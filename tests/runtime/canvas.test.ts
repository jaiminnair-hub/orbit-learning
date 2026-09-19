import { describe, expect, it } from "vitest";
import type { CanvasLayout, Position } from "@/lib/spec";
import { canvasFrameStyle, positionStyle } from "@/lib/runtime/canvas";

// Pure conversion-math tests for Phase 3B, Track 2 step 1 — no DB, no
// network, no React, matching the discipline lib/runtime/engine.ts and
// lib/runtime/animation.ts's own tests use.

function layout(overrides: Partial<CanvasLayout> = {}): CanvasLayout {
  return { mode: "canvas", width: 1280, height: 720, scaling: "fit", ...overrides };
}

function position(overrides: Partial<Position> = {}): Position {
  return { x: 0, y: 0, width: 100, height: 100, unit: "px", ...overrides };
}

describe("positionStyle: px units convert to percent of the design viewport", () => {
  it("converts x/y/width/height against the layout's own dimensions", () => {
    const style = positionStyle(position({ x: 128, y: 72, width: 640, height: 360 }), layout());
    expect(style.left).toBe("10%");
    expect(style.top).toBe("10%");
    expect(style.width).toBe("50%");
    expect(style.height).toBe("50%");
  });

  it("always renders as position: absolute", () => {
    expect(positionStyle(position(), layout()).position).toBe("absolute");
  });
});

describe("positionStyle: percent units pass through unchanged", () => {
  it("uses the authored percentage directly, ignoring layout dimensions", () => {
    const style = positionStyle(position({ x: 25, y: 50, width: 10, height: 20, unit: "percent" }), layout({ width: 999, height: 999 }));
    expect(style.left).toBe("25%");
    expect(style.top).toBe("50%");
    expect(style.width).toBe("10%");
    expect(style.height).toBe("20%");
  });
});

describe("positionStyle: zIndex, rotation, opacity", () => {
  it("carries zIndex and opacity through directly", () => {
    const style = positionStyle(position({ zIndex: 5, opacity: 0.5 }), layout());
    expect(style.zIndex).toBe(5);
    expect(style.opacity).toBe(0.5);
  });

  it("renders rotation as a CSS rotate() transform", () => {
    expect(positionStyle(position({ rotation: 45 }), layout()).transform).toBe("rotate(45deg)");
  });

  it("omits the transform entirely when there is no rotation", () => {
    expect(positionStyle(position(), layout()).transform).toBeUndefined();
  });
});

describe("canvasFrameStyle: scaling modes", () => {
  it("fit: responsive width, aspect ratio locked to the design viewport", () => {
    const style = canvasFrameStyle(layout({ width: 1280, height: 720, scaling: "fit" }));
    expect(style.width).toBe("100%");
    expect(style.aspectRatio).toBe("1280 / 720");
  });

  it("fill: responsive width, no aspect-ratio lock, literal design height", () => {
    const style = canvasFrameStyle(layout({ height: 720, scaling: "fill" }));
    expect(style.width).toBe("100%");
    expect(style.height).toBe(720);
    expect(style.aspectRatio).toBeUndefined();
  });

  it("fixed: literal pixel dimensions, scrolls instead of scaling", () => {
    const style = canvasFrameStyle(layout({ width: 1280, height: 720, scaling: "fixed" }));
    expect(style.width).toBe(1280);
    expect(style.height).toBe(720);
    expect(style.overflow).toBe("auto");
  });
});
