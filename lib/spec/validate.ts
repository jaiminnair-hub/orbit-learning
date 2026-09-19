import { z } from "zod";
import type { Block, Layer } from "./blocks";
import { checkAccessibility } from "./accessibility";
import { CourseSpec, type Page, type Section } from "./course-spec";
import { type Finding, type FindingKind, type FindingSeverity, pointer, summarise, type ValidationReport } from "./findings";
import type { Action, Trigger } from "./interactions";
import { isSupportedSpecSchemaVersion } from "./version";

/**
 * Two-layer validation.
 *
 * **Structural** (`CourseSpec.safeParse`) catches shape: wrong types, unknown
 * block kinds, missing required fields, out-of-range numbers.
 *
 * **Semantic** catches everything JSON Schema cannot express — and it is most
 * of what actually goes wrong with a generated course. A trigger pointing at a
 * block that does not exist is perfectly well-shaped and completely broken.
 *
 * Nothing here repairs the document. Per PHASE3_AI_ARCHITECTURE.md §4 a failed
 * generation is an honest outcome; a silently-fixed one is a course whose
 * behaviour nobody can explain later.
 */

/** URL schemes an authored link may use. Anything else is an error. */
const ALLOWED_LINK_SCHEMES = ["http:", "https:", "mailto:"];

type Ctx = {
  findings: Finding[];
  add: (f: Omit<Finding, "kind"> & { kind?: FindingKind }) => void;
};

function createCtx(): Ctx {
  const findings: Finding[] = [];
  return {
    findings,
    add: (f) => findings.push({ kind: "semantic", ...f } as Finding),
  };
}

/** Every addressable id in the document, with where it was found. */
type SpecIndex = {
  sections: Map<string, string>;
  pages: Map<string, string>;
  blocks: Map<string, { path: string; type: string; pageId: string }>;
  layers: Map<string, { path: string; pageId: string }>;
  variables: Map<string, { path: string; type: string }>;
  states: Map<string, Set<string>>;
  cuePoints: Map<string, string>;
  /**
   * Addressable sub-elements: hotspot markers, accordion items, tabs, cards,
   * scenario steps and so on. A trigger firing "when the learner clicks hotspot
   * h1" is the common case in both Rise and Storyline, so these must be
   * resolvable trigger sources rather than unknown ids.
   */
  parts: Map<string, { blockId: string; pageId: string }>;
  /** Block ids per page, for timeline-track checks. */
  blocksByPage: Map<string, Set<string>>;
};

/**
 * Ids of the interactive sub-elements a trigger may fire on.
 *
 * Deliberately explicit per block type rather than a recursive sweep for
 * anything shaped like an id: the addressable surface is part of the contract,
 * not an accident of which fields happen to be named `id`.
 */
function partIdsOf(block: Block | Layer["blocks"][number]): string[] {
  switch (block.type) {
    case "hotspot":
      return block.hotspots.map((h) => h.id);
    case "labeledGraphic":
      return block.markers.map((m) => m.id);
    case "accordion":
      return block.items.map((i) => i.id);
    case "tabs":
      return block.tabs.map((t) => t.id);
    case "flashcards":
      return block.cards.map((c) => c.id);
    case "process":
      return block.steps.map((s) => s.id);
    case "imageGallery":
      return block.images.map((i) => i.id);
    case "sorting":
      return [...block.categories.map((c) => c.id), ...block.cards.map((c) => c.id)];
    case "scenario":
      return block.steps.flatMap((s) => [s.id, ...(s.choices ?? []).map((c) => c.id)]);
    case "knowledgeCheck":
    case "quiz":
      return block.items.flatMap((item) => [
        item.id,
        ...("choices" in item ? item.choices.map((c) => c.id) : []),
        ...("steps" in item ? item.steps.map((s) => s.id) : []),
      ]);
    default:
      return [];
  }
}

function eachBlock(page: Page): Array<{ block: Block | Layer["blocks"][number]; path: string; inLayer: boolean }> {
  const out: Array<{ block: Block | Layer["blocks"][number]; path: string; inLayer: boolean }> = [];
  page.blocks.forEach((block, bi) => {
    out.push({ block, path: pointer("blocks", bi), inLayer: false });
    const layers = (block as Block).layers ?? [];
    layers.forEach((layer, li) => {
      layer.blocks.forEach((lb, lbi) => {
        out.push({
          block: lb,
          path: pointer("blocks", bi, "layers", li, "blocks", lbi),
          inLayer: true,
        });
      });
    });
  });
  return out;
}

function buildIndex(spec: CourseSpec, ctx: Ctx): SpecIndex {
  const index: SpecIndex = {
    sections: new Map(),
    pages: new Map(),
    blocks: new Map(),
    layers: new Map(),
    variables: new Map(),
    states: new Map(),
    cuePoints: new Map(),
    parts: new Map(),
    blocksByPage: new Map(),
  };

  /**
   * One global id namespace.
   *
   * `trigger.onId` is untyped — it may name a block, a layer, a cue point or a
   * sub-element — so those at minimum must not collide. Applying the rule to
   * everything is simpler to explain than a partial rule, and removes a class
   * of ambiguity rather than documenting around it.
   */
  const seen = new Set<string>();

  const claim = <T>(map: Map<string, T>, id: string, value: T, what: string, path: string, pageId?: string) => {
    if (seen.has(id)) {
      ctx.add({
        code: "DUPLICATE_ID",
        severity: "error",
        message: `Duplicate id '${id}' (${what}). Ids must be unique across the whole specification — they are how triggers, timelines and validation findings address content.`,
        path,
        pageId,
      });
      return;
    }
    seen.add(id);
    map.set(id, value);
  };

  (spec.variables ?? []).forEach((v, i) => {
    claim(index.variables, v.id, { path: pointer("variables", i), type: v.type }, "variable", pointer("variables", i));
  });

  spec.sections.forEach((section: Section, si) => {
    const sectionPath = pointer("sections", si);
    claim(index.sections, section.id, sectionPath, "section", sectionPath);

    section.pages.forEach((page, pi) => {
      const pagePath = `${sectionPath}${pointer("pages", pi)}`;
      claim(index.pages, page.id, pagePath, "page", pagePath);
      index.blocksByPage.set(page.id, new Set());

      (page.timeline?.cuePoints ?? []).forEach((cue, ci) => {
        claim(index.cuePoints, cue.id, `${pagePath}${pointer("timeline", "cuePoints", ci)}`, "cue point", pagePath, page.id);
      });

      for (const { block, path } of eachBlock(page)) {
        const blockPath = `${pagePath}${path}`;
        claim(index.blocks, block.id, { path: blockPath, type: block.type, pageId: page.id }, "block", blockPath, page.id);
        index.blocksByPage.get(page.id)!.add(block.id);

        const stateIds = new Set<string>();
        (block.states ?? []).forEach((s) => stateIds.add(s.id));
        index.states.set(block.id, stateIds);

        for (const partId of partIdsOf(block)) {
          claim(index.parts, partId, { blockId: block.id, pageId: page.id }, "element", blockPath, page.id);
        }

        for (const layer of (block as Block).layers ?? []) {
          claim(index.layers, layer.id, { path: blockPath, pageId: page.id }, "layer", blockPath, page.id);
        }
      }
    });
  });

  return index;
}

function checkAction(action: Action, path: string, index: SpecIndex, ctx: Ctx, pageId?: string) {
  const missing = (what: string, id: string, code: string) =>
    ctx.add({
      code,
      severity: "error",
      message: `Trigger action '${action.kind}' targets ${what} '${id}', which does not exist in this specification.`,
      path,
      pageId,
    });

  switch (action.kind) {
    case "setVariable": {
      if (!index.variables.has(action.variableId)) missing("variable", action.variableId, "ACTION_VARIABLE_MISSING");
      if (action.fromVariableId && !index.variables.has(action.fromVariableId)) {
        missing("variable", action.fromVariableId, "ACTION_VARIABLE_MISSING");
      }
      if (action.value === undefined && !action.fromVariableId && action.operation !== "toggle") {
        ctx.add({
          code: "ACTION_VALUE_MISSING",
          severity: "error",
          message: `'setVariable' with operation '${action.operation}' needs either a value or fromVariableId.`,
          path,
          pageId,
        });
      }
      break;
    }
    case "showBlock":
    case "hideBlock":
    case "playMedia":
    case "pauseMedia":
    case "seekMedia":
    case "submitAnswer":
    case "resetBlock":
      if (!index.blocks.has(action.blockId)) missing("block", action.blockId, "ACTION_BLOCK_MISSING");
      break;
    case "markComplete":
      if (action.blockId && !index.blocks.has(action.blockId)) missing("block", action.blockId, "ACTION_BLOCK_MISSING");
      break;
    case "setState": {
      if (!index.blocks.has(action.blockId)) {
        missing("block", action.blockId, "ACTION_BLOCK_MISSING");
      } else if (!index.states.get(action.blockId)?.has(action.stateId)) {
        ctx.add({
          code: "ACTION_STATE_MISSING",
          severity: "error",
          message: `Block '${action.blockId}' has no state '${action.stateId}'.`,
          path,
          pageId,
          blockId: action.blockId,
        });
      }
      break;
    }
    case "showLayer":
    case "hideLayer":
      if (!index.layers.has(action.layerId)) missing("layer", action.layerId, "ACTION_LAYER_MISSING");
      break;
    case "navigate":
      if (action.target.kind === "page" && !index.pages.has(action.target.pageId)) {
        missing("page", action.target.pageId, "ACTION_PAGE_MISSING");
      }
      break;
    default:
      break;
  }
}

function checkTrigger(trigger: Trigger, path: string, index: SpecIndex, ctx: Ctx, pageId?: string) {
  if (trigger.onId) {
    const known =
      index.blocks.has(trigger.onId) ||
      index.layers.has(trigger.onId) ||
      index.cuePoints.has(trigger.onId) ||
      index.parts.has(trigger.onId);
    if (!known) {
      ctx.add({
        code: "TRIGGER_SOURCE_MISSING",
        severity: "error",
        message: `Trigger fires on '${trigger.onId}', which is not a block, layer, cue point or interactive element in this specification.`,
        path,
        pageId,
      });
    }
  }

  const needsSource: string[] = ["click", "doubleClick", "hover", "hoverOut", "focus", "blur", "mediaComplete", "mediaStart", "timelineCue", "blockComplete", "answerSubmitted", "layerShown", "layerHidden"];
  if (needsSource.includes(trigger.when) && !trigger.onId) {
    ctx.add({
      code: "TRIGGER_SOURCE_REQUIRED",
      severity: "error",
      message: `Trigger event '${trigger.when}' needs an onId naming what it fires on.`,
      path,
      pageId,
    });
  }

  const comparisons = [
    ...(trigger.condition?.all ?? []),
    ...(trigger.condition?.any ?? []),
    ...(trigger.condition?.none ?? []),
  ];
  comparisons.forEach((c, ci) => {
    const cPath = `${path}${pointer("condition", ci)}`;
    if (c.kind === "variable" && !index.variables.has(c.variableId)) {
      ctx.add({ code: "CONDITION_VARIABLE_MISSING", severity: "error", message: `Condition references variable '${c.variableId}', which is not declared.`, path: cPath, pageId });
    }
    if (c.kind === "pageVisited" && !index.pages.has(c.pageId)) {
      ctx.add({ code: "CONDITION_PAGE_MISSING", severity: "error", message: `Condition references page '${c.pageId}', which does not exist.`, path: cPath, pageId });
    }
    if ((c.kind === "blockCompleted" || c.kind === "answerCorrect") && !index.blocks.has(c.blockId)) {
      ctx.add({ code: "CONDITION_BLOCK_MISSING", severity: "error", message: `Condition references block '${c.blockId}', which does not exist.`, path: cPath, pageId });
    }
    if (c.kind === "blockState") {
      if (!index.blocks.has(c.blockId)) {
        ctx.add({ code: "CONDITION_BLOCK_MISSING", severity: "error", message: `Condition references block '${c.blockId}', which does not exist.`, path: cPath, pageId });
      } else if (!index.states.get(c.blockId)?.has(c.stateId)) {
        ctx.add({ code: "CONDITION_STATE_MISSING", severity: "error", message: `Block '${c.blockId}' has no state '${c.stateId}'.`, path: cPath, pageId });
      }
    }
    if (c.kind === "layerVisible" && !index.layers.has(c.layerId)) {
      ctx.add({ code: "CONDITION_LAYER_MISSING", severity: "error", message: `Condition references layer '${c.layerId}', which does not exist.`, path: cPath, pageId });
    }
  });

  trigger.actions.forEach((a, ai) => checkAction(a, `${path}${pointer("actions", ai)}`, index, ctx, pageId));
}

/** Rich text links, checked wherever they appear. */
function checkRichTextLinks(value: unknown, path: string, ctx: Ctx, pageId?: string, blockId?: string) {
  if (!value || typeof value !== "object") return;
  const rt = value as { blocks?: Array<{ spans?: Array<{ link?: { href?: string } }> }> };
  if (!Array.isArray(rt.blocks)) return;

  rt.blocks.forEach((b, bi) => {
    (b.spans ?? []).forEach((span, si) => {
      const href = span.link?.href;
      if (!href) return;
      let scheme: string | null = null;
      try {
        scheme = new URL(href).protocol;
      } catch {
        // Relative links are permitted within a course.
        if (href.startsWith("/") || href.startsWith("#")) return;
      }
      if (scheme === null || !ALLOWED_LINK_SCHEMES.includes(scheme)) {
        ctx.add({
          code: "LINK_SCHEME_NOT_ALLOWED",
          severity: "error",
          message: `Link '${href.slice(0, 80)}' uses a scheme that is not allowed. Permitted: ${ALLOWED_LINK_SCHEMES.join(", ")}.`,
          path: `${path}${pointer("blocks", bi, "spans", si, "link")}`,
          pageId,
          blockId,
        });
      }
    });
  });
}

function checkBlockContent(
  block: Block | Layer["blocks"][number],
  path: string,
  index: SpecIndex,
  ctx: Ctx,
  page: Page,
  isCanvas: boolean
) {
  const pageId = page.id;
  const blockId = block.id;

  // --- layout: position is only meaningful on a canvas page
  if (block.position && !isCanvas) {
    ctx.add({
      code: "POSITION_ON_FLOW_PAGE",
      severity: "error",
      message: `Block '${blockId}' has an absolute position, but page '${pageId}' uses flow layout. Set the page layout mode to 'canvas', or remove the position — silently ignoring it would discard authoring intent.`,
      path: `${path}/position`,
      pageId,
      blockId,
    });
  }
  if (!block.position && isCanvas) {
    ctx.add({
      code: "POSITION_MISSING_ON_CANVAS",
      severity: "warning",
      message: `Block '${blockId}' has no position on a canvas page; the runtime will fall back to flow placement.`,
      path,
      pageId,
      blockId,
    });
  }

  // --- states
  (block.states ?? []).forEach((s, i) => {
    if (s.name === "custom" && !s.customName) {
      ctx.add({
        code: "CUSTOM_STATE_UNNAMED",
        severity: "error",
        message: `Custom state on block '${blockId}' needs a customName.`,
        path: `${path}${pointer("states", i)}`,
        pageId,
        blockId,
      });
    }
  });

  (block.triggers ?? []).forEach((t, i) =>
    checkTrigger(t, `${path}${pointer("triggers", i)}`, index, ctx, pageId)
  );

  // Accessibility moved to lib/spec/accessibility.ts in Phase 3 step 10.
  // It was two inline warnings here; it is now a rule set with its own
  // severity model driven by `meta.accessibilityProfile`, and it runs as its
  // own pass at the end of validateCourseSpec().

  // --- per-type referential integrity
  switch (block.type) {
    case "text":
      checkRichTextLinks(block.content, `${path}/content`, ctx, pageId, blockId);
      break;
    case "sorting": {
      const categoryIds = new Set(block.categories.map((c) => c.id));
      block.cards.forEach((card, i) => {
        if (!categoryIds.has(card.categoryId)) {
          ctx.add({
            code: "SORTING_CATEGORY_MISSING",
            severity: "error",
            message: `Sorting card '${card.id}' belongs to category '${card.categoryId}', which this block does not define.`,
            path: `${path}${pointer("cards", i)}`,
            pageId,
            blockId,
          });
        }
      });
      break;
    }
    case "scenario": {
      const stepIds = new Set(block.steps.map((s) => s.id));
      block.steps.forEach((step, si) => {
        (step.choices ?? []).forEach((choice, ci) => {
          if (choice.nextStepId && !stepIds.has(choice.nextStepId)) {
            ctx.add({
              code: "SCENARIO_STEP_MISSING",
              severity: "error",
              message: `Scenario choice points at step '${choice.nextStepId}', which this scenario does not contain.`,
              path: `${path}${pointer("steps", si, "choices", ci)}`,
              pageId,
              blockId,
            });
          }
        });
      });
      break;
    }
    case "continue": {
      (block.requiresBlockIds ?? []).forEach((id, i) => {
        if (!index.blocks.has(id)) {
          ctx.add({
            code: "CONTINUE_REQUIREMENT_MISSING",
            severity: "error",
            message: `Continue block requires block '${id}', which does not exist.`,
            path: `${path}${pointer("requiresBlockIds", i)}`,
            pageId,
            blockId,
          });
        }
      });
      break;
    }
    case "knowledgeCheck":
    case "quiz": {
      block.items.forEach((item, i) => {
        const itemPath = `${path}${pointer("items", i)}`;
        if (item.kind === "multipleChoice") {
          const correct = item.choices.filter((c) => c.correct).length;
          if (correct !== 1) {
            ctx.add({
              code: "MCQ_CORRECT_COUNT",
              severity: "error",
              message: `Multiple-choice item '${item.id}' has ${correct} correct choices; it must have exactly one.`,
              path: itemPath,
              pageId,
              blockId,
            });
          }
        }
        if (item.kind === "multipleResponse" && !item.choices.some((c) => c.correct)) {
          ctx.add({
            code: "MULTI_RESPONSE_NO_CORRECT",
            severity: "error",
            message: `Multiple-response item '${item.id}' has no correct choice.`,
            path: itemPath,
            pageId,
            blockId,
          });
        }
      });
      break;
    }
    default:
      break;
  }
}

function checkTimeline(page: Page, pagePath: string, index: SpecIndex, ctx: Ctx, isCanvas: boolean) {
  const timeline = page.timeline;
  if (!timeline) return;
  const onPage = index.blocksByPage.get(page.id) ?? new Set<string>();

  (timeline.tracks ?? []).forEach((track, ti) => {
    const tPath = `${pagePath}${pointer("timeline", "tracks", ti)}`;
    if (!onPage.has(track.blockId)) {
      ctx.add({
        code: "TIMELINE_BLOCK_MISSING",
        severity: "error",
        message: `Timeline track references block '${track.blockId}', which is not on page '${page.id}'.`,
        path: tPath,
        pageId: page.id,
      });
    }
    if (
      track.appearAtMs !== undefined &&
      track.disappearAtMs !== undefined &&
      track.disappearAtMs <= track.appearAtMs
    ) {
      ctx.add({
        code: "TIMELINE_RANGE_INVALID",
        severity: "error",
        message: `Timeline track for '${track.blockId}' disappears at ${track.disappearAtMs}ms, at or before it appears (${track.appearAtMs}ms).`,
        path: tPath,
        pageId: page.id,
      });
    }

    (track.animations ?? []).forEach((anim, ai) => {
      const aPath = `${tPath}${pointer("animations", ai)}`;
      if (anim.startMs + anim.durationMs > timeline.durationMs) {
        ctx.add({
          code: "ANIMATION_EXCEEDS_TIMELINE",
          severity: "warning",
          message: `Animation '${anim.id}' ends at ${anim.startMs + anim.durationMs}ms, past the timeline duration of ${timeline.durationMs}ms.`,
          path: aPath,
          pageId: page.id,
        });
      }
      // Motion-path coordinates are design-viewport units, which only exist on
      // a canvas page. On a flow page there is no frame to interpret them in.
      if (anim.kind === "motion" && !isCanvas) {
        ctx.add({
          code: "MOTION_PATH_ON_FLOW_PAGE",
          severity: "error",
          message: `Motion animation '${anim.id}' needs a canvas-layout page; its coordinates have no meaning in flow layout.`,
          path: aPath,
          pageId: page.id,
        });
      }
    });
  });
}

/**
 * Validates a candidate course specification.
 *
 * Accepts `unknown` deliberately: the two callers that matter are an AI
 * response and an HTTP request body, neither of which can be trusted to be
 * anything at all.
 */
export function validateCourseSpec(candidate: unknown): ValidationReport {
  const parsed = CourseSpec.safeParse(candidate);

  if (!parsed.success) {
    const findings: Finding[] = parsed.error.issues.map((issue: z.core.$ZodIssue) => ({
      code: `SCHEMA_${issue.code.toUpperCase()}`,
      kind: "schema" as const,
      severity: "error" as const,
      message: issue.message,
      path: issue.path.length ? pointer(...(issue.path as (string | number)[])) : "/",
    }));
    const declared =
      candidate && typeof candidate === "object" && "specSchemaVersion" in candidate
        ? String((candidate as { specSchemaVersion?: unknown }).specSchemaVersion ?? "")
        : null;
    return summarise(findings, declared || null);
  }

  const spec = parsed.data;
  const ctx = createCtx();

  if (!isSupportedSpecSchemaVersion(spec.specSchemaVersion)) {
    ctx.add({
      code: "SPEC_VERSION_UNSUPPORTED",
      kind: "schema",
      severity: "error",
      message: `Specification declares schema version '${spec.specSchemaVersion}', which this build does not support. Renderers must refuse versions they do not understand rather than guess.`,
      path: "/specSchemaVersion",
    });
  }

  const index = buildIndex(spec, ctx);

  // Variable initial values must match their declared type.
  (spec.variables ?? []).forEach((v, i) => {
    if (v.initial === undefined) return;
    const actual = typeof v.initial;
    const expected = v.type === "text" ? "string" : v.type;
    if (actual !== expected) {
      ctx.add({
        code: "VARIABLE_INITIAL_TYPE",
        severity: "error",
        message: `Variable '${v.id}' is declared ${v.type} but its initial value is a ${actual}.`,
        path: pointer("variables", i, "initial"),
      });
    }
  });

  if (spec.sections.length === 0) {
    ctx.add({ code: "SPEC_EMPTY", severity: "warning", message: "Specification has no sections.", path: "/sections" });
  }

  spec.sections.forEach((section, si) => {
    const sectionPath = pointer("sections", si);
    if (section.pages.length === 0) {
      ctx.add({ code: "SECTION_EMPTY", severity: "warning", message: `Section '${section.id}' has no pages.`, path: sectionPath, sectionId: section.id });
    }

    section.pages.forEach((page, pi) => {
      const pagePath = `${sectionPath}${pointer("pages", pi)}`;
      const isCanvas = page.layout?.mode === "canvas";

      if (page.blocks.length === 0) {
        ctx.add({ code: "PAGE_EMPTY", severity: "warning", message: `Page '${page.id}' has no blocks.`, path: pagePath, sectionId: section.id, pageId: page.id });
      }

      (page.triggers ?? []).forEach((t, i) =>
        checkTrigger(t, `${pagePath}${pointer("triggers", i)}`, index, ctx, page.id)
      );

      for (const { block, path } of eachBlock(page)) {
        checkBlockContent(block, `${pagePath}${path}`, index, ctx, page, isCanvas);
      }

      checkTimeline(page, pagePath, index, ctx, isCanvas);
    });
  });

  // Completion rule integrity.
  if (spec.completion?.rule === "passedQuiz") {
    const quizId = spec.completion.quizBlockId;
    if (!quizId) {
      ctx.add({ code: "COMPLETION_QUIZ_MISSING", severity: "error", message: "Completion rule 'passedQuiz' needs a quizBlockId.", path: "/completion" });
    } else {
      const block = index.blocks.get(quizId);
      if (!block) {
        ctx.add({ code: "COMPLETION_QUIZ_MISSING", severity: "error", message: `Completion references quiz block '${quizId}', which does not exist.`, path: "/completion/quizBlockId" });
      } else if (block.type !== "quiz") {
        ctx.add({ code: "COMPLETION_QUIZ_WRONG_TYPE", severity: "error", message: `Completion references block '${quizId}', which is a '${block.type}', not a quiz.`, path: "/completion/quizBlockId" });
      }
    }
  }

  // The accessibility pass runs last and separately: it answers "can everyone
  // use this?" rather than "will this run?", and its severities are governed
  // by the course's declared accessibility profile rather than being fixed.
  ctx.findings.push(...checkAccessibility(spec));

  return summarise(ctx.findings, spec.specSchemaVersion);
}

/** Convenience wrapper for callers that only care whether it passed. */
export function isValidCourseSpec(candidate: unknown): boolean {
  return validateCourseSpec(candidate).valid;
}

export type { Finding, FindingKind, FindingSeverity, ValidationReport };
