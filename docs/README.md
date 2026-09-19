# Learning & Capability Platform — Specification Package

> **Current status (2026-08-26):** This specification package contains both historic plans and technical reference material. For the live release state, use [CURRENT_STATUS.md](CURRENT_STATUS.md) first. The core LMS, SCORM isolation, rate limiting, standalone assessment foundation, and the first two Orbit entry scopes are built; Phase 3's AI generation pipeline is deliberately deferred.

**Historic package status (updated 2026-08-16):**

- **Phase 1 — Complete.** Multi-tenancy, auth, RBAC, systemic RLS. Reviewed in [DEFINITION_OF_DONE.md](DEFINITION_OF_DONE.md).
- **Phase 2 — Complete.** Content library, learning objects, courses, SCORM, enrolment, progress, search, and the admin authoring UI. Reviewed in [DEFINITION_OF_DONE_PHASE2.md](DEFINITION_OF_DONE_PHASE2.md). **Frozen** — Phase 3 does not modify it.
- **Phase 3 — In progress.** Specification approved 2026-08-16. Step 1 done ([JOB_EXECUTION_SPIKE_RESULTS.md](JOB_EXECUTION_SPIKE_RESULTS.md)). Step 2 done — the course specification schema + validator, at [`lib/spec/`](../lib/spec/README.md), including the widened layout/timeline models for Phase 3B. **Step 3 (export conformance spike) is next.**
- **Scope decision, 2026-08-16:** the goal is a world-class LMS *and* a world-class authoring tool in one product. Full Articulate-class parity is committed; it lands in **Phase 3B**, and Phase 3's schema is widened now so it arrives additively. See [MASTER_FEATURE_MATRIX.md](MASTER_FEATURE_MATRIX.md) reconciliation note 4.

Test baseline: 62 Vitest (24 data-layer + 38 course-spec) + 22 Playwright tests green in CI, plus 22 spike assertions against real Cloudflare infrastructure.

Placeholder product name — see `project-lms-naming-tbd` — do not treat "Learning Platform" or any name in these docs as final branding.

**Provenance:** the patterns in this package were originally extracted from an earlier, unrelated production project. This repository shares no code, database, or credentials with it, and is fully independent.

**Product positioning:** this is not "another LMS." The LMS (content, courses, assessment, certification) is the *foundation* of a longer-term **AI-native Learning & Capability Platform**, built around the cycle:

```
LEARN → PRACTICE → ASSESS → DEMONSTRATE → MEASURE PROFICIENCY → IMPROVE
```

Every document below should be read with that cycle in mind — the MVP only builds the LEARN/ASSESS half in full, but the data model and event architecture are designed so PRACTICE/DEMONSTRATE/MEASURE can be added later without a redesign.

## Documents in this package

| # | Document | Answers |
|---|---|---|
| 1 | [ARCHITECTURE.md](ARCHITECTURE.md) | What is the system, end to end? |
| 2 | [DATABASE.md](DATABASE.md) | What is the complete schema (ERD, keys, RLS strategy)? |
| 3 | [CONTENT_MODEL.md](CONTENT_MODEL.md) | How is content structured, reused, versioned, and published? |
| 4 | [AI_ARCHITECTURE.md](AI_ARCHITECTURE.md) | What does AI actually do in v1, and how is it kept safe? |
| 5 | [MULTI_TENANCY.md](MULTI_TENANCY.md) | How is tenant isolation enforced, everywhere, provably? |
| 6 | [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) | What is the IA/navigation/component/token system for all 4 personas? |
| 7 | [MVP_SPEC.md](MVP_SPEC.md) | What ships in v1, and what explicitly doesn't? |
| 8 | [API_SPEC.md](API_SPEC.md) | What are the API conventions? |
| 9 | [TESTING.md](TESTING.md) | What automated tests exist from commit one? |
| 10 | [CLOUDFLARE_VALIDATION.md](CLOUDFLARE_VALIDATION.md) / [CLOUDFLARE_VALIDATION_RESULTS.md](CLOUDFLARE_VALIDATION_RESULTS.md) | Is the hosting assumption actually valid? **Spiked 2026-08-14 — yes, proceed, one design change made.** |
| 11 | [DEVELOPMENT_SEQUENCE.md](DEVELOPMENT_SEQUENCE.md) | In what order does Phase 1 actually get built? |
| 12 | [DEFINITION_OF_DONE.md](DEFINITION_OF_DONE.md) | How do we know Phase 1 is actually done? |
| 13 | [PEOPLE_INTELLIGENCE.md](PEOPLE_INTELLIGENCE.md) | **Future (P2/P3), architecture-reserved.** How do Psychometrics, 360° Feedback, SJT, and Behavioral/Cognitive Assessments fit without redesigning 1–12? |
| 14 | [FEATURE_MATRIX.md](FEATURE_MATRIX.md) | Canonical P0–P3 priority list, including where People Intelligence sits |
| 15 | [ROADMAP.md](ROADMAP.md) | The full Phase 1–9 directional sequence |

## Phase 2 (complete) and Phase 3 (specification)

| Document | Answers |
|---|---|
| [DEVELOPMENT_SEQUENCE_PHASE2.md](DEVELOPMENT_SEQUENCE_PHASE2.md) / [DEFINITION_OF_DONE_PHASE2.md](DEFINITION_OF_DONE_PHASE2.md) | How Phase 2 was built, and the box-by-box proof it is done |
| **[MASTER_FEATURE_MATRIX.md](MASTER_FEATURE_MATRIX.md)** | **The single reconciled scope — original + expanded — with EXISTING / PHASE / PRIORITY / DEPENDENCIES** |
| [PHASE3_PRODUCT_SPEC.md](PHASE3_PRODUCT_SPEC.md) | What the AI-Native Authoring Engine is, and where its boundaries are |
| [PHASE3_TECHNICAL_ARCHITECTURE.md](PHASE3_TECHNICAL_ARCHITECTURE.md) | How it is built, and whether Phases 1–2 can carry it without rewrites |
| [PHASE3_DATA_MODEL.md](PHASE3_DATA_MODEL.md) | Every schema change required |
| [PHASE3_API_EVENTS.md](PHASE3_API_EVENTS.md) | Routes and events introduced |
| [PHASE3_AI_ARCHITECTURE.md](PHASE3_AI_ARCHITECTURE.md) | The model-agnostic AI gateway and generation pipeline |
| [AUTHORING_CAPABILITY_CHECKLIST.md](AUTHORING_CAPABILITY_CHECKLIST.md) | Articulate-equivalence, stated honestly per capability |
| [DEVELOPMENT_SEQUENCE_PHASE3.md](DEVELOPMENT_SEQUENCE_PHASE3.md) | Phase 3 implementation milestones |
| [JOB_EXECUTION_SPIKE_RESULTS.md](JOB_EXECUTION_SPIKE_RESULTS.md) | **Milestone 1 verdict** — durable job execution on Cloudflare, proven on the real engine |

## Reading order

If reviewing end to end: **1 → 3 → 2 → 5 → 4 → 7 → 6 → 8 → 9 → 10 → 11 → 12** — architecture, then the content model (since it drives the database), then the full schema, then tenancy/AI (the two systems that touch every table), then what ships, then design/API/test/host mechanics, then the sequencing and exit criteria.

## What happens after this package is reviewed

Per the brief: **no production application code is written until these twelve documents are internally consistent and approved.** The first implementation milestone remains exactly as scoped in [DEVELOPMENT_SEQUENCE.md](DEVELOPMENT_SEQUENCE.md): Cloudflare validation + a new independent Supabase project + multi-tenancy + authentication + RBAC + RLS + an automated tenant-isolation test suite passing. Nothing else is built until that foundation is green.
