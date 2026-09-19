# Export conformance spike (Phase 3, step 3)

Proves the second infrastructural unknown named in
[`docs/DEVELOPMENT_SEQUENCE_PHASE3.md`](../../docs/DEVELOPMENT_SEQUENCE_PHASE3.md) step 3:
**SCORM/cmi5 *export* conformance is a different problem from the SCORM *ingest* Phase 2
proved** — a package this platform produces has to actually run, track completion, and report
a score inside someone else's LMS.

The step's own definition: *"Take a hand-written fixture spec, build a SCORM 2004 package and a
cmi5 package, and run both in a real third-party LMS, confirming completion and score report
back. Uses no editor and no AI."*

## What is proven here, automatically, with real evidence

- **The fixture** (`fixture.ts`) is a genuine `CourseSpec` document — imported from `lib/spec`,
  not an invented shape — and it validates against the real schema/validator with zero errors
  (`tests/export/export-conformance.test.ts`, first test).
- **One renderer drives two different tracking backends.** `render.ts` turns the spec into
  content once; `lib/export/scorm2004.ts` and `lib/export/cmi5.ts` wrap that *same* HTML/JS with
  a SCORM 2004 Run-Time Environment adapter and a cmi5 xAPI adapter respectively. The content is
  byte-identical between the two packages — only the tracking script differs — which is the
  actual architectural claim worth proving (one spec, many publish targets).
- **The tracking adapters are real, not stubs**: the SCORM side does the documented
  `API_1484_11` parent/opener discovery walk, then a genuine
  `Initialize → SetValue(cmi.completion_status/success_status/score.scaled) → Commit → Terminate`
  lifecycle. The cmi5 side parses the real launch query-string parameters (`fetch`, `endpoint`,
  `actor`, `registration`, `activityId`), exchanges the fetch URL for an auth token, and sends
  real xAPI statements (`initialized` at launch, `completed` + `passed`/`failed` with a
  `result.score.scaled` on quiz submit, `terminated` on unload) to `${endpoint}statements`.
- **Package structure is conformant**: SCORM 2004 3rd Edition manifest with the standard ADL
  namespaces and a single `adlcp:scormType="sco"` resource; cmi5 course structure with one
  `<au moveOn="CompletedOrPassed">`. Asserted by unzipping the actual built packages and checking
  the real XML/JS content, not by inspecting the builder's source.
- **The score is genuinely computed**, not hardcoded: 5 multiple-choice questions, 80% passing
  threshold, so 4/5 = pass and 3/5 = fail are both real, distinct outcomes depending on what a
  learner actually answers — not a single binary question standing in for "graded."

Run it: `npx vitest run tests/export/export-conformance.test.ts` (12 tests, no Supabase needed).
It also writes the two packages to `output/` (gitignored — regenerate by rerunning the test).

## Real third-party LMS run

The step requires running both packages **in a real third-party LMS** and confirming
completion/score report back there — not something to fake with a mocked response. **Both are now
confirmed, 2026-08-20, via [SCORM Cloud](https://cloud.scorm.com) (Rustici Software).**

| Package | Registration result |
|---|---|
| `fire-safety-scorm2004.zip` | Completion `complete`, Success `passed`, Score `100.00%`, standard `SCORM 2004 3rd Ed.` |
| `fire-safety-cmi5.zip` | Completion `complete`, Success `passed`, Score `80.00%`, standard `cmi5` |

SCORM 2004 passed on the first real run — the RTE adapter's `Initialize`/`SetValue`/`Commit`/
`Terminate` lifecycle worked against a genuine third-party LMS with no changes needed.

cmi5 took six rounds against the real LRS, each one driven by an exact error message SCORM Cloud
returned (never guessed), with the trickier ones cross-checked against the actual cmi5 spec /
AICC reference examples rather than assumed:

1. The `fetch` launch parameter must be called via **POST**, not GET.
2. The `sessionid` context extension must be the LMS's own session id (from the `fetch` URL's
   `session` query param), not one the AU generates itself.
3. `context.contextActivities.grouping` must include the parent **course**.
4. `grouping` must *also* include the AU's own **Publisher Activity** id — its `cmi5.xml`-authored
   id, distinct from the LMS-generated `activityId` used as the statement's `object.id`
   ([reference](https://risc-inc.com/cmi5-publisher-id/)).
5. The AU must `GET` the `cmi5LearnerPreferences` document from the xAPI **Agent Profile API**
   before sending `Initialized` (a 404 is the normal, expected case for a new learner).
6. Statements whose `result` carries `success`/`completion` (Completed, Passed, Failed) need a
   second **`moveon`** category alongside the base cmi5 category, and the Passed/Failed statement's
   `result` must *not* include `completion` — only the separate Completed statement carries that
   ([AICC cmi5 spec sample scenarios](https://aicc.github.io/CMI-5_Spec_Current/samples/scenarios/)).

All six are documented inline in `../../lib/export/cmi5.ts` at the exact line each one fixes. The
built package also carries an on-page debug panel (bottom of the screen, collapsible) logging every
network call and its real response — added specifically because a live LMS launch has no open
browser console, and it's what made diagnosing rounds 3–6 possible from screenshots alone.

## Files

| File | Purpose |
|---|---|
| `fixture.ts` | Hand-written `CourseSpec` — 2 pages, a 5-question multiple-choice quiz, `completion.rule: "passedQuiz"` at 80% |
| `render.ts` | Spike-scoped spec→HTML renderer (heading/text/quiz only — **not** step 5's runtime interpreter) plus the shared quiz/nav interaction script |
| `output/` | The built `.zip` packages (gitignored, regenerated by the test) |
| `../../lib/export/zip.ts` | `fflate`-based zip helper (Workers-safe, same reasoning as Phase 2's `unzipSync` choice in `lib/content/scorm.ts`) |
| `../../lib/export/scorm2004.ts` | SCORM 2004 manifest + RTE adapter — **reused by step 9**, not spike-only |
| `../../lib/export/cmi5.ts` | cmi5 course structure + xAPI adapter — **reused by step 9**, not spike-only |
| `../../tests/export/export-conformance.test.ts` | The automated half of this step's proof |

## Why the packaging code lives in `lib/export/`, not here

Step 9 (Publishing pipeline) is explicit: *"Re-runs step 3's conformance check against generated
content rather than a fixture."* The manifest generation and tracking-adapter code is genuinely
reusable production infrastructure regardless of what content it wraps — only the fixture and the
minimal renderer are spike-only, thrown away once step 5's real interpreter exists.
