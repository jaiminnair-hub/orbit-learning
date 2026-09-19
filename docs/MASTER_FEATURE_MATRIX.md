# Master Feature Matrix

**Deliverable A.** The single reconciled scope: the original Stage 1 competitor-derived scope ([FEATURE_MATRIX.md](FEATURE_MATRIX.md)), the People Intelligence amendment ([PEOPLE_INTELLIGENCE.md](PEOPLE_INTELLIGENCE.md)), and the expanded Phase 3+ requirements — in one table. **Nothing from the original scope has been removed.** Where the original and the expanded requirements described the same capability at different depths, the row is kept once and the depth is noted.

**EXISTING** is measured against what is actually in the repository and database today (22 tables, Phases 1–2 complete), not against what is designed on paper. **This is a pre-Phase-3 planning snapshot and was not kept current as Phase 3 shipped** — a 2026-09-11 audit found several rows (the interactivity engine: states/variables/triggers/layers/branching, the visual block editor, quiz blocks in authored content, the interactive runtime player) still marked "No" weeks after they were built and verified complete. Those rows have been corrected below, but treat [`docs/CURRENT_STATUS.md`](CURRENT_STATUS.md) as authoritative when the two differ — it says as much itself ("when historic plans differ, this file takes precedence").

- **Yes** — built, tested, in CI
- **Partial** — a real foundation exists but the capability is not complete
- **Schema-only** — the table/column exists or is reserved, with no behaviour
- **No** — not started

---

## 1. Platform core

| FEATURE | EXISTING | PHASE | PRIORITY | DEPENDENCIES |
|---|---|---|---|---|
| Multi-tenancy (org_id + systemic RLS) | Yes | 1 | P0 | — |
| Authentication (email, OAuth-ready) | Yes | 1 | P0 | — |
| RBAC role hierarchy | Yes | 1 | P0 | Multi-tenancy |
| Organizations, departments, invitations | Yes | 1 | P0 | Multi-tenancy |
| Platform admin + cross-tenant audit | Yes | 1 | P0 | RBAC |
| Billing / plan architecture | Partial (`plans`, `subscriptions` exist; no billing UI or provider) | 5 | P1 | Payment provider decision |
| Notifications (email) | **Yes — activated and verified live in production 2026-09-04.** Resend delivery path for invitations, assessment assignments and automated enrollment/re-enrollment, with append-only delivery evidence (`notification_logs`) and explicit failure when unconfigured. Real Resend key + verified sender wired into Vercel; real emails sent and received via a disposable Mailinator inbox for invitation and assessment-assignment (real `provider_message_id`, correct links, correct `notification_logs` rows) against a disposable production test org; auto-enrollment's wiring confirmed correct, its real send not independently re-proven; re-enrollment's send not yet exercised at all | 1 | P0 | — |
| Audit log | Yes (`activity_log`) — **append-only at the DB level since 2026-09-04** (a trigger rejects UPDATE/DELETE for every role incl. service role); org-level event coverage (member/course/assessment/enrollment/certificate) added the same day, previously platform-admin-only | 1 | P0 | — |
| Enterprise security / compliance (SOC 2, ISO 27001) | No | 9 | P3 | Real enterprise demand; external audit |

## 2. Content & authoring

| FEATURE | EXISTING | PHASE | PRIORITY | DEPENDENCIES |
|---|---|---|---|---|
| Content library (assets, upload, SCORM ingest) | Yes | 2 | P0 | Storage |
| Learning objects + composition (reuse unit) | Yes | 2 | P0 | Content library |
| Courses → modules → lessons | Yes | 2 | P0 | Learning objects |
| Versioning + immutable publish snapshots | Yes | 2 | P0 | Content model |
| Draft→Review→Approval→Published→Archived workflow | Yes | 2 | P0 | Content model |
| Admin authoring UI (forms-based) | Yes | 2 | P0 | Content APIs |
| Full-text content search | **Yes — expanded to the learner workspace 2026-09-16.** `/search` covers published course metadata, published learning paths, the caller's assigned published assessments, their certificates, and already-indexed published course-page passages. Session-derived org/user scope plus RLS/service-side org filters prevent cross-tenant and private-record leakage. | 2 | P1 | Content model; Guide index |
| **AI Course Builder** (source → validated course spec) | **Yes — production-verified end to end 2026-09-04** (this row was stale; Lite shipped 2026-08-26, Full shipped 2026-08-27, both now real-provider-verified). A real cross-page duplicate-id bug was found and fixed along the way (`namespaceIds()`, `lib/ai/full-course-builder.ts`) — see `CURRENT_STATUS.md`. **A second real bug — long generations silently stalling — root-caused and fixed 2026-09-11**: the self-continuation design (a function calling its own deployment over HTTP to hand off to a fresh invocation) reliably tripped Vercel's own loop-detection guard (HTTP 508) after enough hops; replaced with a client-driven design (the existing poll loop calls `resume-full`), no self-call left anywhere. See `CURRENT_STATUS.md`. | **3** | **P0** | AI gateway; course-spec schema |
| **Course Specification** (validated structured IR) | **Yes — shipped 2026-08-21.** `lib/spec/course-spec.ts` and siblings; two-layer validation (structural + semantic reference-checking), versioned (`SPEC_SCHEMA_VERSION`), optimistic-concurrency writes. See `docs/DEFINITION_OF_DONE_PHASE3.md`. | **3** | **P0** | JSON Schema validator |
| **Visual block-based authoring (Rise-class)** | **Yes — shipped 2026-08-21.** `components/authoring/spec-editor.tsx`: drag-and-drop reorder (native HTML5, keyboard-equivalent buttons), 24 leaf block types, AI-generated content lands fully editable in the same editor. See `docs/DEFINITION_OF_DONE_PHASE3.md`. | **3** | **P0** | Course spec; block model |
| **Reusable components / component library** | Partial (learning objects reuse; no block-level components) | **3** | **P0** | Block model |
| **Templates** | No | **3** | **P1** | Block model |
| **Multimedia blocks (video/audio/image/embed)** | **Yes — shipped 2026-08-21.** Real renderers in `components/runtime/block-renderers.tsx` for image/imageGallery/video/audio/embed among the 24 block types. | **3** | **P0** | Block model; player runtime |
| **Interactions (Storyline-class)** | **Yes — shipped 2026-08-21, verified functionally complete 2026-09-03.** Pure synchronous interpreter (`lib/runtime/engine.ts`, `(spec, state, event) -> (state, effects)`), a closed declarative trigger/action set (`lib/spec/interactions.ts`), real test coverage (`tests/runtime/engine.test.ts`, `tests/runtime/blocks.test.ts`, `tests/e2e/authored-course-runtime.spec.ts`). See `docs/DEFINITION_OF_DONE_PHASE3.md`. | **3** | **P0** | Block model; runtime engine |
| **States** | **Yes — shipped 2026-08-21.** `BlockState` (normal/hover/down/visited/selected/disabled/correct/incorrect/custom), interpreted by the runtime engine. | **3** | **P0** | Interaction model |
| **Variables** | **Yes — shipped 2026-08-21.** Course/page-scoped `Variable` (number/text/boolean), read and written by triggers/conditions in the runtime engine. | **3** | **P0** | Interaction model |
| **Triggers** | **Yes — shipped 2026-08-21.** Closed `TriggerEvent`/`Action` set (`lib/spec/interactions.ts`) — deliberately no expression language, per `docs/PHASE3_AI_ARCHITECTURE.md §7`'s "no executable content" invariant. | **3** | **P0** | Interaction model; variables; states |
| **Layers** | **Yes — shipped 2026-08-21.** Overlay `Layer`s (modal/dismissible) attached to any top-level block, authored via `components/authoring/layers-timeline-editor.tsx`. | **3** | **P1** | Interaction model |
| **Timelines** | Partial — cue-point triggers are real and interpreted (`docs/DEFINITION_OF_DONE_PHASE3.md`), but full frame-accurate animation/motion-path playback is genuinely Phase 3B (schema carries `Animation`/`MotionPath` from v1, no renderer yet). | **3** / 3B (animation) | **P1** | Interaction model |
| **Branching / scenarios** | **Yes — shipped 2026-08-21.** Real `ScenarioBlock` type + `ScenarioBlockView` renderer with branching choices/`nextStepId`. Note: `learning_object.kind = 'scenario'` is a *separate*, still schema-only value (future AI Practice Lab entry point) — see reconciliation note below on the naming collision between the two. | **3** | **P0** | Triggers; variables |
| **Accessibility (WCAG 2.2 AA authoring + runtime)** | **Yes — shipped 2026-08-21 (Phase 3 step 10).** `lib/spec/accessibility.ts`'s `checkAccessibility` runs as its own pass in `validate.ts`, severity driven by the course's declared accessibility profile. | **3** | **P0** | Block model; player runtime |
| **Localization / multi-language** | No | **3** (authoring-side) / 6 (full) | P1 | Course spec; content versioning |
| Collaborative / SME-led authoring (multi-author) | No | 6 | P2 | Authoring engine; real-time infra |
| Content marketplace | No | 9 | P3 | Authoring engine; billing |
| **Free-form absolute-positioning canvas** | No | **3B** (schema accommodation in 3) | **P1** | Course-spec layout model |
| **Animation / motion-path authoring (timeline editor)** | No | **3B** (schema accommodation in 3) | **P1** | Course-spec timeline model |
| **Video transcoding + delivery pipeline** | No | **3B** | **P1** | Storage; a transcoding provider decision |
| **Caption editor + transcript authoring** | No | **3B** | **P1** | Media pipeline |
| **Text-to-speech narration** | No | **3B** | **P2** | Media pipeline; AI gateway |
| **Audio trimming / basic editing** | No | **3B** | **P2** | Media pipeline |
| **Stock asset + illustrated character library** | No | **3B** | **P2** | Licensing / content-ops decision, not engineering |
| **Block-level threaded review comments** | Partial (`content_reviews` carries item-level comments) | **3B** | **P1** | Course spec; block addressing |
| **Side-by-side version diff** | No | **3B** | **P2** | Course spec versioning |
| Drag-and-drop + slider/dial interactions | No | 4 | P1 | Item engine (scoring) |
| Screen recording / software simulation | No | — | P3 | Separate product category; not scheduled |

## 3. Assessment & certification

| FEATURE | EXISTING | PHASE | PRIORITY | DEPENDENCIES |
|---|---|---|---|---|
| Question bank | **Yes — shipped 2026-08-26**, `question_bank_items`, real API + admin UI, spreadsheet import | 4 | P0 | Content model |
| Quizzes / exams / knowledge checks | **Yes — shipped 2026-08-26** (standalone assessments, real learner-facing runner at `/assessments/[id]`); separate from and in addition to the in-content quiz blocks below | 4 | P0 | Question bank |
| Scoring, attempts, time limits | Yes — real server-side scoring, attempts, `max_attempts`, `pass_percent` (2026-08-26), **plus time limits and question pooling/randomisation, shipped 2026-09-04**: an optional `time_limit_minutes` per assessment enforced server-side (`lib/assessments/attempt.ts`'s `isAttemptExpired`, a real elapsed-time check against when the attempt actually started, not a client-trusted duration), and an optional `question_pool_size` draws a random subset per attempt with `randomize_questions` shuffling presentation order — both persisted per-attempt (`assessment_assignments.current_attempt_question_ids`) so scoring and what was shown always agree | 4 | P0 | Question bank |
| **Quiz blocks inside authored content** | **Yes — shipped 2026-08-21.** `quiz`/`knowledgeCheck` block types render inline in a lesson page (`QuizLikeBlockView`, `components/runtime/block-renderers.tsx`) and score via the shared `AssessmentItem` scorer (`lib/assessments/scoring.ts`, unified into the runtime engine 2026-09-11 — see reconciliation note below). Distinct from the standalone `/assessments/[id]` engine. | **3** | **P0** | Block model; question bank (or inline items) |
| AI Question Generator | **Yes — shipped 2026-09-04**, reusing `item_generation`'s existing schema/instruction verbatim (the same one `full-course-builder.ts` already used for in-content knowledge checks) — no new AI abstraction. Paste source text, get real scored questions saved as drafts into the question bank. **Real bug found and fixed by a real verification run**: the model's generated id is a short slug, but `question_bank_items.id` is a real `uuid` primary key — every generated question failed to save until fixed (mint a fresh uuid per item, matching the manual add-question route's existing convention). Verified end to end against a real configured AICredits provider, not mocked. | 4 | P0 | AI gateway; published content |
| Certificates + public verification | **Yes — shipped 2026-09-03**, verified end to end against production (real assessment-pass and course-completion issuance, idempotency under re-trigger, public verification page live-checked in a real browser) | 4 | P0 | Assessment; course completion |
| Adaptive / branching assessment difficulty | No | 7 | P2 | Assessment; skills |

## 4. Learning delivery

| FEATURE | EXISTING | PHASE | PRIORITY | DEPENDENCIES |
|---|---|---|---|---|
| Enrollment (polymorphic) | Yes — **automated enrollment & re-enrollment rules shipped 2026-09-04** (`enrollment_rules`: `on_join`/`role_equals` triggers fire on invitation acceptance; an optional `recur_after_days` per rule re-enrolls a learner once a prior completion goes stale, checked lazily on their own worklist load rather than a cron job this product doesn't have). Verified against a real local Supabase instance with real signed-in sessions; found and fixed a real bug where the re-enrollment read path used the learner's own session client against an RLS policy that requires manager+, making it a silent permanent no-op for actual learners. Production migration applied and confirmed live 2026-09-04. | 2 | P0 | Courses |
| Progress + derived completion | Yes | 2 | P0 | Enrollment |
| Course player | Yes — dispatches per learning object by `source`/package: authored specs to the interactive runtime player (see below), SCORM/xAPI packages to their own players, otherwise a flat asset list. | 2 | P0 | Courses |
| **Interactive runtime player** (renders authored spec) | **Yes — shipped 2026-08-21.** `components/runtime/RuntimeCoursePlayer.tsx`, mounted by the course player (`app/(app)/courses/[id]/player.tsx`) whenever a learning object has `source = 'authored'`. Until 2026-09-11 nothing in the product ever created that row (only a test fixture did) — `app/api/v1/authoring/specs/[id]/publish/route.ts` now creates/syncs it on publish, so authored content is actually reachable from a real course. | **3** | **P0** | Course spec; block/interaction model |
| SCORM 1.2 / 2004 playback | Yes | 2 | P0 | Content library |
| Learning paths | **Yes — shipped 2026-09-04.** An ordered sequence of published courses, enrollable via the `enrollable_type = 'learning_path'` value `enrollments` has allowed since Phase 2 but never used until now (`learning_paths`/`learning_path_items`, migration `20260904160000_learning_paths.sql`). Completion is derived from constituent courses' own status, not re-walked through learning objects; `progress/route.ts` recomputes a path's enrollment the instant its last course finishes. Admin authoring, assignment (`AssignPanel`'s third kind), and the learner worklist (`buildMyWorkRows`'s third `WorkRow` kind) all wired in. Verified against real local Supabase (8/8 checks) and a real end-to-end Playwright test driving the actual course player through a real browser. No drag-drop reordering, no path-level certificates, no manager-report rollup, no auto-enrollment-rule support — all deliberately out of scope for this cut. Production migration applied and confirmed live 2026-09-04. | 5 | P1 | Courses; enrollment |
| Learner transcript | **Yes — shipped 2026-09-16.** One private `/transcript` record combines courses, learning paths, assessments/latest score and certificates, with progress, due/completed dates and type/completion/overdue/minimum-score filters. | 4 | P0 | Enrollment; progress; assessments; certificates |
| Programs (cohorts, scheduling) | No | 5 | P1 | Learning paths |
| Instructor-led training / virtual classroom | No | 5 | P1 | Scheduling; video provider |
| Mobile (responsive web) | Partial (responsive by default) | 3 | P1 | Runtime player |
| Mobile app + offline mode | No | 8 | P3 | Runtime player; sync model |

## 5. Standards & interoperability

| FEATURE | EXISTING | PHASE | PRIORITY | DEPENDENCIES |
|---|---|---|---|---|
| SCORM **ingest** (upload/extract/play) | Yes | 2 | P0 | Storage |
| **xAPI ingest** (upload a third-party Tin Can package, launch, track) | **Done — shipped and verified 2026-09-03.** Real end-to-end pipeline proven against the production database (register → launch → LRS statements → completion → State API), then re-proven against a genuine third-party-authored package (Rustici Software's official "Golf Example" Tin Can course, not a package built for this test) launched in a real browser with its own unmodified TinCanJS — 35 real statements landed, including a real `failed` verb with a real derived score that correctly flipped `xapi_progress`. A genuine Articulate Storyline export remains untested (no public sample exports exist to test against — Storyline is paid desktop software). | **3** | **P1** | Storage; a real LRS-compatible statements endpoint — [docs/XAPI_INGEST_ARCHITECTURE.md](XAPI_INGEST_ARCHITECTURE.md) |
| **SCORM publishing (export)** | **Yes — all four formats now ship.** SCORM 1.2 (2026-09-04) joins SCORM 2004 and cmi5 (both real-third-party-LMS-verified via SCORM Cloud). SCORM 1.2's own real difference from 2004 — a single `cmi.core.lesson_status` field rather than split completion/success statuses — is handled directly in `lib/export/scorm12.ts`, not glossed over. **xAPI (Tin Can) export also shipped 2026-09-04** (`lib/export/xapi.ts`), the export counterpart of the xAPI ingest pipeline: a `tincan.xml` manifest per the real Tin Can Launch convention and a tracking script that reads `endpoint`/`auth`/`actor`/`registration`/`activity_id` straight off the launch URL (no token-exchange step, unlike cmi5) and sends real xAPI statements — this was the one remaining unimplemented publish format; `UNIMPLEMENTED_FORMATS` is now empty. Verified via a real generated package's manifest/RTE adapter for each format plus real e2e build/download/org-isolation coverage; SCORM 1.2 and xAPI are not yet independently re-run through SCORM Cloud itself the way 2004/cmi5 were | **3** | **P0** | Course spec; publish pipeline |
| **xAPI statement emission** | Yes — the runtime player emits real xAPI statements per the verb table in `PHASE3_API_EVENTS.md` §7.2 | **3** | **P0** | Runtime player; event model |
| **xAPI / LRS (own record store)** | Partial — emission done (native runtime); a real, narrowly-scoped LRS exists for ingest (Statement + State resources, `app/api/v1/xapi-lrs/`), **its Statement Resource GET gained real query params + keyset pagination 2026-09-04**, and a second org-wide query route (`GET /api/v1/reports/xapi-statements`, real session auth, not launch-token-scoped) now exists too; federation and retention policy are still Phase 6 | **3** (emit + narrow ingest LRS + basic query) / 6 (full LRS) | P1 | Statement schema; storage |
| **cmi5 publishing** | Yes — SCORM Cloud-verified, real xAPI statement viewer confirmed `launched → initialized → completed → satisfied → terminated` | **3** | **P1** | xAPI; publish pipeline |
| LTI (consumer/provider) | No | 8 | P3 | Enterprise demand |

**AICC removed from the build and roadmap entirely, 2026-09-03** (product decision, not deferred): it predates SCORM, most AICC content in the wild has long since moved to SCORM 1.2 in practice, and modern authoring tools rarely export it. `published_packages.format` no longer accepts it (`supabase/migrations/20260903060000_drop_aicc_format.sql`); `lib/publishing/build.ts`'s `UNIMPLEMENTED_FORMATS` no longer names it.

## 6. Intelligence & AI

| FEATURE | EXISTING | PHASE | PRIORITY | DEPENDENCIES |
|---|---|---|---|---|
| **AI gateway (model-agnostic, multi-provider)** | **Yes — this row was stale.** `lib/ai/gateway.ts`'s `generateStructured()` is the one generation primitive every AI feature already calls (AI Course Builder Lite/Full, AI Question Generator): a per-workload provider chain (`lib/ai/profiles.ts`), automatic fallback down the chain on failure, a bounded schema-repair loop, and budget enforcement before every call | **3** | **P0** | — (foundational for all AI) |
| **Structured-output generation with schema validation** | **Yes — this row was stale**, same gateway: every call validates the model's output against the caller's Zod schema and re-prompts with the validator's own errors on failure, never coerces or partially accepts | **3** | **P0** | AI gateway |
| **AI usage/cost logging** | **Yes — this row was stale.** `lib/ai/usage.ts`'s `logAiUsage()` writes a real row (provider, model, tokens, latency, cost, success/failure) for every single attempt, not just successes; `lib/ai/budget.ts`'s `assertWithinBudget()` sums real `cost_usd` from this table before every call to enforce the org's monthly cap — this is live, load-bearing logic, not a dormant schema | **3** | **P0** | AI gateway |
| **AI Tutor / Learning Assistant (org-scoped RAG)** | **Yes — AI Tutor Lite live; contextual in-player P0 shipped 2026-09-16.** Learners can use `/guide` or ask from the active course page with explain/summarize/example/quiz/free-text prompts. Answers remain limited to the organisation's published content, and in-player retrieval is additionally restricted to the active course with active page/object passages preferred. Citations are application-validated; unsupported questions return the fixed no-answer boundary. No memory, admin curation, or outside-knowledge fallback. | **4** | **P0** | AI gateway; `ai_knowledge_chunks`; published content |
| **RAG vector store (`ai_knowledge_chunks`)** | **Yes — production migration applied and real-provider verified.** pgvector HNSW cosine index over 1536-dimensional AICredits `text-embedding-3-small` vectors; service-role-only source/read RPCs, strict org filters, published-state joins, content hashes that avoid re-embedding unchanged passages, stale-chunk pruning and same-course contextual filtering. | **4** | **P0** | AICredits embeddings; pgvector |
| AI Practice Lab (conversational simulation) | Schema-only (`kind = 'scenario'`) | 7 | P1 | AI gateway; scenario content |
| AI-native recommendations | No | 7 | P2 | Skills; progress data |
| AI administration / agents (admin copilot, bulk ops) | No | 8 | P2 | AI gateway; audit model |

## 7. Skills & capability

| FEATURE | EXISTING | PHASE | PRIORITY | DEPENDENCIES |
|---|---|---|---|---|
| Skills taxonomy (vocabulary) | **Yes — Learning-side organisation vocabulary is live at `/admin/content/skills` (name, description, external reference), and the shared, versioned Foundation-owned Competencies taxonomy (2026-09-16) is live: built, code+security reviewed, production migration applied to the real Foundation Supabase project, and confirmed with a real production smoke test of `/skills/development`. Versioned frameworks, publish-time immutability, 360 rating-to-level thresholds, content mappings, consent and data-rights handling. See `docs/CURRENT_STATUS.md` for the full account.** | 5 | P1 | Foundation Competencies product |
| Role → required-skill mapping | No | 6 | P2 | Skills taxonomy |
| **Skills mapping from authored content** | **Yes for Learning evidence, shipped 2026-09-16.** `/skills` resolves nested authored-spec `skillTagIds`, assigned assessment `skill_code`, learner work evidence and mapped published next-course options without inventing proficiency. Cross-product 360 gap → learning-path mapping remains the Foundation P1 hand-off. | **3** (spec tags + learner evidence) / 6 (cross-product engine) | P1 | Course spec; Learning vocabulary |
| Skill proficiency engine (evidence → proficiency) | No | 6 | P2 | Assessment; progress; skills taxonomy |
| Talent Profile | No | 8 | P2 | Skills engine; psychometrics; 360 |
| Talent Graph (relationships across people/skills/roles) | No | 8 | P2 | Talent profile |
| Talent Review / 9-box / HiPo | No | 8 | P2 | Talent profile; performance inputs |
| Career pathing / internal mobility | No | 8 | P2 | Talent graph; role model |
| Succession planning | No | 8 | P3 | Talent review; role model |
| Coaching / mentoring | No | 8 | P2 | Talent profile; scheduling |

## 8. People Intelligence (architecture-reserved)

Ordering constraint from [FEATURE_MATRIX.md](FEATURE_MATRIX.md) is preserved: **none of these begin before Phases 1–4 are live and Skills has real usage data.**

| FEATURE | EXISTING | PHASE | PRIORITY | DEPENDENCIES |
|---|---|---|---|---|
| 360° feedback (campaigns, rater groups) | No | 6 | P2 | Competency framework; threshold-gated aggregation |
| Threshold-gated anonymous aggregation | No | 6 | P2 | 360 entities |
| Psychometric instrument hosting | No | 7 | P3 | Qualified psychometricians; scoring models |
| Norms / standard scores / longitudinal results | No | 7 | P3 | Psychometrics |
| SJT (scenario judgement) | No | 7 | P3 | Scoring models; competencies |
| Behavioral / cognitive assessment | No | 7 | P3 | Psychometric instrument model |

## 9. Analytics, integrations, engagement

| FEATURE | EXISTING | PHASE | PRIORITY | DEPENDENCIES |
|---|---|---|---|---|
| Basic dashboards (learner/manager/admin) | Partial (counts + completion; learner dashboard gained real certificate/overdue counts and People & access gained a deactivated-members count, 2026-09-04 — still the existing fixed layouts, not a configurable widget system, which was deliberately scoped out as premature) | 2 | P0 | Progress |
| Analytics (completion, pass rates, engagement) | Partial — **the completion report and the compliance activity trail now update live via Supabase Realtime, 2026-09-04** (`enrollments`/`progress`/`activity_log` added to the `supabase_realtime` publication; no new RLS, existing select policies enforce delivery scope); pass-rate/engagement analytics beyond completion still not built | 5 | P1 | Progress; assessment |
| Advanced analytics / ROI / skill analytics | No | 8 | P2 | Skills; xAPI |
| SSO / SAML / OIDC | No | 8 | P3 | Enterprise demand |
| HRIS integration (Workday, SAP, etc.) | No | 8 | P3 | Enterprise demand; talent profile |
| CRM / other connectors | No | 8 | P3 | Enterprise demand |
| Webhooks / public API | Partial (route convention reserved) | 8 | P2 | API versioning |
| Gamification (badges, XP, leaderboards) | No | 6 | P2 | Progress; events |
| Social learning (discussions, feeds, UGC) | No | 6 | P2 | Content model; moderation |

---

## Phase legend

| Phase | Scope | Status |
|---|---|---|
| 1 | Platform foundation | **Complete** |
| 2 | Content + Core LMS (+ authoring UI) | **Complete** |
| **3** | **AI-Native Authoring Engine** (this specification) | **Functionally complete** (corrected 2026-09-03 — see [ROADMAP.md](ROADMAP.md) and [DEFINITION_OF_DONE_PHASE3.md](DEFINITION_OF_DONE_PHASE3.md); this row was stale since well before it was fixed) |
| **3B** | **Authoring parity + media pipeline** — canvas, animation timeline, video/captions/TTS, asset library, block-level review | Scope agreed 2026-08-16; not specified in detail yet |
| 4 | Assessment, Certification, AI Tutor | **Substantially implemented.** Standalone assessments, certification, AI Question Generator, and AI Tutor Lite/RAG are built, activated and verified. Broader tutor memory, curation, recommendations and practice simulation remain later scope. |
| 5 | Paths, programs, ILT, analytics, billing | Not started |
| 6 | Skills engine, 360°, gamification, social, LRS | Not started |
| 7 | AI Practice Lab, psychometrics, SJT, adaptive | Not started |
| 8 | Talent suite, integrations, mobile/offline, AI admin | Not started |
| 9 | Enterprise compliance, marketplace, LTI | Not started |

## Reconciliation notes

Four places where the original scope and the expanded requirements had to be reconciled rather than simply merged:

1. **Assessment sits in Phase 4, but Phase 3 needs quiz blocks.** A Rise/Storyline-class authoring engine cannot ship without in-content knowledge checks. Resolved by scoping Phase 3 to *quiz blocks within authored content* (item definitions carried in the course specification, `lib/spec/items.ts`'s `AssessmentItem` discriminated union), with the full standalone Question Bank / attempts / scoring engine remaining Phase 4.

   **What actually happened, 2026-08-26 — worth recording plainly rather than quietly correcting:** the standalone engine shipped with its *own*, simpler item shape (`question_bank_items`: `{prompt, options, correct_option_index}`, single-answer MCQ only) instead of adopting `AssessmentItem`'s richer shape as this note originally planned. The platform had two independent, non-unified assessment-item representations — one inside authored courses, one standalone.

   **Resolved 2026-09-03.** Checked first whether unifying now was actually cheap: `question_bank_items` had zero real rows, and the one real assessment that existed ("POSH") had zero questions attached — nothing to migrate. Unified `question_bank_items` onto `AssessmentItem` (`supabase/migrations/20260903090000_question_bank_assessment_items.sql`): the table now stores a real, Zod-validated `AssessmentItem` (`lib/assessments/build-item.ts` reuses the exact schema Phase 3's authored-course quiz blocks use — the whole point of unifying), and the standalone engine gained 4 question kinds it didn't have (multipleResponse with optional partial credit, trueFalse, fillBlank, sequencing) on top of the multipleChoice it already had. Scoring (`lib/assessments/scoring.ts`), the admin authoring UI, and the learner-facing runner were all rebuilt to match. Verified end to end against production: all 5 kinds built, validated, round-tripped through the real table, and scored correctly (including the partial-credit and case-insensitive-fillBlank branches specifically) before any UI work began.

2. **xAPI was originally P3 "future".** The expanded requirements make publishing (SCORM/xAPI/cmi5/AICC) a Phase 3 deliverable. Resolved by splitting: **statement emission + publishing** is Phase 3; a **full LRS** (query API, statement storage at scale, external LRS federation) stays later (Phase 6).

3. **Skills mapping is requested as part of the Phase 3 authoring flow, but the Skills engine is Phase 6.** Resolved by having the course specification carry skill *tags* from Phase 3 onward (so authored content is skill-annotated from day one and needs no backfill), while proficiency computation waits for the Phase 6 engine.

4. **"World-class LMS *and* authoring tool in one" vs. Phase 3's deliberate exclusions.** Scope decision, 2026-08-16: full Articulate-class authoring parity is the target, so free-form canvas and animation authoring are no longer excluded — but Phase 3 still ships as approved, and parity lands in **3B**. The load-bearing consequence is in Phase 3 itself: the course specification schema must carry a **layout model** capable of absolute positioning and a **timeline model** capable of animation from v1, even though the editor exposes neither yet. Blocks remain responsive-by-default; the schema simply stops being unable to express anything else. Deferring the schema accommodation instead would turn 3B into a spec migration plus a rewrite of the interpreter and the editor — the exact failure the "schema first" ordering exists to prevent.

   Also folded in here: the **media pipeline** (transcoding, captions, TTS, audio editing) and the **asset/character library**, which appeared in no prior document and are not optional for parity. The asset library is a licensing and content-operations decision rather than an engineering one, and is flagged as such.

5. **Navigation and role model grew feature-by-feature rather than role-by-role.** Each Phase 3/4 feature (assessments, certification, xAPI) shipped with its own top-level nav destination and its own assignment flow, rather than being folded into the one destination each of the three real roles (learner, org admin, platform owner) actually needs. Reconciled 2026-09-03 against the explicit target model — one worklist for a learner, one workspace for an org admin, platform-owner-only org creation:
   - Learner: courses and assessments merged into one worklist (`GET /api/v1/my-work`, `lib/lms/my-work.ts`); the standalone "Assessments" nav tab and page are gone, folded into `/dashboard`.
   - Org admin: nav consolidated from 6 tabs to 4 (People · Curriculum · Assessments · Assign & Track). "Content & AI" is no longer a same-level tab — it's reached from inside the Curriculum course editor, since it authors *content* that Curriculum assembles, not a competing course system. "Reports" became **Assign & Track**: course assignment (`assign-panel.tsx`, pre-existing) and assessment assignment (previously siloed in the Assessments console) are now one flow, plus a per-learner drill-down (`GET /api/v1/reports/learner/[id]`) and a combined CSV export (`GET /api/v1/reports/export`, also used by Platform Control's Activity & audit tab for a cross-org version).
   - People: a real member deactivate/reactivate action was added (`PATCH /api/v1/orgs/members/[id]` with `{status}`) — `profiles.status`'s `suspended` value existed in the schema from Phase 1 but was never enforced or exposed anywhere; `getSessionContext()` now gates on it.
   - Platform owner: the competing self-serve `POST /api/v1/orgs` path was removed (see [MULTI_TENANCY.md](MULTI_TENANCY.md) §"Org creation is now platform-owner-only") so Platform Control's Organisations tab is the only way a new tenant gets created.
