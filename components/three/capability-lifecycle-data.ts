/**
 * The learner capability loop, in the product's own language
 * (LEARN → PRACTICE → ASSESS → DEMONSTRATE → MEASURE → GROW, cycling back).
 *
 * `live` reflects what is ACTUALLY SHIPPED today, not the roadmap vision.
 * Per the content-accuracy rule for the public site: a stage is only
 * flipped to `live: true` once its chips describe real, verified,
 * learner-facing capability — never the roadmap vision. As of 2026-09-10,
 * that's Learn (Phase 2 — courses, content, SCORM/xAPI/cmi5, learning
 * paths) plus Assess (the standalone assessment engine — question bank,
 * scoring, time limits, pooling) and Demonstrate (certificate issuance +
 * public no-login verification). Practice, Measure and Grow remain
 * roadmap and must never be presented as present-tense product claims.
 * The 3D encodes this directly: live stages are lit terracotta, roadmap
 * stages are dimmed.
 *
 * `accentVar`/`surfaceVar` give each stage its own bright Orbit accent
 * (all six brand hues used once each) so the hero stepper and its expand
 * panel can recolor per stage without any stage looking like a copy of
 * another.
 *
 * Shared by the 3D scene, its static fallback, and the accessible HTML
 * stage list so all three can never drift out of sync.
 */
export type LifecycleStage = {
  key: string;
  label: string;
  live: boolean;
  /** One-line description shown under the stage name. */
  short: string;
  /** Longer status line shown in the stage's expand panel. */
  blurb: string;
  /** 2-3 concrete, nameable things this stage includes. */
  chips: string[];
  accentVar: string;
  surfaceVar: string;
  /** Short sentence shown in the orbit hero's hover/focus tooltip. */
  tooltip: string;
};

export const LIFECYCLE_STAGES: LifecycleStage[] = [
  {
    key: "learn",
    label: "Learn",
    live: true,
    short: "Acquire knowledge. Spark new connections.",
    blurb: "Courses, content, SCORM, learning paths — shipped and in use today.",
    tooltip: "Acquire knowledge and build new connections.",
    chips: ["SCORM & xAPI", "Certificates on completion"],
    accentVar: "var(--orbit-learning)",
    surfaceVar: "var(--orbit-learning-surface)",
  },
  {
    key: "practice",
    label: "Practice",
    live: false,
    short: "Rehearse in context. Build confidence.",
    blurb: "AI practice lab — rehearse the conversation before it counts.",
    tooltip: "Rehearse in context and build confidence.",
    chips: ["AI practice lab", "Instant feedback"],
    accentVar: "var(--orbit-feedback)",
    surfaceVar: "var(--orbit-feedback-surface)",
  },
  {
    key: "assess",
    label: "Assess",
    live: true,
    short: "Check understanding. Identify gaps.",
    blurb: "Assessments and question bank — evidence, not attendance. Shipped and in use today.",
    tooltip: "Check understanding and identify gaps.",
    chips: ["5 question types", "Partial credit", "Timed & randomized"],
    accentVar: "var(--orbit-energy)",
    surfaceVar: "var(--orbit-energy-surface)",
  },
  {
    key: "demonstrate",
    label: "Demonstrate",
    live: true,
    short: "Show what you can do. Create evidence.",
    blurb: "Certificates issue automatically on a real pass — publicly verifiable, no login required.",
    tooltip: "Apply skills and create verifiable evidence.",
    chips: ["Verified certificates", "Public verification page"],
    accentVar: "var(--orbit-saffron)",
    surfaceVar: "var(--orbit-saffron-surface)",
  },
  {
    key: "measure",
    label: "Measure",
    live: false,
    short: "Track progress. Prove impact.",
    blurb: "Skill proficiency tracked against the roles that need it.",
    tooltip: "Track progress and prove impact.",
    chips: ["Skill maps", "Role benchmarks"],
    accentVar: "var(--orbit-indigo)",
    surfaceVar: "var(--orbit-indigo-surface)",
  },
  {
    key: "grow",
    label: "Grow",
    live: false,
    short: "Strengthen capability. Evolve continuously.",
    blurb: "Career paths and mobility modelled on capability evidence.",
    tooltip: "Strengthen capability continuously.",
    chips: ["Career pathways", "Mobility signals"],
    accentVar: "var(--orbit-growth)",
    surfaceVar: "var(--orbit-growth-surface)",
  },
];
