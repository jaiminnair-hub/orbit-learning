import { z } from "zod";
import { Block } from "./blocks";
import { Variable, Trigger } from "./interactions";
import { PageLayout, Theme } from "./layout";
import { Timeline } from "./timeline";
import { AssetRef, Locale, PlainText, RichText, SpecId } from "./primitives";
import { SPEC_SCHEMA_VERSION } from "./version";

/**
 * The course specification — the contract between the AI, the editor, the
 * renderer, and every publish target.
 *
 * The LLM writes this and nothing else: no application code, no HTML, no
 * rendered artifact. That single constraint is what makes generation
 * reviewable, hand-editable, portable across publish targets, and
 * model-agnostic.
 */

/**
 * A page — the addressable navigation unit (≈ a lesson, or a Storyline slide).
 */
export const Page = z.strictObject({
  id: SpecId,
  title: PlainText,
  /** Flow by default. Canvas is the Phase 3B opt-in — see layout.ts. */
  layout: PageLayout.optional(),
  blocks: z.array(Block).max(500),
  /** Page-scoped triggers, e.g. `pageEnter`. */
  triggers: z.array(Trigger).max(50).optional(),
  timeline: Timeline.optional(),
  /** Learner must complete this page before moving on. */
  gated: z.boolean().optional(),
  /** Hidden from the menu; reachable only via a navigate action. */
  hiddenFromMenu: z.boolean().optional(),
  notes: RichText.optional(),
});

export type Page = z.infer<typeof Page>;

/** A section — the grouping unit (≈ a module). */
export const Section = z.strictObject({
  id: SpecId,
  title: PlainText,
  description: RichText.optional(),
  pages: z.array(Page).max(200),
});

export type Section = z.infer<typeof Section>;

export const LearningObjective = z.strictObject({
  id: SpecId,
  text: PlainText,
  skillTagIds: z.array(z.uuid()).max(20).optional(),
});

export const CourseMeta = z.strictObject({
  title: PlainText,
  description: RichText.optional(),
  /**
   * The primary locale. Translations are sibling specification rows (Phase 6),
   * aligned to this one by the stable ids on every section, page and block —
   * which is what "locale-addressable from day one" buys, without inflating
   * every string into a per-locale map.
   */
  locale: Locale.default("en"),
  /** Reading direction; the runtime honours it from v1. */
  direction: z.enum(["ltr", "rtl"]).optional(),
  thumbnailAssetId: AssetRef.optional(),
  estimatedMinutes: z.number().int().min(0).max(10_000).optional(),
  /** Declares the accessibility bar the content is authored against. */
  accessibilityProfile: z.enum(["wcag-2.2-aa", "wcag-2.2-a", "none"]).optional(),
});

export const CourseNavigation = z.strictObject({
  mode: z.enum(["free", "linear", "gated"]).optional(),
  showMenu: z.boolean().optional(),
  showProgress: z.boolean().optional(),
  allowExit: z.boolean().optional(),
});

export const CourseCompletion = z.strictObject({
  /** How the course reports complete to the host (LMS, SCORM, cmi5). */
  rule: z.enum(["allPagesVisited", "allBlocksComplete", "passedQuiz", "manual"]).optional(),
  /** Required when `rule` is `passedQuiz`. */
  quizBlockId: SpecId.optional(),
  passingScorePercent: z.number().min(0).max(100).optional(),
});

export const CourseSpec = z.strictObject({
  /** Must match a version this build supports. */
  specSchemaVersion: z.string().max(20).default(SPEC_SCHEMA_VERSION),
  meta: CourseMeta,
  theme: Theme.optional(),
  /** Skill tag ids (`skill_tags.id`) this course addresses. */
  skillTagIds: z.array(z.uuid()).max(50).optional(),
  objectives: z.array(LearningObjective).max(100).optional(),
  variables: z.array(Variable).max(200).optional(),
  navigation: CourseNavigation.optional(),
  completion: CourseCompletion.optional(),
  sections: z.array(Section).max(100),
});

export type CourseSpec = z.infer<typeof CourseSpec>;
