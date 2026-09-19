# Roadmap

Directional — a sequencing statement, not a commitment to build every phase immediately. [DEVELOPMENT_SEQUENCE.md](DEVELOPMENT_SEQUENCE.md) is the only phase with a granular, ready-to-execute build order (Phase 1); everything past it is intentionally coarse until it's actually next.

## Phase list

| Phase | Focus | Depends on | Status |
|---|---|---|---|
| **1** | SaaS Foundation — multi-tenancy, auth, RBAC, RLS | Cloudflare validation ([CLOUDFLARE_VALIDATION.md](CLOUDFLARE_VALIDATION.md)) | **Done** (2026-08-14) — [DEVELOPMENT_SEQUENCE.md](DEVELOPMENT_SEQUENCE.md), reviewed in [DEFINITION_OF_DONE.md](DEFINITION_OF_DONE.md) |
| **2** | Content + Core LMS — content library, courses, SCORM, enrollment, authoring UI | Phase 1 | **Done** (2026-08-16) — [DEVELOPMENT_SEQUENCE_PHASE2.md](DEVELOPMENT_SEQUENCE_PHASE2.md), reviewed in [DEFINITION_OF_DONE_PHASE2.md](DEFINITION_OF_DONE_PHASE2.md) |
| **3** | **AI-Native Authoring Engine** — AI course generation, course specification, visual block/interaction authoring, interactive runtime, SCORM/xAPI/cmi5 publishing | Phase 2 | **Functionally complete** (approved 2026-08-16; status corrected 2026-09-03 — the "8, 10, 11 outstanding, not done" verdict below was accurate on 2026-08-21 but was never updated as those steps actually landed). All 11 steps of [DEVELOPMENT_SEQUENCE_PHASE3.md](DEVELOPMENT_SEQUENCE_PHASE3.md) are built: steps 10 (accessibility gates) and 11 (skill tagging + search) are done and fully checked off in [DEFINITION_OF_DONE_PHASE3.md](DEFINITION_OF_DONE_PHASE3.md); step 8 (AI generation pipeline) shipped 2026-08-27 as "Full AI Course Builder," and its first real-provider run was interrupted by the org's AI budget before completing. **Production-verified end to end 2026-09-04**: chasing that gap down surfaced a real bug, not just a budget limit — cross-page duplicate ids from independently-generated pages, fixed by `namespaceIds()` (`lib/ai/full-course-builder.ts`) — then re-proven with a real end-to-end run that saved a genuine draft course. Only one item remains genuinely open, not blocking the agreed commercial path: proving the AI gateway against a second real provider (only AICredits has been exercised for real; the direct-Anthropic adapter is unexercised, no key configured). A separate 403 hit during that same investigation was initially misread as a production infra gap (a `SUPABASE_SECRET_KEY` mismatch) — corrected on reflection: it was an artifact of the verification script signing a job-continuation token locally rather than from within Vercel itself; real production traffic signs and verifies that token in the same deployment and is unaffected. See `CURRENT_STATUS.md` for the full account. Both SCORM 2004 and cmi5 confirmed working in SCORM Cloud 2026-08-20 and again 2026-09-03 (complete/passed); data model + tenancy (9 new tables, full RLS) landed 2026-08-20; runtime interpreter + native player (24 block renderers, resume, xAPI emission) landed 2026-08-20; visual authoring engine landed 2026-08-21 — the authoring loop is closed end to end (author builds a course in the browser, previews it in the real runtime, publishes it, learner plays it); AI gateway and publishing pipeline landed 2026-08-21, closing the distribution loop, 256 unit + 41 e2e tests green. **2026-09-03, alongside but outside this 11-step list:** AICC removed from the build and roadmap entirely, and real xAPI/Tin Can package ingest shipped and verified — including against a genuine third-party-authored package, not just a hand-built fixture (`docs/XAPI_INGEST_ARCHITECTURE.md`). See [JOB_EXECUTION_SPIKE_RESULTS.md](JOB_EXECUTION_SPIKE_RESULTS.md), [`lib/spec/`](../lib/spec/README.md), [`spikes/export-conformance/`](../spikes/export-conformance/README.md), [PHASE3_DATA_MODEL.md](PHASE3_DATA_MODEL.md), [`lib/runtime/`](../lib/runtime/engine.ts), [`lib/authoring/`](../lib/authoring/json-patch.ts) |
| **3B** | **Authoring parity + media pipeline** — free-form canvas, animation/motion-path timeline editor, video transcoding, caption editor, TTS, asset/character library, block-level review comments | Phase 3 | Scope agreed 2026-08-16, not yet specified — deliberately lettered, not numbered, to avoid a second renumbering cascade |
| **4** | Assessment + Certification + AI Tutor (Learning Assistant, RAG, Question Generator) | Phase 3 | **Partially started.** A real standalone assessment engine (question bank, assessments, attempts, real server-side scoring, admin console, learner runner — `supabase/migrations/20260826110000_assessment_foundation.sql`) shipped 2026-08-26, ahead of Phase 3 finishing. See [MASTER_FEATURE_MATRIX.md](MASTER_FEATURE_MATRIX.md) reconciliation note 1 for a real gap this surfaced: it uses its own simpler item shape rather than the one Phase 3's authored-course quiz blocks use, un-reconciled so far. **Certification shipped 2026-09-03** (`supabase/migrations/20260903080000_certificates.sql`) — issues automatically on an assessment pass or a course completion, public verification page, verified end to end against production including a real browser check. The AI Tutor/RAG/Question Generator pieces are not started. |
| **5** | Learning paths, programs, ILT/virtual classroom, analytics, billing UI, notifications | Phase 4 | Not started |
| **6** | Skills engine, 360° Feedback, gamification, social learning, full LRS, localization workflow, collaborative authoring | Phase 5 | Not started — 360 per [PEOPLE_INTELLIGENCE.md](PEOPLE_INTELLIGENCE.md) §4–§5 |
| **7** | AI Practice Lab, Psychometrics, SJT, behavioural/cognitive, adaptive learning | Phase 6 (Skills with real usage data; qualified psychometricians engaged) | Not started — architecture-reserved, [PEOPLE_INTELLIGENCE.md](PEOPLE_INTELLIGENCE.md) |
| **8** | Talent suite (profile, graph, review/9-box, career, succession, coaching), HRIS/CRM/SSO integrations, mobile + offline, AI administration | Phase 7 | Not started |
| **9** | Enterprise compliance (SOC 2 / ISO 27001), content marketplace, LTI, dedicated-tenant | A real enterprise customer requesting it | Not started — build on request, not speculation |

## Reconciliation note

This supersedes the coarser Stage 1 phase list (which had Phase 5 = Skills+competency, Phase 6 = Collaboration+gamification, Phase 7 = Enterprise, Phase 8 = Scale+security) with the sequencing the user specified when introducing the People Intelligence Engine. Two changes worth naming explicitly:

- **Collaboration + gamification** (old Phase 6) is not a numbered phase anymore — it folds into whichever phase is shipping when there's a concrete driver for it, rather than being a dedicated milestone.
- **Scale, security, and optimization hardening** (old Phase 8) is not a late, dedicated phase — every phase's Definition of Done already requires its own security/test gate (established as a principle in Phase 1's [DEFINITION_OF_DONE.md](DEFINITION_OF_DONE.md)), so hardening happens continuously rather than being deferred to the end.

### AICC removed, 2026-09-03

Dropped from the build and roadmap entirely, not deferred. AICC predates SCORM; most AICC content in the wild has long since moved to SCORM 1.2 in practice, and modern authoring tools rarely export it. Building real support for a standard this rare, before there's a specific customer asking for it by name, is effort spent ahead of demand. `published_packages.format` no longer accepts it (`supabase/migrations/20260903060000_drop_aicc_format.sql`). SCORM 1.2 and native xAPI *export* remain named as unimplemented, still open per [MASTER_FEATURE_MATRIX.md](MASTER_FEATURE_MATRIX.md) §5.

### Renumbering, 2026-08-16

Introducing the AI-Native Authoring Engine as Phase 3 shifted every later phase by one, and merged some previously-separate milestones. Recorded explicitly so old references can be translated rather than silently misread:

| Was | Now | Note |
|---|---|---|
| 3 — Assessment + Certification | **4** | Now also carries AI Tutor/RAG, which the old list had at 4 |
| 4 — AI Learning | **4** (merged) | Tutor/RAG/Question Generator sit with Assessment, since they depend on it |
| 5 — 360° Feedback | **6** | Now grouped with Skills, which it depends on |
| 6 — Psychometric Engine | **7** | Grouped with SJT and AI Practice Lab |
| 7 — AI Practice + Skills | **6** (Skills) / **7** (Practice Lab) | Split: Skills must precede the People Intelligence integration loop |
| 8 — People/Capability Intelligence loop | **8** | Now stated as the Talent suite, which is what that loop produces |
| 9 — Enterprise | **8** (integrations) / **9** (compliance, marketplace) | Split: connectors are demand-driven; formal compliance is separate |

The canonical, deduplicated view of scope across all phases is [MASTER_FEATURE_MATRIX.md](MASTER_FEATURE_MATRIX.md); where this table and that document differ, the Master Feature Matrix wins.

## What this roadmap deliberately does not promise

A ship date for Phases 4–9. Those phases exist here so that Phase 1–3 architecture doesn't accidentally block them (that's the entire point of [PEOPLE_INTELLIGENCE.md](PEOPLE_INTELLIGENCE.md)) — not because they're committed for a specific quarter. The only phase with a real commitment right now is **Phase 3**, whose specification was approved on 2026-08-16.
