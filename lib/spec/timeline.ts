import { z } from "zod";
import { SpecId } from "./primitives";

/**
 * The timeline model.
 *
 * Phase 3 uses only the cue-point half (timed reveal, and `timelineCue` as a
 * trigger event). The animation half is **Phase 3B** — no Phase 3 editor
 * surface produces it — but it lives here from v1 for the same reason canvas
 * layout does: retrofitting it after the interpreter and editor exist is a spec
 * migration plus two rewrites.
 *
 * Animations are named presets and declarative paths, never author-supplied
 * code or easing expressions. The closed set is what keeps "no executable
 * content" structurally true rather than dependent on sanitisation.
 */

export const Easing = z.enum([
  "linear",
  "easeIn",
  "easeOut",
  "easeInOut",
  "spring",
  "bounce",
]);

export const EntrancePreset = z.enum([
  "fade",
  "wipe",
  "slideFromLeft",
  "slideFromRight",
  "slideFromTop",
  "slideFromBottom",
  "zoomIn",
  "grow",
  "spin",
]);

export const ExitPreset = z.enum([
  "fade",
  "wipe",
  "slideToLeft",
  "slideToRight",
  "slideToTop",
  "slideToBottom",
  "zoomOut",
  "shrink",
  "spin",
]);

export const EmphasisPreset = z.enum(["pulse", "shake", "flash", "bounce", "colorShift"]);

/**
 * A motion path, expressed as geometry rather than as a path expression.
 *
 * Coordinates are design-viewport units, matching `Position` — a motion path is
 * only meaningful on a canvas page, which `validate.ts` enforces.
 */
export const MotionPath = z.strictObject({
  kind: z.enum(["line", "arc", "polyline", "loop"]),
  points: z
    .array(z.strictObject({ x: z.number(), y: z.number() }))
    .min(2)
    .max(200),
  /** Points are offsets from the block's position rather than absolute. */
  relative: z.boolean().optional(),
  /** Rotates the block to follow the path tangent. */
  orientToPath: z.boolean().optional(),
});

const AnimationBase = {
  id: SpecId,
  startMs: z.number().int().min(0).max(3_600_000),
  durationMs: z.number().int().min(0).max(600_000),
  easing: Easing.optional(),
  /** Repeat count; omitted means once. `0` means loop indefinitely. */
  repeat: z.number().int().min(0).max(999).optional(),
};

export const EntranceAnimation = z.strictObject({
  ...AnimationBase,
  kind: z.literal("entrance"),
  preset: EntrancePreset,
});

export const ExitAnimation = z.strictObject({
  ...AnimationBase,
  kind: z.literal("exit"),
  preset: ExitPreset,
});

export const EmphasisAnimation = z.strictObject({
  ...AnimationBase,
  kind: z.literal("emphasis"),
  preset: EmphasisPreset,
});

export const MotionAnimation = z.strictObject({
  ...AnimationBase,
  kind: z.literal("motion"),
  path: MotionPath,
});

export const Animation = z.discriminatedUnion("kind", [
  EntranceAnimation,
  ExitAnimation,
  EmphasisAnimation,
  MotionAnimation,
]);

export type Animation = z.infer<typeof Animation>;

/** A named instant on the timeline that triggers can fire from. */
export const CuePoint = z.strictObject({
  id: SpecId,
  name: z.string().max(120).optional(),
  atMs: z.number().int().min(0).max(3_600_000),
});

/** One block's presence and animation across the page timeline. */
export const TimelineTrack = z.strictObject({
  blockId: SpecId,
  appearAtMs: z.number().int().min(0).max(3_600_000).optional(),
  disappearAtMs: z.number().int().min(0).max(3_600_000).optional(),
  animations: z.array(Animation).max(50).optional(),
});

export type TimelineTrack = z.infer<typeof TimelineTrack>;

export const Timeline = z.strictObject({
  durationMs: z.number().int().min(0).max(3_600_000),
  /** Starts on page entry rather than waiting for a trigger. */
  autoplay: z.boolean().optional(),
  cuePoints: z.array(CuePoint).max(100).optional(),
  tracks: z.array(TimelineTrack).max(500).optional(),
});

export type Timeline = z.infer<typeof Timeline>;
