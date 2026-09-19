import { z } from "zod";
import { Block } from "./blocks";
import { CourseSpec, Page, Section } from "./course-spec";
import { AssessmentItem } from "./items";
import { PlainText, SpecId } from "./primitives";
import { SPEC_SCHEMA_VERSION } from "./version";

/**
 * JSON Schema emission.
 *
 * The Zod schemas are the single source of truth; JSON Schema is *derived*.
 * Maintaining a hand-written JSON Schema alongside TypeScript types guarantees
 * they drift, and the drift is silent.
 *
 * **Why not ajv:** ajv compiles schemas to JavaScript with `new Function`,
 * which Cloudflare Workers block. Its standalone precompile mode exists for
 * exactly this, but it adds a build step to the most important artifact in the
 * phase. Zod validates without codegen and runs on Workers unchanged.
 *
 * Two consumers, with different needs:
 *
 * - **Documentation and whole-document validation** — `courseSpecJsonSchema()`.
 * - **AI structured output** — the *narrow, per-step* schemas below. The
 *   generation pipeline (PHASE3_AI_ARCHITECTURE.md §5) never asks a model for
 *   a whole course in one call; each step has its own small schema, which is
 *   what keeps output reliable and cost attributable per step.
 */

export type JsonSchema = Record<string, unknown>;

function emit(schema: z.ZodType): JsonSchema {
  // `reused: "ref"` is load-bearing, not cosmetic. Zod's default is to
  // *inline* every occurrence of a repeated sub-schema (RichText,
  // Accessibility, Trigger, ...) rather than emit one `$defs` entry and
  // `$ref` it — and the 24-type block union repeats those enough for that to
  // compound into multi-megabyte output. Measured directly, calling a real
  // provider for the first time (2026-08-26, AICredits): the `pageBlocks`
  // generation schema alone emitted at **11.2 MB** without this option,
  // rejected outright by AICredits' API with `413 Payload Too Large`; with
  // it, the identical schema is **49 KB** — the array-of-blocks shape and
  // every field it validates are unchanged, only the JSON Schema's own
  // encoding of shared structure is. This would have broken the direct
  // Anthropic adapter identically the first time anyone gave it a real key;
  // nothing caught it earlier because, per docs/DEFINITION_OF_DONE_PHASE3.md,
  // no real provider had ever been called until now.
  return z.toJSONSchema(schema, { io: "input", reused: "ref" }) as JsonSchema;
}

/** The whole document. Large — intended for docs and tooling, not for prompts. */
export function courseSpecJsonSchema(): JsonSchema {
  return {
    ...emit(CourseSpec),
    title: "CourseSpec",
    description: `Course specification schema version ${SPEC_SCHEMA_VERSION}.`,
  };
}

/**
 * Narrow schemas for the generation pipeline, keyed by the step that uses them.
 *
 * Kept deliberately small: a model asked for one page's blocks produces better
 * output than one asked for an entire course, a failure costs one step rather
 * than the whole run, and an author can regenerate a single step.
 *
 * Defined as Zod schemas first (`generationZodSchemas`) rather than emitted
 * JSON Schema directly: the AI gateway's `generateStructured` (step 7,
 * `lib/ai/gateway.ts`) needs the Zod schema itself — it emits the JSON Schema
 * *and* runs `.safeParse` for validation — so a caller needing the schema for
 * generation and a caller needing it for documentation/tooling now read the
 * same object rather than two definitions that could drift.
 *
 * Ids use `SpecId`, not a bare string: the generated outline's section/page
 * ids and the generated objectives' ids flow directly into a `CourseSpec`,
 * which requires `SpecId`-shaped ids everywhere. Constraining it here means
 * the gateway's own repair loop enforces valid ids from the model, the same
 * way it already does for `Block.id` — not a sanitisation step bolted on
 * after the call.
 */
export const generationZodSchemas = {
  /** Step 1 — outline: title, a short description, sections and page titles. */
  outline: z.strictObject({
    title: PlainText,
    /** Plain text; the caller wraps it into a `RichText` for `CourseMeta.description`. */
    description: z.string().max(2000).optional(),
    sections: z
      .array(
        z.strictObject({
          id: SpecId,
          title: PlainText,
          pages: z.array(z.strictObject({ id: SpecId, title: PlainText })).min(1).max(50),
        })
      )
      .min(1)
      .max(30),
  }),

  /** Step 2 — learning objectives. */
  objectives: z.strictObject({
    objectives: z.array(z.strictObject({ id: SpecId, text: PlainText })).max(50),
  }),

  /** Step 3 — the blocks of a single page. */
  pageBlocks: z.strictObject({ blocks: z.array(Block).max(60) }),

  /** Step 5 — knowledge-check items for a page. */
  items: z.strictObject({ items: z.array(AssessmentItem).max(20) }),

  /** A whole page, for regeneration of one page in place. */
  page: Page,

  /** A whole section, for regeneration of one section in place. */
  section: Section,
} as const;

export const generationSchemas = {
  outline: () => emit(generationZodSchemas.outline),
  objectives: () => emit(generationZodSchemas.objectives),
  pageBlocks: () => emit(generationZodSchemas.pageBlocks),
  items: () => emit(generationZodSchemas.items),
  page: () => emit(generationZodSchemas.page),
  section: () => emit(generationZodSchemas.section),
} as const;

export type GenerationSchemaName = keyof typeof generationSchemas;
