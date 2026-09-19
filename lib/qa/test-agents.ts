export type OrbitProduct = "Platform Control" | "Orbit Learning" | "360 Feedback" | "Competencies" | "Orbit Growth";
export type CoverageState = "live" | "prepared";
export type QaAgentId = "orbit-admin-test-agent" | "orbit-learner-test-agent";

export type QaStep = { id: string; product: OrbitProduct; action: string; expected: string; automation: "guided" | "automation-ready" | "blocked" };
export type QaAgent = { id: QaAgentId; name: string; role: string; purpose: string; guardrail: string; coverage: Array<{ product: OrbitProduct; role: string; state: CoverageState }>; steps: QaStep[] };

export const qaAgents: QaAgent[] = [
  {
    id: "orbit-admin-test-agent", name: "Admin Test Agent", role: "Test-only platform and organization administrator",
    purpose: "Proves that an authorized admin can set up, govern and review the live Orbit products without bypassing permissions.",
    guardrail: "Runs only in the dedicated Orbit QA organization. It never invites real people, changes a customer workspace or sends production email.",
    coverage: [
      { product: "Platform Control", role: "platform test administrator", state: "live" }, { product: "Orbit Learning", role: "organization admin and course author", state: "live" }, { product: "360 Feedback", role: "feedback administrator", state: "live" }, { product: "Competencies", role: "future product administrator", state: "prepared" }, { product: "Orbit Growth", role: "future product administrator", state: "prepared" },
    ],
    steps: [
      { id: "admin-platform", product: "Platform Control", action: "Open the QA organization from Platform Control.", expected: "Only the isolated QA workspace is visible and the audit trail records the test run.", automation: "guided" },
      { id: "admin-learning", product: "Orbit Learning", action: "Create a draft course from approved fixture content and review the draft.", expected: "The course remains a draft; no learner receives a notification and nothing is published automatically.", automation: "automation-ready" },
      { id: "admin-360", product: "360 Feedback", action: "Open the 360 administrator workspace and verify the role gate.", expected: "The agent reaches admin planning tools only with its feedback_admin test role.", automation: "guided" },
      { id: "admin-future", product: "Competencies", action: "Check the future-product access boundary.", expected: "The run reports prepared, not passed, until a real workspace and test role exist.", automation: "blocked" },
      { id: "admin-growth", product: "Orbit Growth", action: "Check the future-product access boundary.", expected: "The run reports prepared, not passed, until a real workspace and test role exist.", automation: "blocked" },
    ],
  },
  {
    id: "orbit-learner-test-agent", name: "Learner Test Agent", role: "Test-only learner, 360 subject and assigned reviewer",
    purpose: "Proves that an end user can learn and contribute feedback without gaining administrative or report access.",
    guardrail: "Uses fixture learning content and synthetic feedback data only. It can never see confidential 360 reports or edit organization settings.",
    coverage: [
      { product: "Platform Control", role: "no access", state: "live" }, { product: "Orbit Learning", role: "learner", state: "live" }, { product: "360 Feedback", role: "feedback subject and assigned reviewer", state: "live" }, { product: "Competencies", role: "future learner", state: "prepared" }, { product: "Orbit Growth", role: "future participant", state: "prepared" },
    ],
    steps: [
      { id: "learner-boundary", product: "Platform Control", action: "Attempt to open Platform Control from the learner session.", expected: "Access is denied and the learner returns to their permitted workspace.", automation: "automation-ready" },
      { id: "learner-course", product: "Orbit Learning", action: "Open the fixture course, complete one learning page and submit the fixture assessment.", expected: "Progress is saved to the QA learner only and is visible in the learner evidence area.", automation: "automation-ready" },
      { id: "learner-360", product: "360 Feedback", action: "Open an assigned test reviewer link and submit synthetic feedback.", expected: "The response is private to the QA cycle and no protected report is released.", automation: "blocked" },
      { id: "learner-future", product: "Competencies", action: "Check the future-product access boundary.", expected: "The run reports prepared, not passed, until a real learner workspace exists.", automation: "blocked" },
      { id: "learner-growth", product: "Orbit Growth", action: "Check the future-product access boundary.", expected: "The run reports prepared, not passed, until a real participant workspace exists.", automation: "blocked" },
    ],
  },
];
