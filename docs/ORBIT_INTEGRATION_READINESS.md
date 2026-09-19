# Orbit Integration Readiness — LMS Codebase Assessment

**Prepared 2026-08-21 for a future technical integration review. No integration has been performed and nothing has been deployed.**

Orbit is a multi-product HR SaaS platform — 360 Degree Feedback, this LMS, Growth/Performance, Competency Management, and later employee feedback, psychometrics, career development, goals/OKRs, 1:1s, compensation, onboarding and people analytics. This LMS will become **one authenticated product inside Orbit**, not a standalone application.

This document exists to make that review fast and evidence-based: what in this codebase is platform material, what is LMS material, what is missing, and which decisions the review has to make before any code moves.

## What this assessment did NOT do

Per the constraints given, and stated explicitly so a reader does not assume otherwise:

- **No change to tenancy, authentication, organization, profile, role, invitation or migration logic.** Every finding below describes the code as it stands.
- **No merge into any 360 Feedback database**, and no schema written against one.
- **No new Supabase project**, no deployment, no hosting change.
- **No secrets, tokens or service-role keys** appear in this document or in anything produced alongside it.

The one thing this document commits to is an honest read, including where the current model does not fit Orbit.

---

## 1. Verdict in one paragraph

**The LMS tenancy and identity core is a credible starting point for the Orbit platform, with one significant exception: the role model.** Organizations, departments, identity, invitations, platform admin, the audit log and — most importantly — the centralized RLS pattern all generalize cleanly, because none of them encode anything about learning. The role model does not: it is a single org-wide role per user drawn from LMS vocabulary, and it is load-bearing for 59 policy expressions across 31 tables. Reshaping it into per-product roles is the largest single piece of work the integration implies, and it is the one thing that should be decided before anything else moves.

---

## 2. Layer classification

### 2a. Platform material — generalizes to Orbit largely as-is

| Component | Why it generalizes |
|---|---|
| `organizations` | The tenant. Carries name, slug, seats, active flag. Nothing learning-specific. Orbit's "one organization" requirement is already satisfied by this table. |
| `departments` | Org structure. Every Orbit product needs it (360 needs reviewer groupings, Performance needs reporting lines). |
| `profiles` (identity half) | `id → auth.users`, `org_id`, `department_id`, `email`, `full_name`, `status`. This is platform identity. **The `role` column is the exception — see §3.** |
| `org_invitations` | Invite → accept → join, with email-match and single-use guards. Product-agnostic. |
| `platform_admins` | Cross-tenant admin, deliberately outside the tenant role hierarchy, with every cross-tenant read audited. |
| `activity_log` | Generic event log with a type discriminator — built as the consolidation of four separate logs, so it is already shaped for many products. |
| `ai_usage_log` | Per-call provider/model/token/cost logging. Orbit-wide from day one if the AI gateway becomes shared. |
| Auth flows | Signup, login, password reset, OAuth callback, session resolution. No LMS coupling. |
| **RLS pattern** | `current_org_id()`, `is_org_member()`, `is_platform_admin()` as `SECURITY DEFINER` helpers, applied uniformly. **This is the single most valuable asset in the codebase for Orbit** — it is the discipline that makes multi-tenancy hold, and it was built from migration one rather than retrofitted. |
| Two-step signed upload | Sign → verify against storage → register row. 360 needs file attachments; Performance needs evidence uploads. |
| `content_assets` | Arguably platform rather than LMS: a private, org-scoped, signed-URL-only file store is a need every Orbit product has. Worth reviewing as shared. |

### 2b. LMS-specific — should stay inside the LMS product boundary

`courses`, `modules`, `lessons`, `learning_objects`, `lesson_learning_objects`, `scorm_packages`, `scorm_progress`, `course_specifications`, `component_definitions`, `course_templates`, `authoring_jobs`, `spec_validation_reports`, `course_runtime_state`, `published_packages`, `skill_tags`, `enrollments`, `progress`, `content_versions`, `content_reviews`.

Two of these deserve a second look during the review rather than automatic classification:

- **`enrollments`** is already polymorphic (`enrollable_type` / `enrollable_id`) and models "this person is assigned this thing, pinned at this version". 360 assigns review cycles; Performance assigns review periods. The *shape* may be platform material even though the current rows are not.
- **`skill_tags`** was deliberately named to avoid colliding with a future `skills` engine carrying proficiency semantics. Competency Management is exactly that engine. The review should decide whether Competency owns the canonical taxonomy and the LMS references it, rather than each product growing its own.

### 2c. Missing entirely — Orbit needs these and nothing here provides them

| Need | Current state |
|---|---|
| A **product** concept | No `products` table, no product identifier anywhere in schema or code. |
| **Product entitlement** per org | `plans`, `subscriptions` and `plans.feature_flags` exist but are **never referenced in application code** — see §4. |
| **Product-specific permissions** | Impossible today; roles are org-wide and single-valued. See §3. |
| **Product switcher** | No UI concept. Session resolution is single-point and ready for one, but nothing consumes it. |
| **Cross-product identity beyond org membership** | A user belongs to an org. There is no notion of "this user has access to LMS and 360 but not Performance". |
| **Shared design system** | 34 component files use inline styles; 2 use CSS classes. Orbit needs one visual language across products. |
| **Cross-product notifications** | No email/notification layer at all. |

---

## 3. Finding 1 — the role model is the real work

This is the single most consequential gap, so it is stated precisely.

**Current shape:**

```sql
role text not null default 'learner'
  check (role in ('learner', 'manager', 'org_admin', 'org_owner'))
```

One column. One role. Org-wide. Enforced by:

```sql
create or replace function has_role(min_role text) ... 
  select exists (select 1 from profiles where id = auth.uid() and role_rank(role) >= role_rank(min_role));
```

**Three distinct problems, which should not be conflated:**

1. **No product dimension.** A person who administers the LMS is, today, necessarily the same rank everywhere. Orbit explicitly requires product-specific permissions — an L&D manager who owns LMS content but is merely a participant in a 360 cycle, or an HR business partner who runs Performance but never touches course authoring. The current model cannot express this at all.

2. **The vocabulary is LMS-flavoured.** `learner` is meaningless in 360 Feedback (participant, reviewer, subject) and in Performance (employee, manager, reviewer). A platform-level base role cannot be called `learner`. This is not cosmetic: the string is in a CHECK constraint, a `role_rank()` SQL function, a TypeScript mirror (`lib/auth/roles.ts`), and the `withAuth({ minRole })` gate on most API routes.

3. **It is load-bearing.** `has_role()` appears in **59 policy expressions across 31 RLS-enabled tables**. Any change to its semantics touches all of them. This is not an argument against changing it — it is an argument for deciding the target shape *once*, deliberately, before writing the migration.

**What makes this tractable:** the pattern that makes it widespread is the same pattern that makes it changeable. Because every policy calls a *centralized helper* rather than hand-copied subqueries, the semantics live in one function. A product-aware `has_role(product, min_role)` — or a sibling `has_product_role()` — changes one definition and then a mechanical policy sweep, not 59 bespoke rewrites. That was the explicit reason the helper pattern was adopted in Phase 1, and this is the situation it was adopted for.

**Options the review should weigh** (this document deliberately does not choose):

- **A.** Keep one org-wide base role for platform concerns (org_owner / org_admin) and add a separate product-membership table carrying per-product roles.
- **B.** Move roles entirely to a `(user, product, role)` membership table, leaving `profiles.role` as a deprecated shim during migration.
- **C.** Keep the current column, add per-product overrides consulted only where products diverge.

Each has a different blast radius on the 59 policies and on `withAuth()`. That trade is the review's to make.

---

## 4. Finding 2 — the entitlement scaffolding is dormant, and that is good news

`plans`, `subscriptions`, and `plans.feature_flags jsonb` were created in Phase 1's first migration. Grepping application code for them returns **nothing** — no route, no library, no component reads them.

The practical consequence: **these tables can be reshaped for Orbit's product-entitlement model without breaking a single line of existing code.** There is no migration of live behaviour to manage, no compatibility shim, no consumers to coordinate. A rare free hand.

`organizations.plan_id` and `organizations.seats` are likewise unread by application code.

This is the natural home for "which Orbit products does this org have, and how many seats of each" — but it should be designed once for all products rather than extended ad hoc by whichever product needs it first.

---

## 5. Finding 3 — the seams that are already in the right place

Three things about the current architecture make the integration materially easier, and are worth protecting during it.

**Single session resolution point.** `lib/auth/session.ts` exports one `getSessionContext()`, used by both the route-group layouts (pages) and the `withAuth()` wrapper (API routes). Orbit's "one login/session model" has exactly one place to change, and a product switcher has exactly one place to read from. Phase 1 chose this over per-route session handling deliberately.

**Defense in depth, already layered.** Authorization is checked at the API layer *and* independently enforced by RLS underneath. Product-scoping can therefore be added at both layers without inventing a new enforcement mechanism.

**Standards conformance is genuinely portable.** SCORM 2004 and cmi5 export were verified passing in a real third-party LMS. Whatever happens to tenancy, that capability moves intact — it depends on `lib/spec` and `lib/export`, neither of which touches identity.

**One seam that is in the wrong place:** the API namespace is flat and LMS-assumed — `/api/v1/content`, `/api/v1/runtime`, `/api/v1/authoring`, `/api/v1/publishing`, alongside platform routes `/api/v1/orgs` and `/api/v1/platform-admin`. In a multi-product Orbit, `/api/v1/content` is ambiguous the moment 360 has content of its own. The review should decide a namespacing convention (`/api/v1/lms/...` versus `/api/v1/products/lms/...`) before a second product lands, because renaming routes after two products depend on them is worse than before.

---

## 6. Hosting

Orbit's public corporate site is on Vercel; a hosting decision for this codebase was recorded on 2026-08-21 to move it to Vercel as well. Relevant facts for the review:

- **There are zero Cloudflare imports in `app/`, `lib/` or `components/`.** The coupling is two root config files (`wrangler.jsonc`, `open-next.config.ts`) plus one standalone spike worker. The application is portable.
- **Cloudflare Workflows** was proven in a spike for durable multi-step jobs and remains the intended mechanism for AI course generation (Phase 3 step 8, unbuilt). Per the stated architecture decision, that background work may remain on Cloudflare even with the main platform on Vercel — nothing in the current code prevents that split, because the publishing pipeline was deliberately built as a plain async job rather than a Workflow.
- No Vercel configuration exists in this repo yet.

---

## 7. Risks the review should weigh

| Risk | Why it matters | Mitigation available today |
|---|---|---|
| **Role-model migration is decided per-product rather than once** | Two products each inventing product-scoped permissions produces exactly the inconsistent authorization the Phase 1 RLS discipline exists to prevent | Decide the target role shape before any product-specific work begins |
| **`learner` leaks into platform vocabulary** | A platform base role named for one product's users constrains every later product | Rename at the same time as the product dimension is added, not afterwards |
| **API namespace collision** | `/api/v1/content` is unambiguous today and ambiguous the moment 360 ships | Namespace before the second product, not after |
| **Two skills taxonomies** | LMS `skill_tags` and Competency Management could each grow one | Assign canonical ownership to Competency during the review |
| **Design divergence** | LMS UI is inline-styled scaffolding; a shared Orbit design system does not exist | Treat the LMS UI pass as an Orbit design-system adoption rather than an LMS-local fix |
| **Test-suite reliability** | The e2e suite passes in isolation but degrades over long runs as the local database container tires | Named in [DEFINITION_OF_DONE_PHASE3.md](DEFINITION_OF_DONE_PHASE3.md); should be fixed before it becomes a shared platform's regression gate |

---

## 8. Current state, for the record

Facts a reviewer will want without having to derive them:

| | |
|---|---|
| Migrations | 24, all applied and verified against a local instance |
| Tables with RLS | 31 (every table in `public`; enforced by a generic hygiene test) |
| `has_role()` policy expressions | 59 |
| API routes | 44 |
| Pages | 20 |
| Unit tests | 256, green |
| End-to-end tests | 41, green |
| Phases complete | 1 (SaaS foundation), 2 (content + core LMS) |
| Phase 3 | Steps 1–7 and 9 done; 8, 10, 11 outstanding — see [DEFINITION_OF_DONE_PHASE3.md](DEFINITION_OF_DONE_PHASE3.md) |

**Two items are honestly outstanding** and are repeated here so the review does not discover them late: the AI gateway has never called a real provider, and no package built by the publishing pipeline has been through a real third-party LMS (the *format* was proven by hand, the *pipeline's output* was not).

A third — the e2e suite's unreliability — **was closed on 2026-08-21**: 41/41 across three consecutive full-suite runs at ~3 minutes each. See [DEFINITION_OF_DONE_PHASE3.md](DEFINITION_OF_DONE_PHASE3.md) for the three root causes.

---

## 9. Suggested agenda for the review

Ordered by how expensive the decision is to reverse:

1. **Role model** — one of options A/B/C in §3, or a fourth. Everything else depends on it.
2. **Product and entitlement model** — the shape of `products`, org→product access, and seats. Free hand per §4.
3. **What is platform versus product** — ratify or amend §2a/§2b, specifically `content_assets`, `enrollments` and `skill_tags`.
4. **API namespacing convention** — before a second product exists.
5. **Unified Supabase project plan** — what the fresh Orbit project's first migration contains, and whether it starts from this codebase's tenancy migrations.
6. **Design system ownership** — whether the LMS UI pass adopts an Orbit system or precedes one.
7. **Hosting split** — confirm Vercel for the platform, Cloudflare for durable background jobs.

---

## 10. What would make the review sharper

Not blockers, but each would remove a guess:

- A schema summary of the existing 360 Feedback product's tenancy and role model, so §3's options can be evaluated against two real systems rather than one plus a hypothesis.
- The intended Orbit product list with, for each, its distinct user *roles* — the concrete input the role model needs.
- Whether Orbit orgs map one-to-one with customers, or whether a customer may hold several orgs (this changes whether `organizations` is sufficient as the tenant root).
