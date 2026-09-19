# Orbit Platform Integration Review

**Prepared 2026-08-21. This is a design review, not an implementation.** No application code, migration, tenancy, authentication, organization, profile, role, invitation or deployment configuration has been modified. No Orbit 360 Supabase project was connected to or read. No secrets, tokens or environment values appear anywhere in this document.

Every SQL shape below is **illustrative of a proposed target**, written to make the design reviewable. None of it has been applied, and §11 lists the changes as a worklist precisely so the decisions in §2 can be made before anything is written.

---

## 0. The shape of the problem

Orbit is modular. Organization A buys LMS only; B buys 360 only; C buys LMS + Growth; D buys everything. That single sentence sets the whole design, because it means **three independent questions must all be answered "yes" before a request is served**:

1. **Membership** — is this person a member of this organization?
2. **Entitlement** — has this organization purchased this product, and is that purchase currently active?
3. **Product role** — does this person hold a role in this product, within this organization?

None implies another. A person can be a member of an org that has no LMS entitlement. An org can hold an LMS entitlement while a given member has no LMS role. A person can be an LMS content author in one org and have no LMS access at all in another.

The current LMS collapses all three into one column (`profiles.role`) because it only ever had to answer one question for one product. That is the gap.

---

## 1. Preferred target schema

### 1.1 Design principles

Four decisions shape everything below. Each is argued where it is non-obvious.

**(a) Organization is the tenant boundary, and stays so.** Every product table keeps `organization_id`. Nothing about modularity changes tenant isolation.

**(b) Organization roles and product roles are separate concepts, not one hierarchy.** Some authority is genuinely organizational and product-independent: who invites people, who manages billing, who sees the org chart. Some is genuinely product-scoped: who authors courses, who administers a feedback cycle. Modelling both as one list forces "billing admin" to become a role of a pseudo-product.

**(c) Organization role does NOT imply product access.** This is the most consequential call in the document, and it is specific to HR software. An IT administrator who provisioned the organization must not automatically be able to read every employee's 360 feedback about their peers. `org_admin` can **grant** product roles — including to themselves, audibly — but never **inherits** them. Implicit escalation is how confidential HR data leaks without anyone deciding it should.

**(d) Product membership is coarse; per-resource assignment stays in the product.** "This person may participate in feedback cycles" is a platform-level product role. "This person is a reviewer for cycle #47" is 360's domain and belongs in 360's own `participants`/`reviewers` tables. Pushing per-cycle assignment into the platform layer would make the platform grow a foreign key for every product's resource model. See §4.3.

### 1.2 Platform tables

```sql
-- Reference table. Rows, not an enum, so adding a product is data.
products (
  key            text primary key,          -- 'lms', 'feedback', 'growth', 'competencies'
  name           text not null,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now()
)

-- Explicit membership. Replaces profiles.org_id, and is what makes
-- one person in several organizations expressible at all.
organization_memberships (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  org_role        text not null check (org_role in ('org_owner','org_admin','manager','employee')),
  -- Department is org-scoped, so it belongs here rather than on profiles:
  -- a person in two organizations has a department in each.
  department_id   uuid references departments(id) on delete set null,
  status          text not null default 'active'
                  check (status in ('active','invited','suspended')),
  joined_at       timestamptz,
  invited_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, user_id)
)

-- Which organization the session is currently acting in.
-- One row per user; switching organizations is a single update.
user_active_organization (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  set_at          timestamptz not null default now()
)

-- What the organization has bought.
organization_product_entitlements (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  product_key     text not null references products(key),
  status          text not null
                  check (status in ('trial','active','suspended','cancelled')),
  plan_tier       text,                     -- 'starter' | 'pro' | 'enterprise', product-defined
  starts_at       timestamptz not null default now(),
  ends_at         timestamptz,              -- null = open-ended
  seat_limit      integer,                  -- null = unlimited
  feature_flags   jsonb not null default '{}'::jsonb,
  provider_ref    text,                     -- billing provider handle, placeholder
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, product_key)
)

-- What the person may do inside a product they are entitled to.
product_role_assignments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  product_key     text not null references products(key),
  product_role    text not null,            -- validated per product; see 1.3
  granted_by      uuid references auth.users(id) on delete set null,
  granted_at      timestamptz not null default now(),
  expires_at      timestamptz,              -- for external coaches and temporary access
  unique (organization_id, user_id, product_key, product_role)
)
```

`platform_admins` stays exactly as it is — Orbit internal staff, deliberately outside the customer role hierarchy, with cross-tenant reads audited to `activity_log`. That separation already works and should not be folded into memberships.

**Why `product_role` is `text` and not an enum:** the valid roles differ per product, and a single enum spanning all products would be validated wrongly (nothing stops `competency_admin` being assigned against `lms`). Either add a `product_roles(product_key, role)` reference table and make it a composite FK, or validate in the grant function. The composite-FK route is stricter and is the recommendation:

```sql
product_roles (
  product_key  text not null references products(key),
  role         text not null,
  description  text,
  primary key (product_key, role)
)
-- then product_role_assignments gains:
--   foreign key (product_key, product_role) references product_roles(product_key, role)
```

That makes "assign an LMS role that does not exist" a database error rather than a runtime discovery.

### 1.3 Seed role vocabulary

| Product | Roles |
|---|---|
| *(organization level)* | `org_owner`, `org_admin`, `manager`, `employee` |
| `lms` | `learner`, `l_and_d_admin`, `content_author`, `instructor`, `learning_manager` |
| `feedback` | `feedback_admin`, `subject`, `reviewer`, `coach`, `report_viewer` |
| `growth` | `performance_admin`, `manager`, `employee`, `review_calibrator` |
| `competencies` | `competency_admin`, `framework_author`, `assessor`, `employee` |

Note `manager` and `employee` appear both at organization level and inside `growth`. That is not a mistake, but it is a trap: `growth.manager` means "runs performance reviews for their reports", while org-level `manager` means "has direct reports in the org chart". They will usually coincide and must not be assumed to. The composite key `(product_key, role)` keeps them distinct in storage; documentation must keep them distinct in people's heads.

### 1.4 Permission evaluation

Access to a product resource requires all of:

```
membership.status = 'active'
  AND entitlement.status IN ('trial','active')
  AND entitlement window contains now()
  AND a matching product_role_assignment exists (unexpired)
```

Expressed as helpers, which is what the policies actually call:

```sql
-- Rewritten: reads the active organization rather than profiles.org_id.
-- Changing this one body is what migrates all 59 existing policies.
current_org_id() returns uuid

is_org_member(target_org uuid default current_org_id()) returns boolean
has_org_role(min_role text) returns boolean          -- ranked, as today

has_product_entitlement(product_key text) returns boolean
has_product_role(product_key text, role text) returns boolean

-- The composite the product policies call.
can_access_product(product_key text, required_role text default null) returns boolean
```

`can_access_product` is the single entry point product policies use, so the three-part rule lives in one place rather than being re-expressed per table — the same discipline that made the current 59 policies uniform and is the reason this migration is tractable at all.

---

## 2. Role-model options

### Option A — organization role plus a separate product-role table *(recommended)*

Org roles stay a small, product-independent set on membership. Product roles live in `product_role_assignments`.

- **For:** models the domain as it actually is; org-level authority (billing, invitations) has a natural home; a product can add roles without touching the platform; the two concerns can be reasoned about and audited separately.
- **Against:** two lookups instead of one; precedence rules must be explicit (see §1.1c); slightly more to explain to an administrator.

### Option B — everything in one `(user, product, role)` table

Abolish org-level roles; make org-level concerns a pseudo-product (`platform`).

- **For:** one table, one mental model, one helper.
- **Against:** "who can manage billing" becomes a role of a product that is not a product, which is a modelling lie that will leak into UI copy and into support conversations. It also makes the common case — an ordinary employee with no product roles — require a row that says nothing.

### Option C — keep `profiles.role`, add per-product overrides

Leave the current column as the default, consult an override table only where a product diverges.

- **For:** smallest immediate diff; existing policies keep working untouched.
- **Against:** it encodes exactly the inheritance §1.1c argues against — the default *is* implicit product access. It also keeps `learner` as a platform-level role name, and "default plus override" is materially harder to answer questions about ("why can this person see that?") than an explicit grant.

### Recommendation

**Option A.** It matches the stated target direction, it is the only one of the three in which the answer to "why does this person have access?" is a single row you can point at, and its main cost — two lookups — is absorbed by one composite helper and an index.

The decisive argument is confidentiality rather than elegance. In an HR platform, the question that eventually gets asked in a security review is *"can the person who administers our tenant read individual 360 feedback?"* Under Option A the answer is "only if someone explicitly granted them a feedback role, and here is the row and who granted it." Under C the honest answer is "yes, by default."

---

## 3. Mapping the current LMS role model

Current: one `profiles.role` per user, org-wide, from `('learner','manager','org_admin','org_owner')`.

| Current LMS role | → Organization role | → `lms` product roles |
|---|---|---|
| `learner` | `employee` | `learner` |
| `manager` | `manager` | `learner`, `learning_manager` |
| `org_admin` | `org_admin` | `l_and_d_admin`, `content_author` |
| `org_owner` | `org_owner` | `l_and_d_admin`, `content_author` |

Three notes on the backfill:

**It is deterministic.** LMS is the only product today, so every existing profile maps to exactly one membership row plus one or two product-role rows. No judgement calls, no data loss.

**`org_admin` and `org_owner` receive product roles explicitly during backfill.** This looks like it contradicts §1.1c, and it does not: the backfill is granting what those users already effectively had, so it preserves behaviour. The principle applies to *new* administrators created after the migration, who start with organizational authority and no product access until granted.

**`instructor` has no current equivalent** and stays unassigned. It exists for instructor-led training (Phase 5) and should not be invented into the backfill.

The API-layer counterpart, `withAuth({ minRole })`, gains a product-aware sibling rather than being replaced — see §7.

---

## 4. Mapping the current 360 Feedback model

Current 360: `workspace_role` per user, org-wide, from `('hr_admin','manager','employee','reviewer','coach')`, with helpers `current_organization_id` and `is_hr_admin`.

### 4.1 The mapping

| Current 360 role | → Organization role | → `feedback` product roles | Note |
|---|---|---|---|
| `hr_admin` | `org_admin` | `feedback_admin`, `report_viewer` | The org-level half is a judgement call — see 4.2 |
| `manager` | `manager` | `report_viewer` | Team-report visibility, not cycle administration |
| `employee` | `employee` | `subject` | |
| `reviewer` | *(unchanged, usually `employee`)* | `reviewer` | Not an organizational role at all — see 4.3 |
| `coach` | `employee`, or membership with `status` reflecting external | `coach` | Often external — see 4.4 |

### 4.2 `hr_admin` is two things wearing one name

In the current schema `hr_admin` grants both "administers this organization" and "administers feedback cycles". Those separate cleanly, and separating them is most of the value of the migration for 360: an HR business partner who runs cycles does not necessarily manage billing or invite users, and the person who does manage billing should not automatically read feedback.

Recommended default: map `hr_admin` → org `org_admin` **plus** `feedback_admin`, preserving current behaviour, then review individual users afterwards and demote the ones who only ever needed the product half. The migration should not silently reduce anyone's access; the follow-up review should.

### 4.3 `reviewer` and `subject` are per-cycle, not per-product

This is the most important structural finding about the 360 mapping, and it is the reason §1.1d exists.

A person is not permanently "a reviewer". They are a reviewer **for cycle #47**, and a subject **in cycle #52**, and neither next quarter. Modelling that as a platform product-role assignment would mean either granting a permanent role that overstates access, or writing platform rows per cycle — at which point the platform layer has grown a foreign key to a 360 resource.

**Recommendation:** the platform product role means *capability to participate* — `reviewer` grants "may be assigned as a reviewer and may see reviewer surfaces". Which cycles, which subject, which questions stays in 360's existing `participants` and `reviewers` tables, and 360's own RLS policies gate row access on those. The platform answers "may this person open the feedback product at all"; the product answers "may they see this cycle".

This keeps the boundary clean and means 360 keeps its domain model rather than having it flattened into the platform.

### 4.4 External coaches

Coaches are frequently not employees of the organization. They still need scoped access. The model supports this without a new concept: an `organization_memberships` row with org role `employee` and a single `feedback`/`coach` product-role assignment carrying an `expires_at`.

If "external" needs to be visible in the UI — and it probably does, since showing an outside coach in the employee directory would be wrong — add a boolean or a membership `kind` column rather than a new role. That is a decision for the review; this document flags it rather than settling it.

### 4.5 Helper equivalences

`current_organization_id` → `current_org_id()`. `is_hr_admin` → splits into `has_org_role('org_admin')` and `has_product_role('feedback','feedback_admin')`, and every call site must be examined to decide which it meant. This is unavoidable manual work and should be planned for rather than discovered.

---

## 5. Authorization decision flow

```
1. Authenticated?              auth.uid() present
       ↓ no → 401
2. Active organization?        user_active_organization → organization_id
       ↓ none → 409, prompt organization selection
3. Active membership?          organization_memberships (org, user).status = 'active'
       ↓ no → 403  (also: clear the stale active-organization row)
4. Product entitled?           organization_product_entitlements (org, product)
                               status IN ('trial','active') AND window contains now()
       ↓ no → 402 / 404  (see below)
5. Product role sufficient?    product_role_assignments (org, user, product, role)
       ↓ no → 403
6. Row visible?                RLS: organization_id = current_org_id() AND product predicate
       ↓ no → empty result, never a leak
```

Two deliberate choices in that ladder.

**Step 4's status code.** For a *navigation* request, an unentitled product should read as though it does not exist — the customer has not bought it and should not be shown a locked door with an upsell they did not ask for, unless Orbit decides upsell is wanted. For an *API* request from a client that should have known better, `402 Payment Required` is more diagnosable. Recommendation: `404` on page routes, `402` on API routes with a machine-readable code. This is a product decision as much as a technical one and is listed as open in §10.

**Steps 4 and 5 are enforced twice** — once at the route layer for a clean error, once in RLS so a route-layer bug cannot leak rows. That is the same defense-in-depth the current codebase already uses for org scope, extended to products.

### 5.1 Does entitlement belong in RLS?

The stated requirement is that data stays inaccessible when the organization does not have the product. Taken literally that means yes, and the recommendation is yes — with one carve-out that must be designed in rather than discovered.

**The carve-out:** if RLS hides rows the moment an entitlement lapses, then a customer whose card fails on Friday cannot export their own data on Saturday, and support cannot see the account to help them. That is a bad outcome for a non-payment event.

Recommended shape:

- `status IN ('trial','active')` → full access.
- `status = 'suspended'` → **read-only access retained**, writes refused. This is the non-payment state, and it lets a customer see what they are about to lose.
- `status = 'cancelled'` → access removed by policy; data retained in the database; export available through a `platform_admin`-operated service-role path with an audit row.

Encoding that as one helper (`has_product_entitlement` returning true for trial/active, plus a separate `has_product_read_entitlement` including suspended) keeps the nuance in one place instead of scattered across policies.

---

## 6. API namespace strategy

### 6.1 Target

```
/api/v1/platform/...        organizations, memberships, invitations, entitlements, switcher
/api/v1/lms/...             courses, content, authoring, runtime, publishing
/api/v1/feedback/...        cycles, participants, reviewers, reports
/api/v1/growth/...
/api/v1/competencies/...
```

Today's LMS routes are flat and product-assumed: `/api/v1/content`, `/api/v1/runtime`, `/api/v1/authoring`, `/api/v1/publishing`, `/api/v1/enrollments`, `/api/v1/progress`, alongside genuinely platform routes `/api/v1/orgs` and `/api/v1/platform-admin`. `/api/v1/content` becomes ambiguous the moment 360 has content of its own.

### 6.2 Backward-compatible migration

Nothing is renamed in this task. The recommended sequence, once approved:

**Step 1 — add, don't move.** Create the namespaced route file and re-export the existing handler:

```ts
// app/api/v1/lms/content/assets/route.ts
export { GET, POST } from "@/app/api/v1/content/assets/route";
```

Two paths, one implementation, zero duplication, zero behaviour change. Both are live and identical.

**Step 2 — move clients.** Point the app's own `fetch` calls at the new paths. Internal-only consumers make this cheap; the LMS has no external API consumers today, which is exactly why doing it now is cheaper than later.

**Step 3 — mark the old paths deprecated.** Add `Deprecation` and `Sunset` response headers and log usage. Do not redirect: a `308` on a `POST` is honoured inconsistently by clients and would turn a rename into an outage.

**Step 4 — remove when the logs are quiet.** The logs, not the calendar, decide.

**Step 5 — invert.** Once removed, the implementation moves into the namespaced file and the re-export disappears.

The whole sequence is revertible at every step, which is the point.

---

## 7. Phased implementation plan

The constraint throughout: **the LMS keeps working, and every phase is independently revertible.**

**Phase 0 — decisions.** §2's role model, §5.1's entitlement semantics, §10's open questions. Nothing is built until these are settled; building first is how two products end up with two authorization models.

**Phase 1 — additive platform tables.** Create `products`, `product_roles`, `organization_memberships`, `user_active_organization`, `organization_product_entitlements`, `product_role_assignments`. Backfill from `profiles` per §3. **No helper or policy changes.** The new tables are written and read by nothing; the LMS is untouched and cannot regress.

**Phase 2 — helpers, behind the same names.** Rewrite `current_org_id()` to read `user_active_organization`, falling back to the single membership when a user has exactly one. Because all 59 policies call the helper rather than inlining the subquery, **this migrates every policy at once without touching them** — the single biggest reason the current codebase is a viable starting point. Add `has_product_entitlement`, `has_product_role`, `can_access_product` alongside. Extend the tenant-isolation suite before flipping, not after.

**Phase 3 — product gating on LMS.** Add `can_access_product('lms', …)` to LMS table policies and an `withProduct('lms')` API wrapper beside the existing `withAuth`. LMS is the only product, every org gets an `lms` entitlement in backfill, so the observable behaviour is unchanged — which is what makes this phase safe to verify.

**Phase 4 — session and switcher.** `getSessionContext()` gains active organization, membership list, entitlements and product roles. Build the switcher UI. This is the first user-visible change.

**Phase 5 — API namespace.** §6.2, steps 1–3.

**Phase 6 — 360 onto the platform.** In the fresh unified Supabase project: platform tables first, then 360's domain tables adapted per §4, with 360's `workspace_role` mapped rather than carried over.

**Phase 7 — retire the shims.** Drop `profiles.role` and `profiles.org_id`, remove the deprecated routes, remove the single-membership fallback in `current_org_id()`.

LMS product work (Phase 3 steps 8/10/11, billing, certificates) can proceed in parallel throughout Phases 1–2 and pauses only briefly around Phase 3.

---

## 8. Supabase and RLS guidance

**Evaluate helpers once per statement, not once per row.** Write `organization_id = (select current_org_id())` rather than `organization_id = current_org_id()`. The subquery form is hoisted to an InitPlan and evaluated once; the bare call can be re-evaluated per row. With three lookups now behind `can_access_product`, this stops being a micro-optimization and starts mattering on large tables. Worth auditing the existing 59 policies for at the same time.

**Keep helpers `stable security definer` with `set search_path = public`.** Already the pattern; it must survive the rewrite. `security definer` is what lets a policy on `courses` read `organization_memberships` without the caller needing rights to that table.

**Index for the access path.** `organization_memberships (user_id, organization_id)`, `organization_product_entitlements (organization_id, product_key)`, `product_role_assignments (organization_id, user_id, product_key)`. Each is the exact lookup a helper performs on every policy evaluation.

**`user_active_organization` needs its own RLS** — a user reads and writes only their own row. Switching organization is an authenticated write of a single row, and the write must re-validate membership; a stale row pointing at an organization the user was removed from must not grant anything, which is why membership is checked at step 3 of §5 independently of the active-org lookup.

**Prefer the table over a JWT claim, initially.** Putting `active_org_id` in a custom access-token claim removes a lookup, but it goes stale: revoking membership does not invalidate an issued token, so a removed user keeps access until expiry. Start with the table, where revocation is immediate. If profiling later shows the lookup matters, a claim can be added as a cache with a short TTL — but that is an optimization to earn, not a starting point.

**Writes to `product_role_assignments` are the new privilege boundary.** Whoever can insert there can grant themselves anything the organization is entitled to. Restrict to `org_admin`+ *and* write an `activity_log` row for every grant and revoke. Self-grants should be permitted (an admin setting themselves up is legitimate) and conspicuous.

**Extend the existing test suite rather than starting one.** `tests/tenant-isolation.test.ts` is a single shared suite every phase has added to, and `tests/schema-hygiene.test.ts` already fails CI if any table lacks RLS. The new matrix to prove: for each product, a member of an entitled org with a role sees data; a member of an entitled org *without* a role does not; a member of a *non-entitled* org does not; a member of another org does not. That is four cases per product and should be table-driven.

---

## 9. Portability — Cloudflare, OpenNext, Vercel

**The application is already portable.** There are zero Cloudflare imports in `app/`, `lib/` or `components/`. The coupling is two root config files (`wrangler.jsonc`, `open-next.config.ts`) plus one standalone spike worker. Moving the web tier to Vercel is a configuration change, not a rewrite — and it removes the Next-on-Workers compatibility caveats the project has been carrying for ISR, `next/image` and `next/og`.

**Background work is the real question, and it splits cleanly in two.**

*Request-scoped work* — package building, already built in Phase 3 step 9 — runs in Next's `after()`: the response returns immediately and the work completes on the same invocation. That is host-neutral and works on Vercel today. Note Vercel's function duration limits apply; a large course with heavy media could exceed them, which is a reason to keep an eye on package sizes rather than a reason to change architecture now.

*Durable multi-step work* — AI course generation, Phase 3 step 8, unbuilt — is different. The Phase 1 spike proved Cloudflare Workflows carrying a 244-second run across two hibernations. Vercel has no equivalent primitive.

**Recommendation: keep the durable-jobs worker on Cloudflare, as the architecture decision already permits, and put an interface in front of it.** A small `JobRunner` contract (`enqueue`, `status`, `cancel`) with a Cloudflare Workflows implementation means the platform can move to a queue service (Inngest, QStash, Trigger.dev) or Supabase Edge Functions plus `pg_cron` later without touching the features that enqueue jobs. `authoring_jobs` already models job state in Postgres, so status and cancellation are readable from the web tier regardless of which host executes the work.

The split — Vercel for the web tier, Cloudflare for durable jobs, Supabase for data — is a normal shape and should be documented as intentional rather than left looking like a migration that stalled halfway.

---

## 10. Risks, open decisions, non-goals

### Risks

| Risk | Consequence | Mitigation |
|---|---|---|
| Role model decided per-product | Two products, two authorization models — exactly what the Phase 1 RLS discipline exists to prevent | Phase 0 gate; nothing built until §2 is settled |
| `current_org_id()` rewritten without full test coverage first | Silent cross-tenant exposure across 59 policies simultaneously | Extend the isolation suite in Phase 2 *before* the helper changes; the suite is the gate, not the review |
| Entitlement checked only at the route layer | One missed wrapper leaks a whole product's data | Enforce in RLS too (§5.1) |
| Per-cycle 360 assignment pushed into platform tables | Platform grows foreign keys into every product's resource model | §1.1d / §4.3 boundary held explicitly |
| Composite helper evaluated per row | Query degradation on large tables under three lookups | `(select helper())` form; indexes per §8 |
| `learner` survives into platform vocabulary | A platform base role named for one product constrains every later product | Rename during Phase 1 backfill, not afterwards |
| Two skills taxonomies | LMS `skill_tags` and Competency Management each grow one | Assign canonical ownership to Competency in Phase 0 |
| ~~E2E suite unreliable under load~~ | **Closed 2026-08-21** — 41/41 across three consecutive runs at ~3 min; root causes were the dev-server compile model, the harness hammering the Docker API, and one label-based assertion | Done before Phase 2, as recommended |

### Open decisions

1. **Unentitled product response** — `404` (invisible) or `402` (explicit upsell)? Product decision; §5 recommends 404 on pages, 402 on APIs.
2. **`suspended` semantics** — read-only retained, per §5.1, or full block?
3. **External membership** — does `organization_memberships` need a `kind` (`employee` / `external`) so outside coaches are excluded from directories?
4. **Does `org_admin` see the *existence* of products it holds no role in?** Managing entitlements arguably requires seeing that `feedback` is entitled, without seeing any feedback data. Recommend yes to metadata, no to data.
5. **Seat counting** — does `seat_limit` count memberships, or members holding a product role? The latter is the commercially meaningful number for a modular platform.
6. **Canonical skills taxonomy owner** — Competency Management, presumably.
7. **Does `profiles` survive at all,** or does everything move to `organization_memberships` plus `auth.users`? `full_name` is arguably per-person; `department_id` is definitely per-membership.

### Non-goals — explicitly out of scope

- **Parent-company / group hierarchy.** Noted as a future consideration only. An organization remains the tenant boundary, and nothing in this design forecloses adding a parent later — but modelling it now would complicate every policy for a requirement that does not yet exist.
- **Merging the LMS database into the 360 database.** Ruled out. The target is a fresh unified project.
- **Production integration or deployment.** None in this task.
- **Cross-product reporting and people analytics.** A later product with its own aggregation design; the entitlement model should not be bent to anticipate it.
- **SSO / SCIM.** Membership provisioning by identity provider is a Phase 7+ concern, though `organization_memberships` is the right table for it to write to.
- **Per-cycle or per-resource permissions in the platform layer.** §1.1d.

---

## 11. Exact future database changes

**A worklist, not an instruction to proceed.** Nothing below has been written, and none of it should be until §2 and §10's open decisions are settled.

### 11.1 New tables

| Table | Purpose |
|---|---|
| `products` | Product registry keyed by `product_key` |
| `product_roles` | Valid roles per product; composite FK target |
| `organization_memberships` | Explicit user↔org membership, org role, department, status |
| `user_active_organization` | Active organization per session |
| `organization_product_entitlements` | What each org has bought, with status, window, seats, flags, provider ref |
| `product_role_assignments` | Product roles per user per org, with grantor and optional expiry |

Each needs `org_id`-scoped RLS in the same migration that creates it, per the standing rule that no table is created first and secured later.

### 11.2 Altered tables

| Change | Note |
|---|---|
| `profiles.role` → deprecate, later drop | Keep during transition; remove in Phase 7 |
| `profiles.org_id` → deprecate, later drop | Superseded by `organization_memberships`; referenced by `current_org_id()`, so it must survive until Phase 2 lands |
| `profiles.department_id` → move to membership | Department is org-scoped; a user in two orgs has two departments |
| `organizations.plan_id`, `organizations.seats` → deprecate | Superseded by entitlements. **Both are currently unread by application code**, so this is free |
| `plans`, `subscriptions` → reshape or retire | Also **never referenced by application code**; a free hand |

### 11.3 Functions

| Function | Change |
|---|---|
| `current_org_id()` | **Rewrite body** to read `user_active_organization`, with a single-membership fallback. Signature unchanged, so all 59 policies follow automatically |
| `is_org_member(uuid)` | Rewrite to query memberships |
| `has_role(text)` | Rename to `has_org_role(text)`; keep a thin `has_role` shim during transition |
| `role_rank(text)` | Update ranks for the new org vocabulary (`org_owner` > `org_admin` > `manager` > `employee`) |
| `has_product_entitlement(text)` | **New** |
| `has_product_read_entitlement(text)` | **New** — includes `suspended`, per §5.1 |
| `has_product_role(text, text)` | **New** |
| `can_access_product(text, text)` | **New** — the composite product policies call |

### 11.4 Constraint and vocabulary changes

- `profiles.role` CHECK: drop `learner`, adopt `employee` — or drop the column entirely per Phase 7.
- New CHECKs on membership `org_role`, entitlement `status`, membership `status`.
- Composite FK `product_role_assignments (product_key, product_role) → product_roles`.

### 11.5 Indexes

- `organization_memberships (user_id, organization_id)` — the membership lookup
- `organization_memberships (organization_id, org_role)` — "who administers this org"
- `organization_product_entitlements (organization_id, product_key)` — the entitlement lookup
- `product_role_assignments (organization_id, user_id, product_key)` — the role lookup
- Partial index on active entitlements if the table grows

### 11.6 Policy sweep

All 59 `has_role()` expressions across 31 RLS-enabled tables need review — most become `has_org_role()` mechanically, while LMS product tables additionally gain `can_access_product('lms', …)`. The sweep is mechanical *because* the helper pattern was adopted in Phase 1; it would be 59 bespoke rewrites otherwise. Audit for the `(select …)` form at the same time (§8).

### 11.7 Backfill

1. One `organization_memberships` row per existing profile, `org_role` per §3.
2. One `organization_product_entitlements` row per organization: `product_key = 'lms'`, `status = 'active'`.
3. `product_role_assignments` per §3's mapping.
4. `user_active_organization` seeded from each profile's single `org_id`.
5. Verify counts match `profiles` before any policy switches over.

---

## Appendix — current state

| | |
|---|---|
| Migrations | 24, applied and verified locally |
| Tables with RLS | 31 (every table in `public`) |
| `has_role()` policy expressions | 59 |
| API routes | 44 |
| Unit / E2E tests | 256 / 41, green |
| Phases complete | 1 (SaaS foundation), 2 (content + core LMS) |
| Phase 3 | Steps 1–7 and 9 done; 8, 10, 11 outstanding |

**Two items outstanding** from Phase 3, repeated so the review does not meet them late: the AI gateway has never called a real provider, and no package built by the publishing pipeline has been through a real third-party LMS.

A third — the E2E suite not being a dependable regression gate, which mattered most here because a platform migration of this size would rely on it — **was closed on 2026-08-21**: 41/41 across three consecutive full-suite runs at ~3 minutes each, down from 8–24 minutes with a rotating cast of failures.

Companion document: [ORBIT_INTEGRATION_READINESS.md](ORBIT_INTEGRATION_READINESS.md), which assesses what in this codebase is platform material versus LMS material.
