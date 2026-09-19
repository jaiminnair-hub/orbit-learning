import { describe, expect, it } from "vitest";
import type { Animation, TimelineTrack } from "@/lib/spec";
import { animationStyle, computeBlockAnimationState, type PlayableAnimation } from "@/lib/runtime/animation";

// Pure timing-logic tests for Phase 3B, Track 1 step 2 — no DB, no network,
// no React, matching the discipline lib/runtime/engine.ts's own tests use.

function entrance(overrides: Partial<PlayableAnimation> = {}): PlayableAnimation {
  return { id: "a1", kind: "entrance", preset: "fade", startMs: 1000, durationMs: 500, ...overrides } as PlayableAnimation;
}

function exit(overrides: Partial<PlayableAnimation> = {}): PlayableAnimation {
  return { id: "a1", kind: "exit", preset: "fade", startMs: 1000, durationMs: 500, ...overrides } as PlayableAnimation;
}

function emphasis(overrides: Partial<PlayableAnimation> = {}): PlayableAnimation {
  return { id: "a1", kind: "emphasis", preset: "pulse", startMs: 1000, durationMs: 500, ...overrides } as PlayableAnimation;
}

describe("computeBlockAnimationState: appear/disappear scheduling", () => {
  it("is invisible before its scheduled appearance and visible after", () => {
    const track: TimelineTrack = { blockId: "b1", appearAtMs: 2000 };
    expect(computeBlockAnimationState(track, 1999).visible).toBe(false);
    expect(computeBlockAnimationState(track, 2000).visible).toBe(true);
  });

  it("is visible from the start when no track exists at all", () => {
    expect(computeBlockAnimationState(undefined, 0).visible).toBe(true);
  });

  it("disappears at its scheduled time and never comes back", () => {
    const track: TimelineTrack = { blockId: "b1", disappearAtMs: 3000 };
    expect(computeBlockAnimationState(track, 2999).visible).toBe(true);
    expect(computeBlockAnimationState(track, 3000).visible).toBe(false);
    expect(computeBlockAnimationState(track, 999_999).visible).toBe(false);
  });
});

describe("computeBlockAnimationState: entrance/exit/emphasis windows", () => {
  it("has no active animation before its startMs and after it finishes", () => {
    const track: TimelineTrack = { blockId: "b1", animations: [entrance()] };
    expect(computeBlockAnimationState(track, 999).active).toBeUndefined();
    expect(computeBlockAnimationState(track, 1000).active?.id).toBe("a1");
    expect(computeBlockAnimationState(track, 1499).active?.id).toBe("a1");
    expect(computeBlockAnimationState(track, 1500).active).toBeUndefined();
  });

  it("stays visible after an entrance animation finishes — it settles into the normal render", () => {
    const track: TimelineTrack = { blockId: "b1", animations: [entrance()] };
    expect(computeBlockAnimationState(track, 2000).visible).toBe(true);
  });

  it("hides the block for good once an exit animation finishes playing", () => {
    const track: TimelineTrack = { blockId: "b1", animations: [exit()] };
    expect(computeBlockAnimationState(track, 1400).visible).toBe(true);
    expect(computeBlockAnimationState(track, 1400).active?.id).toBe("a1");
    expect(computeBlockAnimationState(track, 1500).visible).toBe(false);
    expect(computeBlockAnimationState(track, 999_999).visible).toBe(false);
  });

  it("repeats an emphasis animation for repeat+1 cycles, then stops", () => {
    // durationMs 500, repeat 2 -> three total cycles -> active for 1500ms from startMs.
    const track: TimelineTrack = { blockId: "b1", animations: [emphasis({ repeat: 2 })] };
    expect(computeBlockAnimationState(track, 1000).active?.id).toBe("a1");
    expect(computeBlockAnimationState(track, 2499).active?.id).toBe("a1");
    expect(computeBlockAnimationState(track, 2500).active).toBeUndefined();
  });

  it("keeps an emphasis animation active indefinitely when repeat is 0 (loop)", () => {
    const track: TimelineTrack = { blockId: "b1", animations: [emphasis({ repeat: 0 })] };
    expect(computeBlockAnimationState(track, 1_000_000).active?.id).toBe("a1");
  });

  it("picks the last-declared animation when two windows overlap", () => {
    const track: TimelineTrack = {
      blockId: "b1",
      animations: [emphasis({ id: "first", startMs: 0, durationMs: 5000 }), emphasis({ id: "second", startMs: 1000, durationMs: 500 })],
    };
    expect(computeBlockAnimationState(track, 1200).active?.id).toBe("second");
  });

  it("ignores a motion animation entirely — it needs canvas coordinates this player doesn't have", () => {
    const motion: Animation = { id: "m1", kind: "motion", startMs: 0, durationMs: 1000, path: { kind: "line", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] } };
    const track: TimelineTrack = { blockId: "b1", animations: [motion] };
    expect(computeBlockAnimationState(track, 500).active).toBeUndefined();
    expect(computeBlockAnimationState(track, 500).visible).toBe(true);
  });
});

describe("animationStyle", () => {
  it("names the keyframe after the animation's kind and preset, and carries duration/easing", () => {
    const style = animationStyle(entrance({ preset: "slideFromLeft", easing: "bounce" }), true);
    expect(style.animationName).toBe("orbit-rt-entrance-slideFromLeft");
    expect(style.animationDuration).toBe("500ms");
    expect(style.animationPlayState).toBe("running");
  });

  it("pauses without changing which animation is set, when playing is false", () => {
    const style = animationStyle(entrance(), false);
    expect(style.animationPlayState).toBe("paused");
  });

  it("sets an infinite iteration count for repeat: 0, and repeat+1 otherwise", () => {
    expect(animationStyle(emphasis({ repeat: 0 }), true).animationIterationCount).toBe("infinite");
    expect(animationStyle(emphasis({ repeat: 3 }), true).animationIterationCount).toBe(4);
    expect(animationStyle(emphasis(), true).animationIterationCount).toBe(1);
  });
});
