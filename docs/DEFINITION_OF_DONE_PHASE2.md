# Definition of Done — Phase 2

Phase 2 (Content + Core LMS: content library, SCORM, learning objects, courses, player, enrollment, progress, search) is done when **every** item below is true. Same discipline as [DEFINITION_OF_DONE.md](DEFINITION_OF_DONE.md) did for Phase 1: nothing is checked without something concrete to point at, and anything deferred is named with its reason rather than quietly dropped.

**Reviewed 2026-08-16, against a live local instance and the real remote project — not from memory.**

## Content model

- [x] `content_assets` exists with `org_id` + the four-policy RLS shape, and the private `content-assets` Storage bucket is created in the same migration so local and remote cannot drift (`...100000_content_assets.sql`).
- [x] The two-step signed-upload flow works end to end ([API_SPEC.md](API_SPEC.md) §6) — verified on **both** local and the real remote project: signed URL → real `PUT` (200) → row created (201) → file re-downloaded and its bytes/size/MIME checked. Guard rails proven by attempting them: another org's storage prefix (400), a file never uploaded (404 — the route verifies against Storage rather than trusting the client), invalid content type (400).
- [x] `learning_objects` + `learning_object_assets` implement composition, and are the reuse unit ([CONTENT_MODEL.md](CONTENT_MODEL.md) §2).
- [x] Reuse is real, not asserted: two separate courses referencing **one** shared learning object, edited once and reflected in both, with row counts confirming 1 learning object and 2 lesson links — i.e. genuine reuse, not duplication.

## Versioning & workflow

- [x] `draft → review → approval → published → archived` is enforced as a state machine (`lib/content/publish.ts`), with no `published → draft` edge by design. Proven to bite: a direct `draft → published` jump is refused with 409 `INVALID_TRANSITION`.
- [x] Publishing writes an immutable `content_versions` snapshot. **The promise the design exists for is proven**: after publishing, the live row was rewritten and republished, and the earlier snapshot still reads the original wording while the newer one reads the rewrite.
- [x] `content_versions` has a select policy but **no** insert policy for `authenticated` — snapshots are written only by the publish path via the service role, never directly by a client.
- [x] Every workflow transition lands in `content_reviews` as an audit trail.
- [x] Enrollment pins `enrolled_version` at enrolment, carrying the versioning promise up a level. Proven: a learner enrolled at v2, the course was republished to v3, and the enrolment stayed pinned to v2.

## SCORM

- [x] A **real** SCORM 1.2 package (genuine zip, real `imsmanifest.xml`) uploads, extracts server-side, and registers — title, version and entry point all parsed correctly.
- [x] Extracted files are served with a correct, **non-downgraded** `Content-Type` (`text/html; charset=utf-8`, `text/javascript`, `text/css`) — the exact mechanism that broke on an earlier project's host.
- [x] Path traversal in the asset route is refused.
- [x] CMI progress round-trips: write → read back → completion with score, all persisted. **Qualified 2026-08-21:** this was verified by calling the progress endpoint directly, which proved the route and not the format — no SCORM package had ever driven it, because no API adapter existed for content to talk to. Closed by `lib/scorm/adapter.ts` and evidenced in `tests/e2e/scorm-tracking.spec.ts`, where real 1.2 and 2004 packages initialise, bookmark, score, complete and resume through the adapter in a browser.
- [x] **All of the above verified on the real Cloudflare `workerd` runtime, not just `next dev`** — the point of sequencing this spike early. Extraction uses `fflate` precisely because it runs on Workers.
- [x] This closes the SCORM item Phase 1's [DEFINITION_OF_DONE.md](DEFINITION_OF_DONE.md) deferred.

## Course structure, player, enrollment

- [x] `courses → modules → lessons → lesson_learning_objects`, with the many-to-many join at the learning-object level only ([CONTENT_MODEL.md](CONTENT_MODEL.md) §4).
- [x] The player renders the course tree and plays SCORM (iframe against the extracted-assets route) and non-SCORM types (short-lived signed URLs).
- [x] Enrollment refuses draft courses (409), refuses duplicates (409), and refuses a learner enrolling **someone else** (403).
- [x] Course completion is **derived** from learning-object progress, never self-reported — a client cannot mark a course complete without its parts being done. Verified: 1 of 2 objects leaves the course at 50% / `in_progress`; the second flips the enrolment to `completed` with a timestamp.
- [x] A manager sees the org's enrolments; a learner asking for org scope still sees only their own.

## Search

- [x] Real Postgres full-text search (generated `tsvector` + GIN), replacing the client-side `.includes()` the Stage 1 audit flagged.
- [x] Scope differs by role, not by a client-supplied parameter: authors see drafts, learners see published only.
- [x] Stemming works ("extinguishers" finds "Extinguisher handling"); an empty query is rejected 400.
- [x] Search does **not** become a side channel past RLS — a matching course seeded in another org never appears, verified at both the data layer and through the real route.

## Tenancy — the non-negotiable

- [x] **All 22 tables in `public` have RLS enabled**, verified by direct query at review time, not assumed. `tests/schema-hygiene.test.ts` fails CI if a future table lacks it.
- [x] Every Phase 2 table carries `org_id` and got its policies in the same migration that created it — no table was added first and secured later.
- [x] Policy-shape deviations are deliberate and documented rather than accidental: `scorm_progress`, `progress` and `enrollments` scope insert/update to `user_id = auth.uid()` because learners must write their own rows; `content_versions` is select-only; `courses_select` is org-wide so learners can see published courses to enrol.
- [x] The full "Org A cannot read Org B's courses" row from [TESTING.md](TESTING.md) §4 — carried as *"doesn't apply yet"* since Phase 1 — **now applies and passes**, at both the data layer and through real routes (listings, structure reads, enrolment attempts, and search).

## Automated tests — green in CI

- [x] 24 data-layer tests (`tests/`), covering cross-org isolation for content assets, SCORM packages and progress, learning objects, version snapshots, courses/modules/lessons/links, enrollments and progress, plus search isolation.
- [x] 17 Playwright tests (`tests/e2e/`), including the flow #2 golden path: admin authors → publishes → learner enrols and completes **through the real rendered player in a browser**, with the enrolment confirmed `completed` server-side afterwards.
- [x] Both suites run twice consecutively with zero failures before being considered stable.
- [x] Both run in CI on every push (`.github/workflows/ci.yml`).

## Deliberately deferred, with reasons

- [ ] **Learning paths and programs** — out of Phase 2's scope per [ROADMAP.md](ROADMAP.md). `enrollments` is already polymorphic (`course/learning_path/program`) so they can be added without rewriting existing rows.
- [ ] **Assessments, question bank, certification** — Phase 3. No migration in this phase touches those tables.
- [ ] **AI Course Builder / Learning Assistant** — Phase 4. Step 3's "published content only" rule is the gate AI ingestion will depend on, so nothing here blocks it.
- [ ] **A real admin course-builder UI.** Authoring currently runs through the API, which the golden-path test exercises end to end; the learner-facing side has a real UI. A richer authoring console is a UX investment, not a foundation gap.
- [ ] **Remaining Cloudflare-validation items** — a real Cron Trigger, a real AI provider key, a raster image through `/_next/image`. Same principle Phase 1 landed on: close each when the feature that needs it arrives, rather than speculatively. SCORM and Storage — the two that mattered for Phase 2 — are now closed.
- [ ] **Branch protection on `main`** — still blocked by the GitHub plan tier for a private repo, unchanged from Phase 1's review and flagged there rather than silently skipped.

**Phase 3 (Assessment + Certification) begins only once the checked items above hold.**
