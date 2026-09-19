import { z } from "zod";
import { AssessmentItem } from "./items";
import { BlockState, Trigger } from "./interactions";
import { Position } from "./layout";
import { Accessibility, AssetRef, PlainText, Provenance, RichText, SpecId } from "./primitives";

/**
 * The block set is **closed**. Adding a type is a schema change with a matching
 * renderer — never an open extension point the AI can invent into
 * (PHASE3_TECHNICAL_ARCHITECTURE.md §2).
 *
 * The tree is also **depth-bounded by construction**: containers such as
 * accordions and tabs hold rich text and a single optional media reference, not
 * arbitrary nested blocks, and layers hold `LeafBlock`s which cannot themselves
 * carry layers. This mirrors what Rise and Storyline actually let authors do,
 * and it buys a non-recursive JSON Schema — which matters because several
 * providers' structured-output modes handle recursion poorly.
 */

/** Fields every block carries regardless of type. */
const BlockEnvelope = {
  id: SpecId,
  a11y: Accessibility.optional(),
  /** Absolute placement. Valid only on a canvas-mode page — see validate.ts. */
  position: Position.optional(),
  states: z.array(BlockState).max(20).optional(),
  triggers: z.array(Trigger).max(50).optional(),
  /** Hidden until a trigger shows it. */
  initiallyHidden: z.boolean().optional(),
  /** Skill tag ids (`skill_tags.id`) this block teaches or evidences. */
  skillTagIds: z.array(z.uuid()).max(20).optional(),
  provenance: Provenance.optional(),
};

// ---------------------------------------------------------------- content

const TextBlock = z.strictObject({
  ...BlockEnvelope,
  type: z.literal("text"),
  content: RichText,
});

const HeadingBlock = z.strictObject({
  ...BlockEnvelope,
  type: z.literal("heading"),
  text: PlainText,
  /** Semantic level. The renderer maps this to real heading elements. */
  level: z.number().int().min(1).max(6).default(2),
});

const ListBlock = z.strictObject({
  ...BlockEnvelope,
  type: z.literal("list"),
  ordered: z.boolean().optional(),
  items: z.array(RichText).min(1).max(200),
});

const QuoteBlock = z.strictObject({
  ...BlockEnvelope,
  type: z.literal("quote"),
  content: RichText,
  attribution: PlainText.optional(),
});

const StatementBlock = z.strictObject({
  ...BlockEnvelope,
  type: z.literal("statement"),
  content: RichText,
  emphasis: z.enum(["note", "tip", "warning", "important", "quote"]).optional(),
});

const DividerBlock = z.strictObject({
  ...BlockEnvelope,
  type: z.literal("divider"),
  style: z.enum(["line", "dotted", "space"]).optional(),
});

const SpacerBlock = z.strictObject({
  ...BlockEnvelope,
  type: z.literal("spacer"),
  size: z.enum(["small", "medium", "large"]).optional(),
});

// ------------------------------------------------------------------ media

const ImageBlock = z.strictObject({
  ...BlockEnvelope,
  type: z.literal("image"),
  assetId: AssetRef,
  caption: RichText.optional(),
  fit: z.enum(["contain", "cover"]).optional(),
});

const ImageGalleryBlock = z.strictObject({
  ...BlockEnvelope,
  type: z.literal("imageGallery"),
  images: z
    .array(z.strictObject({ id: SpecId, assetId: AssetRef, caption: RichText.optional(), altText: PlainText.optional() }))
    .min(1)
    .max(50),
  presentation: z.enum(["grid", "carousel"]).optional(),
});

const VideoBlock = z.strictObject({
  ...BlockEnvelope,
  type: z.literal("video"),
  assetId: AssetRef,
  posterAssetId: AssetRef.optional(),
  autoplay: z.boolean().optional(),
  /** Blocks page completion until watched — a common compliance requirement. */
  requireCompletion: z.boolean().optional(),
});

const AudioBlock = z.strictObject({
  ...BlockEnvelope,
  type: z.literal("audio"),
  assetId: AssetRef,
  requireCompletion: z.boolean().optional(),
});

/**
 * Embeds are allowlisted by provider, not by free URL, for the whole of Phase 3
 * (AUTHORING_CAPABILITY_CHECKLIST.md §1). An arbitrary iframe is arbitrary code
 * running in our origin's neighbourhood.
 */
const EmbedBlock = z.strictObject({
  ...BlockEnvelope,
  type: z.literal("embed"),
  provider: z.enum(["youtube", "vimeo", "genially", "googleSlides", "codepen"]),
  /** The provider-specific resource id, never a full URL. */
  resourceId: z.string().min(1).max(256),
  title: PlainText,
  aspectRatio: z.enum(["16:9", "4:3", "1:1"]).optional(),
});

// ------------------------------------------------------------ interactive

const AccordionBlock = z.strictObject({
  ...BlockEnvelope,
  type: z.literal("accordion"),
  items: z
    .array(
      z.strictObject({
        id: SpecId,
        title: PlainText,
        content: RichText,
        imageAssetId: AssetRef.optional(),
      })
    )
    .min(1)
    .max(50),
});

const TabsBlock = z.strictObject({
  ...BlockEnvelope,
  type: z.literal("tabs"),
  tabs: z
    .array(
      z.strictObject({
        id: SpecId,
        label: PlainText,
        content: RichText,
        imageAssetId: AssetRef.optional(),
      })
    )
    .min(1)
    .max(20),
});

const FlashcardsBlock = z.strictObject({
  ...BlockEnvelope,
  type: z.literal("flashcards"),
  cards: z
    .array(
      z.strictObject({
        id: SpecId,
        front: RichText,
        back: RichText,
        frontImageAssetId: AssetRef.optional(),
        backImageAssetId: AssetRef.optional(),
      })
    )
    .min(1)
    .max(100),
});

const LabeledGraphicBlock = z.strictObject({
  ...BlockEnvelope,
  type: z.literal("labeledGraphic"),
  assetId: AssetRef,
  markers: z
    .array(
      z.strictObject({
        id: SpecId,
        /** Percentage of the image's width/height, so it survives resizing. */
        xPercent: z.number().min(0).max(100),
        yPercent: z.number().min(0).max(100),
        label: PlainText,
        content: RichText.optional(),
      })
    )
    .min(1)
    .max(50),
});

const HotspotBlock = z.strictObject({
  ...BlockEnvelope,
  type: z.literal("hotspot"),
  assetId: AssetRef,
  hotspots: z
    .array(
      z.strictObject({
        id: SpecId,
        shape: z.enum(["rect", "circle"]),
        xPercent: z.number().min(0).max(100),
        yPercent: z.number().min(0).max(100),
        widthPercent: z.number().min(0).max(100),
        heightPercent: z.number().min(0).max(100),
        label: PlainText,
        content: RichText.optional(),
      })
    )
    .min(1)
    .max(50),
  /** Gate progression until every hotspot has been opened. */
  requireAllVisited: z.boolean().optional(),
});

const ProcessBlock = z.strictObject({
  ...BlockEnvelope,
  type: z.literal("process"),
  presentation: z.enum(["steps", "timeline"]).optional(),
  steps: z
    .array(
      z.strictObject({
        id: SpecId,
        title: PlainText,
        content: RichText.optional(),
        imageAssetId: AssetRef.optional(),
      })
    )
    .min(1)
    .max(50),
});

const SortingBlock = z.strictObject({
  ...BlockEnvelope,
  type: z.literal("sorting"),
  categories: z.array(z.strictObject({ id: SpecId, label: PlainText })).min(2).max(10),
  cards: z
    .array(z.strictObject({ id: SpecId, text: RichText, categoryId: SpecId }))
    .min(2)
    .max(60),
});

const ScenarioBlock = z.strictObject({
  ...BlockEnvelope,
  type: z.literal("scenario"),
  setting: RichText.optional(),
  steps: z
    .array(
      z.strictObject({
        id: SpecId,
        speaker: PlainText.optional(),
        speakerImageAssetId: AssetRef.optional(),
        message: RichText,
        choices: z
          .array(
            z.strictObject({
              id: SpecId,
              text: RichText,
              /** Branch within this scenario. Cross-page jumps use triggers. */
              nextStepId: SpecId.optional(),
              feedback: RichText.optional(),
              preferred: z.boolean().optional(),
            })
          )
          .max(10)
          .optional(),
      })
    )
    .min(1)
    .max(100),
});

// ------------------------------------------------------------- assessment

const KnowledgeCheckBlock = z.strictObject({
  ...BlockEnvelope,
  type: z.literal("knowledgeCheck"),
  items: z.array(AssessmentItem).min(1).max(20),
});

const QuizBlock = z.strictObject({
  ...BlockEnvelope,
  type: z.literal("quiz"),
  title: PlainText.optional(),
  items: z.array(AssessmentItem).min(1).max(100),
  passingScorePercent: z.number().min(0).max(100).optional(),
  showResults: z.boolean().optional(),
  allowRetry: z.boolean().optional(),
});

// ------------------------------------------------------------- structural

const ContinueBlock = z.strictObject({
  ...BlockEnvelope,
  type: z.literal("continue"),
  label: PlainText.optional(),
  /** Ids of blocks that must be complete before this unlocks. */
  requiresBlockIds: z.array(SpecId).max(50).optional(),
});

/**
 * A reference to a `component_definitions` row — referenced, never copied, so
 * updating a component updates every course that uses it, exactly as
 * learning-object reuse already works.
 */
const ComponentBlock = z.strictObject({
  ...BlockEnvelope,
  type: z.literal("component"),
  componentDefinitionId: z.uuid(),
  /** Narrow, named overrides. Not an arbitrary patch. */
  overrides: z
    .object({
      title: PlainText.optional(),
      text: RichText.optional(),
      imageAssetId: AssetRef.optional(),
    })
    .optional(),
});

/** Every block type, in one closed union. Leaf level — no layers. */
const LEAF_VARIANTS = [
  TextBlock,
  HeadingBlock,
  ListBlock,
  QuoteBlock,
  StatementBlock,
  DividerBlock,
  SpacerBlock,
  ImageBlock,
  ImageGalleryBlock,
  VideoBlock,
  AudioBlock,
  EmbedBlock,
  AccordionBlock,
  TabsBlock,
  FlashcardsBlock,
  LabeledGraphicBlock,
  HotspotBlock,
  ProcessBlock,
  SortingBlock,
  ScenarioBlock,
  KnowledgeCheckBlock,
  QuizBlock,
  ContinueBlock,
  ComponentBlock,
] as const;

/**
 * A block that may not itself contain layers — the leaf level that keeps the
 * tree non-recursive.
 */
export const LeafBlock = z.discriminatedUnion("type", LEAF_VARIANTS);
export type LeafBlock = z.infer<typeof LeafBlock>;

/** An overlay with its own content, shown and hidden by triggers. */
export const Layer = z.strictObject({
  id: SpecId,
  name: PlainText.optional(),
  blocks: z.array(LeafBlock).min(1).max(100),
  /** Dims and blocks interaction with the page beneath. */
  modal: z.boolean().optional(),
  dismissible: z.boolean().optional(),
});

export type Layer = z.infer<typeof Layer>;

const layers = { layers: z.array(Layer).max(20).optional() };

/**
 * A top-level block: any variant, optionally carrying layers.
 *
 * Built by extending each variant rather than by intersecting the union with
 * `{ layers }`. An intersection would emit `allOf` in the JSON Schema, and
 * since both branches close `additionalProperties`, **no document carrying
 * `layers` could ever validate against the schema we publish** — a schema that
 * disagrees with its own validator is worse than no schema. Listing the
 * variants keeps one flat `anyOf` and keeps the inferred types exact.
 */
export const Block = z.discriminatedUnion("type", [
  TextBlock.extend(layers),
  HeadingBlock.extend(layers),
  ListBlock.extend(layers),
  QuoteBlock.extend(layers),
  StatementBlock.extend(layers),
  DividerBlock.extend(layers),
  SpacerBlock.extend(layers),
  ImageBlock.extend(layers),
  ImageGalleryBlock.extend(layers),
  VideoBlock.extend(layers),
  AudioBlock.extend(layers),
  EmbedBlock.extend(layers),
  AccordionBlock.extend(layers),
  TabsBlock.extend(layers),
  FlashcardsBlock.extend(layers),
  LabeledGraphicBlock.extend(layers),
  HotspotBlock.extend(layers),
  ProcessBlock.extend(layers),
  SortingBlock.extend(layers),
  ScenarioBlock.extend(layers),
  KnowledgeCheckBlock.extend(layers),
  QuizBlock.extend(layers),
  ContinueBlock.extend(layers),
  ComponentBlock.extend(layers),
]);

export type Block = z.infer<typeof Block>;

export const BLOCK_TYPES = LEAF_VARIANTS.map((v) => v.shape.type.value);
