# Development Sequence — Phase 3

**Deliverable H.** Implementation milestones for the AI-Native Authoring Engine, in the same discipline as Phases 1–2: small dependency-ordered steps, each verified against real infrastructure before the next begins, gated by a Definition of Done.

**Status: approved 2026-08-16; all 11 steps built as of 2026-08-27.** Steps **1–7 and 9–11 are done**;
step 8 (AI generation pipeline) shipped 2026-08-27 as "Full AI Course Builder," built but with its own
real-provider run interrupted by the org's AI budget before completing — see step 8 below and
[DEFINITION_OF_DONE_PHASE3.md](DEFINITION_OF_DONE_PHASE3.md) for the precise, current line between "built"
and "production-verified." See also [JOB_EXECUTION_SPIKE_RESULTS.md](JOB_EXECUTION_SPIKE_RESULTS.md), [`lib/spec/`](../lib/spec/README.md), [`spikes/export-conformance/README.md`](../spikes/export-conformance/README.md), [PHASE3_DATA_MODEL.md](PHASE3_DATA_MODEL.md), [`lib/runtime/`](../lib/runtime/engine.ts), [`lib/authoring/`](../lib/authoring/json-patch.ts), [`lib/ai/`](../lib/ai/gateway.ts), and [`lib/publishing/`](../lib/publishing/build.ts).

**The authoring loop is closed as of step 6**: a course can be authored, previewed, published and played entirely in-product. **Step 9 closes the distribution loop**: that course now also packages into SCORM 2004 or cmi5 for delivery in someone else's LMS.

**Step 10 landed 2026-08-21**, after the E2E suite was made a dependable regression gate — deliberately in that order, since a gate that blocks publishing deserves a test suite whose green runs mean something.

**Step 8 was deferred by decision on 2026-08-21, then built anyway on 2026-08-27** once the commercial-path reasoning that deferred it no longer applied — see `CURRENT_STATUS.md`'s "Full AI Course Builder" record for what shipped and its one still-open gap (a budget-interrupted real-provider run). The step-12 review has been kept current against real state rather than held until everything passes: see [DEFINITION_OF_DONE_PHASE3.md](DEFINITION_OF_DONE_PHASE3.md).

## Why this order

Phase 2's ordering principle — *de-risk the genuine unknowns first, before anything is built on top of them* — applies with more force here, because Phase 3 has **three** unknowns rather than two, and two of them are infrastructural rather than feature-level:

1. **Durable job execution on Cloudflare** — multi-step AI generation cannot run in a request. If Workers/Queues/Workflows cannot carry it, that changes the architecture, not just a feature.
2. **The specification schema itself** — every subsequent step reads and writes it. Getting it wrong late is the most expensive possible mistake in this phase.
3. **SCORM/cmi5 *export* conformance in a third-party LMS** — we proved SCORM *ingest* in Phase 2; export is a different problem and only counts if a real external LMS runs the package.

Steps 1–3 exist to answer those before the editor is built.

## Sequence

1. ~~**Job-execution spike — de-risk before anything depends on it.**~~ **Done, 2026-08-16.** Prove durable, multi-step, long-running execution on Cloudflare (Queues vs. Workflows vs. Durable Objects), including retry, cancellation, per-step status, and a run exceeding a single request's limits. Deliverable: a working spike plus a written verdict, in the shape of [CLOUDFLARE_VALIDATION_RESULTS.md](CLOUDFLARE_VALIDATION_RESULTS.md). **If this fails, the phase plan changes before code is written, not after.**

   **Outcome: Cloudflare Workflows, in a separate `jobs` worker bound to the Next.js worker via `script_name`.** All 14 claims proven on the real engine, including a 244-second run across two hibernations. The plan did not change. Full verdict: [JOB_EXECUTION_SPIKE_RESULTS.md](JOB_EXECUTION_SPIKE_RESULTS.md); evidence: [`spikes/job-execution/`](../spikes/job-execution/).

2. ~~**Course specification schema v1 + validator.**~~ **Done, 2026-08-17.** The JSON Schema, the validator, and `spec_validation_reports`. No UI, no AI — just the contract and its enforcement, with fixture specs (valid, invalid, edge cases) as tests. Everything downstream depends on this being right, so it is built and reviewed on its own.

   **Amended 2026-08-16 (scope change — see [MASTER_FEATURE_MATRIX.md](MASTER_FEATURE_MATRIX.md) reconciliation note 4).** The schema must additionally carry a **layout model** able to express absolute positioning and a **timeline model** able to express animation, from v1 — with responsive flow as the default and no Phase 3 editor surface producing either. This is schema accommodation only; the canvas and timeline *editors* are 3B. The reason it cannot wait: adding either to the spec after step 5 and step 6 exist means a spec migration plus a rewrite of the interpreter and the editor, which is precisely the risk this "schema first" ordering exists to avoid.

   **Outcome.** Built at [`lib/spec/`](../lib/spec/) as Zod schemas — a single source of truth for TypeScript types, whole-document JSON Schema, and narrow per-generation-step schemas, rather than maintaining hand-written JSON Schema alongside types where the two would silently drift. **ajv was rejected**: it compiles schemas to JavaScript via `new Function`, which Cloudflare Workers block; Zod validates without codegen. The block set (24 types) is closed and depth-bounded by construction — layers hold leaf blocks that cannot themselves carry layers — keeping the JSON Schema non-recursive, which several providers' structured-output modes handle poorly. Every object is `z.strictObject`, matching the published `additionalProperties: false`, so a hallucinated field is a validation error rather than a silently-dropped key. The layout and timeline models are in from v1 and exercised end to end by a canvas+motion-path fixture, though no Phase 3 editor produces one. Semantic validation (referential integrity — trigger targets, variable references, sub-element addressing, canvas/flow layout rules) runs as a second pass beyond JSON Schema, producing path-addressed findings in the shape `spec_validation_reports.findings` will store once that table exists in step 4. 38 tests, all green; Phase 1/2's 24 data-layer tests still pass alongside them. Full detail: [`lib/spec/README.md`](../lib/spec/README.md).

3. ~~**Export conformance spike.**~~ **Done, 2026-08-20.** Take a hand-written fixture spec, build a SCORM 2004 package and a cmi5 package, and **run both in a real third-party LMS**, confirming completion and score report back. Uses no editor and no AI. This is deliberately early: discovering an export blocker after building the authoring engine would be the Phase 3 equivalent of discovering SCORM didn't work in Phase 2 week eight.

   **Partially done, 2026-08-20 — the automatable half only.** A real `CourseSpec` fixture (imported from `lib/spec`, not invented) validates against the schema with zero errors, renders through a spike-scoped renderer into identical content, and packages via two new reusable modules — [`lib/export/scorm2004.ts`](../lib/export/scorm2004.ts) (SCORM 2004 3rd Edition manifest + a real `Initialize`/`SetValue`/`Commit`/`Terminate` RTE adapter) and [`lib/export/cmi5.ts`](../lib/export/cmi5.ts) (cmi5 course structure + a real launch/auth/xAPI-statement adapter sending `initialized`/`completed`/`passed`/`failed`/`terminated`). Both packages' structure and adapter code are asserted against the actual built zip contents by [`tests/export/export-conformance.test.ts`](../tests/export/export-conformance.test.ts) (12 tests, green). Score is genuinely computed (5-question quiz, 80% threshold), not hardcoded.

   **Done, confirmed in a real third-party LMS — both formats, 2026-08-20.**

   - **SCORM 2004**: `fire-safety-scorm2004.zip` uploaded to SCORM Cloud, launched, completed. Registration result: Completion `complete`, Success `passed`, Score `100.00%`, learning standard recognised as `SCORM 2004 3rd Ed.`
   - **cmi5**: `fire-safety-cmi5.zip` uploaded to SCORM Cloud, launched, completed. Registration result: Completion `complete`, Success `passed`, Score `80.00%`, learning standard recognised as `cmi5`.

   Getting cmi5 to a real pass took six real, server-confirmed fixes in sequence, each one driven by an exact error message from SCORM Cloud (not guessed) and cross-checked against the actual cmi5 spec / AICC reference examples where the error text alone wasn't enough to be sure:
   1. The `fetch` launch parameter must be called via **POST**, not GET.
   2. `context.extensions` sessionid must be the LMS's own session (from the `fetch` URL's `session` query param), not a self-generated one.
   3. `context.contextActivities.grouping` must include the parent **course**.
   4. `context.contextActivities.grouping` must *also* include the AU's own **Publisher Activity** id (its `cmi5.xml`-authored id — distinct from the LMS-generated `activityId` used as the statement's `object.id`).
   5. The AU must `GET` the `cmi5LearnerPreferences` document from the xAPI **Agent Profile API** before sending `Initialized` (a 404 is the normal, expected case for a new learner).
   6. Statements whose `result` carries `success`/`completion` (Completed, Passed, Failed) need a second **`moveon`** category alongside the base cmi5 category; and the Passed/Failed statement's `result` must **not** include `completion` — only the separate Completed statement does.

   `lib/export/cmi5.ts` carries all six as inline comments at the line each one fixes, each with a one-line note of what broke and what confirmed the fix, so the reasoning isn't lost to git history alone. The built `cmi5.js` also ships an on-page debug panel that logs every network call and its real HTTP response — added mid-debugging because a real LMS launch has no open browser console, and it's what made rounds 3–6 possible to diagnose from screenshots alone.

4. ~~**Data model + tenancy.**~~ **Done, 2026-08-20.** The migrations from [PHASE3_DATA_MODEL.md](PHASE3_DATA_MODEL.md), each with `org_id` and four-policy RLS in the same migration, and each with its tenant-isolation tests added in the same step. Includes the two additive alterations to `learning_objects` and `content_versions`.

   **Outcome.** 10 migrations, applied cleanly against a real local Postgres instance (`npx supabase db reset`, exit code 0, no SQL errors across all 21 migrations old and new): the 9 new tables (`skill_tags`, `course_specifications`, `component_definitions`, `course_templates`, `authoring_jobs`, `spec_validation_reports`, `course_runtime_state`, `published_packages`, `xapi_statements`), the `learning_objects` source discriminator, the `content_versions` entity-type widening, and the new private `published-packages` storage bucket. Every table follows the Phase 1/2 standard tenant pattern and centralized RLS helpers (`current_org_id()`, `has_role()`, `is_platform_admin()`) — no hand-copied subqueries. One spec deviation found and written back: `spec_validation_reports.kind` widened to 4 values (adding `semantic`) to match `lib/spec/findings.ts`'s already-shipped `FindingKind` type, since `validate.ts` produces both schema and semantic findings from one call. `course_specifications.generated_by_job_id` resolves a forward reference to `authoring_jobs` (created later in the same step) via a deferred `ALTER TABLE ADD CONSTRAINT` once that table exists — no interim nullable-without-FK window left unclosed. 17 new tenant-isolation tests added to the same shared suite ([`tests/tenant-isolation.test.ts`](../tests/tenant-isolation.test.ts)), including the two the spec flagged as easy to overlook: `xapi_statements` cross-org denial plus a genuine role-gate test (learner denied, promoted to manager, sees the row, reverted), and `published_packages` proving tenant roles cannot write rows directly (service-role-only, mirroring `content_versions`). Full suite: 41/41 passing against the live migrated database; `tsc --noEmit` and lint both clean; the `content_versions_entity_type_check` constraint independently confirmed via `pg_constraint`.

5. ~~**Runtime interpreter + native player.**~~ **Done, 2026-08-20.** The pure `(spec, state) → view` interpreter, the block renderers, and the state machine for variables/states/triggers/layers. Rendered in-app, with `course_runtime_state` resume and xAPI emission. Built **before** the editor so the editor's preview is the real player, not a second implementation that drifts.

   **Outcome.** [`lib/runtime/engine.ts`](../lib/runtime/engine.ts) is `(spec, state, event) → (state, effects)` — synchronous, side-effect free, no fetch/storage/React. Triggers stay *data it reads*, never code it runs, so the closed declarative set in `lib/spec/interactions.ts` remains the structural security boundary rather than a convention. Interpreted from the spec: all comparison operators and flat AND/OR/NONE conditions, every `Action` variant, block/layer visibility, block states, page navigation (including `next`/`previous`/`firstPage`/`exit`), quiz scoring across all five `AssessmentItem` kinds, and all four `CourseCompletion` rules. A depth guard bounds pathological `pageEnter`→`navigate` cycles. Renderers for all 24 leaf block types live in [`components/runtime/block-renderers.tsx`](../components/runtime/block-renderers.tsx), presentational only — every interaction decision belongs to the engine.

   Resume persists via `course_runtime_state`, keyed on the specification's **current** version rather than one the client asserts, so a republish starts a fresh state row instead of feeding a learner state addressed against a structure that no longer matches. The interpreter's richer in-memory model folds into the two `jsonb` columns step 4 already shipped (`toPersisted`/`fromPersisted`) rather than driving a schema change for what the database treats as opaque. xAPI statements follow the verb table in [PHASE3_API_EVENTS.md](PHASE3_API_EVENTS.md) §7.2, with `actor` **always** stamped server-side from the authenticated session — a client-supplied actor is ignored outright, proven by its own e2e test.

   Phase 1/2 is untouched: the existing player gains a third branch for `source = 'authored'` beside its unchanged SCORM and asset paths, and course completion flows back through the *existing* `progress` rollup rather than a parallel one. 33 new tests (18 interpreter, 15 renderer) bring the Vitest suite to 133/133 green; `tsc --noEmit` and lint both clean. Verified in a real browser against a real database — spec-driven rendering, 100% quiz scoring, resume-after-reload landing back mid-course, completion, and the full `initialized`/`progressed`/`answered`/`completed`/`passed` statement chain confirmed by direct SQL against `xapi_statements` and `course_runtime_state`.

6. ~~**Visual authoring engine.**~~ **Done, 2026-08-21.** Block editing, drag/reorder, component insertion, templates, and the interaction editor (states, variables, triggers, layers, timeline cue points). Operates on the spec via JSON-Patch with optimistic concurrency. Preview reuses step 5's interpreter.

   **Outcome.** The loop the phase exists for now closes: an author builds an interactive course in a browser and the runtime plays exactly what they built, end to end, proven in a real browser against a real database.

   Edits travel as JSON-Patch operations ([`lib/authoring/json-patch.ts`](../lib/authoring/json-patch.ts) — a deliberate `add`/`remove`/`replace`/`move` subset, since those four are exactly what a block editor produces) rather than whole-document saves. The server applies them with optimistic concurrency keyed on `updated_at`, so two authors working from the same revision cannot silently overwrite one another — the loser gets a 409. **Validation runs before the write, never after**: a change that would invalidate the specification is refused with the findings that blocked it, so the table can never hold a document the runtime would later refuse to play.

   Preview mounts the *real* step 5 interpreter against the draft. A second rendering path built for the editor would drift from what learners get, and the drift would only ever surface after publish.

   The editor covers the closed block set end to end — property editors for all 24 types, drag-and-drop reorder with keyboard-reachable equivalents, layers, timeline cue points, and variables/triggers/conditions where every target is picked from what the document actually contains, making a dangling reference hard to author rather than merely reported afterwards. Media and saved blocks insert through pickers because both need a choice made before the block is valid at all. 11 API routes per [PHASE3_API_EVENTS.md](PHASE3_API_EVENTS.md) §1–§2; publishing reuses `lib/content/publish.ts`'s state machine and snapshot mechanic unchanged, with a validation gate added on the way to `published`.

   **Three schema gaps surfaced and were fixed**, each found by building the first caller that needed it: `content_reviews.content_type` never learned the Phase 3 entity types (so a spec publish would have passed the snapshot write and failed on the audit insert); `content_assets.type` had no `image` value at all, though four Phase 3 block types require an image asset; and the runtime player fetched specs without the preview flag, so an author previewing a draft got a 403.

   7 end-to-end tests (editor flow, concurrency, publish gating, tenancy, component and template libraries) and 68 unit tests over the patch engine and block factory. Suite totals: 201 unit, 35 e2e.

   **Deferred to 3B, per [AUTHORING_CAPABILITY_CHECKLIST.md](AUTHORING_CAPABILITY_CHECKLIST.md) §2:** the timeline editor covers cue-point sequencing only — frame-accurate animation authoring and the free-form canvas surface remain 3B, though the spec has carried both models since v1.

7. ~~**AI gateway.**~~ **Done, 2026-08-21, with one specific sub-item still open.** Provider adapters, workload profiles, structured-output generation with schema validation and bounded repair, fallback chains, usage/cost logging, rate limits and budgets; no feature code names a model. **Not yet met**: "proven against at least two providers switched by configuration alone" — only AICredits has been called for real (2026-08-27, via step 8's Lite builder); the direct-Anthropic adapter is written but unexercised, no `ANTHROPIC_API_KEY` configured anywhere. This is the one item [DEFINITION_OF_DONE_PHASE3.md](DEFINITION_OF_DONE_PHASE3.md) still tracks as genuinely open.

8. ~~**AI generation pipeline.**~~ **Built 2026-08-27 as "Full AI Course Builder"** (deferred on 2026-08-21, then built once that deferral's own reasoning stopped applying — see `CURRENT_STATUS.md`). Source ingest (PDF/DOCX/PPT/URL/prompt) → the multi-step pipeline from [PHASE3_AI_ARCHITECTURE.md](PHASE3_AI_ARCHITECTURE.md) §5 → a validated draft spec. **Not yet production-verified**: its one real-provider run exercised the recovery flow but stopped at the org's $5 monthly AI budget before saving a full draft — no course from this full pipeline has been published yet. Re-running it needs the budget raised or reset, not a code change.

9. ~~**Publishing pipeline.**~~ **Done, 2026-08-21** (with two carve-outs, below). Package building as a job: SCORM 1.2/2004, xAPI, cmi5, into the new private bucket with signed download. Re-runs step 3's conformance check against *generated* content rather than a fixture.

   **Outcome.** A published course renders, packages, lands in the private `published-packages` bucket under an `org_id/` prefix, and is downloadable only through a short-lived signed URL its own org can obtain. `published_packages` records which **spec version** produced each artifact, so a rebuild is a new row rather than a mutation.

   The renderer was the substantial part. [`lib/export/render.ts`](../lib/export/render.ts) promotes the step-3 spike renderer — which covered three block types because that was all its fixture used — to the whole closed set, because packaging *authored* courses means an author who inserts a flashcard and gets a blank page has been failed silently, in someone else's LMS. Blocks whose behaviour cannot survive a static export render as their content instead: a scenario becomes its readable steps, a sorting activity its answer key. Losing interactivity is honest; losing content is not.

   **Built as a plain async job, not a durable Workflow** — a deliberate departure from step 1's finding. Workflows carry long multi-step AI generation, which is what step 8 needs; packaging is a render, a zip and an upload, and durable orchestration would buy nothing while tying the publishing surface to a host the platform is moving off (hosting decision, 2026-08-21). The work runs in Next's `after()`, so the route returns a job id immediately and the client polls `authoring_jobs`.

   Two guards worth naming: only a **published** spec packages, because exporting a draft puts unreviewed content where our workflow gate no longer reaches; and the spec is **re-validated at build time** rather than trusted from its publish, because a schema version bump since publication would otherwise ship a package built from a spec we can no longer interpret.

   36 renderer tests covering every insertable block, 6 end-to-end tests covering the pipeline, the workflow guard, tenancy and the signed download — including the leak [PHASE3_DATA_MODEL.md](PHASE3_DATA_MODEL.md) §7 flagged as easy to overlook.

   **Carve-outs, both recorded in [DEFINITION_OF_DONE_PHASE3.md](DEFINITION_OF_DONE_PHASE3.md):** SCORM 1.2 and xAPI are named in code as unimplemented rather than silently absent, so requesting one gets an honest answer (AICC removed from the build and roadmap entirely, 2026-09-03 — see [MASTER_FEATURE_MATRIX.md](MASTER_FEATURE_MATRIX.md)); and step 3's conformance check has **not** been re-run against pipeline output in a real third-party LMS — step 3 proved the format by hand, and proving the pipeline's own artifacts needs a manual SCORM Cloud upload.

10. ~~**Accessibility + validation gates.**~~ **Done, 2026-08-21.** Editor affordances (required alt text, contrast checks, reading order), automated runtime checks, keyboard-only traversal tests, and the publish-readiness gate that blocks publishing on accessibility errors.

11. ~~**Skill tagging + search integration.**~~ **Done, 2026-08-21.** `skill_tags`, spec skill annotation in the editor, and authored block text indexed into the existing full-text search.

12. ~~**Phase 3 Definition of Done review.**~~ **Written 2026-08-21, kept current since — see [DEFINITION_OF_DONE_PHASE3.md](DEFINITION_OF_DONE_PHASE3.md). Verdict as of 2026-09-03: functionally complete, two named exceptions.** Recorded early rather than held until everything passes: a DoD written only at the end is a formality, written now it is a worklist. The original 2026-08-21 review found three items moved from "assumed fine" to named and outstanding — the AI gateway had never called a real provider, no pipeline-built package had been through a real LMS, and the e2e suite was not yet a dependable regression gate. Two of those three are now closed (real-LMS conformance, 2026-08-24; the e2e suite, 2026-08-21 itself); the third is narrower but still open — one real provider (AICredits) has been proven, not the two independently-configured providers this Definition of Done calls for. Steps 10 and 11, both done above, were incorrectly still marked "not built" in this review's original verdict line for two weeks — fixed 2026-09-03 as a documentation correction, not new work.

    **Original scope:** `DEFINITION_OF_DONE_PHASE3.md`, reviewed box by box against real evidence, before Phase 4 begins.

## What explicitly does not start until step 12 passes

Phase 4 (Assessment engine, Certification, AI Tutor/RAG) and everything after. Same discipline as Phases 1–2: the authoring engine is the foundation the assessment engine and AI Tutor will build on, and building them on an unproven spec model would repeat the mistake this whole sequencing approach exists to avoid.

## Explicit non-goals for this phase

Restated from [PHASE3_PRODUCT_SPEC.md](PHASE3_PRODUCT_SPEC.md) §5 so they are not quietly absorbed mid-phase: standalone question bank and attempts engine, AI Tutor/RAG, full LRS, skills proficiency computation, real-time multi-author collaboration, translation workflow, mobile/offline, content marketplace.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Durable job execution unavailable/unsuitable on Cloudflare | Step 1 spike, before anything depends on it |
| Spec schema churn after the editor is built | Step 2 first; `spec_schema_version` on every row from day one |
| Export packages fail in real third-party LMSs | Step 3 spike against a real external LMS, repeated in step 9 |
| Scope creep from "Storyline parity" | [AUTHORING_CAPABILITY_CHECKLIST.md](AUTHORING_CAPABILITY_CHECKLIST.md) states ✅/🟡/📅/❌ per capability, including deliberate exclusions |
| AI output quality varies by provider | Golden-set regression whenever a profile's provider/model changes |
| AI cost runaway | Per-org budgets and concurrency caps enforced at the gateway, with `ai_usage_log` correlation by job |
| Editor and player diverge | One interpreter, built in step 5 and reused as the editor's preview in step 6 |
| Large specs degrade editor/runtime performance | Lazy section loading, progressive hydration, batched autosave; snapshot-to-storage escape hatch designed in step 4 |

## Estimated shape

Not calendar estimates — relative sizing, in the manner of the Stage 1 complexity assessment:

| Step | Size |
|---|---|
| 1. Job spike | S–M |
| 2. Spec schema + validator | M |
| 3. Export conformance spike | M |
| 4. Data model | M |
| 5. Runtime interpreter | **XL** |
| 6. Visual authoring engine | **XL** |
| 7. AI gateway | L |
| 8. Generation pipeline | L |
| 9. Publishing pipeline | L |
| 10. Accessibility gates | M |
| 11. Skill tagging + search | S |
| 12. DoD review | S |

Steps 5 and 6 are the bulk of the phase, and they are the two that most reward the schema being settled first.
