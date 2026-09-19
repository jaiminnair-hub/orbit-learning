import type { CourseSpecType as CourseSpec, LeafBlockType as LeafBlock, RichText } from "@/lib/spec";

/**
 * Flattens a course specification into searchable plain text.
 *
 * Phase 3 step 4 deliberately left `course_specifications.search_vector`
 * indexing the title alone, with the reason recorded in that migration: the
 * readable text of a course lives inside a nested block tree of structured
 * `RichText` spans, and walking that shape into a flat tsvector is an
 * application-layer job — not a fragile pure-SQL JSON walk invented
 * speculatively. It was to wait for "whichever step first has code that
 * already parses the tree for another reason."
 *
 * Steps 6 and 9 are both that reason, so this is step 11 collecting on it.
 *
 * What it deliberately excludes: ids, block types, asset ids, trigger and
 * variable definitions. An author searching their library is looking for
 * words they wrote, and indexing machine identifiers would surface a course
 * because its internal block id happened to contain the query.
 */

function fromRichText(rt: RichText | undefined): string[] {
  if (!rt) return [];
  return rt.blocks.flatMap((b) => b.spans.map((s) => s.text));
}

function fromBlock(block: LeafBlock): string[] {
  const out: string[] = [];

  // Author-facing accessible text is genuinely part of the content: an alt
  // text describing "fire extinguisher types" should make the course findable.
  if (block.a11y?.altText) out.push(block.a11y.altText);
  if (block.a11y?.label) out.push(block.a11y.label);

  switch (block.type) {
    case "heading":
      out.push(block.text);
      break;
    case "text":
    case "quote":
    case "statement":
      out.push(...fromRichText(block.content));
      if (block.type === "quote" && block.attribution) out.push(block.attribution);
      break;
    case "list":
      block.items.forEach((i) => out.push(...fromRichText(i)));
      break;
    case "image":
      out.push(...fromRichText(block.caption));
      break;
    case "imageGallery":
      block.images.forEach((img) => {
        if (img.altText) out.push(img.altText);
        out.push(...fromRichText(img.caption));
      });
      break;
    case "embed":
      out.push(block.title);
      break;
    case "accordion":
      block.items.forEach((i) => {
        out.push(i.title);
        out.push(...fromRichText(i.content));
      });
      break;
    case "tabs":
      block.tabs.forEach((t) => {
        out.push(t.label);
        out.push(...fromRichText(t.content));
      });
      break;
    case "flashcards":
      block.cards.forEach((c) => {
        out.push(...fromRichText(c.front));
        out.push(...fromRichText(c.back));
      });
      break;
    case "labeledGraphic":
      block.markers.forEach((m) => {
        out.push(m.label);
        out.push(...fromRichText(m.content));
      });
      break;
    case "hotspot":
      block.hotspots.forEach((h) => {
        out.push(h.label);
        out.push(...fromRichText(h.content));
      });
      break;
    case "process":
      block.steps.forEach((s) => {
        out.push(s.title);
        out.push(...fromRichText(s.content));
      });
      break;
    case "sorting":
      block.categories.forEach((c) => out.push(c.label));
      block.cards.forEach((c) => out.push(...fromRichText(c.text)));
      break;
    case "scenario":
      out.push(...fromRichText(block.setting));
      block.steps.forEach((s) => {
        if (s.speaker) out.push(s.speaker);
        out.push(...fromRichText(s.message));
        (s.choices ?? []).forEach((c) => {
          out.push(...fromRichText(c.text));
          out.push(...fromRichText(c.feedback));
        });
      });
      break;
    case "knowledgeCheck":
    case "quiz":
      if ("title" in block && block.title) out.push(block.title);
      block.items.forEach((item) => {
        out.push(...fromRichText(item.prompt));
        // authorNote is deliberately excluded: it is explicitly "never shown
        // to a learner", and indexing it would surface courses by content no
        // learner can see.
        if ("choices" in item) item.choices.forEach((c) => out.push(...fromRichText(c.text)));
        if ("steps" in item) item.steps.forEach((s) => out.push(...fromRichText(s.text)));
        if ("acceptedAnswers" in item) out.push(...item.acceptedAnswers);
      });
      break;
    case "continue":
      if (block.label) out.push(block.label);
      break;
    case "component":
      if (block.overrides?.title) out.push(block.overrides.title);
      out.push(...fromRichText(block.overrides?.text));
      break;
    default:
      break;
  }

  return out;
}

/** Postgres tsvector input is capped; a runaway course must not break saving. */
const MAX_LENGTH = 500_000;

export function specSearchText(spec: CourseSpec): string {
  const parts: string[] = [spec.meta.title];

  parts.push(...fromRichText(spec.meta.description));
  (spec.objectives ?? []).forEach((o) => parts.push(o.text));

  for (const section of spec.sections) {
    parts.push(section.title);
    parts.push(...fromRichText(section.description));

    for (const page of section.pages) {
      parts.push(page.title);
      // Page notes are author-facing but are course content, and authors do
      // look for them.
      parts.push(...fromRichText(page.notes));

      for (const block of page.blocks) {
        parts.push(...fromBlock(block as LeafBlock));
        for (const layer of block.layers ?? []) {
          if (layer.name) parts.push(layer.name);
          for (const lb of layer.blocks) parts.push(...fromBlock(lb));
        }
      }
    }
  }

  return parts
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .slice(0, MAX_LENGTH);
}
