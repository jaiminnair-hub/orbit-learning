# Feature Matrix

Consolidates the Stage 1 competitor-matrix-derived prioritization (see the approved plan, `ethereal-purring-pillow.md`) with the Stage 2 MVP revision ([MVP_SPEC.md](MVP_SPEC.md)) and the new People Intelligence Engine domain ([PEOPLE_INTELLIGENCE.md](PEOPLE_INTELLIGENCE.md)) into one canonical priority list. Sourced from `LMS_Comparison_Matrix.xlsx` (TalentLMS, Adobe Learning Manager, Docebo, Moodle, 360Learning) plus this platform's own product direction — never from an earlier project's insurance feature set (see project memory `feedback-lms-scope-discipline`).

## P0 — MVP

| Feature | Notes |
|---|---|
| Multi-tenancy, RBAC, organizations, users, departments | [MULTI_TENANCY.md](MULTI_TENANCY.md) |
| Content library, learning objects, courses, modules, lessons, versioning, publish workflow | [CONTENT_MODEL.md](CONTENT_MODEL.md) |
| SCORM playback | Reused pattern from an earlier project |
| Enrollment, progress, completion | |
| Question bank, quizzes/exams/knowledge checks, basic certificates | |
| AI Learning Assistant (org-scoped RAG) | [AI_ARCHITECTURE.md](AI_ARCHITECTURE.md) §2 |
| AI Course Builder v1 | [AI_ARCHITECTURE.md](AI_ARCHITECTURE.md) §3 |
| AI Question Generator | [AI_ARCHITECTURE.md](AI_ARCHITECTURE.md) §4 |
| Admin console, Learner/Manager/Admin dashboards | [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) |
| Notifications, audit log, usage tracking, basic analytics | |
| Billing/plan architecture | |
| Security baseline: systemic RLS, real RBAC, tenant-isolation tests | [TESTING.md](TESTING.md) |

## P1 — Important V1

Learning paths & programs · instructor-led + virtual classroom scheduling (Zoom, reused pattern) · certificate verification · basic gamification (badges, leaderboard) · skills taxonomy v1 (vocabulary only) · real server-side search · **AI Practice Lab** (generalized from an earlier project's Sales/Underwriting Arena mechanism, content stripped — see [AI_ARCHITECTURE.md](AI_ARCHITECTURE.md) §6).

## P2 — Differentiating

Skills/competency proficiency tracking (closing the "what can they do" loop, schema-ready per [DATABASE.md](DATABASE.md) §7) · adaptive learning paths · AI-native recommendations · collaborative/SME-led authoring · **People Intelligence Engine — 360° Feedback** (Phase 5) · **People Intelligence Engine — Psychometric Engine** (Phase 6, architecture-reserved, requires qualified psychometricians before any real instrument is built).

## P3 — Enterprise / Future

Deep HRIS/CRM integrations · white-label mobile app, offline mode · formal ISO 27001/SOC 2 · content marketplace · multi-language/translation · xAPI/cmi5 LRS · dedicated-tenant/on-prem deployment · **People Intelligence Engine — Situational Judgement Testing** · **People Intelligence Engine — Behavioral/Cognitive Assessments** (both architecture-reserved per [PEOPLE_INTELLIGENCE.md](PEOPLE_INTELLIGENCE.md), not scheduled ahead of the domains above them).

## Explicit non-negotiable ordering

People Intelligence Engine work of any kind — including any real instrument, item, or campaign — does not begin before Phases 1–4 (Platform, Content, Assessment, AI) are live and the Skills domain (P2, feeding directly into People Intelligence's development-loop integration, [PEOPLE_INTELLIGENCE.md](PEOPLE_INTELLIGENCE.md) §7) has real usage data. This is a dependency ordering, not just a priority label — 360°/Psychometrics/SJT have nothing to integrate with (§8 of the amendment: "Skills Integration") until Skills exists.
