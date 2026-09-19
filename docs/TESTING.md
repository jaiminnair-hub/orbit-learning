# Testing Architecture

an earlier project has zero automated tests — verification is manual (typecheck, build, click-through). That is explicitly not repeated here. Automated testing exists from the first commit of the new repo.

**Status (2026-08-14):** the Database/RLS row is implemented and running in CI (12 tests, [`tests/`](../tests)); the Critical UI row has flow #1 running in CI (11 Playwright tests total across [`tests/e2e/`](../tests/e2e) — the golden path plus the API-level role-matrix and tenant-isolation specs, see §4 and §6 below) — see the notes under each row. Unit and Integration rows remain proposed; no business logic or route handlers complex enough to need them yet.

## 1. Test pyramid

| Layer | Tool | Covers |
|---|---|---|
| Unit | Vitest (proposed) | Business logic — plan/entitlement resolution, RLS-helper logic mirrored in TypeScript, content state-machine transitions, question scoring |
| Integration | Vitest + local Supabase (proposed) | API route handlers against a real (local, disposable) Postgres instance — not mocked, since RLS behavior can't be meaningfully mocked |
| API / contract | **Playwright `request` fixture, role-matrix coverage implemented** | Every route's auth rejection paths (401/403) and role gating — `tests/e2e/role-matrix.spec.ts`. Response-envelope shape and pagination contract tests remain proposed (no paginated routes exist yet) |
| Database / RLS | **Vitest + real Supabase Admin API + `@supabase/supabase-js`, implemented** | Every table's RLS/policies (§3 in [MULTI_TENANCY.md](MULTI_TENANCY.md)) — the highest-priority suite in this whole document, see §5. Originally proposed as pgTAP-or-equivalent; landed on Vitest driving genuine authenticated sessions through the same client library the real app uses, which exercises PostgREST's behavior (not just raw SQL role-switching) and needed no new tooling |
| Critical UI | **Playwright, flow #1 implemented** | A small number of golden-path flows, not exhaustive UI coverage — see §6. Flows #2–5 remain proposed (their underlying features don't exist yet) |

## 2. Authentication tests

- Signup, login, logout, password reset, OAuth callback succeed end-to-end.
- Session persists correctly across a page reload and expires correctly.
- An unauthenticated request to any protected route is rejected by `getSessionContext()` (via the route-group layout or the `withAuth()` wrapper — see [API_SPEC.md](API_SPEC.md) §1) before a handler or page renders.

## 3. Authorization (role) tests

- For each role in the hierarchy (`learner < manager < org_admin < org_owner`), a matrix of "can/cannot perform action X" assertions against representative routes (create course, publish course, invite user, change a user's role, view team reports).
- A `learner` cannot escalate their own role via a direct API call (mirrors an earlier project's real, fixed `007_prevent_role_escalation.sql` vulnerability — this platform tests for it from day one instead of discovering it in production).

## 4. Tenant isolation tests — the highest-priority suite

Directly implementing the user's required matrix. For two seeded orgs (Org A, Org B) and a user in each:

| A user in Org A cannot... | Verified against |
|---|---|
| Read Org B's courses | `courses`, `modules`, `lessons`, `learning_objects` |
| Read Org B's users | `profiles`, `departments` |
| Read Org B's assessments | `assessments`, `question_bank`, `assessment_attempts` |
| Read Org B's reports | Manager/Admin analytics endpoints |
| Retrieve Org B's files | Signed URL requests against Org B's `content_assets`/`scorm_packages` |
| Retrieve Org B's AI/RAG content | `ai_knowledge_chunks` — both via direct query and via the Learning Assistant's retrieval path (an end-to-end test asking the assistant a question phrased to probe for Org B's content) |

Each row is tested at **two layers**: a direct RLS test (raw SQL as Org A's user, assert zero rows from Org B) and an API-level test (call the route as Org A's user, assert a 403/404/empty result, never a 500 or a silent cross-tenant leak). Additionally: **platform administrators have controlled, auditable cross-tenant access** — a test asserts a platform admin *can* read across orgs via the designated path, and that doing so writes an `activity_log` row (see [MULTI_TENANCY.md](MULTI_TENANCY.md) §4); a second test asserts a platform admin **cannot** write cross-tenant data through the same read-only path.

This suite runs on every PR and is the literal gate defined in [DEFINITION_OF_DONE.md](DEFINITION_OF_DONE.md) — Phase 1 is not done until every row above is a green, automated test, not a manual check.

**Update (2026-08-16, Phase 2 complete):** the **"Read Org B's courses" row now applies and passes** — at the data layer (`courses`, `modules`, `lessons`, `lesson_learning_objects`, `learning_objects`, `content_versions`, `content_assets`, `scorm_packages`, `scorm_progress`, `enrollments`, `progress`) and through real routes (listings, structure reads, enrolment attempts, and **search**, which matters most because a `SELECT` is the easiest thing to accidentally turn into a side channel past RLS). 24 data-layer + 17 Playwright tests. Assessments/reports/AI-RAG rows still don't apply — those tables arrive in Phases 3–4.

**Implemented as of 2026-08-14:** the "Read Org B's users" row (`organizations`, `profiles`, `departments`, `org_invitations`, plus `subscriptions` and `activity_log`, which weren't in the original row list but exist in Phase 1's schema) — 11 tests in [`tests/tenant-isolation.test.ts`](../tests/tenant-isolation.test.ts) at the data layer, using real signed-in sessions (which exercises PostgREST/RLS together, more representative than raw SQL role-switching). Plus a 12th test, [`tests/schema-hygiene.test.ts`](../tests/schema-hygiene.test.ts), a generic "every `public` table has RLS enabled" check that automatically covers tables added in later phases.

The **API layer** for this same row is now also covered: [`tests/e2e/tenant-isolation-api.spec.ts`](../tests/e2e/tenant-isolation-api.spec.ts) (5 tests) calls the actual routes as a real signed-in user and asserts no cross-org leakage/writes, and [`tests/e2e/role-matrix.spec.ts`](../tests/e2e/role-matrix.spec.ts) (5 tests) covers the role-matrix half of this section for every route. Both platform-admin assertions are implemented and automated, including the "read is audited to `activity_log`" half — the API-layer test queries `activity_log` directly after the read and asserts the row exists with the right `actor_id`, not just trusting the route's own success response. Courses/assessments/reports/files/AI-RAG rows don't apply yet — those tables arrive in later phases, which extend this same suite.

## 5. Database/RLS test execution

Run against a local, disposable Supabase instance (via `supabase start`) in CI, seeded fresh per run — never against a shared staging database, so tests are deterministic and can't leak state across runs. **Implemented**: local instance trimmed to `db`+`auth`+`api`+`local_smtp`+`storage` (`supabase/config.toml`) — Realtime/Analytics/Studio/pg_meta remain disabled, since no suite needs them.

**Storage was re-enabled in Phase 2 step 1** (as this section anticipated), with two consequences worth recording. Its container fails the CLI's health probe on this machine even though the service itself logs a clean start and answers requests, so `npm test`/`npm run test:e2e` pass `--ignore-health-check` — the probe is bypassed, not the service, which is verified reachable separately (`/storage/v1/status` → 200). And enabling Storage pushed `npx supabase status` to ~7–8s; every Vitest file pays that once via `getLocalStatus()`, which consumed most of the old 15s `testTimeout` and made `schema-hygiene` time out on a query that isn't slow — `testTimeout` is now 45s, with the reason recorded in `vitest.config.mts` so it isn't mistaken for an arbitrary bump. Connection details (URL, keys) are read fresh via `supabase status -o json` at test-run time rather than hardcoded, so the same test code works locally and in CI regardless of what the CLI generates.

## 6. Critical UI tests (Playwright, golden paths only)

Not exhaustive UI coverage — a small set of end-to-end flows that prove the seams between systems work together:

1. Sign up → create an organization → invite a user → new user accepts and logs in. **Done and automated** (`tests/e2e/onboarding.spec.ts`, [DEVELOPMENT_SEQUENCE.md](DEVELOPMENT_SEQUENCE.md) step 10, 2026-08-14) — runs against the real rendered UI and a local, disposable Supabase instance (`playwright.config.ts`'s `webServer` points `next dev` at it via env vars, never the real project), in CI on every push.
2. Admin creates a course (content library → learning objects → lessons → modules → course), publishes it. **Done and automated** (`tests/e2e/course-lifecycle.spec.ts`, Phase 2 step 8) — and it goes further than this line originally scoped: the same test then has a learner enrol, work through the course in the real rendered player, and confirms the enrolment flips to `completed` server-side.
3. Learner enrolls, completes the course, takes the assessment, receives a certificate; certificate verification link works unauthenticated.
4. Admin uploads a document to AI Course Builder, reviews/edits the draft, publishes — course appears for learners.
5. Learner asks the AI Assistant a question with content-backed context, and a second question with no relevant org content, and sees the grounded/generated/unsupported distinction rendered correctly (see [AI_ARCHITECTURE.md](AI_ARCHITECTURE.md) §5).

## 7. CI pipeline

Every PR runs, in order, failing fast: typecheck → lint → unit tests → integration tests → RLS/tenant-isolation suite → critical Playwright flows. **Merge is blocked on any failure** — no exceptions for the RLS suite specifically, since that's the one category of regression this platform cannot afford to ship silently.

**Implemented so far:** typecheck → lint → build → RLS/tenant-isolation suite → Playwright golden path (`.github/workflows/ci.yml`), running on GitHub's `ubuntu-latest` runners, which have Docker preinstalled — no extra CI setup needed for the local Supabase stack; the Playwright step installs Chromium (`playwright install --with-deps chromium`) and reuses the same local Supabase instance `npm test` already started. Unit/integration/API-contract steps and further Playwright flows get added to this same workflow as their respective code exists; there's deliberately no placeholder step for them yet, since an empty/stub CI step is worse than an honestly absent one. The "fails closed, not green by default" property has now been proven **against CI itself**, not just inferred from local behavior: a throwaway branch with a deliberately failing test was pushed and opened as a real PR to trigger the workflow, the run genuinely went red on `npm test` with subsequent steps correctly skipped, and the branch/PR were then deleted without merging (see [DEFINITION_OF_DONE.md](DEFINITION_OF_DONE.md)'s step 11 review, 2026-08-14, for the full record). The separate, still-open gap is that no GitHub branch protection is configured on `main`, so a red PR isn't actually *blocked* from merging today — that's a repo-settings decision left to the user, not a testing gap.
