# Definition of Done — Phase 3

Phase 3 (AI-Native Authoring Engine: course specification, visual authoring, interactive runtime, AI gateway, SCORM/xAPI/cmi5 publishing) is done when **every** item below is true. Same discipline as [DEFINITION_OF_DONE.md](DEFINITION_OF_DONE.md) and [DEFINITION_OF_DONE_PHASE2.md](DEFINITION_OF_DONE_PHASE2.md): nothing is checked without something concrete to point at, and anything deferred is named with its reason rather than quietly dropped.

**Reviewed 2026-08-21, against a live local instance — not from memory.**

> **Verdict as of 2026-09-03 (updated from the original 2026-08-21 review — the paragraph below is stale and kept only as history, not as the current state): Phase 3 is functionally complete, with two named exceptions.** Steps 1–7, 9, 10 and 11 are complete and verified (10 and 11's own sections below are fully checked off — the original verdict line calling them "not built" was never updated after those steps actually landed, a documentation gap now fixed here, not a claim of new work). Step 8 (the AI generation pipeline) is **built** — source ingest, the multi-step pipeline, and the human-review gate all exist and shipped 2026-08-27 as "Full AI Course Builder" (see `CURRENT_STATUS.md`) — but its one real-provider production run stopped at the org's $5 monthly AI budget before completing, so it is **not yet production-verified end to end**; that specific run has not been re-attempted with a raised budget. The only other open item is the pre-existing one this doc already tracked: the AI gateway has been proven against exactly one real provider (AICredits, via the separate "Lite" builder, verified 2026-08-27), not the two independently-configured providers this Definition of Done calls for — the direct-Anthropic adapter remains unexercised because no `ANTHROPIC_API_KEY` is configured anywhere. Neither open item blocks the agreed commercial path. This review is being recorded now rather than at the end because a Definition of Done that only ever gets written once everything passes is a formality; written early it is a worklist. Every unchecked box below is a real outstanding item, not a caveat.
>
> **Also complete, 2026-09-03, alongside but outside this doc's original 11-step list:** AICC removed from the build and roadmap entirely (a product decision, not a deferral), and real xAPI/Tin Can package **ingest** shipped and verified — including against a genuine independently-authored third-party package (Rustici Software's official Golf Example course), not just a hand-built fixture. Full record in `CURRENT_STATUS.md` and `docs/XAPI_INGEST_ARCHITECTURE.md`.

## Specification — the contract everything else depends on

- [x] `CourseSpec` v1 exists as the single source of truth for TypeScript types, JSON Schema, and per-generation-step schemas (`lib/spec/`), built on Zod so types and schema cannot drift.
- [x] The block set is **closed** (24 types) and depth-bounded by construction — layers hold leaf blocks that cannot themselves carry layers — which keeps the published JSON Schema non-recursive.
- [x] Every object is `z.strictObject`, matching the published `additionalProperties: false`. A hallucinated field is a validation error, not a silently-dropped key.
- [x] **No executable content is expressible.** No script field, no raw HTML, no expression language; rich text is structured spans, and triggers are a closed declarative set. This is structural, not enforced by sanitisation.
- [x] Semantic validation runs as a second pass beyond JSON Schema, producing path-addressed findings — a trigger pointing at a nonexistent block is well-shaped and completely broken, and only the semantic pass catches it.
- [x] The layout and timeline models are carried from v1 even though no Phase 3 editor surface produces a canvas or an animation, so 3B is an editor addition rather than a spec migration plus two rewrites.
- [x] `ajv` was evaluated and rejected with a recorded reason (it compiles schemas via `new Function`, which Workers block).

## Runtime

- [x] The interpreter is pure and synchronous — `(spec, state, event) → (state, effects)` — with no fetch, storage or React inside it (`lib/runtime/engine.ts`).
- [x] Triggers are **data the engine reads**, never code it runs. The switch covers the closed action set and nothing else.
- [x] All 24 block types have renderers.
- [x] Variables, conditions (flat AND/OR/NONE), block states, layers, and all four completion rules are interpreted from the spec.
- [x] Resume works and is **version-scoped**: state is keyed on `(org, user, spec, spec_version)`, so a learner mid-course when an author republishes is never fed state addressed against a structure that no longer matches. Proven in a browser: advance a page, reload, land back mid-course.
- [x] Leaving mid-course does not lose position. Found by the suite, not by a user: an 800ms autosave debounce silently discarded the last edit on navigate-away. Fixed with a `pagehide`/`visibilitychange`/unmount flush over `sendBeacon`, and covered by a regression test that documents why it only fails on a warm server.
- [x] xAPI statements are emitted per the verb table in [PHASE3_API_EVENTS.md](PHASE3_API_EVENTS.md) §7.2, and the actor is **always** stamped server-side from the session — a client-supplied actor is ignored outright, proven by its own test.
- [x] The Phase 2 player is untouched: `source = 'authored'` is a third branch beside the unchanged SCORM and asset paths, and completion flows through the *existing* `progress` rollup rather than a parallel one.

## Authoring

- [x] Every one of the 24 block types has a real property editor — no raw-JSON escape hatch, which is what an editor falls back to when its harder types are never finished.
- [x] Structural editing works: add, delete, drag-reorder (with keyboard-reachable equivalents), sections and pages.
- [x] The Storyline surfaces are present: variables, triggers, conditions, layers, timeline cue points. Every target is picked from what the document actually contains, so a dangling reference is hard to author rather than merely reported afterwards.
- [x] Edits travel as JSON-Patch against the stored document, applied server-side.
- [x] **Optimistic concurrency is real**: two authors saving from the same revision cannot silently overwrite one another — the second gets a 409. Proven by a test that performs exactly that race.
- [x] **Validation runs before the write, never after.** A change that would invalidate the specification is refused with the findings that blocked it; the stored document is confirmed untouched afterwards.
- [x] Preview mounts the **real** step 5 interpreter against the draft, not a second rendering path that would drift from what learners get.
- [x] Publishing reuses `lib/content/publish.ts`'s state machine and snapshot mechanic unchanged, with a validation gate added on the way to `published`. A course with errors is refused with its findings and stays at its previous status.
- [x] Component and template libraries exist and validate their contents on the way in.
- [x] The editor cannot create content its own validator rejects — asserted per block type against the real schema, which is why `embed` is not in the blind-insert menu (an empty `resourceId` is a schema error).

## AI gateway

- [x] `generateStructured({ profile, schema, instruction, source })` is the only generation primitive, and there is **no parameter through which a caller could name a model**. Model-agnosticism is enforced by shape, not convention.
- [x] `lib/ai/profiles.ts` is the only file in the platform where a model name appears.
- [x] Workload profiles resolve to ordered provider chains; a failed provider advances the chain, and a provider with no credentials is skipped rather than called.
- [x] A bounded repair loop feeds **the validator's own errors** back to the model. Output is never coerced: either it satisfies the schema within the retry budget or the call fails with findings attached.
- [x] A transport failure does not spend the repair budget — re-asking a provider that is down with schema errors helps nobody, so the chain advances instead.
- [x] Untrusted source text travels in its own field to the adapter, which delimits it as data. Combined with schema-constrained output, an injected instruction has nothing to express itself through.
- [x] Every call logs to `ai_usage_log` on **both** the success and failure branches, with `job_id` correlation, `profile` and `retry_count`.
- [x] Budget exhaustion **fails clearly and never silently downgrades to a cheaper model** — asserted by a test that confirms neither the expensive nor the cheap adapter was called.
- [ ] **Proven against at least two providers switched by configuration alone.** *Not done.* The gateway is exercised end to end against a deterministic in-process adapter, which proves the gateway; it has never called a real provider, because no API key has been configured. The Anthropic adapter is written against the official SDK but is unexercised.

## Generation pipeline — step 8

**Built 2026-08-27 as "Full AI Course Builder" — see `CURRENT_STATUS.md` for the full account.** The
checkboxes below were written 2026-08-21 against the deliberately-deferred original plan; they are
updated here against what actually shipped, not re-derived from a fresh audit of every sub-item, so
treat the two left unchecked as "not independently re-confirmed," not "known missing."

- [x] Source ingest (PDF / DOCX / PPT / URL / prompt) — accepts pasted text, a public URL (server-side
      extraction with SSRF and size controls), or a PDF/DOCX/PPTX already in the content library.
- [x] The multi-step pipeline from [PHASE3_AI_ARCHITECTURE.md](PHASE3_AI_ARCHITECTURE.md) §5 — generates
      every bounded lesson page, section knowledge checks and skill tags through the provider gateway.
- [ ] Per-step status recorded in `authoring_jobs.steps` — not independently re-confirmed against this
      specific flow (the mechanism exists and is used elsewhere in Phase 3, e.g. the job-execution
      spike); not re-verified here that Full AI Course Builder's own steps populate it.
- [ ] Partial regeneration of one section/page/block without touching the rest — not independently
      re-confirmed.
- [ ] Provenance recorded per generated block, so a reviewer can check a claim against its source
      chunk — not independently re-confirmed.
- [x] Generated specs enter at `draft` and reach `published` only through explicit human transitions —
      "saves only a human-reviewed draft," explicitly, per the 2026-08-27 record.

**Not yet production-verified end to end.** The first real-provider run exercised the recovery flow but
stopped at the org's configured $5 monthly AI budget before saving a full draft — no generated course
from this full pipeline has been published. (The separate, narrower "Lite" builder *has* been
production-verified with a real AICredits call, 2026-08-27 — see below.) Re-attempting the full run
needs the budget intentionally raised or reset first, not a code change.

## Publishing

- [x] Package building runs as a tracked job — the route returns a job id and never blocks, because zipping a course with media is not a request-time operation.
- [x] Built as a plain async job rather than a durable Workflow, with the reason recorded: packaging is a render, a zip and an upload, and durable orchestration would tie the publishing surface to a host the platform is moving off.
- [x] Packages land in the private `published-packages` bucket under an `org_id/` prefix, with download only through a short-lived signed URL.
- [x] `published_packages` rows record which **spec version** produced them — immutable provenance, and a rebuild produces a new row rather than mutating one.
- [x] Only a **published** spec packages. Exporting a draft would put unreviewed content into somebody else's LMS, where our workflow gate no longer applies.
- [x] The spec is re-validated at build time rather than trusted from its publish, so a schema version bump since publication cannot produce a package built from a spec we can no longer interpret.
- [x] **A signed download URL is never issuable for another org's package** — the specific leak [PHASE3_DATA_MODEL.md](PHASE3_DATA_MODEL.md) §7 flagged, proven refused at 404 before the signing step is reached.
- [x] Every block type an author can insert renders into the package. Blocks whose behaviour cannot survive a static export render as their content instead — losing interactivity is honest, losing content is not.
- [ ] **SCORM 1.2 and xAPI formats.** *Not done.* `scorm2004` and `cmi5` are built and were confirmed passing in a real third-party LMS; the other two are named in code as unimplemented so asking for one gets an honest answer rather than an obscure failure. (AICC was in this list until 2026-09-03 — removed from the build and roadmap entirely, not deferred; see [MASTER_FEATURE_MATRIX.md](MASTER_FEATURE_MATRIX.md).)
- [x] **Step 3's conformance check re-run against generated content in a real third-party LMS.** **Done 2026-08-24.** A pipeline-built `scorm2004` and `cmi5` package (from a real published `course_specifications` row, via `buildPackage()` unmodified) both uploaded to SCORM Cloud, launched, and completed with `Completion: complete, Success: passed, Score: 100.00%`. This run caught two real bugs step 3's hand-built fixture never exercised: the multi-page nav had no click handler wired (`lib/export/render.ts`), and the quiz-submit handler reported results via a `window.__courseTrack` API neither `scorm2004.ts` nor `cmi5.ts`'s adapter ever defined — no pipeline-built package had ever actually reported a score to a real LMS before this. Both fixed and covered by `tests/export/navigation.test.ts` (real DOM, real clicks, not source-text assertions).

  **Extended 2026-09-03 — the 2026-08-24 course happened to use `completion.rule: "passedQuiz"`, so it never exercised the other three rules `isCourseCompleteNow` supports.** Re-ran the same conformance check against a real, AI-generated, published course (`course_specifications` id `d4943215…`, "Giving effective feedback") whose rule is `allPagesVisited` — the schema's own default. Both formats got stuck at `Initialized` in SCORM Cloud, twice, with zero further statements. Root cause: `course:complete` had exactly one trigger in the whole content script — a quiz Submit click — regardless of what `completion.rule` actually said. Fixed in `lib/export/render.ts`: the content script now tracks page visits and fires completion for every rule except `passedQuiz` once all pages are shown; `scorm2004.ts`/`cmi5.ts` updated to leave `success_status`/score at their spec-correct unset state rather than inventing a pass for an ungraded course. Rebuilt both packages and re-ran in SCORM Cloud: SCORM 2004 showed `Completion: complete` (real duration, 1m10s; `Score: unknown`, correctly never set — `Success: passed` is SCORM Cloud's own sandbox-summary heuristic, not something the package reported). cmi5's raw xAPI Statement Viewer — the literal ground truth, not a summary — showed exactly `launched → initialized → completed → satisfied (LRS-derived, moveOn="CompletedOrPassed") → terminated`, no `Passed`/`Failed` statement, `Success/Score: unknown` in the summary. Confirmed the fix doesn't regress the original `passedQuiz` fixture (re-rendered `spikes/export-conformance/fixture.ts`: quiz dispatch and its `viaQuiz: true` unchanged, `allPagesVisited` tracking is a documented no-op under `passedQuiz`). Could not run through the automated suite in this environment (Docker Desktop's daemon wasn't up, blocking vitest's global setup) — verified by direct execution of the real `renderCourse`/`buildPackage` functions against production data instead; worth a real `vitest run` once Docker is available.

## Accessibility — step 10

- [x] **A publish-readiness gate that blocks on accessibility errors.** Proven end to end: a course with an undescribed image is refused at `422 NOT_PUBLISHABLE` with `ALT_TEXT_MISSING` in the findings, stays at its previous status, and publishes once the alt text is supplied.
- [x] **Required alt text** (WCAG 1.1.1, Level A) — images, gallery images individually, labelled graphics, hotspots. `decorative` is the explicit opt-out.
- [x] **Captions or transcript required** for video and audio (WCAG 1.2.2, Level A).
- [x] **Contrast checks** (WCAG 1.4.3, Level AA) — real relative-luminance maths against `theme.colors`, tested against the reference extremes (21:1 black on white, 1:1 white on white). Returns null rather than guessing when a colour is a named design token instead of a hex value.
- [x] **Reading order** — flags a page where only *some* blocks set an explicit order, which is worse than none because the rest fall back to document order and the two interleave unpredictably.
- [x] **Keyboard-only traversal, driven with real Tab presses** against real rendered output: outline → open a course → operate an accordion → advance a page → answer a question → submit, without a mouse.
- [x] **Editor affordances.** An accessibility panel listing findings, separating what blocks publishing from what is merely suggested, with click-to-navigate straight to the offending block (findings are path-addressed precisely for this). The tab shows the blocking count so an author does not have to open it to learn the course cannot ship.
- [x] **Every requirement is satisfiable from the editor.** Adding caption and transcript pickers was part of this step, not incidental: the gate could previously demand captions that the inspector gave no way to supply, and a requirement an author cannot satisfy is worse than no requirement.

**The severity model is the design decision worth recording.** `meta.accessibilityProfile` — which already existed in the schema — decides strictness, defaulting to **WCAG 2.2 AA** when a course declares nothing. Enforcing by default is the defensible stance for a platform selling into HR; an author who genuinely cannot meet it opts down explicitly, and even then findings are still reported at `info` rather than suppressed. Rules that *suspect* a problem rather than prove one — skipped heading levels, vague link text, a placeholder embed title, a missing page heading — stay warnings under every profile, because a gate that blocks on a guess teaches authors to distrust it.

**Accessibility errors block publishing, never saving.** `validateForWrite` gates writes on *schema* errors alone, so an author who inserts an image is never prevented from saving work they have not described yet. A gate that fired on every keystroke would be switched off within a week.

**Deferred:** automated runtime checks against a rendered page (axe-core or equivalent). The static pass covers what the specification can express; a DOM-level audit would additionally catch renderer regressions, and is worth adding when the UI pass lands rather than against scaffolding that is about to be replaced.

## Skill tagging & search — step 11

- [x] **`skill_tags` has a real API** — list with name filter, create, rename, delete, all `org_admin` through `withAuth`. Duplicate names surface as `409 ALREADY_EXISTS` rather than a server fault. Cross-org access refused at 404; learners get 403.
- [x] **Authored block text is indexed into the existing full-text search.** `course_specifications.search_text` is populated on every create, patch and duplicate from a real walk of the block tree (`lib/authoring/spec-text.ts`), and `search_vector` is regenerated over title (weight A) and body (weight B) so a course *called* "Fire safety" still outranks one that merely mentions it.
- [x] **Proven end to end**: a term written into a text block deep in a document, appearing nowhere in the title, is findable through `/api/v1/content/search` — the exact gap step 4 deferred.
- [x] **Search is not a side channel past RLS** — a specification planted in another org with the query term in both its title and indexed body returns nothing.

**The deferral from step 4 is now collected.** That migration indexed the title alone and recorded why: a course's readable text lives in a nested tree of structured `RichText` spans, and walking it in pure SQL would be a fragile JSON walk invented speculatively. It was to wait for "whichever step first has code that already parses the tree for another reason" — steps 6 and 9 are both that reason, so the walk lives in application code and the generated column covers its output. No SQL backfill was attempted, deliberately: the source of truth is a jsonb tree only the application reads correctly, and existing rows keep matching on title until next saved.

**What the walk deliberately excludes:** ids, block types and asset references (so a course is never surfaced because an internal id happened to contain the query), and `authorNote`, which the schema states is "never shown to a learner" — indexing it would surface courses by content no learner can see. Alt text *is* indexed, because it describes real content.

**Scope boundary, recorded in the code itself:** these tags are LMS-local and temporary in that scope. `skill_tags` was named to avoid colliding with a future `skills` engine carrying proficiency semantics, and Orbit's **Competency Management** product is that engine — it should own Orbit's canonical skills and proficiency taxonomy when it ships, at which point this becomes a reference into it or a migration source. Nothing here anticipates that: no proficiency levels, no hierarchy, no cross-product meaning, because inventing those now would be inventing Competency Management badly and in the wrong repository. `external_ref` is the seam a later taxonomy import lands on.

**Deferred:** editor UI for assigning tags to a course or block. The schema carries `skillTagIds` at course, block, objective and assessment-item level and the API is complete, but the assignment control is best built with the LMS UI pass rather than added to scaffolding about to be replaced.

## Tenancy — the non-negotiable

- [x] Every Phase 3 table carries `org_id` and got its four-policy RLS in the same migration that created it — no table was added first and secured later.
- [x] `tests/schema-hygiene.test.ts` fails CI if any future table lacks RLS; it is generic and needed no change for the nine new tables.
- [x] Policy-shape deviations are deliberate and documented: `xapi_statements` is manager+ on select because it is behavioural data; `published_packages` and `content_versions` are select-only for tenant roles; `course_runtime_state` scopes writes to `user_id = auth.uid()`; `authoring_jobs` has no delete policy.
- [x] Cross-org isolation proven at the data layer **and** through the real HTTP routes, for authoring, runtime and publishing alike.
- [x] The authoring API is closed to learners entirely (403), and another org's admin gets 404 on a specification they do not own.

## Testing & evidence

- [x] 256 unit tests and 41 end-to-end tests, green.
- [x] The runtime interpreter is tested as a pure function, separately from its renderers — so a failure names either the logic or the markup, never both.
- [x] End-to-end tests run against a real browser and a real database, not mocks.
- [x] Three schema gaps were found by building the first real caller rather than by review: `content_reviews` never learned the Phase 3 entity types, `content_assets` had no `image` type despite four block types requiring one, and the runtime fetched drafts without the preview flag.
- [x] **The e2e suite is reliable.** *Fixed 2026-08-21.* **41/41 across three consecutive full-suite runs, in ~3 minutes each** (previously 8–24 minutes with a rotating cast of 1–13 failures). Three genuine causes, none of which was the application:
  1. **The suite ran against `next dev`.** Turbopack compiles each route on first hit, so an unpredictable multi-second cost landed inside whichever test touched a route first, moving between runs with test order and machine load. It now runs against `next build && next start` — the dominant fix, and the one that took the run from 23.7 minutes to 3.0.
  2. **The harness was hammering the Docker API.** `createLocalAdminClient()` shelled out to `npx supabase status` with no caching, and Playwright gives every spec file its own worker — roughly eleven Docker queries per run, enough that Docker began returning 502s mid-run. Failures looked like flaky application code and were not. Connection details are now resolved once in global setup and written for workers to read. The Vitest side had the same stampede on a cold cache and gained a `globalSetup` that warms it.
  3. **One test asserted on a label instead of a round-trip.** `expect("All changes saved")` passes instantly on the *previous* edit's indicator, so the test read the database before the write landed. Now waits for the actual `PATCH` response — the same mistake the runtime autosave test was written to avoid.

  Two guards were added while fixing it: global setup fails with one clear sentence if the dev server is serving a stale build (a stale `.next` makes newly-added nested routes 404, which reads exactly like a broken feature), and it waits for Auth and PostgREST to genuinely accept work before seeding, rather than trusting the CLI's health check.

## Deferred, with reasons

*Rows below struck through were live-tracked deferrals; the table wasn't updated as each landed. Fixed
2026-09-03, not re-litigated — see each linked record for the actual evidence.*

| Item | Why | When |
|---|---|---|
| ~~Step 8 — AI generation pipeline~~ | ~~Gateway complete; the pipeline is the expensive half~~ | **Built 2026-08-27 ("Full AI Course Builder"). Its own real-provider run is still budget-interrupted — see the Generation pipeline section above** |
| ~~Step 10 — accessibility gates~~ | ~~Enterprise procurement concern, not a first-customer one~~ | **Done — see the Accessibility section above, fully checked off** |
| ~~Step 11 — skill tagging + search~~ | ~~Small and now unblocked; opportunistic~~ | **Done — see the Skill tagging & search section above, fully checked off** |
| Real-provider AI verification | Proven against one real provider (AICredits, via the Lite builder, 2026-08-27); the direct-Anthropic adapter remains unexercised — no `ANTHROPIC_API_KEY` configured | The one genuinely open item this doc still tracks |
| SCORM 1.2 / xAPI **export** packaging | 2004 and cmi5 cover the proven ground; 1.2 has real commercial value for older LMSs. (Not to be confused with xAPI **ingest**, which is done — see below.) | On demand |
| ~~AICC (any form)~~ | ~~Predates SCORM; content has moved on~~ | **Removed from the roadmap, 2026-09-03** |
| ~~xAPI/Tin Can ingest~~ | ~~Rejected outright on upload; no parser existed~~ | **Done and verified 2026-09-03, including against a real independently-authored package — see `docs/XAPI_INGEST_ARCHITECTURE.md`** |
| ~~Conformance re-run on generated content~~ | ~~Requires a manual SCORM Cloud upload~~ | **Done 2026-08-24** |
| Canvas + animation editors | Explicitly 3B; the spec already carries both models | Phase 3B |

## What this review changes

Three things moved from "assumed fine" to "named and outstanding" in the original 2026-08-21 review:

1. **The AI gateway has never spoken to a real provider.** *Partially closed 2026-08-27* — the gateway has now spoken to one real provider (AICredits, via the Lite builder). The direct-Anthropic adapter, and the two-independently-configured-providers proof this Definition of Done actually calls for, remain open — still the one genuinely outstanding item, unchanged in kind from 2026-08-21, just narrower in scope now.
2. ~~**The publishing pipeline's output has never been through a real LMS.**~~ **Closed 2026-08-24** — see above. Closing this surfaced two real bugs the hand-built step 3 fixture never exercised (nav click handler, quiz-tracking handoff), both fixed.
3. ~~**The e2e suite is not a dependable gate.**~~ **Closed 2026-08-21** — 41/41 across three consecutive runs at ~3 minutes. See the Testing section for the three causes and their fixes.

**Updated 2026-09-03** to correct a documentation gap rather than to record new investigation: steps 10 and 11 were completed and fully checked off in their own sections of this document at some point after the 2026-08-21 review, but the top-line verdict and this table were never updated to say so — they kept calling both "not built" until this pass. Step 8 was also built in that window (2026-08-27, "Full AI Course Builder") but its own real-provider run is separately budget-interrupted, so it counts as built-not-fully-verified, not done.

**Remaining before Phase 3 is declared done**: only item 1 above — the second real AI provider — plus, if pursued, a completed real-provider run of the full (non-Lite) generation pipeline. Neither blocks the agreed commercial path. Everything else in this document, including steps 10 and 11, is done.
