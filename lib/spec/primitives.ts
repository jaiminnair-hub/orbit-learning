import { z } from "zod";

/**
 * Shared leaf types for the course specification.
 *
 * Two rules govern everything in this directory:
 *
 * 1. **Nothing executable.** No script fields, no raw HTML, no expression
 *    strings. Every behaviour is a closed, declarative enum the runtime
 *    interprets. This is the security boundary from
 *    PHASE3_TECHNICAL_ARCHITECTURE.md §2, not a limitation to relax later.
 *
 * 2. **No recursion.** The block tree is depth-bounded by construction (see
 *    `blocks.ts`). Recursive JSON Schema is poorly supported by several
 *    providers' structured-output modes, and an unbounded tree makes both the
 *    renderer and the editor harder for no authoring benefit.
 *
 * 3. **Every object is strict.** Zod's default is to *strip* unknown keys, but
 *    the JSON Schema we publish says `additionalProperties: false`. A validator
 *    that quietly disagrees with its own published schema is a trap: a model
 *    that hallucinates `"animation": {...}` on a block type that has no such
 *    field would have it silently dropped, and the author would be left with a
 *    course that renders differently from what was generated with nothing to
 *    explain why. Unknown keys are errors.
 */

/**
 * Stable, human-readable identifier.
 *
 * Deliberately not a UUID: these ids are the addressing scheme for validation
 * findings, editor deep-links, and — per AUTHORING_CAPABILITY_CHECKLIST.md §6 —
 * aligning translated sibling specs field-by-field. A model can also generate
 * them meaningfully, which a UUID cannot.
 */
export const SpecId = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/, "must be alphanumeric with - or _, starting alphanumeric");

export type SpecId = z.infer<typeof SpecId>;

/** BCP 47-ish locale tag. Kept permissive; the runtime does not parse it. */
export const Locale = z
  .string()
  .min(2)
  .max(35)
  .regex(/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/, "must look like a BCP 47 tag, e.g. en or en-GB");

/** Reference to a row in `content_assets`. */
export const AssetRef = z.uuid();

export const InlineMark = z.enum(["bold", "italic", "underline", "strikethrough", "code", "subscript", "superscript"]);

/**
 * A link target. Validated structurally here; scheme safety is enforced in
 * `validate.ts`, because "which schemes are allowed" is policy rather than shape.
 */
export const LinkTarget = z.strictObject({
  href: z.string().min(1).max(2048),
  newTab: z.boolean().optional(),
});

export const InlineSpan = z.strictObject({
  text: z.string().max(10_000),
  marks: z.array(InlineMark).max(7).optional(),
  link: LinkTarget.optional(),
});

export const RichTextBlockKind = z.enum(["paragraph", "bulletItem", "numberItem", "quote", "codeBlock"]);

export const RichTextBlock = z.strictObject({
  kind: RichTextBlockKind,
  spans: z.array(InlineSpan).max(500),
});

/**
 * Structured rich text — never an HTML string.
 *
 * A sanitiser is a control that can be wrong; a model with no way to express
 * markup cannot carry an injection at all. It also gives the editor stable
 * addressing and gives the accessibility work real structure to reason about.
 */
export const RichText = z.strictObject({
  blocks: z.array(RichTextBlock).max(500),
});

export type RichText = z.infer<typeof RichText>;

/** A plain, non-marked-up string for labels, titles and alt text. */
export const PlainText = z.string().max(2000);

export const ColorToken = z
  .string()
  .max(64)
  .regex(/^(#[0-9a-fA-F]{3,8}|[a-z][a-z0-9-]*)$/, "must be a hex colour or a theme token name");

/**
 * Where a generated block came from.
 *
 * Required by PHASE3_AI_ARCHITECTURE.md §7: a reviewer must be able to check a
 * generated claim against the source chunk it derived from. Absent on
 * hand-authored content.
 */
export const Provenance = z.strictObject({
  jobId: z.uuid().optional(),
  stepName: z.string().max(64).optional(),
  sourceAssetId: AssetRef.optional(),
  /** Free-form pointer into the source, e.g. a page or chunk reference. */
  sourceRef: z.string().max(512).optional(),
  generatedAt: z.iso.datetime().optional(),
});

/** Accessibility fields. Authored, never retrofitted. */
export const Accessibility = z.strictObject({
  /** Required for images by the publish-readiness gate, not by the schema. */
  altText: PlainText.optional(),
  /** Marks purely decorative content so screen readers skip it. */
  decorative: z.boolean().optional(),
  /** Accessible name when the visible label is insufficient. */
  label: PlainText.optional(),
  /** Overrides document order for screen-reader traversal within a page. */
  readingOrder: z.number().int().min(0).max(9999).optional(),
  /** WebVTT track in `content_assets`. */
  captionAssetId: AssetRef.optional(),
  transcriptAssetId: AssetRef.optional(),
});
