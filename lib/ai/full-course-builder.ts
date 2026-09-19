import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { generationZodSchemas, SPEC_SCHEMA_VERSION, validateCourseSpec, type CourseSpecType } from "@/lib/spec";
import { richText, specId } from "@/lib/authoring/block-factory";
import { isPublishable, recordValidationReport } from "@/lib/authoring/spec-store";
import { specSearchText } from "@/lib/authoring/spec-text";
import { generateStructured, isRealProviderConfigured } from "./gateway";
import { AiGatewayError } from "./types";

/**
 * The full AI generation pipeline — Phase 3 step 8, docs/PHASE3_AI_ARCHITECTURE.md
 * §5. Everything AI Course Builder Lite (lib/ai/course-builder.ts) deliberately
 * left out: every page generated (not one), knowledge-check items at section
 * checkpoints, skill tagging, and an honest accessibility pass — assembled
 * from document sources (PDF/DOCX/PPTX/URL, lib/authoring/extract.ts) as well
 * as pasted text.
 *
 * Still no new AI abstraction and no new authoring data model: every
 * generation call goes through the same `generateStructured` gateway and the
 * same narrow `generationZodSchemas`, the result is still one
 * `course_specifications` row entering at `status = draft`, and nothing here
 * bypasses the existing draft/review/publish workflow.
 *
 * What *is* new is how the job runs. Lite's three calls comfortably fit one
 * request's lifetime. A full course can be outline + objectives + up to ~24
 * pages + a handful of checkpoint quizzes + skill tagging — plausibly a
 * couple of minutes of sequential AI calls, which is not a safe assumption
 * to make about any single serverless invocation's time budget on any
 * hosting plan. So this still runs as a **chain of short invocations**, each
 * processing as many steps as fit inside a small, conservative time budget —
 * but nothing here hands off to the next one anymore.
 *
 * **Real incident, 2026-09-11**: the original design had each invocation make
 * an authenticated HTTP call to its own "advance" route to trigger a fresh
 * invocation — no queue, no new infrastructure, and it worked, until it
 * didn't: reproduced live in production, a job would advance for a handful
 * of steps and then go permanently silent, `[full-course-builder] unable to
 * queue continuation` logged with **HTTP 508 — Loop Detected**. That is
 * Vercel's own platform-level guard against a deployment's functions calling
 * each other in a cycle, and it does not care that the "cycle" here is a
 * deliberate, bounded hand-off — enough hops in a short enough window and it
 * cuts the chain, silently as far as the job row is concerned (see the old
 * `triggerContinuation`'s own comment, since deleted, which called this "a
 * real, known gap" without yet knowing the cause). Retrying the same
 * self-call harder would not have helped; the pattern itself is what a
 * hosting platform's loop protection exists to stop.
 *
 * The fix removes the self-call entirely. `advanceFullCourseJob` now just
 * *stops* when its invocation's time budget is spent, leaving the job
 * `running` with its steps saved — exactly like before a hand-off used to
 * fire. What used to be a server-triggered continuation is now client-driven
 * instead: `components/authoring/ai-generate-panel.tsx`'s poll loop (already
 * polling every 2s to update the progress label) awaits one
 * `POST .../resume-full` per tick whenever it sees no new step, which runs
 * this same function again from a fresh request — a real browser tab
 * calling an authenticated endpoint, not one deployment function calling
 * itself, so Vercel's loop guard has nothing to see. `tryAppendStep`'s
 * existing optimistic-concurrency check (below) was already safe against two
 * overlapping invocations before this change; it is what makes an
 * occasional redundant resume call harmless rather than a new race.
 */

// ---------------------------------------------------------------- plan

type PlannedStep =
  | { kind: "outline" }
  | { kind: "objectives" }
  | { kind: "page"; sectionIndex: number; pageIndex: number }
  | { kind: "items"; sectionIndex: number; pageIndex: number }
  | { kind: "skill_tags" }
  | { kind: "assemble" };

interface JobStepRecord {
  index: number;
  kind: PlannedStep["kind"];
  status: "succeeded" | "failed";
  provider?: string;
  model?: string;
  error?: string;
  /** For "page" and "items" only — which page in the outline this result belongs to. */
  sectionIndex?: number;
  pageIndex?: number;
  /** The step's structured output, read back during assembly. Absent on failure. */
  data?: unknown;
}

// Real courses, kept bounded regardless of what the model proposes — a
// predictable cost/time ceiling matters more here than accommodating an
// outlier outline. Excess sections/pages are trimmed, not rejected: a
// slightly shorter course beats a failed job.
const MAX_SECTIONS = 8;
const MAX_PAGES_PER_SECTION = 6;
const MAX_TOTAL_PAGES = 24;

const MAX_STEPS = 80;
const MAX_TOTAL_JOB_MS = 60 * 60 * 1000;
/** Conservative on purpose: comfortably inside even the tightest plan's per-invocation limit. */
// Overridable via env var purely as a test seam (forcing it to ~0 makes
// every invocation hand off immediately, so the chaining path itself — not
// just the "everything fits in one call" happy path — is exercisable
// without a real multi-minute course). Production never sets this.
const TIME_BUDGET_PER_INVOCATION_MS = Number(process.env.AI_FULL_COURSE_STEP_BUDGET_MS ?? 8_000);

export const MIN_SOURCE_TEXT_LENGTH = 40;
/** Matches lib/authoring/extract.ts's own extraction cap — a document's full extracted text is the expected size here, not a short paste. */
export const MAX_SOURCE_TEXT_LENGTH = 200_000;

export interface FullCourseBuilderRequest {
  orgId: string;
  userId: string;
  jobId: string;
  sourceText: string;
  titleHint?: string;
  sourceKind: "prompt" | "pdf" | "docx" | "pptx" | "url";
}

export function isFullCourseBuilderConfigured(): boolean {
  return isRealProviderConfigured("course_outline");
}

const OUTLINE_INSTRUCTION =
  "You are an instructional designer. The <source_material> is JSON with a `sourceText` field (the material to " +
  "build a course from) and an optional `workingTitle` the author suggested — prefer it if it fits, otherwise " +
  `choose your own. Produce a course title, a one-to-two sentence plain-text description, and up to ${MAX_SECTIONS} ` +
  `sections (modules), each with up to ${MAX_PAGES_PER_SECTION} pages (lessons), titled specifically to the ` +
  "material — not generic placeholders. Cover the material's real structure rather than padding to the maximum. " +
  "Every id must be a short lowercase slug of letters, numbers, '-' or '_', unique across your whole response.";

const OBJECTIVES_INSTRUCTION =
  "The <source_material> is JSON with the original `sourceText` and the `outline` already produced from it. Write " +
  "3-8 clear, measurable learning objectives for the whole course, each starting with an action verb and grounded " +
  "in the source text. Every id must be a short lowercase slug, unique across your response.";

const PAGE_BLOCKS_INSTRUCTION =
  "The <source_material> is JSON with the original `sourceText`, the course `title`, and the `pageTitle` of one " +
  "specific lesson page. Write the content blocks for that one page only, grounded strictly in the source text — " +
  "do not invent facts absent from it. Prefer a short heading plus 2-5 text/list/statement blocks. Every block id " +
  "must be a short lowercase slug, unique within your response.";

const ITEMS_INSTRUCTION =
  "The <source_material> is JSON with the original `sourceText` and the `sectionTitle` of one course section that " +
  "has just ended. Write 2-4 knowledge-check items (multiple choice or true/false) testing whether a learner " +
  "absorbed that section's material, grounded strictly in the source text. Every id must be a short lowercase " +
  "slug, unique within your response.";

const SKILL_TAGS_INSTRUCTION =
  "The <source_material> is JSON with the course `title`, its `objectives`, and its section titles. Suggest 2-6 " +
  "short skill or topic names (2-4 words each, Title Case) this course addresses — the kind of label an HR system " +
  "would use to tag a course by subject. Do not invent a taxonomy; just name the real subjects covered.";

/**
 * Not one of lib/spec's generation schemas — those cover the course
 * specification itself, and a skill *name* is not spec content, it is an
 * input to reconciling against the org's `skill_tags` table (§ below). Kept
 * as narrow as every other step's schema, for the same reason.
 */
const skillTagSuggestionsSchema = z.strictObject({
  skills: z.array(z.string().min(1).max(60)).min(1).max(6),
});

// ---------------------------------------------------------------- outline shaping

type OutlineResult = z.infer<typeof generationZodSchemas.outline>;
type ObjectivesResult = z.infer<typeof generationZodSchemas.objectives>;
type PageBlocksResult = z.infer<typeof generationZodSchemas.pageBlocks>;
type ItemsResult = z.infer<typeof generationZodSchemas.items>;

/** Enforces the hard caps regardless of what the model proposed. Exported for direct unit testing. */
export function trimOutline(outline: OutlineResult): OutlineResult {
  let sections = outline.sections
    .slice(0, MAX_SECTIONS)
    .map((section) => ({ ...section, pages: section.pages.slice(0, MAX_PAGES_PER_SECTION) }));

  let total = sections.reduce((sum, s) => sum + s.pages.length, 0);
  // Trim from the end, one page at a time, until under the total cap —
  // simplest correct approach for a cap that rarely actually binds (only
  // when many sections are each near their own per-section max at once).
  for (let i = sections.length - 1; total > MAX_TOTAL_PAGES && i >= 0; i--) {
    while (sections[i].pages.length > 0 && total > MAX_TOTAL_PAGES) {
      sections[i] = { ...sections[i], pages: sections[i].pages.slice(0, -1) };
      total--;
    }
  }
  sections = sections.filter((s) => s.pages.length > 0);

  return { ...outline, sections };
}

function buildPlanFromOutline(outline: OutlineResult): PlannedStep[] {
  const plan: PlannedStep[] = [{ kind: "objectives" }];

  outline.sections.forEach((section, sectionIndex) => {
    section.pages.forEach((_page, pageIndex) => {
      plan.push({ kind: "page", sectionIndex, pageIndex });
    });
    // One checkpoint quiz per section, attached to its last page.
    plan.push({ kind: "items", sectionIndex, pageIndex: section.pages.length - 1 });
  });

  plan.push({ kind: "skill_tags" }, { kind: "assemble" });
  return plan;
}

// ---------------------------------------------------------------- job row access

interface JobRow {
  id: string;
  org_id: string;
  status: string;
  input: {
    mode: "full";
    sourceKind: FullCourseBuilderRequest["sourceKind"];
    sourceText: string;
    titleHint: string | null;
    createdBy: string;
    /** Grows from a 1-element placeholder to the real plan once the outline step completes. */
    plan: PlannedStep[];
  };
  steps: JobStepRecord[];
  started_at: string | null;
  created_at: string;
  updated_at: string;
}

async function loadJobRow(admin: SupabaseClient, jobId: string): Promise<JobRow | null> {
  const { data, error } = await admin
    .from("authoring_jobs")
    .select("id, org_id, status, input, steps, started_at, created_at, updated_at")
    .eq("id", jobId)
    .single();
  if (error || !data) return null;
  return data as unknown as JobRow;
}

/**
 * Optimistic-concurrency append, mirroring lib/authoring/spec-store.ts's
 * writeSpec — `updated_at` (maintained by the shared set_updated_at()
 * trigger) is the revision token. A 0-row update means another invocation
 * already advanced this job (the initial invocation racing its own
 * self-triggered continuation, most plausibly), so this invocation backs
 * off silently rather than double-processing or erroring.
 */
async function tryAppendStep(
  admin: SupabaseClient,
  job: JobRow,
  step: JobStepRecord,
  planOverride?: PlannedStep[]
): Promise<boolean> {
  const nextInput = planOverride ? { ...job.input, plan: planOverride } : job.input;
  const { data, error } = await admin
    .from("authoring_jobs")
    .update({ steps: [...job.steps, step], input: nextInput, status: "running" })
    .eq("id", job.id)
    .eq("updated_at", job.updated_at)
    .select("id")
    .maybeSingle();
  return !error && Boolean(data);
}

async function markJobFailed(admin: SupabaseClient, jobId: string, message: string): Promise<void> {
  await admin
    .from("authoring_jobs")
    .update({ status: "failed", finished_at: new Date().toISOString(), error: message })
    .eq("id", jobId);
}

function describeGenerationError(error: unknown): string {
  if (error instanceof AiGatewayError) {
    if (error.code === "NO_PROVIDER_CONFIGURED") {
      return "AI generation is not configured for this platform. Add a provider (e.g. ANTHROPIC_API_KEY) to enable AI Course Builder.";
    }
    if (error.code === "BUDGET_EXCEEDED") return error.message;
    if (error.code === "VALIDATION_FAILED") {
      return "The AI provider could not produce output that satisfied the schema within the retry budget.";
    }
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------- one step

/** The single completed step of this kind's stored output — "outline"/"objectives"/"skill_tags" each occur once. */
function findStepData<T>(completedSteps: JobStepRecord[], kind: PlannedStep["kind"]): T | undefined {
  return completedSteps.find((s) => s.kind === kind && s.status === "succeeded")?.data as T | undefined;
}

async function runOneStep(
  request: FullCourseBuilderRequest,
  step: PlannedStep,
  index: number,
  completedSteps: JobStepRecord[]
): Promise<{ record: JobStepRecord; nextPlan?: PlannedStep[] }> {
  const { orgId, userId, jobId, sourceText, titleHint } = request;
  const base = { orgId, userId, jobId };

  try {
    switch (step.kind) {
      case "outline": {
        const result = await generateStructured({
          ...base,
          profile: "course_outline",
          schema: generationZodSchemas.outline,
          instruction: OUTLINE_INSTRUCTION,
          source: JSON.stringify({ workingTitle: titleHint || undefined, sourceText }),
          feature: "authoring.full_course.outline",
        });
        const trimmed = trimOutline(result.data);
        const nextPlan: PlannedStep[] = [{ kind: "outline" }, ...buildPlanFromOutline(trimmed)];
        return {
          record: {
            index,
            kind: "outline",
            status: "succeeded",
            provider: result.meta.provider,
            model: result.meta.model,
            data: trimmed,
          },
          nextPlan,
        };
      }

      case "objectives": {
        const outline = findStepData<OutlineResult>(completedSteps, "outline");
        const result = await generateStructured({
          ...base,
          profile: "course_outline",
          schema: generationZodSchemas.objectives,
          instruction: OBJECTIVES_INSTRUCTION,
          source: JSON.stringify({ sourceText, outline }),
          feature: "authoring.full_course.objectives",
        });
        return {
          record: { index, kind: "objectives", status: "succeeded", provider: result.meta.provider, model: result.meta.model, data: result.data },
        };
      }

      case "page": {
        const outline = findStepData<OutlineResult>(completedSteps, "outline")!;
        const section = outline.sections[step.sectionIndex];
        const page = section.pages[step.pageIndex];
        const result = await generateStructured({
          ...base,
          profile: "content_expansion",
          schema: generationZodSchemas.pageBlocks,
          instruction: PAGE_BLOCKS_INSTRUCTION,
          source: JSON.stringify({ sourceText, title: outline.title, pageTitle: page.title }),
          feature: "authoring.full_course.page",
        });
        return {
          record: {
            index,
            kind: "page",
            status: "succeeded",
            provider: result.meta.provider,
            model: result.meta.model,
            sectionIndex: step.sectionIndex,
            pageIndex: step.pageIndex,
            data: result.data,
          },
        };
      }

      case "items": {
        const outline = findStepData<OutlineResult>(completedSteps, "outline")!;
        const section = outline.sections[step.sectionIndex];
        const result = await generateStructured({
          ...base,
          profile: "item_generation",
          schema: generationZodSchemas.items,
          instruction: ITEMS_INSTRUCTION,
          source: JSON.stringify({ sourceText, sectionTitle: section.title }),
          feature: "authoring.full_course.items",
        });
        return {
          record: {
            index,
            kind: "items",
            status: "succeeded",
            provider: result.meta.provider,
            model: result.meta.model,
            sectionIndex: step.sectionIndex,
            pageIndex: step.pageIndex,
            data: result.data,
          },
        };
      }

      case "skill_tags": {
        const outline = findStepData<OutlineResult>(completedSteps, "outline")!;
        const objectives = findStepData<ObjectivesResult>(completedSteps, "objectives");
        const result = await generateStructured({
          ...base,
          profile: "classification",
          schema: skillTagSuggestionsSchema,
          instruction: SKILL_TAGS_INSTRUCTION,
          source: JSON.stringify({
            title: outline.title,
            objectives: objectives?.objectives.map((o) => o.text) ?? [],
            sections: outline.sections.map((s) => s.title),
          }),
          feature: "authoring.full_course.skill_tags",
        });
        return {
          record: { index, kind: "skill_tags", status: "succeeded", provider: result.meta.provider, model: result.meta.model, data: result.data },
        };
      }

      case "assemble":
        // Handled by the caller — it needs the DB admin client and the
        // whole steps array, neither of which this pure dispatcher has.
        throw new Error("assemble must be handled by the caller");
    }
  } catch (error) {
    const message = describeGenerationError(error);
    return { record: { index, kind: step.kind, status: "failed", error: message } };
  }
}

// ---------------------------------------------------------------- assemble

/**
 * Reconciles the AI's suggested skill names against this org's real
 * `skill_tags` (case-insensitive match; creates a new row for a genuinely
 * new name). A tagging failure — a lookup or insert error for one name — is
 * swallowed rather than failing the whole course: the tags are an
 * annotation on a real, otherwise-complete course, not a correctness
 * requirement of it.
 */
async function resolveSkillTagIds(admin: SupabaseClient, orgId: string, names: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const raw of names) {
    const name = raw.trim().slice(0, 200);
    if (!name) continue;
    try {
      const { data: existing } = await admin.from("skill_tags").select("id").eq("org_id", orgId).ilike("name", name).maybeSingle();
      if (existing) {
        ids.push(existing.id as string);
        continue;
      }
      const { data: created, error } = await admin.from("skill_tags").insert({ org_id: orgId, name }).select("id").single();
      if (created) {
        ids.push(created.id as string);
      } else if (error?.code === "23505") {
        // Unique-violation race — created concurrently since the check above; re-fetch rather than fail.
        const { data: raced } = await admin.from("skill_tags").select("id").eq("org_id", orgId).ilike("name", name).maybeSingle();
        if (raced) ids.push(raced.id as string);
      }
    } catch {
      // Swallow — see doc comment above.
    }
  }
  return ids;
}

/**
 * Each "page" and "items" generation call is its own independent AI
 * request, prompted to keep ids unique only *within that one response*
 * (see PAGE_BLOCKS_INSTRUCTION / ITEMS_INSTRUCTION above) — there is no
 * way to ask the model for cross-call uniqueness when the calls don't
 * share context. Real output confirmed the predictable result: the model
 * reaches for the same natural names ('intro-text', 'q1', 'q1a', ...) on
 * more than one page, and lib/spec/validate.ts correctly rejects it —
 * ids are "one global id namespace" across the whole specification
 * (validate.ts's own comment), by design, since triggers/timelines/
 * validation findings address content by id.
 *
 * Rather than trust the model to get global uniqueness right (it can't,
 * structurally) or hand-enumerate every block type's nested id fields
 * here (already enumerated once, in validate.ts's `partIdsOf` — a second
 * copy would drift), this renames every `id` field found anywhere in a
 * generated block/item's own subtree, deterministically prefixed by the
 * page/section coordinate that produced it. Two ids from the *same*
 * generation call staying distinct after an identical prefix is already
 * guaranteed (the model satisfied that on its own); this only adds the
 * cross-call guarantee that was structurally missing.
 *
 * Exported for direct unit testing, same as trimOutline above.
 */
export function namespaceIds<T>(value: T, prefix: string): T {
  if (Array.isArray(value)) {
    return value.map((item) => namespaceIds(item, prefix)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = key === "id" && typeof val === "string" ? `${prefix}${val}` : namespaceIds(val, prefix);
    }
    return out as T;
  }
  return value;
}

function assembleFullSpec(params: {
  titleHint?: string;
  completedSteps: JobStepRecord[];
  jobId: string;
  generatedAt: string;
  skillTagIds: string[];
}): Record<string, unknown> {
  const { titleHint, completedSteps, jobId, generatedAt, skillTagIds } = params;
  const outline = findStepData<OutlineResult>(completedSteps, "outline")!;
  const objectives = findStepData<ObjectivesResult>(completedSteps, "objectives");

  const pageBlocksByCoord = new Map<string, PageBlocksResult["blocks"]>();
  const itemsByCoord = new Map<string, ItemsResult["items"]>();
  for (const s of completedSteps) {
    if (s.status !== "succeeded" || s.sectionIndex === undefined || s.pageIndex === undefined) continue;
    const coord = `${s.sectionIndex}:${s.pageIndex}`;
    if (s.kind === "page") pageBlocksByCoord.set(coord, (s.data as PageBlocksResult).blocks);
    if (s.kind === "items") itemsByCoord.set(coord, (s.data as ItemsResult).items);
  }

  const provenance = { jobId, stepName: "full_course", generatedAt };

  const sections = outline.sections.map((section, sectionIndex) => ({
    id: section.id,
    title: section.title,
    pages: section.pages.map((page, pageIndex) => {
      const coord = `${sectionIndex}:${pageIndex}`;
      // Prefix scoped to this coordinate — lowercase letters/digits/hyphen
      // only, matching the slug format every id in this spec already
      // uses — applied before `provenance` is attached (provenance
      // carries no `id` field of its own, but the ordering is deliberate
      // so nothing the AI didn't generate is ever renamed).
      const idPrefix = `s${sectionIndex}p${pageIndex}-`;
      const blocks: Record<string, unknown>[] = namespaceIds(pageBlocksByCoord.get(coord) ?? [], idPrefix).map(
        (block) => ({ ...block, provenance: block.provenance ?? provenance })
      );

      const items = namespaceIds(itemsByCoord.get(coord), idPrefix);
      if (items && items.length > 0) {
        blocks.push({
          id: specId("quiz"),
          type: "quiz",
          title: "Check your understanding",
          passingScorePercent: 80,
          showResults: true,
          allowRetry: true,
          items,
        });
      }

      return { id: page.id, title: page.title, blocks };
    }),
  }));

  const meta: Record<string, unknown> = { title: titleHint?.trim() || outline.title, locale: "en" };
  if (outline.description) meta.description = richText(outline.description);

  return {
    specSchemaVersion: SPEC_SCHEMA_VERSION,
    meta,
    objectives: (objectives?.objectives ?? []).map((o) => ({ id: o.id, text: o.text })),
    skillTagIds: skillTagIds.length > 0 ? skillTagIds : undefined,
    navigation: { mode: "linear", showMenu: true, showProgress: true },
    completion: { rule: "allPagesVisited" },
    sections,
  };
}

async function finishAssembly(
  admin: SupabaseClient,
  job: JobRow,
  index: number,
  completedSteps: JobStepRecord[]
): Promise<void> {
  const orgId = job.org_id;
  const userId = job.input.createdBy;
  const sourceKind = job.input.sourceKind;

  const skillNames = findStepData<z.infer<typeof skillTagSuggestionsSchema>>(completedSteps, "skill_tags")?.skills ?? [];
  const skillTagIds = await resolveSkillTagIds(admin, orgId, skillNames);

  const spec = assembleFullSpec({
    titleHint: job.input.titleHint ?? undefined,
    completedSteps,
    jobId: job.id,
    generatedAt: new Date().toISOString(),
    skillTagIds,
  });

  const report = validateCourseSpec(spec);
  if (!isPublishable(report)) {
    const errors = report.findings.filter((f) => f.severity === "error");
    await markJobFailed(
      admin,
      job.id,
      `The generated course did not pass validation and was not saved: ${errors
        .slice(0, 5)
        .map((f) => f.message)
        .join("; ")}`
    );
    return;
  }

  const { data: row, error: insertError } = await admin
    .from("course_specifications")
    .insert({
      org_id: orgId,
      title: (spec.meta as { title: string }).title,
      spec,
      spec_schema_version: SPEC_SCHEMA_VERSION,
      search_text: specSearchText(spec as CourseSpecType),
      source_kind: sourceKind,
      generated_by_job_id: job.id,
      created_by: userId,
    })
    .select("id, version")
    .single();

  if (insertError || !row) {
    await markJobFailed(admin, job.id, `Could not save the generated course: ${insertError?.message ?? "unknown error"}`);
    return;
  }

  // Accessibility findings, if any, are recorded against the new spec so
  // the existing editor's accessibility panel can surface them — this is
  // the pipeline's "accessibility fill" stage in practice: nothing here
  // generates alt text because nothing in this pipeline produces
  // image/video/audio blocks (no asset pipeline is wired into AI
  // generation), so there is nothing to fill. What *is* real is recording
  // whatever the validator actually found, same as any authored course.
  if (report.findings.length > 0) {
    await recordValidationReport(admin, {
      orgId,
      specId: row.id,
      specVersion: row.version,
      report,
      userId,
      kind: "accessibility",
    }).catch(() => {});
  }

  const finalSteps = [
    ...completedSteps,
    { index, kind: "assemble" as const, status: "succeeded" as const, data: { specId: row.id } },
  ];
  await admin
    .from("authoring_jobs")
    .update({
      status: "succeeded",
      finished_at: new Date().toISOString(),
      output: { specId: row.id },
      steps: finalSteps,
    })
    .eq("id", job.id);
}

// ---------------------------------------------------------------- invocation loop

/**
 * Processes as many steps as fit inside one invocation's conservative time
 * budget, then stops — leaving the job `running` with its steps saved so
 * far. Called by the route that creates the job (its first chunk of work)
 * and by `resume-full` every time after that; the caller (ultimately the
 * client's poll loop) decides whether and when to call again. See this
 * file's header for why nothing here self-triggers a continuation anymore.
 */
export async function advanceFullCourseJob(admin: SupabaseClient, jobId: string): Promise<void> {
  const invocationStart = Date.now();

  for (let iterations = 0; iterations < MAX_STEPS; iterations++) {
    const job = await loadJobRow(admin, jobId);
    if (!job) return;
    if (job.status === "succeeded" || job.status === "failed" || job.status === "cancelled") return;

    const plan = job.input.plan;
    const doneCount = job.steps.length;

    if (doneCount >= plan.length) return; // assemble already finished the job; nothing left to do

    const jobAgeMs = Date.now() - new Date(job.started_at ?? job.created_at).getTime();
    if (jobAgeMs > MAX_TOTAL_JOB_MS) {
      await markJobFailed(admin, jobId, "This generation is taking longer than the time limit allows and was stopped.");
      return;
    }
    if (plan.length > MAX_STEPS) {
      await markJobFailed(admin, jobId, "This course's plan exceeded the step limit and was stopped.");
      return;
    }

    const step = plan[doneCount];
    const request: FullCourseBuilderRequest = {
      orgId: job.org_id,
      userId: job.input.createdBy,
      jobId,
      sourceText: job.input.sourceText,
      titleHint: job.input.titleHint ?? undefined,
      sourceKind: job.input.sourceKind,
    };

    if (step.kind === "assemble") {
      await finishAssembly(admin, job, doneCount, job.steps);
      return;
    }

    const { record, nextPlan } = await runOneStep(request, step, doneCount, job.steps);

    if (record.status === "failed") {
      await markJobFailed(admin, jobId, record.error ?? "Generation failed.");
      return;
    }

    const wrote = await tryAppendStep(admin, job, record, nextPlan);
    if (!wrote) return; // another invocation is already ahead of this one — back off

    if (Date.now() - invocationStart > TIME_BUDGET_PER_INVOCATION_MS) {
      // Stop here. The job stays `running` with everything saved so far —
      // the caller (resume-full, driven by the client's poll loop) is what
      // decides whether and when another invocation picks it up.
      return;
    }
    // Otherwise loop and process the next step in this same invocation.
  }

  await markJobFailed(admin, jobId, "This generation exceeded the maximum number of steps and was stopped.");
}

// ---------------------------------------------------------------- entry point

export interface StartFullCourseJobRequest {
  orgId: string;
  userId: string;
  jobId: string;
  sourceText: string;
  sourceKind: FullCourseBuilderRequest["sourceKind"];
  titleHint?: string;
}

/** Initialises a queued job's `input` with the starting (outline-only) plan, then runs the first invocation. */
export async function startFullCourseJob(admin: SupabaseClient, request: StartFullCourseJobRequest): Promise<void> {
  await admin
    .from("authoring_jobs")
    .update({
      status: "running",
      started_at: new Date().toISOString(),
      input: {
        mode: "full",
        sourceKind: request.sourceKind,
        sourceText: request.sourceText,
        titleHint: request.titleHint ?? null,
        createdBy: request.userId,
        plan: [{ kind: "outline" }] satisfies PlannedStep[],
      },
    })
    .eq("id", request.jobId);

  await advanceFullCourseJob(admin, request.jobId);
}
