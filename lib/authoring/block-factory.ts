import type { LeafBlockType as LeafBlock, RichText } from "@/lib/spec";

/**
 * Default blocks for the editor's "insert" menu.
 *
 * Every one of these must validate against the schema the moment it is
 * inserted — an editor that can create content its own validator rejects
 * teaches authors to distrust the validator. So required fields get real
 * placeholder values rather than empty ones, and the block types that cannot
 * exist without an asset (image, video, audio, and the image-backed
 * interactions) are deliberately absent from `INSERTABLE_TYPES`: they are
 * inserted through the media picker, which supplies the assetId.
 */

export function richText(text: string): RichText {
  return { blocks: [{ kind: "paragraph", spans: [{ text }] }] };
}

/** Editor-generated ids: readable, unique enough, and valid per SpecId's pattern. */
export function specId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

/** Block types the insert menu can drop in directly, with no further input. */
export const INSERTABLE_TYPES = [
  "heading",
  "text",
  "list",
  "quote",
  "statement",
  "divider",
  "spacer",
  "accordion",
  "tabs",
  "flashcards",
  "process",
  "sorting",
  "scenario",
  "knowledgeCheck",
  "quiz",
  "continue",
] as const;

export type InsertableType = (typeof INSERTABLE_TYPES)[number];

/** Types that need a content asset, offered through the media picker instead. */
export const ASSET_BACKED_TYPES = ["image", "imageGallery", "video", "audio", "labeledGraphic", "hotspot"] as const;

/**
 * `embed` is neither: it needs a provider resource id, and the schema
 * requires that id to be non-empty. Inserting a blank one would create a
 * block the validator immediately rejects, so the editor collects the
 * provider and id first and calls this.
 */
export function createEmbedBlock(
  provider: "youtube" | "vimeo" | "genially" | "googleSlides" | "codepen",
  resourceId: string,
  title: string
): LeafBlock {
  return {
    id: specId("embed"),
    type: "embed",
    provider,
    resourceId,
    title: title || "Embedded media",
    aspectRatio: "16:9",
  };
}

export const BLOCK_LABELS: Record<string, string> = {
  heading: "Heading",
  text: "Text",
  list: "List",
  quote: "Quote",
  statement: "Callout",
  divider: "Divider",
  spacer: "Spacer",
  image: "Image",
  imageGallery: "Image gallery",
  video: "Video",
  audio: "Audio",
  embed: "Embed",
  accordion: "Accordion",
  tabs: "Tabs",
  flashcards: "Flashcards",
  labeledGraphic: "Labelled graphic",
  hotspot: "Hotspots",
  process: "Process / timeline",
  sorting: "Sorting activity",
  scenario: "Scenario",
  knowledgeCheck: "Knowledge check",
  quiz: "Quiz",
  continue: "Continue",
  component: "Saved block",
};

export function createBlock(type: InsertableType | "component", opts?: { componentDefinitionId?: string }): LeafBlock {
  const id = specId(type.toLowerCase().slice(0, 8));

  switch (type) {
    case "heading":
      return { id, type: "heading", text: "New heading", level: 2 };
    case "text":
      return { id, type: "text", content: richText("Write your content here.") };
    case "list":
      return { id, type: "list", items: [richText("First item"), richText("Second item")] };
    case "quote":
      return { id, type: "quote", content: richText("A memorable quote."), attribution: "Source" };
    case "statement":
      return { id, type: "statement", content: richText("Something worth emphasising."), emphasis: "note" };
    case "divider":
      return { id, type: "divider", style: "line" };
    case "spacer":
      return { id, type: "spacer", size: "medium" };
    case "accordion":
      return {
        id,
        type: "accordion",
        items: [
          { id: specId("item"), title: "First section", content: richText("Hidden until opened.") },
          { id: specId("item"), title: "Second section", content: richText("Hidden until opened.") },
        ],
      };
    case "tabs":
      return {
        id,
        type: "tabs",
        tabs: [
          { id: specId("tab"), label: "Tab one", content: richText("First tab content.") },
          { id: specId("tab"), label: "Tab two", content: richText("Second tab content.") },
        ],
      };
    case "flashcards":
      return {
        id,
        type: "flashcards",
        cards: [{ id: specId("card"), front: richText("Front of the card"), back: richText("Back of the card") }],
      };
    case "process":
      return {
        id,
        type: "process",
        presentation: "steps",
        steps: [
          { id: specId("step"), title: "Step one", content: richText("What happens first.") },
          { id: specId("step"), title: "Step two", content: richText("What happens next.") },
        ],
      };
    case "sorting": {
      const catA = specId("cat");
      const catB = specId("cat");
      return {
        id,
        type: "sorting",
        categories: [
          { id: catA, label: "Category A" },
          { id: catB, label: "Category B" },
        ],
        cards: [
          { id: specId("card"), text: richText("Belongs in A"), categoryId: catA },
          { id: specId("card"), text: richText("Belongs in B"), categoryId: catB },
        ],
      };
    }
    case "scenario":
      return {
        id,
        type: "scenario",
        setting: richText("Set the scene for the learner."),
        steps: [
          {
            id: specId("step"),
            speaker: "Colleague",
            message: richText("What would you do in this situation?"),
            choices: [
              { id: specId("choice"), text: richText("The preferred response"), preferred: true, feedback: richText("Good choice.") },
              { id: specId("choice"), text: richText("A weaker response"), feedback: richText("Consider the impact of that.") },
            ],
          },
        ],
      };
    case "knowledgeCheck":
      return { id, type: "knowledgeCheck", items: [defaultMultipleChoice()] };
    case "quiz":
      return {
        id,
        type: "quiz",
        title: "Quiz",
        passingScorePercent: 80,
        showResults: true,
        allowRetry: true,
        items: [defaultMultipleChoice()],
      };
    case "continue":
      return { id, type: "continue", label: "Continue" };
    case "component":
      return { id, type: "component", componentDefinitionId: opts?.componentDefinitionId ?? "" };
    default: {
      const exhaustive: never = type;
      throw new Error(`Unknown insertable block type: ${String(exhaustive)}`);
    }
  }
}

/** An asset-backed block, created once the media picker has an assetId. */
export function createAssetBlock(type: (typeof ASSET_BACKED_TYPES)[number], assetId: string): LeafBlock {
  const id = specId(type.toLowerCase().slice(0, 8));
  switch (type) {
    case "image":
      return { id, type: "image", assetId, a11y: { altText: "" } };
    case "imageGallery":
      return { id, type: "imageGallery", images: [{ id: specId("img"), assetId, altText: "" }], presentation: "grid" };
    case "video":
      return { id, type: "video", assetId };
    case "audio":
      return { id, type: "audio", assetId };
    case "labeledGraphic":
      return {
        id,
        type: "labeledGraphic",
        assetId,
        a11y: { altText: "" },
        markers: [{ id: specId("marker"), xPercent: 50, yPercent: 50, label: "Marker", content: richText("Describe this point.") }],
      };
    case "hotspot":
      return {
        id,
        type: "hotspot",
        assetId,
        a11y: { altText: "" },
        hotspots: [
          {
            id: specId("spot"),
            shape: "rect",
            xPercent: 25,
            yPercent: 25,
            widthPercent: 25,
            heightPercent: 25,
            label: "Hotspot",
            content: richText("Describe this area."),
          },
        ],
      };
    default: {
      const exhaustive: never = type;
      throw new Error(`Unknown asset-backed block type: ${String(exhaustive)}`);
    }
  }
}

function defaultMultipleChoice() {
  return {
    id: specId("q"),
    kind: "multipleChoice" as const,
    prompt: richText("Ask your question here."),
    choices: [
      { id: specId("opt"), text: richText("The correct answer"), correct: true },
      { id: specId("opt"), text: richText("A plausible distractor") },
    ],
  };
}

/** A new, empty-but-valid specification. */
export function createBlankSpec(title: string, specSchemaVersion: string) {
  return {
    specSchemaVersion,
    meta: { title, locale: "en" },
    navigation: { mode: "linear" as const, showMenu: true, showProgress: true },
    completion: { rule: "allPagesVisited" as const },
    sections: [
      {
        id: specId("section"),
        title: "Section 1",
        pages: [
          {
            id: specId("page"),
            title: "Page 1",
            blocks: [
              { id: specId("heading"), type: "heading" as const, text: title, level: 1 },
              { id: specId("text"), type: "text" as const, content: richText("Start writing your course here.") },
            ],
          },
        ],
      },
    ],
  };
}

export function createPage(title: string) {
  return { id: specId("page"), title, blocks: [] };
}

export function createSection(title: string) {
  return { id: specId("section"), title, pages: [createPage("Page 1")] };
}
