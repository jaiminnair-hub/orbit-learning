# SCORM Cloud validation — pipeline output

## Files

Two packages, generated 2026-08-21 by driving the real production publishing path (`lib/publishing/build.ts`, unmodified) against a real published `course_specifications` row — not the hand-built fixture the two earlier SCORM Cloud passes used. Local paths (gitignored, not committed — see `.gitignore`):

```
.tmp-pipeline-packages/pipeline-scorm2004.zip   (3,427 bytes)
.tmp-pipeline-packages/pipeline-cmi5.zip        (6,823 bytes)
```

Also sent directly via file transfer in this session. Contents, confirmed by unzipping locally before sending:

| Package | Files |
|---|---|
| `pipeline-scorm2004.zip` | `imsmanifest.xml`, `index.html`, `content.js`, `scorm-api.js` |
| `pipeline-cmi5.zip` | `cmi5.xml`, `index.html`, `content.js`, `cmi5.js` |

Both built from a course titled "Fire Safety Fundamentals" — two pages (an introduction, and a quiz check).

## What this proves vs. what it doesn't

**Proves:** the packaging pipeline itself — spec validation, rendering, manifest generation, zip assembly — produces a real, structurally valid artifact from a real database row, end to end, with no manual intervention. This was previously unverified; the two earlier SCORM Cloud passes (2026-08-20) used a package built directly from a hand-authored fixture in `spikes/export-conformance/`, which proved the *format* but never the *pipeline*.

**Doesn't prove:** anything about the SCORM runtime adapter built in this session (`lib/scorm/adapter.ts`) — that's for *importing* SCORM content into this LMS, tested separately and already verified against real generated packages in `tests/e2e/scorm-tracking.spec.ts`. This validation is the opposite direction: this LMS *exporting* a package for another LMS to import.

## Validation checklist (perform in SCORM Cloud)

For each package:

- [ ] **Upload** succeeds without a format-rejection error.
- [ ] **Metadata recognized correctly:**
  - `pipeline-scorm2004.zip` → SCORM Cloud reports the standard as "SCORM 2004 3rd/4th Edition" (matching what `lib/export/scorm2004.ts`'s manifest declares) — if it reports 1.2 or fails to detect a version, that's a manifest bug.
  - `pipeline-cmi5.zip` → recognized as "cmi5", not misclassified as a generic SCORM package.
- [ ] **Title displays correctly:** "Fire Safety Fundamentals" — confirms `course_specifications.title` flowed through to the manifest, not a placeholder.
- [ ] **Launch:** the course opens in SCORM Cloud's player without a blank screen or console error.
- [ ] **Content renders:** both authored pages are reachable and show real text (not "undefined" or empty blocks) — the heading and quiz block from the seed spec.
- [ ] **Tracking round-trip:** progress through both pages, answer the quiz, reach the end.
- [ ] **Registration result** (SCORM Cloud's summary screen) shows a real completion/success/score — record the exact values, mirroring the format of the two earlier passes:
  - SCORM 2004 (2026-08-20, fixture): `Completion: complete, Success: passed, Score: 100.00%`
  - cmi5 (2026-08-20, fixture): `Completion: complete, Success: passed, Score: 80.00%`
  - **This run (pipeline output):** _______________

## Result — done 2026-08-24

- **SCORM 2004 (pipeline output):** `Completion: complete, Success: passed, Score: 100.00%`
- **cmi5 (pipeline output):** `Completion: complete, Success: passed, Score: 100.00%`

This run caught two real bugs neither the step 3 spike's hand-built fixture nor any earlier check exercised — both in `lib/export/render.ts`'s shared content script, both fixed same-day:

1. **Nav links did nothing.** The exported HTML's page-switch links carried `data-page` attributes but nothing ever wired a click handler to them.
2. **Quiz results were never actually reported.** The quiz-submit handler called `window.__courseTrack.answered/complete/score()` — an API neither `lib/export/scorm2004.ts`'s nor `lib/export/cmi5.ts`'s adapter ever defined; both only ever listened for a `course:complete` CustomEvent. The first attempt at this validation (before the second fix) showed `Score: unknown` despite `Completion: complete` — that mismatch is what surfaced this.

Both fixed and covered by `tests/export/navigation.test.ts`, which loads the actual generated `index.html`/`content.js` into a real DOM (via `jsdom`) and dispatches real clicks, rather than asserting on the script's source text — the class of test gap that let both bugs ship unnoticed.

`docs/DEFINITION_OF_DONE_PHASE3.md` line 77 and `docs/ORBIT_STATUS.md` §2 updated accordingly.
