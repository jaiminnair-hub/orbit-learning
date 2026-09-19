import { LIFECYCLE_STAGES } from "./capability-lifecycle-data";
import { CapabilityCore } from "./capability-core";
import { OrbitNode } from "./orbit-node";

/**
 * Six fixed positions around an ellipse (in percent, so they stay correct
 * at any container size without a resize listener) — 60° apart, clockwise
 * from the top, in the exact Learn→Practice→Assess→Demonstrate→Measure→Grow
 * order. `left/top` are in a 0–100 square coordinate space; the container's
 * own wide-not-tall aspect ratio is what turns this into a visible ellipse
 * (the background SVG uses `preserveAspectRatio="none"` for the same
 * reason, so its circles stretch into ellipses that land exactly on these
 * points).
 */
const RADIUS = 38;
function ellipsePoint(index: number) {
  const angle = ((-90 + index * 60) * Math.PI) / 180;
  return {
    left: 50 + RADIUS * Math.cos(angle),
    top: 50 + RADIUS * Math.sin(angle),
  };
}
const NODE_POSITIONS = LIFECYCLE_STAGES.map((_, i) => ellipsePoint(i));

export function LearningOrbit() {
  return (
    <div className="learning-orbit">
      <svg className="learning-orbit__rings" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <ellipse className="learning-orbit__ring learning-orbit__ring--outer" cx="50" cy="50" rx="46" ry="46" />
        <ellipse className="learning-orbit__ring learning-orbit__ring--main" cx="50" cy="50" rx="38" ry="38" />
        <ellipse className="learning-orbit__ring learning-orbit__ring--inner" cx="50" cy="50" rx="30" ry="30" strokeDasharray="0.6 2.2" />
      </svg>

      <span className="learning-orbit__particle" aria-hidden="true" />

      <div className="learning-orbit__core-slot">
        <CapabilityCore />
      </div>

      {LIFECYCLE_STAGES.map((stage, i) => (
        <OrbitNode key={stage.key} stage={stage} index={i} left={NODE_POSITIONS[i].left} top={NODE_POSITIONS[i].top} />
      ))}

      <p className="sr-only">
        The capability journey, in order:{" "}
        {LIFECYCLE_STAGES.map((s) => s.label).join(" → ")}, then back to {LIFECYCLE_STAGES[0].label}.
      </p>
    </div>
  );
}
