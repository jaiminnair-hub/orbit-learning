import type { CSSProperties } from "react";
import type { Animation, TimelineTrack } from "@/lib/spec";

/**
 * Entrance/exit/emphasis animation timing — Phase 3B, Track 1 step 2.
 *
 * Pure and synchronous, same design rule as lib/runtime/engine.ts: given a
 * track and an elapsed-ms reading from the player's own clock (built in step
 * 1 for cue points), decide whether a block is visible right now and which of
 * its animations, if any, is currently playing. The player applies the
 * result as CSS — presets are a closed set (lib/spec/timeline.ts), so a
 * fixed keyframe per preset (app/globals.css) is enough; no animation library
 * needed. Motion-path animation is excluded here on purpose: it needs canvas
 * coordinates (Track 2), which flow-layout pages don't have.
 */

/** Everything but `MotionAnimation` — that variant needs canvas coordinates (Track 2). */
export type PlayableAnimation = Extract<Animation, { preset: string }>;

export interface BlockAnimationState {
  visible: boolean;
  active?: PlayableAnimation;
}

function isPlayable(animation: Animation): animation is PlayableAnimation {
  return animation.kind !== "motion";
}

function animationWindowMs(animation: PlayableAnimation): number {
  const cycles = animation.repeat === 0 ? Infinity : (animation.repeat ?? 0) + 1;
  return cycles === Infinity ? Infinity : animation.durationMs * cycles;
}

export function computeBlockAnimationState(track: TimelineTrack | undefined, elapsedMs: number): BlockAnimationState {
  const appearAtMs = track?.appearAtMs ?? 0;
  const disappearAtMs = track?.disappearAtMs;
  if (elapsedMs < appearAtMs) return { visible: false };
  if (disappearAtMs !== undefined && elapsedMs >= disappearAtMs) return { visible: false };

  const animations = (track?.animations ?? []).filter(isPlayable);

  // An exit animation that has already finished playing removes the block
  // for the rest of this page visit. There is no trigger-free way back in,
  // and snapping back to visible once the exit has played would be more
  // confusing than staying gone.
  const exitedForGood = animations.some((a) => a.kind === "exit" && elapsedMs >= a.startMs + animationWindowMs(a));
  if (exitedForGood) return { visible: false };

  // Last-declared wins when two animations overlap — an author stacking two
  // effects at the same instant almost certainly means "replace", not "layer".
  let active: PlayableAnimation | undefined;
  for (const animation of animations) {
    const elapsedInAnimation = elapsedMs - animation.startMs;
    const windowMs = animationWindowMs(animation);
    if (elapsedInAnimation >= 0 && elapsedInAnimation < windowMs) active = animation;
  }
  return { visible: true, active };
}

const EASING_CSS: Record<NonNullable<PlayableAnimation["easing"]>, string> = {
  linear: "linear",
  easeIn: "cubic-bezier(.42,0,1,1)",
  easeOut: "cubic-bezier(0,0,.58,1)",
  easeInOut: "cubic-bezier(.42,0,.58,1)",
  spring: "cubic-bezier(.34,1.56,.64,1)",
  bounce: "cubic-bezier(.68,-.55,.265,1.55)",
};

/** The `@keyframes` name app/globals.css defines for this animation's kind + preset. */
export function keyframeName(animation: PlayableAnimation): string {
  return `orbit-rt-${animation.kind}-${animation.preset}`;
}

/** Inline style for the currently-active animation. `playing` toggles it with `playTimeline`/`pauseTimeline`. */
export function animationStyle(animation: PlayableAnimation, playing: boolean): CSSProperties {
  const cycles = animation.repeat === 0 ? Infinity : (animation.repeat ?? 0) + 1;
  return {
    animationName: keyframeName(animation),
    animationDuration: `${animation.durationMs}ms`,
    animationTimingFunction: EASING_CSS[animation.easing ?? "easeInOut"],
    animationIterationCount: cycles === Infinity ? "infinite" : cycles,
    animationFillMode: "forwards",
    animationPlayState: playing ? "running" : "paused",
  };
}
