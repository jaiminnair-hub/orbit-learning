# Multi-Tenancy & RLS Design

an earlier project's core lesson (see the audit in the Stage 1 plan): row-level security applied table-by-table, after the fact, produces gaps — only ~30% of its tables ended up properly org-scoped. This design applies one pattern, once, everywhere, from the first migration.

## 1. Model

Shared database, shared schema, row-level isolation via Postgres RLS. Every tenant-owned table carries a non-null `org_id` (see [DATABASE.md](DATABASE.md) §1). Dedicated-database or schema-per-tenant isolation is out of scope for MVP — revisit only if a specific enterprise deal requires it.

## 2. Centralized helper functions

Three `SECURITY DEFINER` SQL functions, defined once in the first migration, and referenced by every table's RLS policy — never a hand-copied subquery per table.

```sql
-- Returns the calling user's org_id, or null if they belong to none / aren't authenticated.
create or replace function current_org_id() returns uuid
language sql stable security definer set search_path = public as $$
  select org_id from profiles where id = auth.uid() and deleted_at is null;
$$;

-- True if the calling user belongs to the given org (defaults to their own org).
create or replace function is_org_member(target_org uuid default current_org_id()) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and org_id = target_org and deleted_at is null
  );
$$;

-- True if the calling user holds at least the given role within their own org.
-- Role hierarchy: learner < manager < org_admin < org_owner.
create or replace function has_role(min_role text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid()
      and deleted_at is null
      and role_rank(role) >= role_rank(min_role)
  );
$$;

-- True if the calling user is a platform administrator (cross-tenant, see §4).
create or replace function is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from platform_admins where user_id = auth.uid());
$$;
```

`role_rank()` is a small lookup function mapping the role enum to an integer, so `has_role('manager')` also passes for an `org_admin` or `org_owner` without every policy re-deriving the hierarchy.

## 2a. Two things this section didn't originally mention, found while writing the Phase 1 test suite

Both are now implemented and covered by automated tests (`tests/`), and both are worth stating explicitly here so they aren't lost as "just something the migration happened to do":

**Privilege-escalation prevention.** RLS's `profiles_update_self` policy (§3) correctly restricts *which row* a user can update — but says nothing about *which columns*. As written, a learner could `UPDATE` their own `role` to `org_owner` and RLS alone would allow it. This is the exact vulnerability an earlier project actually had and fixed (`007_prevent_role_escalation.sql`, per the Stage 1 audit) — a `BEFORE UPDATE` trigger on `profiles` that silently reverts `role`/`org_id`/`department_id` to their prior values unless the caller is `service_role`, regardless of what RLS permitted. Proven to matter, not just present: the trigger was deliberately disabled once during testing, and the corresponding test was watched to fail for real before it was restored.

**Data API grants.** RLS controls *which rows* a role can see; it says nothing about whether that role can reach a table *at all* through PostgREST — that's a separate, more basic Postgres privilege layer (`GRANT`/`REVOKE`). A dashboard-created hosted Supabase project sets this up implicitly ("Automatically expose new tables"); a CLI-managed local project does not, and relying on an unversioned dashboard toggle for something this fundamental isn't acceptable. Every migration set now explicitly grants `SELECT` to `anon`, `SELECT`/`INSERT`/`UPDATE`/`DELETE` to `authenticated`, and full access to `service_role` on every table — plus `ALTER DEFAULT PRIVILEGES` so future tables inherit this automatically. Safe to grant broadly at the table level specifically because RLS is the real row-level gate underneath it.

## 3. Standard policy shape

Every tenant table gets the same four policies, differing only in the `has_role()` threshold for writes:

```sql
alter table <table> enable row level security;

create policy <table>_select on <table>
  for select using (org_id = current_org_id() or is_platform_admin());

create policy <table>_insert on <table>
  for insert with check (org_id = current_org_id() and has_role('<min_role_to_create>'));

create policy <table>_update on <table>
  for update using (org_id = current_org_id() and has_role('<min_role_to_edit>'))
  with check (org_id = current_org_id());

create policy <table>_delete on <table>
  for delete using (org_id = current_org_id() and has_role('<min_role_to_delete>'));
```

No table ships without all four. This is a code-review checklist item, not a convention left to memory — the single fix that would have prevented most of an earlier project's tenancy debt.

## 4. Platform administrator cross-tenant access

an earlier project's superadmin model was a single hardcoded email layered inconsistently over its `role` column — incompatible with a real multi-tenant product and a genuine security gap (any table an admin needed to see cross-tenant either bypassed RLS via the service-role key with no consistent audit trail, or simply wasn't visible to them).

**This platform's replacement:**

- A dedicated `platform_admins` table (`user_id → auth.users`, not `profiles`) — small, hand-managed, reviewed periodically. Platform admin is a **role grant**, not an identity check.
- `is_platform_admin()` is referenced in every table's `_select` policy (read-only cross-tenant access at the RLS layer), **but never in `_insert`/`_update`/`_delete` policies** — a platform admin can see any tenant's data for support/ops purposes but cannot silently *write* into a tenant's data through the same path a tenant user would use.
- Any cross-tenant **write** a platform admin genuinely needs (e.g. disabling a tenant for non-payment) goes through a dedicated `/api/platform-admin/*` route that uses the service-role client explicitly, requires `is_platform_admin()` at the application layer too (defense in depth), and **must** write an `activity_log` row with `is_platform_admin_action = true` before the operation is considered complete — enforced in the route handler, tested in [TESTING.md](TESTING.md) §5.
- Every cross-tenant **read** via the RLS carve-out above is *also* logged — a lightweight `activity_log` entry is written whenever a platform-admin-scoped query executes (implemented at the API-route layer, since RLS itself cannot easily trigger on `SELECT`).

**Implemented (2026-08-14):** `GET /api/v1/platform-admin/orgs` (`app/api/v1/platform-admin/orgs/route.ts`) is the first real instance of this pattern — checks `is_platform_admin()` via RPC, reads through the caller's own session client (RLS does the actual cross-tenant permitting), then writes the `activity_log` row via a new service-role client (`lib/supabase/admin.ts`). Verified against the real project with a genuine platform-admin test user who had zero membership in the org they successfully read, and by querying `activity_log` afterward and finding the row. No cross-tenant **write** route exists yet — build one when a real use case needs it.

**Org creation is now platform-owner-only (2026-09-03).** `POST /api/v1/platform-admin/orgs` (`requirePlatformOwner()`, creates the org plus a first-owner invitation) was, until this date, one of *two* ways to create a tenant — a self-serve `POST /api/v1/orgs` also let any signed-up user with no `org_id` create their own org and become its owner, with zero platform gating. That route has been removed entirely; a user with no org now sees a "waiting for your workspace" notice (`app/(app)/dashboard/create-org-form.tsx`) instead of a create-org form. Platform Control's Organisations tab is the sole door for new tenants, matching the platform-owner-provisions-everything model.

## 5. Isolation checklist — applied to every surface, not just tables

| Surface | Mechanism |
|---|---|
| Users, courses, assessments, progress, certificates | Non-null `org_id` + the standard policy shape above, no exceptions |
| Files (SCORM packages, uploads, certificates) | Storage paths namespaced `org_id/...`; signed URLs generated server-side only, scoped to the requesting user's org |
| AI knowledge base (RAG) | `ai_knowledge_chunks.org_id` mandatory; every retrieval query filters by `org_id = current_org_id()` **before** the vector similarity search runs, never after — see [AI_ARCHITECTURE.md](AI_ARCHITECTURE.md) §5 |
| Reports & analytics | Same RLS boundary as source tables — no separate, more-permissive reporting database or view |
| Branding / configuration | Per-org `tenant_settings` row, not environment variables |
| Integrations / webhooks (future) | Per-org, encrypted-at-rest credential rows, never shared across tenants |
| Email | Every outbound email template resolves org-scoped data only; no cross-tenant recipient lists possible by construction |

## 6. What Phase 1 must prove before anything else is built

The exact test matrix (Org A cannot read Org B's courses/users/assessments/reports/files/AI content, under any role, including edge cases around platform-admin access) is specified as executable tests in [TESTING.md](TESTING.md) §5 and is the gating criterion in [DEFINITION_OF_DONE.md](DEFINITION_OF_DONE.md). No content, assessment, or AI feature work begins until that suite is green.

**Status (2026-08-14):** the users/orgs/departments/invitations/subscriptions/activity-log portion of this matrix is done — 12 tests in [`tests/`](../tests), green locally against a disposable Docker-based Supabase instance and in CI on every push. Courses/assessments/files/AI-RAG rows don't apply yet (those tables arrive in later phases); each phase extends this same suite rather than writing a new one.
