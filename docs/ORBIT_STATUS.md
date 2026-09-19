# Orbit — LMS Product Repository Status

**Current release record:** [CURRENT_STATUS.md](CURRENT_STATUS.md) · **Last reconciled:** 2026-09-16

> **Historical-status notice.** Sections below document the original LMS and integration design sequence. Their former “not started” integration language is superseded by the completed Scope 1 LMS entry bridge and Scope 2 Orbit product-shell entry recorded in [CURRENT_STATUS.md](CURRENT_STATUS.md) and [ORBIT_LMS_INTEGRATION_PLAN.md](ORBIT_LMS_INTEGRATION_PLAN.md). No data merge or shared identity-provider rollout has begun.
>
> **2026-08-30/31 — resolved, not tracked in detail below.** A real gap was found in the Orbit Foundation database (the 360 confidentiality-hardening migration was committed but not applied to production). Applied and re-verified 2026-08-31 with the product owner's go-ahead. This file does not track Foundation/360 database status day-to-day — see [CURRENT_STATUS.md](CURRENT_STATUS.md) and `ORBIT_PLATFORM_BUILD_STATUS.md` §12.1 for the full, current account.

This repository is the **Learning Management System**, one product destined for the Orbit platform. It is not intended to remain standalone.

> **Operating rule — Super Admin stays current.** Every material Orbit build or deployment must update the authenticated **Platform Control** page (`/platform`) at the same time when it changes product status, platform health, attention items, recent activity, or the shipped record. The matching documentation and source-control commit must be updated in the same release. Never present an unconnected product metric as real data.

## Current Super Admin Command Center

- **P1-A Learning-side skills evidence (built and verified 2026-09-16):** `/skills` maps the signed-in learner's published authored courses and assigned assessments to the organisation vocabulary, shows honest learning evidence and next-course options, and excludes cross-tenant data. `/admin/content/skills` manages the flat Learning vocabulary. It does not claim proficiency or a 360 competency gap; the canonical Foundation taxonomy and gap hand-off remain the next P1 boundary.
- **P1 Foundation competency development — live (built, code+security reviewed, migrated to production, and production-smoke-tested 2026-09-16):** the canonical Foundation-owned Competencies taxonomy and 360-signal → learning-recommendation loop named as the next boundary above is now built — versioned/immutable-once-published frameworks, rating-to-level thresholds, consent and data-rights handling, and a `/skills/development` UI — reviewed directly against the migration SQL and confirmed the anonymity/PII gating is real, not just described. The Foundation production migration is applied to the real Foundation Supabase project (`YOUR_PROJECT_REF`) and confirmed present (function + all 6 tables read back directly after applying). A real signed-in `org_admin` account opened `/skills/development` on `app.example.com` and got a real rendered workspace, not the former "migration not applied" error. Full account in `docs/CURRENT_STATUS.md`.
- **Learner P0-A/P0-B (built and release-verified 2026-09-16):** Orbit Guide is embedded in the course player with same-course retrieval, quick page/lesson prompts and validated citations. `/transcript` combines course, path, assessment/score and certificate history with filters. `/search` spans published learning plus the signed-in learner's own assessment/certificate records. The AI Tutor migration was applied successfully and its real supported/no-answer provider checks passed.
- **Orbit Sanskrit visual-system foundation:** shared Learning and 360 entry, workspace, reviewer/report and control-screen presentation now uses the same indigo, peacock, lotus, leaf and saffron/coral language. This does not change any platform metric, authorisation, invitation or confidentiality boundary.
- **Route:** `/platform` — authenticated and restricted by the separate `platform_admins` grant; it is not the organisation-level `/admin` workspace.
- **Platform owner:** `owner@example.com` (granted through `platform_admins`, not a hardcoded front-end email check).
- **Current scope:** command overview, live LMS organisation/course counts, owner attention list, shipped record, product portfolio status, real LMS audit activity, organisation creation, and organisation-admin invitations.
- **Truth boundary:** 360 Feedback is live as a product, but its aggregate metrics are not yet connected into this LMS command-center data source. Competencies went live 2026-09-16 (see above); Orbit Growth remains in development. The page must retain these distinctions until an audited aggregate connection exists.
- **Access boundary:** 360 resolves authenticated accounts without an active 360 membership to an explicit access-resolution screen. Learning and 360 do not yet share SSO, so the control plane must not imply that an LMS credential alone opens 360.
- **360 administrator repair:** An active owner or organization administrator can repair a missing Feedback-administrator assignment only when the active organization already has a trial or active Feedback entitlement. This is verified server-side and audited; no employee self-service role escalation is permitted.
- **360 reviewer workflow:** Secure invitation, reviewer-response and protected-report source has shipped to the 360 project, including one-time hashed links, response freezing, and anonymous-group suppression. Both delivery and reviewer feature flags remain disabled pending Foundation migration confirmation and an isolated end-to-end smoke test; Platform Control must continue to describe 360 aggregate metrics as disconnected.
- **360 synthetic QA bots:** The Orbit 360 repository now runs a disposable local Foundation QA workflow for its Admin and Reviewer roles. The verified workflow covers role denial, invitation safety, reviewer save/clear/submit/freeze, and anonymous-group suppression using synthetic data and an in-memory mail sink only.
- **Navigation reset:** The public Orbit front door is now a single product chooser with only two live choices. The 360 public explanation, administrator sign-in, and private reviewer route are intentionally distinct; 360 admin navigation is role/task based, and Growth/Competencies are not presented as usable workspaces. Learning and 360 still have separate secure sign-ins.
- **QA Test Agents:** Platform Control includes an Admin Test Agent and Learner Test Agent playbook runner. It records a deliberately human-reviewed test report in the browser and separates live Learning/360 role checks from future-product readiness. It is not autonomous production browser automation and does not grant real users access; test identities must be isolated in a dedicated QA organization with synthetic data.
- **Future AI QA Command Bar:** approved as the next QA-system evolution. It will interpret constrained owner requests, select only allow-listed QA capabilities, use isolated Admin/Learner test personas, and return evidence plus Excel reports. It is expressly not an unrestricted production agent; the detailed scope is in `docs/ORBIT_AI_QA_COMMAND_BAR_PLAN.md`.
- **360 secure-cycle smoke test — first real run (2026-08-29):** ran the controlled activation checklist from `ORBIT_LMS_INTEGRATION_PLAN.md` and `docs/products/360-invitation-delivery.md` against a disposable synthetic organization only. All three required Foundation migrations are confirmed applied on the live database, including the confidentiality-hardening one (proved, not assumed: the submitted test response could no longer be edited afterward). Real evidence collected: unauthenticated API rejection (401), exactly one private link sent to an approved external reviewer, real delivery and submission, and — critically — the admin's protected report correctly withheld the under-threshold anonymous group's scores and comments despite a genuine submitted response underneath. A real bug was found and fixed in the process: the workforce-directory import failed on any file without an Employee ID column (empty string vs. `NULL` colliding with the `employee_number` unique constraint) — Orbit repo `790fef4`. Both feature flags are confirmed back to `false` in Production. **Not an activation** — invitation sender domain (`feedback@example.com`, a deliberate temporary choice pending a real domain purchase) and a raw-error-message UI gap remain before this could go live for a real customer.

This document exists to keep three things from being confused with one another: what the LMS actually does, what the Orbit Foundation database contains, and how far integration between them has progressed. **The answer to the third is: not started.**

---

## 1. LMS product status

### Phases

| Phase | Scope | Status |
|---|---|---|
| **1** | Multi-tenancy, auth, RBAC, RLS | **Complete** |
| **2** | Content library, SCORM ingest, courses, enrollment, progress, search | **Complete** |
| **3** | AI-native authoring engine (12 steps) | **Steps 1–7 and 9–11 done** |
| **4** | Assessment, certification, AI Tutor | **Assessment, certification, AI Question Generator, AI Tutor/RAG, contextual in-player Guide and learner transcript built and verified** |

### Phase 3 detail

| Step | Scope | Status |
|---|---|---|
| 1 | Job-execution spike (Cloudflare Workflows) | Done |
| 2 | CourseSpec v1 + validator (24 closed block types) | Done |
| 3 | Export conformance spike | Done |
| 4 | Data model + tenancy (9 tables, full RLS) | Done |
| 5 | Runtime interpreter + native player | Done — authored-course preview polished 2026-08-27 to suppress an exact duplicate first heading matching the page title and use the shared Orbit course-reader presentation |
| 6 | Visual authoring engine | Done |
| 7 | AI gateway (model-agnostic) | Done |
| 8 | AI generation pipeline | **Built, awaiting full production-provider verification.** AI Course Builder Lite remains production-verified; the explicitly approved Full AI Course Builder now accepts pasted text, public URLs, and content-library PDF/DOCX/PPTX sources, generates every bounded page plus section checks and skill tags, validates a draft-only CourseSpec, and exposes per-block generation details in review. Its first live full run hit the deliberately configured $5 monthly budget before it could save a draft, so it remains unverified. |
| 9 | Publishing pipeline | Done |
| 10 | Accessibility gates | **Done** |
| 11 | Skill tagging + search integration | **Done** |
| 12 | Definition of Done review | Written; verdict *not done* |

### Scale

25 migrations · 48 API routes · 23 pages · 31 RLS-enabled tables · 59 policy expressions

### LMS core — tracking, reporting, assignment (2026-08-21, outside Phase 3)

Work paused on the authoring engine at the user's direction to close a gap in the LMS itself: a SCORM package could be uploaded and played, but nothing tracked it, and nobody could see who had completed what.

- **SCORM API adapter** (`lib/scorm/adapter.ts`) — the object a package finds on `window.API` / `window.API_1484_11` and reports through. Previously absent entirely: content rendered and every completion it reported went nowhere. Now mounted before the iframe loads, persists on commit/terminate and immediately on reaching a terminal status, and normalises both generations' status/score/time models onto the one stored shape.
- **SCORM completion now advances the enrolment** — the manual "Mark as complete" button is replaced by observed completion for both SCORM and authored content.
- **Completion reporting** (`/api/v1/reports/completion`, `/admin/reports`) — manager+, status/course filters, CSV export. Previously did not exist in any form.
- **Course assignment UI** — the enrolment API has accepted admin-assignment since Phase 2; nothing in the product called it until now. `/admin/reports` lets an org_admin assign a course to any number of people with a due date.
- **Learner dashboard** (`/api/v1/my-learning`) — replaced a page whose entire content was an org UUID and a role string. Now lists what is assigned, progress, and overdue items, computed by the same shared function the manager's report uses.

---

## 2. Standards support — precise claims only

The three questions below are genuinely different, and this repository's evidence differs for each. Nothing is marked verified without something concrete to point at.

| Format | Import, play & track | Export implemented | Verified in SCORM Cloud |
|---|---|---|---|
| **SCORM 1.2** | **Yes — evidenced end to end.** A real 1.2 package uploaded, extracted, played by a learner in a browser, and **tracked**: the package finds `window.API`, bookmarks its position, reports a score and completion, and that completion advances the enrolment | **No** — named in code as unimplemented | Not applicable (no export) |
| **SCORM 2004** | **Yes — evidenced end to end.** A real 2004 package through the same path against `window.API_1484_11`, including resume (`cmi.entry` = `resume` on return) and the split completion/success model normalised onto one stored status | **Yes** | **Yes** — hand-built fixture (2026-08-20): complete / passed / 100%. **Pipeline output also now verified (2026-08-24):** complete / passed / 100% |
| **cmi5** | No import path | **Yes** | **Yes** — hand-built fixture (2026-08-20): complete / passed / 80%. **Pipeline output also now verified (2026-08-24):** complete / passed / 100% |
| **xAPI (standalone package)** | No | **No** — named in code as unimplemented | No |

AICC removed from the build and roadmap entirely (2026-09-03, product decision) — see [MASTER_FEATURE_MATRIX.md](MASTER_FEATURE_MATRIX.md).

### Three qualifications that matter

**"Verified in SCORM Cloud" now covers both the format and the pipeline.** The original two verifications used packages built from a hand-written fixture during the step 3 spike. **Closed 2026-08-24:** a package produced by the actual step 9 publishing pipeline (`buildPackage()`, unmodified, against a real published `course_specifications` row) has now been uploaded to SCORM Cloud for both formats and completed with a real score. That run caught two real bugs the hand-built fixture never exercised — a missing nav click handler and a quiz-tracking handoff that called an API neither format's adapter defined — both fixed same-day (`docs/SCORM_CLOUD_VALIDATION.md`).

**Import previously meant "renders", not "tracks" — corrected 2026-08-21.** Until the SCORM API adapter was built, an uploaded package loaded and displayed but recorded nothing: no adapter was mounted on `window`, so `LMSInitialize` found nothing to talk to and every completion the content reported was discarded. Extraction, serving and the progress endpoint were all correct and all unreachable. Earlier rows in this table said 1.2 was "played", and `DEFINITION_OF_DONE_PHASE2.md` checked off a "CMI progress round-trip" that was in fact the API endpoint being called directly by a test, never a package driving it. Both are now true as stated, evidenced by `tests/e2e/scorm-tracking.spec.ts`.

**xAPI statement emission is separate from xAPI packaging.** The native runtime emits xAPI statements to `xapi_statements` (initialized / progressed / answered / completed / passed), and that is evidenced end to end. That is not the same as producing a distributable xAPI package, which is unimplemented.

---

## 3. Test evidence

| Suite | Count | Evidence |
|---|---|---|
| Unit / integration (Vitest) | **348** | Green. Runs against a real local Postgres for data-layer tests |
| End-to-end (Playwright) | **65** | Green. Reliability established at 41 tests across **three consecutive full-suite runs** at ~3 minutes each; the suite has since grown with steps 10–11 and the SCORM/reporting work, green on every run that added tests |

E2E runs against a **production build** (`next build && next start`), not a dev server. That change was made on 2026-08-21 and is what turned the suite into a dependable gate: previously 8–24 minute runs with a rotating cast of 1–13 failures, every one of which passed in isolation.

Three causes were found and fixed, none of them in the application:

1. **`next dev` compiled routes on first hit**, putting unpredictable multi-second cost inside whichever test touched a route first, moving between runs with test order and load. Dominant cause; the fix took a 23.7-minute run to 3.0.
2. **The harness hammered the Docker API** — `npx supabase status` was called uncached once per Playwright worker (~11 times per run), enough that Docker returned 502s mid-run. Failures were indistinguishable from flaky application code.
3. **One test asserted on a stale UI label** rather than the network round-trip, reading the database before the write landed.

**Also verified:** `tsc --noEmit` clean, `eslint` clean, production build succeeds with all routes present.

**Not verified:** behaviour on CI hardware. All testing was on a Windows development machine with Dockerized Supabase. The fixes are environment-independent; the timings are not.

---

## 4. Orbit Foundation database status

**Reported by the project owner, not verified from this repository.** Per the constraints on this work, no connection to that project has been made from here, and nothing below was inspected.

A fresh Orbit Foundation Supabase project now exists, containing:

- `organizations`
- organization memberships
- product entitlements
- product roles
- RLS policies
- a product catalogue covering **LMS, Feedback, Growth, Competencies**

This is the intended future home of Orbit's shared platform layer.

---

## 5. Integration status — not started

**The LMS is not connected to the Orbit Foundation project.** Specifically:

- **No connection.** This repository points only at its own development Supabase project. No credentials, URL or client for the Orbit Foundation project exist anywhere in this codebase.
- **No data migrated.** Zero rows have moved in either direction.
- **No schema alignment.** The LMS still uses its own `organizations`, `profiles`, `org_invitations` and single-column `profiles.role`.
- **Tenancy, authentication, roles, RLS helpers and API namespace are untouched.** No change has been made to `current_org_id()`, `is_org_member()`, `has_role()`, `role_rank()`, `getSessionContext()`, `withAuth()`, or any of the 59 policy expressions.
- **No product/entitlement/permission system exists in this repository**, deliberately. Product access control belongs to the Orbit platform layer, not here.
- **No deployment change.** Hosting configuration is unchanged.

### What the LMS still uses

| Concern | Current LMS implementation |
|---|---|
| Tenant | `organizations`, one org per user via `profiles.org_id` |
| Roles | Single `profiles.role` — `learner` / `manager` / `org_admin` / `org_owner` |
| Authorization seam | `getSessionContext()` and `withAuth()` only |
| Tenant scoping | `current_org_id()` in every RLS policy |

### The pivot point for later integration

All **59** RLS policy expressions call `current_org_id()` rather than inlining the subquery. Rewriting that one function body migrates every policy at once. This is the single strongest argument for the LMS tenancy core as Orbit's platform foundation, and it is why the migration is tractable rather than a 59-way rewrite.

Design work for that migration is complete and unimplemented:

- `docs/ORBIT_PLATFORM_INTEGRATION_REVIEW.md` — target schema, role-model options with recommendation, LMS and 360 mappings, authorization decision flow, API namespace plan, phased implementation, exact future database changes
- `docs/ORBIT_INTEGRATION_READINESS.md` — what in this codebase is platform material versus LMS material

---

## 6. Architecture constraints in force

Binding on all new LMS work in this repository:

- **Do not change** the Supabase tenancy foundation, `organizations` / `profiles` / `org_invitations`, the role model, RLS helpers, auth and session architecture, the API namespace, deployment configuration, or billing tables.
- **`getSessionContext()` and `withAuth()` are the only authorization seam.** No direct queries against `profiles.role`, `profiles.org_id`, or raw organization membership in route handlers.
- **Every tenant query goes through the established RLS helper pattern.**
- **Keep LMS tables and routes LMS-specific.** Do not build a global product, entitlement or permission system here.
- **No new permanent meanings** for `learner`, `manager`, `org_admin` or `org_owner` beyond current LMS behaviour.
- **Any new feature needing permissions** must be documented as temporarily LMS-scoped and straightforwardly mappable to Orbit product roles later.
- **No secrets** in code, exports, logs, fixtures or documentation.

---

## 7. Outstanding gaps

**Honest, and repeated so they are not discovered late:**

1. **The AI gateway has called a real provider — production-verified 2026-08-27.** An AICredits adapter (`lib/ai/adapters/aicredits.ts`, an INR-billed OpenAI-compatible gateway at aicredits.in, the user's chosen primary provider — every profile's chain tries it first, falling back to a direct Anthropic adapter, then the deterministic in-process one) was exercised end to end with a real, funded API key: all three of AI Course Builder Lite's generation calls (outline, objectives, one page's blocks) ran for real through the actual product code path (`lib/ai/course-builder.ts` → `generateStructured` → the real adapter → a real HTTP call), producing a real draft `course_specifications` row with model-generated content, at a real billed cost. **The live Production deployment was then verified with a generic sample source**, producing the unpublished “Giving effective feedback” draft and opening it in the authenticated editor. This is kept as a permanent, self-skipping regression test (`tests/ai/course-builder.live-provider.test.ts` — runs only when `AICREDITS_API_KEY` is set, harmless no-op otherwise, including in CI). **What this verification run itself found and fixed:** `anthropic/claude-opus-5` isn't in AICredits' catalog yet (404; `anthropic/claude-opus-4.6` is used instead — see `lib/ai/profiles.ts` for real, measured ₹/M pricing, replacing the earlier unverified placeholder), and — far more significant — the JSON Schema handed to a real provider for the block-generation step was found emitting at **11.2 MB** (Zod's default `toJSONSchema` inlines every repeated sub-schema instead of `$ref`-ing one shared definition), rejected outright by a real API call with `413 Payload Too Large`. Fixed in two places that had each independently regenerated the schema without deduplication (`lib/spec/json-schema.ts`'s `emit()` and `lib/ai/gateway.ts`'s own inline call) by adding Zod's `reused: "ref"` option — 49 KB for the identical schema afterward. **This would have broken the direct Anthropic adapter identically**, the first time anyone gave it a real key; nothing had caught it because, until this verification run, no code path here had ever actually called a real provider. **What remains open:** the direct Anthropic adapter itself is still unexercised (no `ANTHROPIC_API_KEY` configured) — only the AICredits path has a real, confirmed call behind it.
2. ~~No pipeline-built package has been through a third-party LMS.~~ **Closed 2026-08-24.** See §2.
3. **Phase 3 step 8's full pipeline is built but not production-verified.** It includes source extraction, bounded draft-only full-course generation, review details, and recovery controls. The first real production run stopped at the configured $5 monthly budget before a full draft was saved; exact source-chunk provenance remains future work. See `docs/CURRENT_STATUS.md` for the full account.
4. **The product UI has a real shared design language on its core surfaces now** (dashboard, my-learning, courses catalogue, course player, completion reporting) — `components/shell/Shell.tsx`, restrained purple/orange tokens in `globals.css`. **Not yet applied:** the authoring tool's internal editors, the admin index, and admin/content — deliberately left alone, out of scope while authoring work is paused.
5. **No billing, certificates, or observability.** Notifications now has one real surface — a learner's own assigned/overdue work on the dashboard — but there is still no email/notification delivery.
6. **No manager view of *who* has not started, beyond the completion report table itself.** Reminders, escalation, and any notion of "nudge the overdue people" do not exist.

---

## 8. Priority order

**Superseded 2026-08-21.** The user gave an explicit ordered instruction that replaces the list this section previously carried: pause new feature expansion and complete six items in order before any Orbit Foundation integration begins. Prior work (E2E reliability, Phase 3 steps 10–11, the SCORM/reporting/assignment pass) is preserved in §1 and §6 above; this section now tracks only the current order.

1. ~~**Security review — SCORM upload, extraction, storage, runtime isolation**~~ — **done 2026-08-21**, with the deferred same-origin isolation finding **closed 2026-08-24**: a genuinely separate, cookie-less content-origin deployment (`apps/scorm-content/`) is built, tested, and deployed. Full findings in `docs/SECURITY_REVIEW_SCORM.md`; isolation architecture in `docs/SCORM_CONTENT_ISOLATION_ARCHITECTURE.md`. **Live in Production** (`NEXT_PUBLIC_SCORM_CONTENT_ORIGIN` was found already set there, not Preview-only as previously tracked here). Progress-sync end to end (postMessage → save → persisted in the database) **confirmed working 2026-08-24** by direct verification against the real Production deployment — not a screenshot relay: opened the course through the Claude in Chrome connector, watched "Tracking: not attempted" become "Tracking: incomplete" on its own, then confirmed via a direct `GET /api/v1/content/scorm/[id]/progress` call that `lesson_status: "incomplete"` and `total_time_sec: 60` were actually persisted server-side. Two real bugs found and fixed to get there, both now live:
   - `APP_ORIGIN` was blank on the content-origin Vercel project's Production environment — every `postMessage` from the bridge to the app was being silently dropped by the browser (invalid target origin), so tracking never updated no matter how long a learner waited. Fixed by setting it to the app's actual Production domain and redeploying.
   - `total_time_sec` is an `integer` column, but the SCORM adapter reports elapsed time with sub-second precision (e.g. `82.31`) — every progress save that included a fractional value was rejected by Postgres with a 500, confirmed live via the exact error `invalid input syntax for type integer: "82.31"`. This affected **both** the isolated bridge and the original same-origin player, since they share `app/api/v1/content/scorm/[id]/progress/route.ts` — fixed by rounding server-side (`1cc7b28`).
   
   **Closed out same day (2026-08-25):** the old, previously-exposed Supabase secret key (`default`, pre-rotation) was revoked in the dashboard — verified safe first by confirming the admin reports page (which depends on the service-role client) still loaded identical real data immediately after revocation, proving `rotatedaug24` was already the live key. Production signup-confirmation email was retested with a real throwaway signup — the confirmation link lands correctly on the real app's `/dashboard`, not `localhost` or a dead deployment.

   **Still open:** bookmark/resume and score/completion through the isolated bridge weren't re-verified after the postMessage/rounding fixes (the Chrome-automation session confirmed status-tracking persistence but didn't click through a full multi-slide/quiz run).
2. ~~**Vercel port**~~ — **done.** Both Vercel projects (`learning-platform`, `learning-platform-scorm-content`) live, env vars configured, Upstash Redis rate limiting connected and confirmed active, Supabase Auth URL configuration and service-role key rotation completed 2026-08-24
3. ~~**CI pipeline**~~ — **done 2026-08-21.** `.github/workflows/ci.yml` already covered type-check/lint/unit/e2e/build on every push and PR — it existed but hadn't run since 2026-08-17 because local `main` was 41 commits ahead of `origin/main` and nothing had been pushed. Pushed (with the user's explicit go-ahead), confirmed green end to end on real GitHub Actions infrastructure in 5m25s
4. ~~**Prove a pipeline-generated SCORM package in SCORM Cloud**~~ — **done 2026-08-24.** Both `scorm2004` and `cmi5` pipeline output uploaded, launched, and completed at 100.00% in SCORM Cloud. See §2 and `docs/SCORM_CLOUD_VALIDATION.md`. Caught and fixed two real bugs the hand-built fixture never exercised (broken in-package nav, broken quiz-tracking handoff)
5. **Apply Orbit's shared visual language and authenticated product shell** — **core surfaces done 2026-08-21**: `components/shell/Shell.tsx` (reusable shell/card/badge/progress primitives) plus a restrained purple accent token alongside the existing orange, applied to dashboard, my-learning, courses catalogue, course player, and completion reporting. Authoring's internal editors deliberately untouched — out of scope while authoring work is paused. No product switcher yet
6. **The controlled Orbit Foundation integration plan** — **first safe slice shipped and FROZEN, 2026-08-25**, once items 1–5 above were all closed and the user explicitly lifted the standing integration freeze. Full account: `docs/ORBIT_LMS_INTEGRATION_PLAN.md`. Scope was deliberately narrow — identity/org-context recognition and entry from an Orbit shell only, via a temporary, approved, replay-guarded passwordless auth-link bridge; **zero course/enrollment/progress/SCORM data migrated, zero database merge**. Verified end-to-end against real production with a real signed token (not just local/CI). The one real finding from that run — testing with a real `org_owner` account gets it silently re-mapped to whatever role the test token carries, since role is always re-derived server-side, by design — is now a documented standing rule: future Orbit-entry tests use a dedicated non-owner test identity.
   - **Scope 2, Orbit product-shell entry — COMPLETE and production-verified, 2026-08-25.** The real "Open Learning" tile now lives inside Orbit's actual authenticated shell (`your-360-app.vercel.app`), gated on live entitlement/role and backed by a new Edge Function (`mint-lms-entry-token`, real authorization boundary) on the Orbit Foundation project. Full account, including the CSP bug found and fixed during live testing, tamper-resistance proof, and the `organizationId` client-side cleanup that followed: `docs/ORBIT_LMS_INTEGRATION_PLAN.md` §10. This closes out the "No product switcher yet" gap noted above — the product strip (360 Feedback / Learning) is now real and functional, not a placeholder.
   - **No deeper integration (real OIDC/SAML migration, further role-model changes, a dedicated content-author role, or any data consolidation) begins without the user's explicit approval of the next scope** — broader design work for that remains unimplemented in `docs/ORBIT_PLATFORM_INTEGRATION_REVIEW.md`, `docs/ORBIT_INTEGRATION_READINESS.md`

**Deferred past this order, not abandoned:** Phase 3B full authoring parity and exact-source provenance remain future work. Phase 3 step 8's full AI generation pipeline is built; its full real-provider verification remains budget-gated. See `docs/CURRENT_STATUS.md`.
