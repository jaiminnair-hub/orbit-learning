import type { Action, AssessmentItem, Block, CourseSpecType as CourseSpec, LeafBlockType as LeafBlock, PageType as Page, Trigger } from "@/lib/spec";
import { scoreAssessment } from "@/lib/assessments/scoring";
import { emptyEffects, type RuntimeEffects, type RuntimeState, type VariableValue } from "./types";

/**
 * The runtime interpreter — `(spec, state, event) -> (state, effects)`.
 *
 * Pure and synchronous throughout: no fetch, no storage, no React. Every
 * trigger is data the engine reads, per lib/spec/interactions.ts's closed
 * declarative design — this file is the switch statement over that closed
 * set, never an evaluator for anything open-ended.
 */

const MAX_CHAINED_NAVIGATIONS = 10;

// --------------------------------------------------------------- lookups

interface FlatPage {
  sectionId: string;
  page: Page;
}

function flattenPages(spec: CourseSpec): FlatPage[] {
  const out: FlatPage[] = [];
  for (const section of spec.sections) {
    for (const page of section.pages) out.push({ sectionId: section.id, page });
  }
  return out;
}

export function firstPageId(spec: CourseSpec): string | null {
  return flattenPages(spec)[0]?.page.id ?? null;
}

export function findPage(spec: CourseSpec, pageId: string | null): Page | null {
  if (!pageId) return null;
  for (const section of spec.sections) {
    for (const page of section.pages) if (page.id === pageId) return page;
  }
  return null;
}

export function currentPage(spec: CourseSpec, state: RuntimeState): Page | null {
  return findPage(spec, state.currentPageId);
}

type AnyBlock = Block | LeafBlock;

/** Finds a block by id anywhere on a page, including inside its blocks' layers. */
function findBlockOnPage(page: Page, blockId: string): AnyBlock | null {
  for (const block of page.blocks) {
    if (block.id === blockId) return block;
    for (const layer of (block as Block).layers ?? []) {
      for (const lb of layer.blocks) if (lb.id === blockId) return lb;
    }
  }
  return null;
}

function findBlockAnywhere(spec: CourseSpec, blockId: string): { block: AnyBlock; page: Page } | null {
  for (const { page } of flattenPages(spec)) {
    const block = findBlockOnPage(page, blockId);
    if (block) return { block, page };
  }
  return null;
}

export function isBlockVisible(state: RuntimeState, block: { id: string; initiallyHidden?: boolean }): boolean {
  const override = state.visibleBlocks[block.id];
  return override ?? !block.initiallyHidden;
}

export function currentBlockStateId(state: RuntimeState, blockId: string): string | undefined {
  return state.blockCurrentStateId[blockId];
}

// ----------------------------------------------------------------- init

export function initRuntimeState(spec: CourseSpec): RuntimeState {
  const variables: Record<string, VariableValue> = {};
  for (const v of spec.variables ?? []) {
    if (v.initial !== undefined) variables[v.id] = v.initial;
    else variables[v.id] = v.type === "number" ? 0 : v.type === "boolean" ? false : "";
  }
  return {
    currentPageId: null,
    variables,
    blockCurrentStateId: {},
    visibleBlocks: {},
    visibleLayers: {},
    visitedPages: [],
    completedBlocks: [],
    quizAttempts: {},
    manuallyCompleted: false,
    completedAt: null,
  };
}

// ------------------------------------------------------------ conditions

type Comparison = NonNullable<NonNullable<Trigger["condition"]>["all"]>[number];

function evaluateComparison(state: RuntimeState, c: Comparison): boolean {
  switch (c.kind) {
    case "variable": {
      const actual = state.variables[c.variableId];
      return compareValues(actual, c.operator, c.value);
    }
    case "pageVisited":
      return state.visitedPages.includes(c.pageId);
    case "blockCompleted":
      return state.completedBlocks.includes(c.blockId);
    case "blockState":
      return state.blockCurrentStateId[c.blockId] === c.stateId;
    case "layerVisible":
      return state.visibleLayers[c.layerId] === true;
    case "answerCorrect":
      return state.quizAttempts[c.blockId]?.passed === true;
    default:
      return false;
  }
}

function compareValues(actual: VariableValue | undefined, operator: string, expected: VariableValue | undefined): boolean {
  switch (operator) {
    case "equals":
      return actual === expected;
    case "notEquals":
      return actual !== expected;
    case "greaterThan":
      return typeof actual === "number" && typeof expected === "number" && actual > expected;
    case "greaterThanOrEqual":
      return typeof actual === "number" && typeof expected === "number" && actual >= expected;
    case "lessThan":
      return typeof actual === "number" && typeof expected === "number" && actual < expected;
    case "lessThanOrEqual":
      return typeof actual === "number" && typeof expected === "number" && actual <= expected;
    case "contains":
      return typeof actual === "string" && typeof expected === "string" && actual.includes(expected);
    case "startsWith":
      return typeof actual === "string" && typeof expected === "string" && actual.startsWith(expected);
    case "isEmpty":
      return actual === undefined || actual === "" || actual === null;
    case "isNotEmpty":
      return actual !== undefined && actual !== "" && actual !== null;
    default:
      return false;
  }
}

function evaluateCondition(state: RuntimeState, condition: Trigger["condition"]): boolean {
  if (!condition) return true;
  const allOk = !condition.all?.length || condition.all.every((c) => evaluateComparison(state, c));
  const anyOk = !condition.any?.length || condition.any.some((c) => evaluateComparison(state, c));
  const noneOk = !condition.none?.length || condition.none.every((c) => !evaluateComparison(state, c));
  return allOk && anyOk && noneOk;
}

// ------------------------------------------------------------- actions

function resolveNavigationTarget(
  spec: CourseSpec,
  state: RuntimeState,
  target: Extract<Action, { kind: "navigate" }>["target"]
): string | "exit" | null {
  const flat = flattenPages(spec);
  switch (target.kind) {
    case "page":
      return target.pageId;
    case "firstPage":
      return flat[0]?.page.id ?? null;
    case "exit":
      return "exit";
    case "next": {
      const idx = flat.findIndex((p) => p.page.id === state.currentPageId);
      return idx >= 0 && idx + 1 < flat.length ? flat[idx + 1].page.id : null;
    }
    case "previous": {
      const idx = flat.findIndex((p) => p.page.id === state.currentPageId);
      return idx > 0 ? flat[idx - 1].page.id : null;
    }
    default:
      return null;
  }
}

function applyValueOperation(
  current: VariableValue | undefined,
  operation: string,
  value: VariableValue | undefined
): VariableValue {
  const num = (v: VariableValue | undefined) => (typeof v === "number" ? v : Number(v ?? 0));
  switch (operation) {
    case "set":
      return value ?? current ?? "";
    case "add":
      return num(current) + num(value);
    case "subtract":
      return num(current) - num(value);
    case "multiply":
      return num(current) * num(value);
    case "divide":
      return num(value) === 0 ? num(current) : num(current) / num(value);
    case "toggle":
      return !(typeof current === "boolean" ? current : Boolean(current));
    case "append":
      return `${current ?? ""}${value ?? ""}`;
    default:
      return current ?? "";
  }
}

/** Mutates the working copies passed in; callers own cloning. */
function applyAction(spec: CourseSpec, state: RuntimeState, effects: RuntimeEffects, action: Action, depth: number): void {
  switch (action.kind) {
    case "setVariable": {
      const source = action.fromVariableId ? state.variables[action.fromVariableId] : action.value;
      state.variables[action.variableId] = applyValueOperation(state.variables[action.variableId], action.operation, source);
      break;
    }
    case "showBlock":
      state.visibleBlocks[action.blockId] = true;
      break;
    case "hideBlock":
      state.visibleBlocks[action.blockId] = false;
      break;
    case "setState":
      state.blockCurrentStateId[action.blockId] = action.stateId;
      break;
    case "showLayer":
      state.visibleLayers[action.layerId] = true;
      break;
    case "hideLayer":
      state.visibleLayers[action.layerId] = false;
      break;
    case "navigate": {
      const dest = resolveNavigationTarget(spec, state, action.target);
      if (dest === "exit") {
        effects.exited = true;
      } else if (dest) {
        transitionToPage(spec, state, effects, dest, depth + 1);
      }
      break;
    }
    case "markComplete":
      if (action.blockId) {
        if (!state.completedBlocks.includes(action.blockId)) state.completedBlocks.push(action.blockId);
      } else {
        state.manuallyCompleted = true;
      }
      break;
    case "emitStatement":
      effects.xapi.push({ verb: action.verb, objectId: action.objectId });
      break;
    case "playTimeline":
      effects.timelineControl = "play";
      break;
    case "pauseTimeline":
      effects.timelineControl = "pause";
      break;
    // playMedia/pauseMedia/seekMedia/seekTimeline: rendering concerns handed to the
    // player component, not interpreter state — Step 5 does not persist mid-media/
    // timeline position (deferred; see DEVELOPMENT_SEQUENCE_PHASE3.md). Unlike
    // play/pause above, a seek has no meaningful state to signal through
    // RuntimeEffects without also carrying a target time; revisit alongside real
    // animation playback (Phase 3B) rather than half-wiring it now.
    case "playMedia":
    case "pauseMedia":
    case "seekMedia":
    case "resetBlock":
    case "seekTimeline":
    case "submitAnswer":
      break;
    default:
      break;
  }
}

function runTriggers(spec: CourseSpec, state: RuntimeState, effects: RuntimeEffects, triggers: Trigger[], depth: number): void {
  for (const trigger of triggers) {
    if (!evaluateCondition(state, trigger.condition)) continue;
    for (const action of trigger.actions) applyAction(spec, state, effects, action, depth);
  }
}

// -------------------------------------------------------------- paging

function transitionToPage(spec: CourseSpec, state: RuntimeState, effects: RuntimeEffects, pageId: string, depth: number): void {
  if (depth > MAX_CHAINED_NAVIGATIONS) return; // guards against a pathological pageEnter/navigate cycle
  const fromPage = findPage(spec, state.currentPageId);
  if (fromPage && fromPage.id !== pageId) {
    // Real bug found and fixed alongside timeline-cue firing (2026-09-11):
    // this ran every trigger on the page regardless of its own `when`, so a
    // `pageExit` trigger fired on entry too, and vice versa — invisible
    // before because nothing authorable had a page-level `when` other than
    // pageEnter/pageExit, so mixing the two on one page just double-fired
    // both without anyone noticing. Now that timelineCue/timelineComplete
    // are also page-level triggers, unfiltered dispatch is a real, visible
    // bug, not just a latent one.
    runTriggers(
      spec,
      state,
      effects,
      (fromPage.triggers ?? []).filter((t) => t.when === "pageExit"),
      depth
    );
  }

  const toPage = findPage(spec, pageId);
  if (!toPage) return;

  state.currentPageId = pageId;
  if (!state.visitedPages.includes(pageId)) state.visitedPages.push(pageId);
  effects.navigatedTo = pageId;
  effects.xapi.push({ verb: "progressed", objectId: pageId });

  runTriggers(
    spec,
    state,
    effects,
    (toPage.triggers ?? []).filter((t) => t.when === "pageEnter"),
    depth
  );
  applyCompletionCheck(spec, state, effects);
}

// ---------------------------------------------------------- completion

function allTopLevelBlockIds(spec: CourseSpec): string[] {
  const ids: string[] = [];
  for (const { page } of flattenPages(spec)) for (const b of page.blocks) ids.push(b.id);
  return ids;
}

function isCourseCompleteNow(spec: CourseSpec, state: RuntimeState): boolean {
  const rule = spec.completion?.rule ?? "allPagesVisited";
  switch (rule) {
    case "allPagesVisited": {
      const allPageIds = flattenPages(spec).map((p) => p.page.id);
      return allPageIds.length > 0 && allPageIds.every((id) => state.visitedPages.includes(id));
    }
    case "allBlocksComplete": {
      const ids = allTopLevelBlockIds(spec);
      return ids.length > 0 && ids.every((id) => state.completedBlocks.includes(id));
    }
    case "passedQuiz": {
      const quizId = spec.completion?.quizBlockId;
      return !!quizId && state.quizAttempts[quizId]?.passed === true;
    }
    case "manual":
      return state.manuallyCompleted;
    default:
      return false;
  }
}

function applyCompletionCheck(spec: CourseSpec, state: RuntimeState, effects: RuntimeEffects): void {
  if (state.completedAt) return; // already completed; do not re-fire completion statements
  if (!isCourseCompleteNow(spec, state)) return;

  state.completedAt = new Date().toISOString();
  effects.courseCompleted = true;
  effects.xapi.push({ verb: "completed", result: { completion: true } });

  if (spec.completion?.rule === "passedQuiz" && spec.completion.quizBlockId) {
    const attempt = state.quizAttempts[spec.completion.quizBlockId];
    effects.xapi.push({
      verb: attempt?.passed ? "passed" : "failed",
      objectId: spec.completion.quizBlockId,
      result: { success: attempt?.passed ?? false, scorePercent: attempt?.scorePercent },
    });
  }
}

// ------------------------------------------------------------- scoring

/**
 * Delegates to lib/assessments/scoring.ts — the standalone assessment
 * engine's own scorer over the same AssessmentItem shape, unified
 * 2026-09-03. This file used to carry a private reimplementation that had
 * already drifted (whole-number vs 2-decimal rounding); one scorer for one
 * item shape, not two that can silently disagree at the margins.
 */
function scoreItems(items: AssessmentItem[], answers: Record<string, unknown>): { scorePercent: number } {
  const scoringItems = items.map((item) => ({ id: item.id, item, points: item.points ?? 1 }));
  return { scorePercent: scoreAssessment(scoringItems, answers).scorePercent };
}

// ------------------------------------------------------------ public API

export function enterPage(spec: CourseSpec, state: RuntimeState, pageId: string): { state: RuntimeState; effects: RuntimeEffects } {
  const next = clone(state);
  const effects = emptyEffects();
  transitionToPage(spec, next, effects, pageId, 0);
  return { state: next, effects };
}

export function fireBlockEvent(
  spec: CourseSpec,
  state: RuntimeState,
  blockId: string,
  when: Trigger["when"],
  onId?: string
): { state: RuntimeState; effects: RuntimeEffects } {
  const next = clone(state);
  const effects = emptyEffects();
  const found = findBlockAnywhere(spec, blockId);
  if (!found) return { state: next, effects };

  effects.xapi.push({ verb: "interacted", objectId: blockId });

  const matching = (found.block.triggers ?? []).filter(
    (t) => t.when === when && (t.onId == null || t.onId === (onId ?? blockId))
  );
  runTriggers(spec, next, effects, matching, 0);
  applyCompletionCheck(spec, next, effects);
  return { state: next, effects };
}

/**
 * Fires a page-scoped event — `timelineCue` (`onId` is the cue point's id) or
 * `timelineComplete` (no `onId`, matching `pageEnter`/`pageExit`'s existing
 * shape). Triggers for these live on `page.triggers`, same place
 * `pageEnter`/`pageExit` already do, not on a block — a cue point belongs to
 * the page's timeline, not to any one block on it.
 */
export function firePageEvent(
  spec: CourseSpec,
  state: RuntimeState,
  when: Extract<Trigger["when"], "timelineCue" | "timelineComplete">,
  onId?: string
): { state: RuntimeState; effects: RuntimeEffects } {
  const next = clone(state);
  const effects = emptyEffects();
  const page = currentPage(spec, next);
  if (!page) return { state: next, effects };

  const matching = (page.triggers ?? []).filter((t) => t.when === when && (t.onId == null || t.onId === onId));
  runTriggers(spec, next, effects, matching, 0);
  applyCompletionCheck(spec, next, effects);
  return { state: next, effects };
}

export function submitQuiz(
  spec: CourseSpec,
  state: RuntimeState,
  blockId: string,
  answers: Record<string, unknown>
): { state: RuntimeState; effects: RuntimeEffects } {
  const next = clone(state);
  const effects = emptyEffects();
  const found = findBlockAnywhere(spec, blockId);
  if (!found || (found.block.type !== "quiz" && found.block.type !== "knowledgeCheck")) {
    return { state: next, effects };
  }

  const { scorePercent } = scoreItems(found.block.items, answers);
  const passingScore = found.block.type === "quiz" ? (found.block.passingScorePercent ?? 100) : 100;
  const passed = scorePercent >= passingScore;

  next.quizAttempts[blockId] = { answers, scorePercent, passed, submittedAt: new Date().toISOString() };
  if (!next.completedBlocks.includes(blockId)) next.completedBlocks.push(blockId);

  effects.xapi.push({ verb: "answered", objectId: blockId, result: { success: passed, scorePercent } });

  const matching = (found.block.triggers ?? []).filter((t) => t.when === "answerSubmitted" && (t.onId == null || t.onId === blockId));
  runTriggers(spec, next, effects, matching, 0);
  applyCompletionCheck(spec, next, effects);
  return { state: next, effects };
}

/**
 * Closes a dismissible layer from its own close affordance — UI chrome the
 * runtime adds for `Layer.dismissible`, not a spec-authored trigger, so it
 * bypasses trigger evaluation entirely rather than synthesizing a fake one.
 */
export function closeLayer(state: RuntimeState, layerId: string): RuntimeState {
  const next = clone(state);
  next.visibleLayers[layerId] = false;
  return next;
}

function clone(state: RuntimeState): RuntimeState {
  return {
    currentPageId: state.currentPageId,
    variables: { ...state.variables },
    blockCurrentStateId: { ...state.blockCurrentStateId },
    visibleBlocks: { ...state.visibleBlocks },
    visibleLayers: { ...state.visibleLayers },
    visitedPages: [...state.visitedPages],
    completedBlocks: [...state.completedBlocks],
    quizAttempts: { ...state.quizAttempts },
    manuallyCompleted: state.manuallyCompleted,
    completedAt: state.completedAt,
  };
}

export { isCourseCompleteNow };
