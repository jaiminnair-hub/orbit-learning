import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { generationZodSchemas, SPEC_SCHEMA_VERSION, validateCourseSpec, type CourseSpecType } from "@/lib/spec";
import { richText } from "@/lib/authoring/block-factory";
import { isPublishable } from "@/lib/authoring/spec-store";
import { specSearchText } from "@/lib/authoring/spec-text";
import { generateStructured, isRealProviderConfigured } from "./gateway";
import { AiGatewayError, type GenerateMeta } from "./types";

/**
 * AI Course Builder Lite — the first narrow slice of Phase 3 step 8
 * (docs/DEVELOPMENT_SEQUENCE_PHASE3.md, deferred by decision on 2026-08-21).
 *
 * Deliberately not the full document-to-course pipeline from
 * docs/PHASE3_AI_ARCHITECTURE.md §5: no PDF/DOCX/PPT/URL extraction, no
 * per-page generation for every page, no interactions/items/skill-tagging/
 * accessibility-fill steps. Pasted text in, three narrow `generateStructured`
 * calls (outline+description, objectives, one page's blocks), a validated
 * draft `course_specifications` row out. Everything else in the outline
 * becomes real, empty, valid pages an author fills in by hand — the existing
 * manual authoring tool this feature is a head start on, not a replacement for.
 *
 * No new AI abstraction and no new authoring data model: this reuses the
 * step-7 gateway, the step-2 generation schemas, `authoring_jobs`, and the
 * step-6 draft/review/publish workflow verbatim.
 */

export const MAX_SOURCE_TEXT_LENGTH = 50_000;
export const MIN_SOURCE_TEXT_LENGTH = 40;

export interface CourseBuilderRequest {
  orgId: string;
  userId: string;
  jobId: string;
  sourceText: string;
  titleHint?: string;
}

export interface JobStepRecord {
  name: "outline" | "objectives" | "page_blocks" | "validate" | "save";
  status: "succeeded" | "failed";
  provider?: string;
  model?: string;
  error?: string;
}

export class CourseBuilderError extends Error {
  constructor(
    message: string,
    readonly code: "AI_NOT_CONFIGURED" | "GENERATION_FAILED" | "INVALID_SPEC" | "SAVE_FAILED",
    readonly steps: JobStepRecord[]
  ) {
    super(message);
    this.name = "CourseBuilderError";
  }
}

/** Whether a real provider (not the always-on `echo` test adapter) is configured. */
export function isCourseBuilderConfigured(): boolean {
  return isRealProviderConfigured("course_outline");
}

// Every instruction below is a fixed string with no user data interpolated
// into it — titleHint, the outline, and the source text all travel through
// the untrusted `source` field instead, per docs/PHASE3_AI_ARCHITECTURE.md §7:
// instruction and source stay separate all the way to the provider, so an
// injected instruction inside pasted source text has no channel to act on.

const OUTLINE_INSTRUCTION =
  "You are an instructional designer. The <source_material> is JSON with a `sourceText` field (the material to " +
  "build a course from) and an optional `workingTitle` the author suggested — prefer it if it fits, otherwise " +
  "choose your own. Produce a course title, a one-to-two sentence plain-text description, and 2-6 sections " +
  "(modules), each with 1-4 pages (lessons), titled specifically to the material — not generic placeholders. " +
  "Every id must be a short lowercase slug of letters, numbers, '-' or '_', unique across your whole response.";

const OBJECTIVES_INSTRUCTION =
  "The <source_material> is JSON with the original `sourceText` and the `outline` already produced from it. Write " +
  "3-6 clear, measurable learning objectives for the whole course, each starting with an action verb and grounded " +
  "in the source text. Every id must be a short lowercase slug, unique across your response.";

const PAGE_BLOCKS_INSTRUCTION =
  "The <source_material> is JSON with the original `sourceText`, the course `title`, and the `pageTitle` of one " +
  "specific lesson page. Write the content blocks for that one page only, grounded strictly in the source text — " +
  "do not invent facts absent from it. Prefer a short heading plus 2-5 text/list/statement blocks. Every block id " +
  "must be a short lowercase slug, unique within your response.";

async function runStep<T>(
  steps: JobStepRecord[],
  name: JobStepRecord["name"],
  fn: () => Promise<{ data: T; meta: GenerateMeta }>
): Promise<{ data: T; meta: GenerateMeta }> {
  try {
    const result = await fn();
    steps.push({ name, status: "succeeded", provider: result.meta.provider, model: result.meta.model });
    return result;
  } catch (error) {
    const message = describeGenerationError(error);
    steps.push({ name, status: "failed", error: message });
    throw new CourseBuilderError(message, "GENERATION_FAILED", steps);
  }
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

type OutlineResult = z.infer<typeof generationZodSchemas.outline>;
type ObjectivesResult = z.infer<typeof generationZodSchemas.objectives>;
type PageBlocksResult = z.infer<typeof generationZodSchemas.pageBlocks>;

interface AssembleParams {
  titleHint?: string;
  outline: OutlineResult;
  objectives: ObjectivesResult;
  firstPageBlocks: PageBlocksResult["blocks"];
  jobId: string;
  generatedAt: string;
}

/** Assembles a full, schema-shaped draft — validated by the caller before it is ever persisted. */
function assembleSpec(params: AssembleParams): Record<string, unknown> {
  const { titleHint, outline, objectives, firstPageBlocks, jobId, generatedAt } = params;
  const provenance = { jobId, stepName: "page_blocks", generatedAt };

  const sections = outline.sections.map((section, si) => ({
    id: section.id,
    title: section.title,
    pages: section.pages.map((page, pi) => ({
      id: page.id,
      title: page.title,
      // Only the very first page of the very first section gets generated
      // content in this slice; every other outlined page is a real, valid,
      // empty page — a schema-valid starting point the author fills in by
      // hand, per this feature's scope (one generated lesson, not a whole
      // generated course).
      blocks:
        si === 0 && pi === 0
          ? firstPageBlocks.map((block) => ({ ...block, provenance: block.provenance ?? provenance }))
          : [],
    })),
  }));

  const meta: Record<string, unknown> = { title: titleHint?.trim() || outline.title, locale: "en" };
  if (outline.description) meta.description = richText(outline.description);

  return {
    specSchemaVersion: SPEC_SCHEMA_VERSION,
    meta,
    objectives: objectives.objectives.map((o) => ({ id: o.id, text: o.text })),
    navigation: { mode: "linear", showMenu: true, showProgress: true },
    completion: { rule: "allPagesVisited" },
    sections,
  };
}

async function buildAndSaveCourseSpec(
  admin: SupabaseClient,
  request: CourseBuilderRequest
): Promise<{ specId: string; steps: JobStepRecord[] }> {
  const { orgId, userId, jobId, sourceText, titleHint } = request;
  const steps: JobStepRecord[] = [];

  if (!isCourseBuilderConfigured()) {
    throw new CourseBuilderError(
      "AI generation is not configured for this platform. Add a provider (e.g. ANTHROPIC_API_KEY) to enable AI Course Builder.",
      "AI_NOT_CONFIGURED",
      steps
    );
  }

  const outline = await runStep(steps, "outline", () =>
    generateStructured({
      profile: "course_outline",
      schema: generationZodSchemas.outline,
      instruction: OUTLINE_INSTRUCTION,
      source: JSON.stringify({ workingTitle: titleHint || undefined, sourceText }),
      orgId,
      userId,
      feature: "authoring.course_builder.outline",
      jobId,
    })
  );

  const objectives = await runStep(steps, "objectives", () =>
    generateStructured({
      profile: "course_outline",
      schema: generationZodSchemas.objectives,
      instruction: OBJECTIVES_INSTRUCTION,
      source: JSON.stringify({ sourceText, outline: outline.data }),
      orgId,
      userId,
      feature: "authoring.course_builder.objectives",
      jobId,
    })
  );

  const firstPage = outline.data.sections[0].pages[0];
  const pageBlocks = await runStep(steps, "page_blocks", () =>
    generateStructured({
      profile: "content_expansion",
      schema: generationZodSchemas.pageBlocks,
      instruction: PAGE_BLOCKS_INSTRUCTION,
      source: JSON.stringify({ sourceText, title: outline.data.title, pageTitle: firstPage.title }),
      orgId,
      userId,
      feature: "authoring.course_builder.page_blocks",
      jobId,
    })
  );

  const spec = assembleSpec({
    titleHint,
    outline: outline.data,
    objectives: objectives.data,
    firstPageBlocks: pageBlocks.data.blocks,
    jobId,
    generatedAt: new Date().toISOString(),
  });

  // The stricter, publish-grade check — not validateForWrite's write-time
  // leniency (kind==="schema" only), which exists so a human mid-edit is
  // never blocked from saving legitimately incomplete work. An assembled
  // AI draft has no such excuse: it claims to be a complete, self-consistent
  // starting point, so any error-severity finding (schema or semantic — a
  // duplicate id across independently generated steps included) blocks it.
  const report = validateCourseSpec(spec);
  if (!isPublishable(report)) {
    const errors = report.findings.filter((f) => f.severity === "error");
    steps.push({ name: "validate", status: "failed", error: summariseFindings(errors) });
    throw new CourseBuilderError(
      "The generated course did not pass validation and was not saved. Try again, or shorten the source material.",
      "INVALID_SPEC",
      steps
    );
  }
  steps.push({ name: "validate", status: "succeeded" });

  const { data: row, error: insertError } = await admin
    .from("course_specifications")
    .insert({
      org_id: orgId,
      title: (spec.meta as { title: string }).title,
      spec,
      spec_schema_version: SPEC_SCHEMA_VERSION,
      search_text: specSearchText(spec as CourseSpecType),
      source_kind: "prompt",
      generated_by_job_id: jobId,
      created_by: userId,
    })
    .select("id")
    .single();

  if (insertError || !row) {
    steps.push({ name: "save", status: "failed", error: insertError?.message ?? "insert returned no row" });
    throw new CourseBuilderError(
      `Could not save the generated course: ${insertError?.message ?? "unknown error"}`,
      "SAVE_FAILED",
      steps
    );
  }
  steps.push({ name: "save", status: "succeeded" });

  return { specId: row.id as string, steps };
}

function summariseFindings(findings: Array<{ message: string }>): string {
  return findings
    .slice(0, 5)
    .map((f) => f.message)
    .join("; ");
}

/**
 * Runs the whole builder as a tracked job, mirroring
 * `lib/publishing/build.ts`'s `runPackageJob` — `authoring_jobs` already
 * models exactly this (status, per-step detail, output) for both.
 *
 * Never throws: every outcome, including "not configured", is recorded on
 * the job row so the polling client sees one consistent shape either way.
 * On any failure, no `course_specifications` row is created — a partial or
 * invalid draft is never persisted.
 */
export async function runCourseBuilderJob(admin: SupabaseClient, request: CourseBuilderRequest): Promise<void> {
  await admin
    .from("authoring_jobs")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", request.jobId);

  try {
    const { specId, steps } = await buildAndSaveCourseSpec(admin, request);
    await admin
      .from("authoring_jobs")
      .update({ status: "succeeded", finished_at: new Date().toISOString(), output: { specId }, steps })
      .eq("id", request.jobId);
  } catch (error) {
    const steps = error instanceof CourseBuilderError ? error.steps : [];
    const message = error instanceof Error ? error.message : String(error);
    await admin
      .from("authoring_jobs")
      .update({ status: "failed", finished_at: new Date().toISOString(), error: message, steps })
      .eq("id", request.jobId);
  }
}
