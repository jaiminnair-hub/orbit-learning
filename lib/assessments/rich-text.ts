import type { RichText } from "@/lib/spec";

/**
 * Wraps a plain string into the minimal valid RichText shape
 * (lib/spec/primitives.ts) — a single paragraph, one unmarked span. The
 * assessment authoring UI captures prompts and choice text as plain
 * strings (no rich-text editor built for this yet); this is what lets
 * that data live in the real canonical shape from day one, so a richer
 * editor later is additive rather than another migration.
 */
export function plainToRichText(text: string): RichText {
  return { blocks: [{ kind: "paragraph", spans: [{ text }] }] };
}
