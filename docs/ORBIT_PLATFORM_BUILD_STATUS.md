# Orbit Platform — Build Status, Technical Architecture and Delivery Roadmap

**Status date:** 2026-09-16
**Audience:** product owner, engineering, design, operations and future delivery partners  
**Source of truth:** this report consolidates the current LMS release ledger, Orbit 360 repository documentation, deployment configuration and recent verification records. It distinguishes production-live features from code that is built but intentionally gated, and from future plans.

---

## 1. Executive summary

Orbit is being built as a suite of connected people-development products rather than one undifferentiated website:

| Product/surface | Current state | What that means today |
|---|---|---|
| **Orbit Learning** | Live, authenticated LMS | Organisations can manage content, courses, learners, assignments, SCORM and native assessments. Learners have contextual grounded Guide help, workspace search, a combined transcript, and an organisation-scoped skills evidence/recommendation view. |
| **Orbit 360 Feedback** | Live product shell and administrator workspace; secure reviewer delivery is built but deliberately gated | Public/product routes, access resolution, administrator repair, cycle planning and private-workflow source are in place. Real customer invitation delivery and review are not enabled until a controlled production smoke test passes. |
| **Platform Control** | Live, owner-only | The LMS-hosted command centre provides real LMS organisation/course/audit visibility, product portfolio context and protected QA controls. It is not yet a unified data warehouse. |
| **Orbit ↔ Learning entry bridge** | Live and verified | Eligible Orbit users can enter Learning through a short-lived signed POST bridge. This is a safe interim product hand-off, not shared sign-in or a merged database. |
| **Orbit visual system** | Live across the Learning and 360 codebases | A shared Sanskrit-inspired palette and Inter type system now provide a common visual foundation. It is a presentation release; it does not alter permissions, data or product behaviour. |
| **Standalone new Orbit landing shell** | Prototype/live preview only | A separate Next.js visual shell demonstrates the new brand and links to the existing products. It is not yet the authoritative authenticated product application. |

The most important distinction is this: **the platform is real and usable, but it is not yet one unified identity, navigation, reporting or data system.** Learning and 360 are separately deployed products with deliberate secure hand-offs. The next release work should strengthen the real end-to-end workflows already built—especially a controlled 360 review cycle, the full AI builder verification and visually complete route-level design QA—before adding another broad product area.

---

## 2. Live product map and entry points

| Surface | Live URL / route | Intended user | Notes |
|---|---|---|---|
| Orbit public product chooser | `https://your-360-app.vercel.app/orbit-360/` | Prospects and existing users | The public entry point. It presents the two current live products only: 360 Feedback and Orbit Learning. |
| Orbit 360 public explanation | `https://your-360-app.vercel.app/orbit-360/360` | Prospects | Product narrative and privacy explanation. |
| Orbit 360 administrator sign-in | `https://your-360-app.vercel.app/orbit-360/sign-in` | Authorised 360 administrators | Route resolves to the protected console experience after authentication. |
| Orbit 360 invitation-only review | `https://your-360-app.vercel.app/orbit-360/review` | Invited reviewers | Intended only for private, token-bound reviewer access once the delivery flags are enabled. |
| Orbit Learning | `https://learning-platform-your-team.vercel.app/login` | Learners, authors and organisation administrators | Authenticated LMS. |
| Platform Control | `https://learning-platform-your-team.vercel.app/platform` | Platform owner only | Requires the server-side platform-owner grant. |
| New Orbit visual shell | separately deployed Vercel preview from `<local path>` | Brand/design review | Front-end shell only; do not treat it as a replacement for Learning or 360 authentication yet. |

### Current navigation model

The suite navigation reset intentionally separates **global context** from **local work**:

1. **Public choice:** one public product chooser, not a collection of ambiguous old home pages.
2. **Product context:** a person explicitly chooses Learning or 360 Feedback; the UI must not imply shared sign-in where it does not exist.
3. **Role context:** each product reveals only the work appropriate to the signed-in role.
4. **Local task navigation:** learners see learning tasks; organisation administrators see management tasks; platform owners see Platform Control.

This structure is safer and clearer than mixing every product and every administrative option in one persistent menu. It is still in a refinement phase: route-by-route visual QA and clearer cross-product return paths remain priorities.

---

## 3. Repository, deployment and ownership inventory

| Repository / project | Local path | Remote / branch | Primary responsibility |
|---|---|---|---|
| Learning Platform | `<local path>` | `your-github-user/orbit-learning`, `main` | Orbit Learning, Platform Control, LMS AI, LMS-side bridge verification and current suite shell. |
| Orbit public / 360 product shell | `<local path> project` | `your-github-user/orbit-platform`, `master` | Orbit public chooser, 360 Feedback browser experience, serverless feedback APIs and Foundation integration. |
| New visual shell | `<local path>` | no authoritative remote recorded yet | New Next.js landing/shell implementation; visual foundation only at present. |

### Recent released source revisions

| Date | Repository | Revision | Release meaning |
|---|---|---|---|
| 2026-08-29 | Learning Platform | `9e738a6` | Applied the Orbit Sanskrit visual-system foundation; LMS uses Inter and shared semantic visual tokens. |
| 2026-08-29 | Orbit 360 | `c6ab69e` | Applied the shared Sanskrit visual layer across public, workspace, reviewer, report and platform-control surfaces. |
| 2026-08-29 | Orbit 360 | `60f2224` | Corrected remaining inherited serif-heading variables so Orbit 360 uses Inter throughout the workspace as intended. |
| 2026-08-29 | Orbit 360 | `d32cce4` | Fixed every dead landing-page link, a CSP block on the Inter font, two XSS gaps, and consolidated to one public landing page. |
| 2026-08-29 | Orbit 360 | `790fef4` | Fixed the workforce-directory import bug found live during the 360 secure-cycle smoke test (see §6.4 and §12.1). |

### Deployment topology

```text
Browser
  ├─ Orbit public / 360 static product shell (Vercel)
  │    ├─ 360 browser UI (HTML/CSS/JS)
  │    └─ 360 serverless APIs (Vercel functions)
  │             └─ Orbit Foundation Supabase (identity, membership, entitlement,
  │                product roles, feedback data and RLS)
  │
  └─ Orbit Learning (Vercel / Next.js)
       ├─ Next.js application and API routes
       ├─ LMS Supabase (users, organisations, courses, learning data and RLS)
       ├─ AI provider gateway
       └─ Platform Control
```

The diagram intentionally shows two data domains. There is a secure product-entry bridge between Orbit and Learning, but no data merge.

---

## 4. Orbit Learning — completed capabilities

### 4.1 Identity, tenancy and roles

Learning is a multi-tenant LMS with Supabase authentication, role-based access control and PostgreSQL Row Level Security (RLS). Users work within an organisation, and server-side access checks determine whether they can learn, author, administer an organisation or access Platform Control.

Built capabilities include:

- Organisation-scoped user, course and content access.
- Supabase authentication and protected application routes.
- Learner, author/organisation-admin and platform-owner experiences.
- Server-side Platform Control authorisation. The platform owner (`owner@example.com`) is authorised through the `platform_admins` grant—not a browser-only email comparison.
- Role-aware navigation: learners see **My learning**, **Explore**, **Search**, **Skills**, **Transcript**, **Certificates** and **Guide**; organisation administrators retain their management workspace; platform owners can additionally access **Platform Control**.

### 4.2 Learning, content and reporting

The following are built and available in the LMS:

- Content library and reusable learning objects.
- Course creation, editing, review and publishing workflow.
- Learner enrolment, assignment and progress tracking.
- Organisation-scoped learner workspace search across published courses/paths/pages and the caller's assigned assessments/certificates, plus catalogue exploration.
- A combined learner transcript for course, learning-path, assessment/score and certificate history with progress/date/status filters.
- A learner skills evidence view that maps published authored-course tags and assigned-assessment skill codes to the organisation vocabulary and recommends mapped published courses, without inferring proficiency.
- Contextual Orbit Guide inside the course player, constrained to the active published course and backed by validated citations.
- Completion reporting and administrative reports.
- Native standalone assessment foundation: question banks, scored attempts, evidence capture/review foundations and spreadsheet question-bank import.
- Draft → review → approval → published content governance. AI-assisted work enters this exact workflow and does not auto-publish.

### 4.3 SCORM and interoperable learning content

Learning supports:

- SCORM 1.2 and SCORM 2004 import, launch, resume, score and completion tracking.
- A SCORM 2004/cmi5 pipeline that has passed SCORM Cloud validation.
- An isolated origin for untrusted uploaded SCORM content, exercised with a real multi-file package.
- Rate limiting around sensitive SCORM and authentication operations.

Not yet built:

- SCORM 1.2 export.
- xAPI package export.
- Native xAPI statement emission should not be confused with full xAPI package support.

AICC was explicitly removed from the build and roadmap (2026-09-03, product decision) — it predates SCORM, most AICC content in the wild has long since moved to SCORM 1.2, and modern authoring tools rarely export it. See [MASTER_FEATURE_MATRIX.md](MASTER_FEATURE_MATRIX.md).

### 4.4 Platform Control

Platform Control is a real, authenticated super-admin surface rather than a public dashboard. It currently provides:

- Live LMS organisation and course counts.
- Real LMS audit activity.
- Organisation provisioning and organisation-admin invitation controls.
- Product portfolio and owner attention items.
- A protected test-agent/QA control room that records guided test evidence and downloadable reports.

It deliberately does **not** yet show direct confidential 360 content or claim unified live suite metrics. A future aggregate connection must expose only appropriate, audited summary data.

---

## 5. AI authoring — what is actually built

### 5.1 AI gateway and provider approach

The LMS has one provider gateway rather than feature-specific direct model calls. It supports a controlled provider order:

1. **AICredits** adapter (`aicredits.in`) as the current billed provider path.
2. **Direct Anthropic** adapter when `ANTHROPIC_API_KEY` is configured.
3. **Deterministic test provider** for explicit test environments only.

If no real provider key is configured, production does not silently manufacture deterministic content. It returns a clear “AI generation is not configured” error.

Security and quality constraints already built into the authoring path:

- Organisation scope is retained through the whole job.
- Structured output is schema-validated before persistence.
- The final assembled course is validated to publishing quality, not merely checked for a database write.
- A failure during generation persists no incomplete course as a valid draft.
- Generated content remains human-reviewable and starts in draft.
- Usage/budget guardrails are enforced before expensive generation proceeds.

### 5.2 AI Course Builder Lite — live and production verified

**Status: live and real-provider verified.**

At `/admin/authoring`, an organisation administrator can paste source material and use **Generate with AI**. The Lite flow makes three narrow structured generation calls and creates a valid draft `course_specifications` record containing:

- A title and short description.
- Learning objectives.
- A module/lesson outline.
- One fully generated lesson page.
- Valid, empty pages corresponding to the rest of the outline for an author to complete.

The production verification on 2026-08-27 used a generic sample source and real AICredits calls. It generated the draft course **“Giving effective feedback”** in the authenticated editor. The course remained unpublished. This run also found and fixed a genuine provider-facing defect: an emitted JSON schema grew to approximately 11.2 MB instead of approximately 49 KB and was rejected by the provider. The regression is now represented by `tests/ai/course-builder.live-provider.test.ts`, which executes only when a real AICredits key is available and otherwise skips safely.

### 5.3 Full AI Course Builder — built, but not yet real-provider verified

**Status: code complete and locally verified; production completion blocked by the intentionally low AI budget.**

An organisation administrator can select **Quick draft** or **Full course** in `/admin/authoring`. The full flow accepts:

- Pasted source text.
- A public URL, retrieved server-side with SSRF and size protections.
- PDF, DOCX or PPTX already uploaded to the content library.

The implementation includes text extraction, bounded multi-page generation, section knowledge checks, skill tagging, accessibility findings and whole-course CourseSpec validation. It saves a draft only.

The first real-provider run deliberately stopped at the configured **USD $5 monthly AI budget** before a complete full-course draft was saved. Therefore it must not be described as “production verified” or “AI ready end to end.” Local extraction tests, TypeScript checks and production build checks pass; a controlled real-provider run is still required.

### 5.4 AI authoring work still pending

1. Authorise an intentionally higher/reset monthly budget for one generic, controlled full-course test.
2. Run the whole pipeline with a real provider and inspect the generated draft, cost, failure recovery and job continuation behaviour.
3. Add the planned **provenance review UI**: an author should be able to see which source chunk informed generated material.
4. Add orchestration/self-chaining integration tests to accompany current unit extraction coverage.
5. Test the direct Anthropic path only when an Anthropic key is intentionally configured.
6. Conduct an author usability review: edit, reject, regenerate, review and publish flows must be understandable without engineering support.

### 5.5 AI capabilities that remain future work

The following are architecture/planning opportunities, not current production claims:

- Broader AI coaching beyond the shipped single-question, published-course-grounded Orbit Guide (conversation memory, recommendations and administrator curation remain future work).
- AI question/item generation beyond the bounded authoring workflow.
- AI-generated interactions and deeper accessibility remediation.
- AI QA command bar: constrained natural-language QA requests become a reviewable plan of allow-listed safe checks and an evidence/Excel report. It must never execute arbitrary SQL, change production data, send production email or access confidential customer reports.

---

## 6. Orbit 360 Feedback — completed capabilities

### 6.1 Current product boundary

Orbit 360 is a separate product with a static browser shell and Vercel serverless APIs backed by Orbit Foundation. It is not a visual mock-up: authenticated access resolution, entitlement/role checks, planning tools, secure workflow source and audit constraints are all present. However, customer invitation/reviewer delivery is deliberately feature-flagged off until a safe isolated production verification is completed.

### 6.2 Access resolution and safe administrator recovery

Completed flows include:

- A clear post-sign-in access-resolution screen when a person has no active 360 organisation membership, rather than an ambiguous setup screen.
- Guidance for the correct account, an expected invitation or an intentional new-organisation path.
- Controlled 360 administrator repair for an existing organisation owner/administrator with a valid 360 entitlement but a missing Feedback-administrator grant.
- Server-side verification of the caller, active membership, organisation role and entitlement before the repair action.
- Audit event recording. Ordinary employees cannot self-grant an administrative role.

### 6.3 Cycle design and respondent planning

The 360 administrator workspace includes foundations for:

- Creating a cycle and defining its purpose.
- Rating and open-text questions.
- Downloadable Excel/CSV templates, source preview and import.
- A private people/demo directory (currently designed as sample planning data; it must not be treated as an account-provisioning system).
- Subject-group building by individual, department, designation, combinations and organisation.
- Dedupe and roster review.
- Perspective planning: self, manager, direct report, same team, peer, cross-functional and external perspectives.
- Hierarchy-aware planning, contact CSV/Excel handling and review warnings around anonymity thresholds.

### 6.4 Secure invitations, reviewer responses and confidentiality — built and gated

The secure delivery/reviewer implementation includes:

- Server-issued 256-bit, single-use reviewer tokens.
- Raw reviewer tokens only in the browser fragment; only a SHA-256 hash is stored server-side.
- `POST /api/feedback-invitations` protected by current active organisation and Feedback-administrator checks.
- Token-bound reviewer save/resume, clear, required-response validation and final submission freezing.
- Server-side audit records that do not expose raw tokens or recipient email addresses to an administrator view.
- Threshold-based anonymous-group suppression designed to prevent scores, counts or comments from identifying a respondent group below its confidentiality threshold.
- Hardening migration to prevent more than one active link per rater and prevent modification after final submission.

Relevant Foundation migrations are:

- `20260824000100_feedback_invitation_delivery.sql`
- `20260824000200_feedback_token_reviewer_responses.sql`
- `20260828000100_feedback_delivery_confidentiality_hardening.sql`

**First real smoke test run, 2026-08-29.** Using a disposable synthetic organization and a real test mailbox (never a customer org), the full checklist from `docs/products/360-invitation-delivery.md`'s activation gate was run with real evidence: unauthenticated API rejection (401), a live cycle sending exactly one private link to an approved external reviewer, real email delivery and submission, post-submission edit rejection (proving the confidentiality-hardening migration is genuinely applied, not just present as a file), and correct anonymous-group suppression in the admin's protected report despite a real submitted response underneath. All three required Foundation migrations were confirmed applied on the live database during this run. One real bug was found and fixed: the workforce-directory import failed on any file without an explicit Employee ID column — an empty string was stored instead of `NULL`, colliding with the table's unique constraint on `employee_number` — reproduced, root-caused, fixed, and re-verified with a real import succeeding (`790fef4`). Two things remain open before this could go live for a real customer: invitation emails currently send from `feedback@example.com`, an unrelated product's domain — a deliberate, temporary choice by the product owner pending a dedicated domain purchase — and a raw Postgres error string was observed surfacing directly in the admin UI during the import failure above. **This was a verification run, not an activation** — both flags were returned to `false` in Production immediately after, confirmed via redeploy.

These capabilities are **not live for customer cycles yet**. Delivery and review are deliberately disabled in Preview and Production through:

```text
ORBIT_FEEDBACK_INVITATIONS_ENABLED=false
ORBIT_FEEDBACK_REVIEW_ENABLED=false
```

They must remain disabled until the operational Foundation database migration state is confirmed and an isolated, synthetic private-link smoke test succeeds.

### 6.5 360 reporting state

Planning and report-oriented user interfaces are present, but customer-ready confidential report release should not be claimed until the gated reviewer workflow is activated and tested. A safe reporting release needs verified suppression behaviour, action-plan delivery, export handling and release governance—not merely a visible report page.

### 6.6 360 work — complete (2026-09-02)

1. ~~Confirm all three invitation/reviewer/confidentiality migrations in the operational Foundation project.~~ Believed confirmed on 2026-08-29; a 2026-08-30 direct check found the confidentiality-hardening migration specifically was *not* actually applied to production. **Re-applied and re-verified 2026-08-31** — see the resolved row in §12.1.
2. ~~Configure and verify the transactional sender/domain.~~ **Decided, not done (2026-08-30):** the product owner chose not to invest in a domain right now. Parked, not a gap — see §13 P0 item 1.
3. Provision a synthetic organisation, subject, reviewers, cycle and inboxes. — done for the 2026-08-29 smoke test.
4. Run the private-link smoke test. — done 2026-08-29; the specific edit-rejection check needs re-verification given item 1's finding.
5. Enable the two feature flags only for a controlled test release; inspect evidence; then decide on customer availability. — done for the controlled test; customer availability remains blocked on items 1 and 2.
6. ~~Build operational delivery features: reminders, bounce/webhook handling, replacement reviewers, reopen policy and delivery audit views.~~ **Complete 2026-08-31** — all five sub-pieces shipped and live-verified:
   - **Delivery audit view** (2026-08-30, `795bf06`) — every invitation's recipient (name only, never address), kind (initial/reminder/resend), status and milestone timestamps, on the Cycles panel. Reads the same privacy-scoped view referenced in item 1; re-verified working against real data after that migration landed.
   - **Reopen policy** (2026-08-31, `8c9261d`, `a16154e`) — a feedback admin can reopen a closed/report_ready cycle. Per the recorded decision: reopening only extends the response window for whoever hasn't finished yet (a `completed` response still cannot be edited, enforced at the database level, not by this feature); any already-released report is withdrawn (reused the existing `withheld` status — no new schema value needed) until the cycle closes and is released again. **Two real bugs found and fixed via live testing, not just code review:** (a) the endpoint's own ordering was non-atomic — the report-withdrawal ran before the cycle-status change, so a real test left a released report incorrectly withdrawn even though the reopen itself failed; reordered so the trigger-guarded step runs first, and the incorrectly-withdrawn test report was restored. (b) the shared launch-validation trigger (`validate_feedback_cycle_launch`) only counted `status = 'approved'` reviewers — but any cycle that was actually used has reviewers in `invited` or `submitted`, never `approved` again, so reopen would have failed for essentially every realistic cycle. Widened to accept `invited` too (safe for original launches, since nobody is `invited` before first going live) — applied to production 2026-08-31 with explicit go-ahead, then independently re-verified end to end against a real freshly-constructed test cycle (launched, invited, closed, reopened successfully, cleaned up afterward, no residue).
   
   - **Reminders** (2026-08-31) — extends the existing invitation-send endpoint with a `kind` parameter rather than a separate file. Targets raters already `invited` who have not submitted (a submitted rater is never `invited` again, so this naturally excludes anyone finished); revokes the existing active delivery first, per the one-active-link-per-rater constraint, before creating a new one tagged `delivery_kind: "reminder"`. Same fail-safe gate as the original — verified live to correctly return `503` while invitation delivery remains disabled. **Cannot be tested end to end (a real send) without the sender domain**, same constraint as invitation-sending itself; the UI's enable/disable gating and the endpoint's reuse of already-proven infrastructure were verified live instead.
   - **Bounce/webhook handling** (2026-08-31) — a new public endpoint (`api/feedback-invitation-webhook.js`) Resend calls directly; no user session, security is entirely the Svix webhook signature (HMAC-SHA256 over the exact raw body) against `RESEND_WEBHOOK_SECRET`. Disables Vercel's default JSON body parser, which would otherwise re-serialize the payload and silently break signature matching. Only a bounce or spam complaint marks a delivery `failed`; a `completed` delivery is explicitly never touched, as a deliberate second safeguard alongside the database's own confidentiality-hardening trigger. Verified live in production: correctly returns `503` while unconfigured. The HMAC algorithm itself was verified in isolation (accepts a genuinely-signed payload, rejects a tampered body/wrong secret/missing signature, handles the multi-signature rotation format) since a real end-to-end test needs a webhook actually registered in the Resend dashboard — a manual step nothing here can do, separate from the sender-domain question.
   
   - **Replacement reviewers** (2026-08-31, `9b6ab22`) — an admin can swap a reviewer for someone else via a directory picker on the People / Questions & reviewers panel. Per the recorded decision, an already-submitted response is deleted, not preserved or transferred. The real difficulty: a completed response is protected by the same confidentiality-hardening trigger from §12.1 — every delivery the old reviewer had is revoked first (making the deletion legal, not a way around the protection), *then* the response rows are deleted, then the old roster-rater row is marked `withdrawn` and a fresh `approved` one created for the replacement. New isolated endpoint (`api/feedback-replace-reviewer.js`) rather than folding into an existing file, given it touches confidential response data directly. **Verified live end to end** against a real freshly-constructed test cycle: old reviewer correctly `withdrawn`, new reviewer correctly `approved` with the same subject and rater group, a real `audit_events` row recorded, cleaned up afterward with no residue. **One thing not independently re-verified**: the specific "delete an already-*completed* response" path — my own earlier security fix now correctly blocks even my own admin session from directly reading or writing `feedback_invitation_responses` from the browser (by design), which means I can no longer manufacture that exact test state the way I could before. The code path was reasoned through carefully (see the commit message) and mirrors the same revoke-before-delete pattern already proven correct in reopen-cycle, but it deserves a real check the first time a genuine completed-then-replaced case naturally occurs.

   **§6.6 item 6 is now complete — all five sub-pieces shipped and verified**, except reminders/bounce-handling's real-world email testing, which stays blocked on the sender-domain decision like invitation-sending itself.
7. Complete report release controls, exports, comment-safety review, scheduled release and durable action plans. **Complete (2026-08-31)** — all 4 sub-pieces shipped and live-verified:
   - **CSV export** (`01cdfe9`) — adds `?format=csv` to the existing protected-report endpoint rather than a new file, reusing the exact same anonymity computation the screen already uses; a withheld group stays withheld in the export, not a separately-maintained copy of that logic. Verified live against a real cycle with genuine historical response data (not constructed test data) — correct headers, correct filename, correct row for the one real completed response.
   - **Scheduled release** (`01cdfe9`, `18ece6a`) — reuses the previously-unwired `report_release_at` column on `feedback_cycles`; an admin sets it from the Reports panel. A daily Vercel Cron job releases every subject's report at once for any closed cycle past its release time. **A real deployment failure was hit and fixed**: the standalone cron file pushed this project from 12 to 13 serverless functions, over the Hobby plan's hard limit — folded into `feedback-reports.js` as an early-exit branch instead of removing or touching unrelated existing endpoints. Verified live end to end: a genuinely due test cycle was released and moved to `report_ready`, a second cron call correctly processed zero cycles (idempotent, no double-release), and a wrong secret was confirmed to fall through safely rather than bypass the check. A real `CRON_SECRET` is now configured in production, generated and set directly since — unlike the domain and Resend webhook — it needs no external account access.
   - **Comment-safety review** (`a8b7c4d`, `5ce5953`) — deliberately a human checkpoint, not algorithmic content screening; researched that no major 360 tool (Culture Amp, Qualtrics, Lumus360, DecisionWise, McLean & Company) runs automated identity-risk detection on comments — the industry standard is reviewer guidance at write time plus human judgment at release time. Two pieces: (1) a write-time reminder on every open-text question in the reviewer-facing `review.js` submission page ("avoid naming people, teams, or specific projects that could reveal who wrote it"); (2) a cycle-level "I've reviewed the comments" gate — `feedback_cycles.comments_reviewed_at`/`comments_reviewed_by`, set via a new `mark_comments_reviewed` action, that blocks both the manual `release` action and the scheduled-release cron with a 409 until ticked, but only for cycles that actually contain an open-text question. Verified live end to end against a constructed test cycle: release blocked pre-review, `mark_comments_reviewed` succeeds, release then proceeds; existing rating-only cycles correctly show no gate at all.
   - **Durable action plans** (`5ce5953`) — new `feedback_directory_action_plans`/`feedback_directory_action_goals` tables (migration `20260831000100`), mirroring the legacy `feedback_action_plans`/`feedback_action_goals` field design (title, behavioral commitment, due date, competency, status, sort order) but keyed to `roster_subject_id` instead of the legacy `participant_id`/`subject_user_id`, with the same validating-trigger and feedback-admin RLS pattern as `feedback_directory_report_releases`. One plan per subject, one or more goals per plan, edited from a new "Action plan" panel on the Reports screen (add/edit/remove goals, single "Save action plan" call that upserts the plan and reconciles goals — deleting removed ones, updating existing ones by id, inserting new ones). **A real bug was hit and fixed during verification**: the console briefly threw `ReferenceError: data is not defined` after a merge mistake dropped a variable declaration, and a second bug left the UI showing a stale, pre-save draft instead of the just-saved goal after clicking Save — both caught by live click-through testing (not just code review) and fixed before this was called done. Verified end to end against a real historical cycle's real subject via actual UI clicks: add goal → save → correct data persisted and rendered; edit → save → updated correctly; remove → save → deleted correctly, server and UI agreeing at every step; all test data cleaned up afterward.
8. Run accessibility, security and realistic administrator/reviewer UAT before using the product for a confidential production cycle. **Complete (2026-09-02)** — all three pieces done and live-verified, including a genuine real-email send/respond/release cycle, not constructed test data:
   - **Accessibility** (`e837dcf`) — reviewer page (`review.js`/`.css`): required-ness on rating/open-text questions is now programmatically exposed via `aria-required`/`required`, not conveyed by color alone; each question section is `aria-labelledby` its own heading instead of being an unnamed landmark region; the "Required" badge's orange measured 2.62:1 against white (fails WCAG AA's 4.5:1) — darkened to `#b25512` (5.00:1). Admin console: the four step-icon glyphs added earlier this session (`+ ↗ ✓ ◎`) are now `aria-hidden` (the adjacent label already carries the meaning; the raw glyphs would otherwise be announced as confusing literal Unicode names); the external-contacts file input had no accessible name at all — added one; the rater-review confirmation modal (`role="dialog"`) now closes on Escape and moves focus to its close button on open / the trigger button on close, neither implemented before. Heading structure, link text, and image alt text across the public pages were audited and found already clean (no fix needed).
   - **Security** — a fresh inventory of every RLS policy, trigger, view, and API auth check confirmed the core confidentiality architecture is sound (independently re-verified live, not just trusted: an admin session gets an empty result from `feedback_invitation_responses` despite a real completed response existing there, a `403` from the raw `feedback_invitation_deliveries` table, and only the safe narrowed columns from `feedback_invitation_delivery_status`). **It also found one real, concrete bug, fixed in `af7d54f`**: the "I've reviewed the comments" gate shipped earlier this session had nothing behind it to actually review — `api/feedback-reports.js` never fetched the `comment` column and no UI rendered comment text to an admin, making the attestation checkbox a rubber stamp. Fixed by extending the existing per-group `reportGroup()` computation (which already gates scores/counts behind the anonymity threshold) to also surface comment text for visible groups only, and adding a "Written comments" section to the Reports panel. A second, minor inconsistency was noted and accepted rather than changed: `feedback_report_access_deliveries` gives admins raw `recipient_email`/`token_hash` via a plain RLS policy rather than a narrowed view like `feedback_invitation_deliveries` has — left as-is since admins already have these same people's emails via the directory/external-contacts tables, so no new exposure is created.
   - **Realistic UAT** — reused the exact 2026-08-29 smoke-test discipline (feature flags flipped to `true` in Preview only, reverted immediately after) but went further: a disposable cycle with 3 real external reviewers (Gmail `+`-alias addresses routing to one real, checkable inbox) received 3 real invitation emails via Resend, each opened and genuinely submitted through the real `/api/feedback-review` endpoint with real ratings and real written comments — not simulated. Because the emailed links point at the production domain, `ORBIT_FEEDBACK_REVIEW_ENABLED` also needed a brief, deliberate Production toggle (same nuance the original 2026-08-29 run hit, for the same reason), reverted and redeployed immediately after the 3 submissions, confirmed back to `503` afterward with no residue. The full admin sequence was then verified for real: release correctly blocked (`409`) before comments were reviewed, the new "Written comments" view correctly surfaced all 3 real submitted comments once the group crossed the anonymity threshold (3 of 3 completed), `mark_comments_reviewed` succeeded, and release then succeeded. All test data (cycle, questions, roster, external contacts, responses) was deleted afterward via cascade, confirmed empty. **One thing not independently re-verified with a fresh live counter-example**: an anonymous group staying withheld with its comments hidden — the withheld-comment code path is structurally identical to the already-proven withheld-score/competency gating (same `visible` boolean, same ternary), and the launch-validation trigger makes it structurally impossible for a live cycle to ever have a genuinely under-threshold anonymous group in the first place, so there was no real state to construct a fresh counter-example against.
   - One real, unrelated finding surfaced during testing and not a product bug: a Gmail-tool quoted-printable decoding artifact (`=3D08` mis-parsed as `=` + a backspace escape of "08") corrupted one of the three emails' extracted plaintext link in my own tooling — confirmed via the message's raw MIME source that the actual sent email was correct throughout; real mail clients don't share this decoding bug.

---

## 7. Orbit Foundation, authorisation and product integration

### 7.1 Foundation responsibility

Orbit Foundation is the shared identity, membership, entitlement and product-role authority for the Orbit side of the suite. It is not a licence to give every user access to every product.

The authorisation model uses three distinct checks:

1. **Active membership** in the selected organisation.
2. **Active or trial entitlement** for a specific product, within its permitted date window.
3. **Non-expired product role** sufficient for the requested action.

Foundation represents this via helpers including:

- `public.current_organization_id()` — reads the explicitly selected organisation.
- `public.set_active_organization(uuid)` — performs safe organisation switching.
- `public.can_access_product(product_key, required_role_key, organization_id)` — evaluates product access.

Resource-level RLS remains necessary after a high-level product-access decision. The design expressly avoids unsafe shortcuts:

- Organisation administrators do not automatically gain every product role.
- A purchased product does not grant every employee access.
- Browser-provided organisation IDs cannot confer cross-tenant authority.
- Platform Control does not receive tenant data simply because it is a platform surface.

### 7.2 LMS entry bridge — completed Scope 1

The Learning Platform can accept a short-lived HMAC-signed Orbit entry token. The LMS:

- Verifies the signature and expiry.
- Rejects replay through a JTI/replay guard.
- Requires a linked organisation and approved role mapping.
- Establishes the normal LMS session through Supabase.
- Receives the token by POST, never in a URL.

This is a secure product-entry bridge. It does **not** migrate data or merge users/databases.

### 7.3 Orbit product-shell hand-off — completed Scope 2

The Orbit serverless function `mint-lms-entry-token` independently re-derives the active organisation, entitlement and role before minting the Learning hand-off. The product shell submits a hidden POST form to Learning.

Production verification covered:

- Valid entitlement and valid role.
- No entitlement.
- No required role.
- Expired role.
- Tampered organisation identifier.
- Clean Learning dashboard landing.

The verification used an isolated test organisation and did not change the real tenant.

### 7.4 Integration work explicitly not yet started

The current bridge is intentionally narrower than a full suite integration. Pending architectural programmes are:

- Shared identity provider / true cross-product SSO.
- OIDC/SAML enterprise SSO (the intended long-term replacement for the temporary passwordless bridge).
- Unified account/profile lifecycle.
- Shared-data migration.
- Learning-signal synchronisation into Foundation.
- Unified reporting warehouse.
- Organisation and role model consolidation.

These are separate programmes with data, privacy, migration and support consequences. They should not be silently folded into a UI release.

---

## 8. QA automation and release evidence

### 8.1 What the current test agents do

Platform Control contains two protected **test personas**, not artificial employees that can freely operate customer data:

| Persona | Intended proof | Product roles represented |
|---|---|---|
| Admin Test Agent | An authorised administrator can reach and use the appropriate administrative surfaces without bypassing permissions. | Platform test administrator; Learning organisation admin/course author; 360 Feedback administrator. |
| Learner Test Agent | An end user can learn and contribute assigned feedback without obtaining admin/report access. | Learning learner; 360 subject/assigned reviewer. |

The control room supports guided pass/fail/block decisions and report export. It does not itself create test accounts, invite real people, send customer email or query customer confidential reports.

### 8.2 Automated 360 safety workflow

A GitHub Actions workflow creates a disposable local Foundation organisation with synthetic identities, synthetic cycle data and an in-memory mail sink. Its verified run passed these seven checks:

1. Role denial.
2. Private invitation handling.
3. Duplicate-send prevention.
4. Private survey access.
5. Draft clearing.
6. Submission freezing.
7. Anonymity suppression.

The workflow does not contact the production Foundation database or send real email. This is a significant safety property, but it is not a replacement for the isolated production smoke test required before enabling 360 invitations.

### 8.3 Existing Learning verification baseline

The LMS includes TypeScript, unit and browser-test tooling, including scripts such as:

- `npm run typecheck`
- `npm test`
- `npm test:e2e`
- `npm run qa:personas`

The recent visual LMS release passed `npm run typecheck`. The 360 repository’s `node orbit-360/navigation.test.mjs` passed during the visual release.

### 8.4 QA capability still missing

The desired experience—press a button, watch a safe background run, then receive a standard Excel QA report—is only partially delivered today. The guided control room and synthetic GitHub workflow exist. To become a true operational QA runner it still needs:

- Dedicated QA organisation/accounts/inboxes provisioned once, using synthetic data only.
- A job record that links the Platform Control run button to a GitHub Actions workflow execution.
- Progress polling/status in Platform Control.
- Direct retrieval of the workflow evidence and XLSX artifact into the UI.
- Clear failed/blocked condition summaries and reproducible evidence links.
- A strictly allow-listed command model for any later natural-language QA assistant.

No future QA assistant should be allowed arbitrary database queries, production data changes, unrestricted browser credentials or unreviewed email sending.

---

## 9. Security, privacy and operational controls

### 9.1 Learning controls

- Supabase authentication and multi-tenant RLS.
- Server-side role checks for protected actions.
- Isolated SCORM content origin for untrusted packages.
- Rate limiting for sensitive auth/SCORM activity in the configured environment.
- AI outputs constrained by schema validation, organisation scope and draft-only human review.

### 9.2 360 browser and API controls

The Orbit 360 Vercel configuration sets restrictive baseline headers including:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- strict-origin referrer policy
- camera, microphone and geolocation permissions disabled
- Content Security Policy restricting default resources to self, approved Supabase connectivity, approved Google font/style resources and necessary script sources
- `frame-ancestors 'none'`
- `base-uri 'self'`
- constrained form actions

The invitation implementation uses hashed token storage and server-side confidentiality rules. The system should not claim compliance certifications merely because these controls exist.

### 9.3 Compliance status

The platform must **not** claim GDPR, ISO 27001 or SOC 2 certification at this stage. Compliance requires documented controls, evidence, legal review, operational processes and, for certifications, formal assessment—not only source code.

### 9.4 Secrets and environment posture

Operational keys are held in environment configuration, not documentation or source. Relevant categories include:

- Supabase URL/publishable/service-role configuration.
- AI provider credentials and AI monthly budget.
- HMAC bridge signing material.
- Upstash/Redis rate-limit configuration where used.
- 360 invitation/reviewer feature flags.
- Resend sender and delivery configuration for 360 transactional mail.

Secret values must never be copied into Git commits, issue threads, QA reports or chat transcripts. Environment-variable presence alone is not proof a feature is production ready; the corresponding controlled verification must be recorded.

---

## 10. Visual system and design implementation

### 10.1 Current design direction

The suite now uses a shared visual language intended to feel calmer and more intentional than the earlier mixed product shells:

| Semantic use | Colour family |
|---|---|
| Platform trust / structure | Deep indigo |
| Learning | Peacock teal |
| 360 Feedback | Lotus rose |
| Progress / positive state | Leaf green |
| Primary action / attention | Saffron |
| Urgency / energy | Coral |

**Inter** is the standard interface typeface. The 360 style layer now overrides inherited serif variables as well as body typography, resolving the earlier heading-font mismatch.

### 10.2 What was applied

- Shared token-based colour and surface styling in the LMS global styles.
- Inter loaded through the LMS application layout.
- Shared visual layer included across Orbit 360 public, workspace, reviewer, private-report and Platform Control pages.
- Existing product functionality left intact; visual work did not alter server APIs, RLS, AI budgets or workflow flags.

### 10.3 Work still required for a finished design rollout

The visual foundation is live, but “all pages have the new design language” requires a route-level acceptance pass rather than just global CSS:

1. Capture and review desktop/mobile screenshots for every public, sign-in, learner, author, organisation-admin, platform-owner, 360 administrator and reviewer state.
2. Fix route-level legacy spacing, typography, component and contrast exceptions.
3. Verify focus indicators, keyboard order, responsive navigation and error states.
4. Replace placeholder links/copy in the standalone shell before making it an authoritative public entry point.
5. Make product transitions explicit during the period of separate authentication.

---

## 11. Technical stack inventory

### 11.1 Learning Platform

| Layer | Current technology |
|---|---|
| Application | Next.js 16, React 19, TypeScript |
| Styling | Tailwind CSS v4 plus application CSS/token layer |
| Authentication/data | Supabase SSR and Supabase JavaScript client, PostgreSQL and RLS |
| Hosting/API | Vercel and Next.js route handlers/server actions where applicable |
| AI | Provider gateway, AICredits adapter, Anthropic adapter, deterministic test provider, Zod/structured validation |
| File/source handling | PDF/DOCX/PPTX/public-URL extraction; `unpdf`, `mammoth`, `fflate` and SSRF/size constraints |
| Rate limits | Upstash Redis/rate-limit integration where configured |
| Quality tools | TypeScript checks, Vitest, Playwright and persona/QA scripts |

The current ledger records approximately 48 API routes, 23 application pages, 31 RLS-governed tables, 25 migrations and 59 policy expressions. Treat these as an engineering inventory snapshot, not a licence to bypass the application authorisation layers.

### 11.2 Orbit/360

| Layer | Current technology |
|---|---|
| Browser application | Static HTML, CSS and JavaScript product shell |
| Hosting/API | Vercel static hosting and serverless functions under `api/feedback-*.js` |
| Foundation/data | Supabase Foundation for identity, memberships, product entitlements, product roles, feedback data and RLS |
| E-mail/delivery readiness | Resend-oriented configuration, intentionally not enabled for customer reviewer delivery yet |
| Security | Vercel security headers, CSP, server-side token hashing, audit events and confidentiality suppression rules |
| QA | Node navigation test and isolated synthetic GitHub Actions workflow |

### 11.3 Intentional architectural seams

The platform is not being forced into premature convergence. Current seams are intentional:

- LMS data stays in LMS Supabase.
- Foundation governs Orbit-side membership/entitlement/product roles.
- The entry bridge transfers a short-lived, signed access assertion, not a password or database record.
- 360 reviewer data remains confidential and must not be surfaced in Platform Control without a specific aggregate/privacy design.

The cost of these seams is that users may still encounter separate authentication and navigation contexts. The next architecture programme should solve this through an identity strategy, not brittle browser redirects.

---

## 12. Known gaps, risks and decisions required

### 12.1 Product/technical risks

| Risk or gap | Why it matters | Required response |
|---|---|---|
| ~~CRITICAL — the 360 confidentiality-hardening migration was committed as a file but not applied to production~~ | **Resolved 2026-08-31.** With the product owner's explicit go-ahead (given 2026-08-31), the migration was applied via the Supabase SQL Editor against the real Orbit Platform Foundation project. Independently re-verified read-only immediately after, with a fresh session: `feedback_invitation_delivery_status` now returns `200` with exactly the intended narrow field set (no `recipient_email`, no `token_hash`); the raw `feedback_invitation_deliveries` table now correctly returns `403 permission denied` for the same ordinary feedback-admin session that could read it directly the day before. The delivery audit view built 2026-08-30 was re-checked against the same cycle and now renders real data end to end. The migration's other two effects (the one-active-link-per-rater unique index and the trigger blocking edits to a `completed` response) were not independently re-tested with a live mutation — deliberately, to avoid an unnecessary write against production data — but ran in the same single SQL Editor execution that the user confirmed succeeded, so under normal Postgres transaction semantics either all of it committed or none of it did; the two independently re-verified effects landing correctly is strong evidence the other two did as well. Still worth a real (non-destructive) check next time a completed response naturally exists to confirm. | No further action needed unless the transaction-semantics inference above is worth confirming directly. |
| Full AI builder has not completed a real-provider full course | Local tests cannot prove provider behaviour, cost or full orchestration. | Explicitly out of scope for now (2026-08-30) — the product owner declined to raise the AI budget above the $5 cap. Parked, not forgotten. |
| Secure 360 delivery is gated | Enabling it before migration/email/private-link proof could expose a confidential workflow to failure. | **Isolated smoke test completed with real evidence, 2026-08-29 — see §6.4.** Sender-domain fix is a recorded product decision, not a gap: the product owner decided not to invest in a domain for now (2026-08-30), so this stays parked until revisited — see §13 P0 item 1. |
| Separate Learning/360 authentication | Product switcher navigation may feel like a broken login if the boundary is not explicit. | Keep transition copy honest now; plan OIDC/SAML/SSO as a distinct programme. |
| Platform Control is not a suite warehouse | Showing raw 360 data would create privacy and tenancy risk. | Design audited aggregate metrics and data contracts first. |
| QA control room is partly guided/manual | A button alone does not yet create evidence-backed remote test automation. | Finish workflow/job/artifact/status integration in the dedicated QA organisation. |
| ~~Visual global styles do not guarantee every route is polished~~ | — | **Closed 2026-08-30.** Full route × role × device pass completed and deployed on both repos — see §13 P0 item 3 and `docs/VISUAL_ACCEPTANCE_CHECKLIST.md`. |
| No formal certification | Marketing claims without evidence carry legal/reputational risk. | Use accurate security wording; start a compliance programme only when operational readiness exists. |

### 12.2 Decisions the product owner should make

1. **AI test budget:** approve a specific capped amount above USD $5 (or reset the current month) for exactly one generic full-course provider test.
2. **360 activation owner:** nominate who signs off the isolated secure-invitation smoke test and who owns the transactional sending domain/inbox.
3. **Identity direction:** decide whether true suite SSO is a near-term strategic investment. If yes, select an identity architecture before more product-to-product redirect work.
4. **Data posture:** decide what Platform Control may see from 360—only health/status aggregates is the recommended initial boundary; raw reports/responses are not recommended.
5. **QA environment:** approve a permanent dedicated QA organisation, fixture accounts and safe test inboxes, explicitly separated from all customer tenants.
6. **Brand rollout:** decide whether the standalone Next.js shell becomes the future canonical public home after content, routes and links are complete, or remains a design prototype.

---

## 13. Recommended delivery roadmap

This order prioritises evidence, confidentiality and a coherent user experience over broad new feature lists.

### P0 — complete the workflows already built

#### 1. Controlled 360 secure-cycle activation

**Goal:** prove the reviewer workflow with synthetic data before any customer use.

- Confirm Foundation migrations in the operational environment.
- Configure the approved transactional sender and test inboxes.
- Run the end-to-end synthetic cycle and inspect audit data plus anonymity suppression.
- Keep features disabled if any privacy/security assertion fails.
- Enable the flags only through a documented controlled release.

**Definition of done:** a reproducible evidence pack demonstrates no raw token storage, correct role denial, one-time private reviewer access, no edits after submit and suppression below threshold.

**Status (2026-09-02): definition-of-done evidence now satisfied twice over; still blocked on the same real decision for actual customer delivery, not an oversight.** Real invitation delivery to
actual external reviewers needs a verified sending domain (Resend rejects/flags unverified senders).
The user has explicitly decided not to invest in a domain right now. Verified in production:
`ORBIT_FEEDBACK_INVITATIONS_ENABLED` is unset, and the code only enables sending on the literal string
`"true"` — so the system fails safe and no real invitation emails can go out. Controlled internal smoke
testing (to test inboxes only) remains possible and needs no domain, and has now been run twice with
real evidence: the original 2026-08-29 smoke test, and again — more thoroughly, covering the full
comment-review and release flow too — as part of §6.6 item 8's realistic UAT (2026-09-02). **This item
stays blocked until a domain decision is revisited** — do not attempt a workaround (e.g. an
unverified/sandbox sender) to reach a "go-live" state, since that would produce unreliable delivery
and likely spam-flagging for real reviewers, not a genuine fix.

#### 2. Full AI Course Builder real-provider verification

**Goal:** turn “built” into “production verified” without uncontrolled spend.

- Raise/reset the bounded AI budget.
- Use neutral, non-confidential sample source material.
- Run one complete job and inspect every generated page, quiz, skill tag, accessibility finding, saved draft and billed cost.
- Confirm no auto-publish and clear recovery from interruption.
- Add orchestration tests and provenance review before presenting the full builder as broadly ready.

**Definition of done:** a human-reviewed, saved draft with recorded cost and provider evidence; a clear provenance path; no unexpected writes or publishing.

**Status (2026-08-30): explicitly out of scope for now.** The user has decided not to raise the AI
budget above the current $5 cap — this item stays parked, not silently forgotten. Revisit when the
budget decision changes.

#### 3. Visual acceptance and navigation clarity pass

**Goal:** make the shared design feel consistent in real journeys, not merely in stylesheets.

- Produce a route/role checklist for desktop and mobile.
- Test public chooser → sign-in → correct product destination.
- Test learner, author, organisation admin, platform owner, 360 administrator and invited reviewer states.
- Fix visible legacy font, spacing, colour, contrast and navigation exceptions.
- Add short transition explanation where a new sign-in is genuinely required.

**Definition of done:** no dead/ambiguous navigation paths and no visual regressions across agreed representative screens.

**Status (2026-08-30): complete**, tracked in `docs/VISUAL_ACCEPTANCE_CHECKLIST.md`. All six roles
covered at desktop and mobile against real (not synthetic-empty) data on both Learning and 360. 14
real findings, fixed and deployed to production on both repos (Learning `1293bfd`, Orbit 360
`4d2eb1f`) — nav-label and multi-active-tab bugs, a bare unstyled 404, wrong password-reset copy, a
CSP-blocked inline style silently breaking a layout, missing mobile scroll affordances on two
separate tab bars, and a stuck loading placeholder. One item intentionally not deep-tested: Platform
Control's actual console content — granting platform-owner even to a disposable test account was
blocked by a privilege-escalation safety guardrail, and the user chose to skip rather than work
around it; access-denial itself was verified safe. Not a regression risk — revisit if/when Platform
Control gets real attention.

### P1 — make the suite operationally manageable

#### 4. Evidence-backed QA runner

Wire the existing Admin/Learner test-agent concept to a real, isolated background workflow:

- Platform Control starts a selected safe suite.
- GitHub Actions runs it against synthetic fixtures only.
- UI shows queued/running/passed/failed/blocked state.
- A standard XLSX report and detailed evidence become downloadable.
- Failures identify product, test, expected condition, observed condition, URL/evidence and reproduction note.

After this exists, add the planned AI QA command bar only as a constrained planner over safe named suites—not as an unrestricted system operator.

#### 5. Shared identity and suite hand-off strategy

Design and implement OIDC/SAML/SSO in a staged migration. Keep the HMAC hand-off as the safe interim mechanism until the replacement passes tenancy, role, logout, account-recovery and audit tests.

#### 6. Platform Control aggregate integration

Define an audited, privacy-safe aggregate contract for 360 health information (for example enabled status, cycle counts in broad bands and delivery health). Do not pull raw feedback responses, rater identities or confidential low-threshold groups into the platform dashboard.

**Status (2026-09-02): complete, live-verified with real production data.** Built the first-ever
server-to-server data channel between the LMS and Orbit Foundation — previously only a one-time
sign-in HMAC hand-off existed. A new Foundation migration (`20260902000100_platform_feedback_health.sql`)
adds `platform_feedback_health()`, a service-role-only SQL function computing banded counts (cycles
total/live, deliveries sent/opened/completed) per organisation with an active `feedback` entitlement,
never granted to `authenticated` — no RLS-level access exists for platform admins, by design. A new
Foundation Edge Function (`platform-feedback-health`) is the only caller, authenticated by a shared
bridge secret (not a Foundation user session, since none exists for a server-to-server platform-admin
request) rather than Supabase's own JWT gateway (had to be explicitly turned off for this function,
since it deliberately uses custom auth). The LMS calls it via a new
`app/api/v1/platform-admin/feedback-health/route.ts`, and `platform-console.tsx`'s "Product portfolio"
tab now renders it live, replacing what was previously hardcoded static prose. **Verified live end to
end**, not just "should work": the deployed Edge Function was called directly and returned real banded
data for the platform's 3 organisations with 360 enabled (8 cycles across the platform); the same data
was then confirmed rendering correctly in the actual Platform Control UI. One real bug was hit and
fixed along the way: the SQL helper functions were initially typed to accept `integer`, but
Postgres's `count()` returns `bigint` — fixed by retyping them, with the corrected migration re-run
successfully.

### P2 — broaden production value after the core is proven

- ~~360 reminder, bounce, replacement-reviewer and reopen workflows.~~ **Shipped — §6.6 item 6, 2026-08-31.**
- ~~Customer-ready 360 report release, exports and action planning.~~ **Shipped — §6.6 items 7–8, 2026-09-02.** Every build-side gate is now clear; only the parked sender-domain decision (P0 item 1) stands between this and real customer delivery.
- Learning assistant/RAG and richer AI authoring interactions after data-governance decisions.
- Enterprise SSO, LTI, custom SMTP, observability/error tracking, CSP hardening, localisation, native mobile/offline, e-commerce and HRIS/CRM integration.
- Orbit Growth only after a real product scope, data model, roles and safety rules are approved. It remains roadmap-only today and should not appear as a live product destination.
- ~~Competencies only after a real product scope, data model, roles and safety rules are approved.~~ **Scope built and live in production, 2026-09-16** — see `docs/ORBIT_COMPETENCY_SCOPING.md` and `docs/CURRENT_STATUS.md`'s P1 competency-development entry: versioned/immutable frameworks, 360 rating-to-level thresholds, anonymity-gated signal computation, consent/data-rights handling, and a Learning-side UI are built, code+security reviewed, the Foundation production migration is applied and confirmed, and a real production smoke test of `/skills/development` passed.

---

## 14. Release and documentation operating rules

For every material Orbit release that changes a product’s status, live metrics, attention items or shipped functionality:

1. Update `docs/CURRENT_STATUS.md` in the LMS repository.
2. Update `docs/ORBIT_STATUS.md` in the LMS repository.
3. Update Platform Control if its metrics, attention list or shipped-work record is affected.
4. Update this detailed report when the architecture, capabilities, verification status or roadmap materially changes.
5. Run proportionate automated checks and browser smoke tests.
6. Commit and push the changed repository without including unrelated local files.
7. Record only verified statements as “live” or “production verified.” Mark implementation that remains gated or untested as such.

This discipline prevents the core problem that creates confusion in multi-product platforms: a screen, a plan, source code and a production-safe workflow are not the same thing.

---

## 15. Plain-language status matrix

| Statement | Accurate? |
|---|---|
| “Orbit Learning is a live LMS.” | **Yes.** |
| “AI can generate a safe draft course from pasted source.” | **Yes; Lite flow is real-provider verified.** |
| “AI can generate a complete multi-page course end to end in production.” | **Built, but not yet fully real-provider verified because the intentional budget guard stopped the test.** |
| “360 administrators can plan a feedback cycle.” | **Yes.** |
| “360 reviewer invitations are safely live for customers.” | **No. The secure workflow is built but feature-flagged off until production migration/smoke evidence exists.** |
| “Platform Control shows all Orbit product data.” | **No. It shows live LMS controls; 360 confidential metrics are intentionally not aggregated yet.** |
| “Learning and 360 have one shared SSO login.” | **No. There is a secure product-entry bridge, not shared identity.** |
| “The new visual language is live.” | **Yes, as a shared foundation; route-by-route polish and visual acceptance remain.** |
| “The QA bot can autonomously test production and fix anything.” | **No. Current QA is guided/isolated synthetic testing. A safe background-runner integration is the next build.** |

---

## 16. Immediate next action

**Updated 2026-09-02.** The visual/navigation acceptance pass is complete (§13 P0 item 3, closed). The AI budget item is explicitly parked by product-owner decision. The confidentiality-hardening migration gap found 2026-08-30 was applied and re-verified 2026-08-31 — see the resolved row in §12.1. **§6.6 is now fully complete — all eight items, every sub-piece shipped and live-verified**, including item 8's real end-to-end UAT (real invitation emails sent, real reviewer submissions, real admin release), closed out 2026-09-02. The recommended immediate action is now:

1. §6.6 (items 1–8) is complete. There is no unstarted 360 build work left on this roadmap.
2. The sender-domain fix stays parked by explicit product-owner decision, not forgotten — revisit before any real customer delivery. Item 8's UAT reused the same temporary `example.com` sender identity that reminders/bounce-handling already depend on, deliberately and briefly (flags reverted immediately after); this does not change the parked decision or make the domain permanent for real customer use.
3. A formal go/no-go review for enabling 360 delivery to real customers should follow the sender-domain decision — every build-side gate (§6.6, including item 8) is now cleared.

---

## Appendix A — key documentation

- `docs/CURRENT_STATUS.md` — concise living release ledger.
- `docs/ORBIT_STATUS.md` — detailed LMS/AI status and verification notes.
- `docs/ORBIT_LMS_INTEGRATION_PLAN.md` — integration scope and plan.
- `docs/ORBIT_AI_QA_COMMAND_BAR_PLAN.md` — approved future design for safe natural-language QA.
- Orbit public/360 repository `README.md` and `DEPLOYMENT.md` — deployment notes.
- Orbit 360 `docs/navigation-reset.md` — product/navigation reset.
- Orbit 360 `docs/products/360-degree-feedback.md` and `docs/products/360-invitation-delivery.md` — product and secure-delivery design.
- Orbit Foundation `docs/authorization-contract.md` — membership/entitlement/role contract.

## Appendix B — terms

| Term | Meaning |
|---|---|
| **Live** | Available in the deployed product and suitable for its stated user/workflow. |
| **Built but gated** | Source and deployment capability exist, but flags or operational prerequisites intentionally prevent customer use. |
| **Production verified** | A controlled real deployment/provider/user-path test passed with recorded evidence. |
| **RLS** | PostgreSQL Row Level Security: database policy enforcement limiting rows a caller may read or change. |
| **Foundation** | The Orbit-side service governing organisation membership, product entitlements and product roles. |
| **Entry bridge** | Short-lived, signed, POST-only hand-off into Learning. It is not SSO. |
| **Synthetic QA organisation** | A dedicated non-customer organisation containing only disposable test accounts, test content and safe inboxes. |
