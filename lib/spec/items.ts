import { z } from "zod";
import { PlainText, RichText, SpecId } from "./primitives";

/**
 * Assessment items carried *inline in the specification*.
 *
 * Phase 3's deliberate boundary (MASTER_FEATURE_MATRIX.md reconciliation note
 * 1): a Rise/Storyline-class authoring engine cannot ship without in-content
 * knowledge checks, but the standalone question bank, pooling, attempt rules
 * and scoring engine are Phase 4. Phase 4 adopts *this* item shape rather than
 * inventing a second one — which is the whole point of defining it carefully
 * here rather than expediently.
 */

export const ItemChoice = z.strictObject({
  id: SpecId,
  text: RichText,
  correct: z.boolean().optional(),
  /** Shown after answering, per choice — the Rise/Storyline affordance. */
  feedback: RichText.optional(),
});

export const ItemFeedback = z.strictObject({
  correct: RichText.optional(),
  incorrect: RichText.optional(),
  partial: RichText.optional(),
});

const ItemBase = {
  id: SpecId,
  prompt: RichText,
  /** Author-facing note, never shown to a learner. */
  authorNote: PlainText.optional(),
  feedback: ItemFeedback.optional(),
  points: z.number().min(0).max(1000).optional(),
  /** Skill tag ids this item evidences. */
  skillTagIds: z.array(z.uuid()).max(20).optional(),
};

export const MultipleChoiceItem = z.strictObject({
  ...ItemBase,
  kind: z.literal("multipleChoice"),
  choices: z.array(ItemChoice).min(2).max(20),
  shuffle: z.boolean().optional(),
});

export const MultipleResponseItem = z.strictObject({
  ...ItemBase,
  kind: z.literal("multipleResponse"),
  choices: z.array(ItemChoice).min(2).max(20),
  shuffle: z.boolean().optional(),
  /** Award partial credit for a partially-correct selection. */
  partialCredit: z.boolean().optional(),
});

export const TrueFalseItem = z.strictObject({
  ...ItemBase,
  kind: z.literal("trueFalse"),
  answer: z.boolean(),
});

/**
 * Phase 3 subset per AUTHORING_CAPABILITY_CHECKLIST.md §4 — accepted answers
 * are compared literally, with optional case-insensitivity. No regex and no
 * expression matching: an author-supplied pattern is executable content by
 * another name.
 */
export const FillBlankItem = z.strictObject({
  ...ItemBase,
  kind: z.literal("fillBlank"),
  acceptedAnswers: z.array(z.string().min(1).max(500)).min(1).max(50),
  caseSensitive: z.boolean().optional(),
  trimWhitespace: z.boolean().optional(),
});

export const SequencingItem = z.strictObject({
  ...ItemBase,
  kind: z.literal("sequencing"),
  /** Authored in the correct order; the runtime presents them shuffled. */
  steps: z.array(z.strictObject({ id: SpecId, text: RichText })).min(2).max(20),
});

export const AssessmentItem = z.discriminatedUnion("kind", [
  MultipleChoiceItem,
  MultipleResponseItem,
  TrueFalseItem,
  FillBlankItem,
  SequencingItem,
]);

export type AssessmentItem = z.infer<typeof AssessmentItem>;
