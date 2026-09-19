import type { CSSProperties } from "react";
import type { CanvasLayout, Position } from "@/lib/spec";

/**
 * Canvas-layout positioning — Phase 3B, Track 2 step 1.
 *
 * `Position` coordinates are design-viewport units (px by default, or
 * already-percent). Converting everything to percentages of the design
 * viewport at render time — rather than rendering literal pixels — is what
 * lets `fit`/`fill` scale responsively with zero JS measurement: a block
 * positioned at x:100 on a 1280-wide design canvas is left:7.8125% whether
 * the frame renders at 1280px or 320px wide.
 */

function toPercent(value: number, unit: Position["unit"], dimension: number): number {
  return unit === "percent" ? value : (value / dimension) * 100;
}

/** Absolute-position style for one block inside its canvas frame. */
export function positionStyle(position: Position, layout: CanvasLayout): CSSProperties {
  const unit = position.unit ?? "px";
  return {
    position: "absolute",
    left: `${toPercent(position.x, unit, layout.width)}%`,
    top: `${toPercent(position.y, unit, layout.height)}%`,
    width: `${toPercent(position.width, unit, layout.width)}%`,
    height: `${toPercent(position.height, unit, layout.height)}%`,
    zIndex: position.zIndex,
    opacity: position.opacity,
    transform: position.rotation ? `rotate(${position.rotation}deg)` : undefined,
  };
}

/** Sizing style for the canvas frame itself, per its `scaling` mode. */
export function canvasFrameStyle(layout: CanvasLayout): CSSProperties {
  const scaling = layout.scaling ?? "fit";
  switch (scaling) {
    case "fixed":
      return { position: "relative", width: layout.width, height: layout.height, overflow: "auto" };
    case "fill":
      // Stretches to whatever height its container gives it; children are
      // percentage-positioned in both axes, so they stretch non-uniformly
      // right along with it -- that's what "fill" (no aspect lock) means.
      return { position: "relative", width: "100%", height: layout.height };
    case "fit":
    default:
      return { position: "relative", width: "100%", aspectRatio: `${layout.width} / ${layout.height}` };
  }
}

/** Style for a canvas frame's optional background. */
export function canvasBackgroundStyle(layout: CanvasLayout, imageUrl: string | undefined): CSSProperties {
  const background = layout.background;
  if (!background) return {};
  const style: CSSProperties = {};
  if (background.color) style.backgroundColor = background.color.startsWith("#") ? background.color : `var(--${background.color})`;
  if (imageUrl) {
    style.backgroundImage = `url(${imageUrl})`;
    style.backgroundSize = background.fit === "contain" ? "contain" : background.fit === "tile" ? "auto" : "cover";
    style.backgroundRepeat = background.fit === "tile" ? "repeat" : "no-repeat";
    style.backgroundPosition = "center";
  }
  return style;
}
