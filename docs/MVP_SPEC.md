# MVP Feature Specification (revised)

Recalculated per the user's revised priorities — most notably, AI moves from "one assistant feature" to four MVP capabilities, and the content model is now a real CMS rather than "courses exist somehow."

## In scope for MVP

| Domain | Features |
|---|---|
| **Platform** | Multi-tenancy (org_id everywhere, centralized RLS — [MULTI_TENANCY.md](MULTI_TENANCY.md)); authentication (Supabase Auth); RBAC (role hierarchy, no hardcoded identities); organizations; users; departments/groups; billing/plan architecture (single entitlement source, not an earlier project's two-parallel-plan bug) |
| **Content** | Content library (assets + learning objects, [CONTENT_MODEL.md](CONTENT_MODEL.md)); course builder (admin-authored, DB-driven — not hardcoded TypeScript); modules; lessons; multiple content types (text/video/audio/pdf/ppt/document/url/embed/scorm); content versioning; draft→review→approval→published→archived workflow; SCORM playback |
| **Learning** | Enrollment; progress tracking; completion; Learner dashboard; Manager dashboard; Administrator dashboard |
| **Assessment** | Question bank; quizzes/exams/knowledge checks; scoring; basic certificates (generation + public verification link) |
| **AI** | AI Learning Assistant (org/course-scoped RAG); AI Course Builder v1 (document → draft course, human-reviewed); AI Question Generator (from approved content, human-reviewed); full AI safety mechanisms ([AI_ARCHITECTURE.md](AI_ARCHITECTURE.md) §5) |
| **Delivery** | Self-paced learning; basic instructor-led scheduling; Zoom integration (reused pattern from an earlier project) |
| **Operations** | Email notifications; audit logs (`activity_log`); usage tracking (`ai_usage_log`); basic analytics (completion/pass-rate rollups) |

## Explicitly out of scope until the core platform is proven

- HRIS/CRM integrations (Workday, SAP SuccessFactors, Salesforce)
- The full skills/competency engine (schema-ready per [DATABASE.md](DATABASE.md) §7, feature deferred — P2)
- AI Practice Lab (P1/V1 — see [AI_ARCHITECTURE.md](AI_ARCHITECTURE.md) §6)
- Social/collaborative learning (comments, forums, SME-led authoring)
- Complex gamification (badges beyond a basic leaderboard, streaks, challenges)
- Native mobile app (responsive web is the MVP mobile story)
- Content marketplace / off-the-shelf course library

## Why AI moved up

The original Stage 1 plan scoped only the AI Learning Assistant as P0 and deferred Course Builder/Question Generator to P1. The user's revision makes all three MVP: the platform's differentiation is the AI-native learning loop, not a completion tracker with a chatbot bolted on — see the product positioning in [ARCHITECTURE.md](ARCHITECTURE.md) §1. Practically, this means Phase 4 ([DEVELOPMENT_SEQUENCE.md](DEVELOPMENT_SEQUENCE.md)) is not optional polish; it's part of what "commercially useful v1" means for this specific product, not a generic LMS.

## Why AI Practice Lab stays out of MVP despite being a differentiator

It depends on content and scenario data that don't exist until Course/Assessment domains are live and proven, and on the genericized engine work noted in [AI_ARCHITECTURE.md](AI_ARCHITECTURE.md) §6. Building it before the foundation is stable risks repeating an earlier project's pattern of shipping features faster than the tenancy/content layers underneath them could support — exactly what this whole specification package exists to avoid.
