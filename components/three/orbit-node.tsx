import type { CSSProperties } from "react";
import type { LifecycleStage } from "./capability-lifecycle-data";
import { STAGE_ICONS } from "./orbit-icons";

/**
 * One stage on the orbit — a fixed hexagon position (nodes don't travel;
 * only the decorative rings and the light particle move). Brightness/scale
 * cycle through the shared 12s loop via `--i`-staggered `animation-delay`
 * (see `.orbit-node` in globals.css), so no per-node keyframes are needed.
 * Hover/focus pauses that cycle and reveals the description tooltip —
 * both handled in CSS (`:hover`, `:focus-visible`), no JS state required.
 */
export function OrbitNode({
  stage,
  index,
  left,
  top,
}: {
  stage: LifecycleStage;
  index: number;
  left: number;
  top: number;
}) {
  const Icon = STAGE_ICONS[stage.key];
  const tipId = `orbit-tip-${stage.key}`;

  return (
    <div
      className="orbit-node"
      style={{ left: `${left}%`, top: `${top}%`, "--i": index } as CSSProperties}
    >
      <button type="button" className="orbit-node__hit" aria-describedby={tipId}>
        <span className="orbit-node__disc">
          <span className="orbit-node__icon">{Icon ? <Icon /> : null}</span>
        </span>
        <span className="orbit-node__label">{stage.label}</span>
      </button>
      <span className="orbit-node__tooltip" role="tooltip" id={tipId}>
        {stage.tooltip}
      </span>
    </div>
  );
}
