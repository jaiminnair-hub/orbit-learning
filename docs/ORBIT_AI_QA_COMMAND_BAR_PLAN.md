# Orbit AI QA Command Bar — Approved Future Build

**Status:** approved future build; not live yet.  
**Decision date:** 2026-08-28

## Outcome

Platform Control will offer an AI QA Command Bar. A platform owner can ask a constrained question such as “test all links on this page”, “run the Admin smoke test”, “is AI generation working?” or “are core database queries healthy?” The AI will turn the request into a reviewable test plan, use only an approved test capability, and return clear evidence plus a standard Excel QA report.

## Safety boundary

- The AI is a **planner and dispatcher**, not an unrestricted production operator.
- It may call only typed, allow-listed test tools. It cannot compose arbitrary SQL, browse customer data, change production configuration, publish content, send email, or use a real employee account.
- Browser work runs through the isolated Admin and Learner QA personas in a dedicated QA organization with fixture data and test inboxes.
- Every run records command, selected tools, environment, time, results, screenshots/traces where available, and blocked prerequisites.
- A test plan is shown before execution whenever a request would create fixture data or take longer than a lightweight health check.

## Initial command catalog

| Natural-language request | Approved capability | Environment | Evidence |
|---|---|---|---|
| “Test all links on this page” | link crawl and HTTP/browser assertions | QA or public read-only | URL, response, screenshot on failure |
| “Run the Admin smoke test” | Admin Playwright persona | isolated QA | trace, assertions, Excel row |
| “Run the learner journey” | Learner Playwright persona | isolated QA | trace, assertions, Excel row |
| “Is AI generation working?” | provider configuration and bounded draft-generation health check | isolated QA | provider response/latency, no auto-publish |
| “Are database queries healthy?” | allow-listed read-only connectivity, migration and critical-query checks | isolated QA/staging | latency, errors, query identifier only |
| “Test 360 reviewer flow” | 360 QA subject/reviewer cycle | dedicated 360 QA tenant | trace and protected report-access assertion |

## Delivery sequence

1. Platform Control command bar and command-to-plan parser.
2. Allow-listed QA tool registry with role/environment guards and audit record.
3. Connect the existing Admin and Learner Playwright personas; attach trace/screenshot evidence.
4. Add AI-provider and database/API health tools.
5. Generate a standard Excel report: Summary, Test Cases, Evidence/Blockers, and run metadata.
6. Add a deployment-release gate and scheduled runs after the above has stable evidence.

## Current prerequisites and truthful limits

- LMS Admin/Learner QA automation exists in the isolated local environment and has produced a first report.
- 360 QA automation remains blocked until a dedicated 360 QA organization, administrator identity, reviewer identity and synthetic cycle are provisioned.
- Competencies and Orbit Growth remain prepared only until their actual workspaces exist.
- The first release must be a QA environment feature, not a button that runs privileged production actions.
