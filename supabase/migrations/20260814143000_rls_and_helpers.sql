-- RLS + centralized helper functions, applied to every table from the
-- previous migration. See docs/MULTI_TENANCY.md §2-3 for the design
-- rationale — one policy shape, everywhere, from the first migration,
-- rather than an earlier project's table-by-table retrofit pattern.

-- ---------------------------------------------------------------------
-- Role hierarchy helper (learner < manager < org_admin < org_owner)
-- ---------------------------------------------------------------------
create or replace function role_rank(role text)
returns integer
language sql
immutable
as $$
  select case role
    when 'learner' then 1
    when 'manager' then 2
    when 'org_admin' then 3
    when 'org_owner' then 4
    else 0
  end;
$$;

-- ---------------------------------------------------------------------
-- current_org_id() — the calling user's own org, or null
-- ---------------------------------------------------------------------
create or replace function current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from profiles where id = auth.uid() and deleted_at is null;
$$;

-- ---------------------------------------------------------------------
-- is_org_member(target_org) — defaults to the caller's own org
-- ---------------------------------------------------------------------
create or replace function is_org_member(target_org uuid default current_org_id())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and org_id = target_org and deleted_at is null
  );
$$;

-- ---------------------------------------------------------------------
-- has_role(min_role) — true if the caller holds at least this role
-- within their own org
-- ---------------------------------------------------------------------
create or replace function has_role(min_role text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid()
      and deleted_at is null
      and role_rank(role) >= role_rank(min_role)
  );
$$;

-- ---------------------------------------------------------------------
-- is_platform_admin() — cross-tenant, read-only by default (see policies)
-- ---------------------------------------------------------------------
create or replace function is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from platform_admins where user_id = auth.uid());
$$;

-- =======================================================================
-- organizations
-- =======================================================================
alter table organizations enable row level security;

create policy organizations_select on organizations
  for select using (id = current_org_id() or is_platform_admin());

create policy organizations_update on organizations
  for update using (id = current_org_id() and has_role('org_owner'))
  with check (id = current_org_id());

-- Insert is intentionally not exposed to normal tenant roles: an org is
-- created via the signup/onboarding flow using the service-role key, not
-- self-service row insertion — see docs/DEVELOPMENT_SEQUENCE.md step 9.
-- No delete policy: orgs are soft-deleted (deleted_at) via an admin path,
-- never hard-deleted through RLS-governed access.

-- =======================================================================
-- departments
-- =======================================================================
alter table departments enable row level security;

create policy departments_select on departments
  for select using (org_id = current_org_id() or is_platform_admin());

create policy departments_insert on departments
  for insert with check (org_id = current_org_id() and has_role('org_admin'));

create policy departments_update on departments
  for update using (org_id = current_org_id() and has_role('org_admin'))
  with check (org_id = current_org_id());

create policy departments_delete on departments
  for delete using (org_id = current_org_id() and has_role('org_admin'));

-- =======================================================================
-- profiles
-- =======================================================================
alter table profiles enable row level security;

create policy profiles_select on profiles
  for select using (org_id = current_org_id() or id = auth.uid() or is_platform_admin());

create policy profiles_update_self on profiles
  for update using (id = auth.uid())
  with check (id = auth.uid());

create policy profiles_update_by_admin on profiles
  for update using (org_id = current_org_id() and has_role('org_admin'))
  with check (org_id = current_org_id());

-- No insert policy: rows are created only by the handle_new_user() trigger
-- (security definer, runs as the function owner, bypasses RLS by design).
-- No delete policy: profiles are soft-deleted (deleted_at) via an admin
-- path, never hard-deleted through RLS-governed access.

-- =======================================================================
-- org_invitations
-- =======================================================================
alter table org_invitations enable row level security;

create policy org_invitations_select on org_invitations
  for select using (org_id = current_org_id() or is_platform_admin());

create policy org_invitations_insert on org_invitations
  for insert with check (org_id = current_org_id() and has_role('org_admin'));

create policy org_invitations_update on org_invitations
  for update using (org_id = current_org_id() and has_role('org_admin'))
  with check (org_id = current_org_id());

create policy org_invitations_delete on org_invitations
  for delete using (org_id = current_org_id() and has_role('org_admin'));

-- =======================================================================
-- subscriptions
-- =======================================================================
alter table subscriptions enable row level security;

create policy subscriptions_select on subscriptions
  for select using (org_id = current_org_id() or is_platform_admin());

-- No insert/update/delete policy for tenant roles: subscriptions are
-- managed by the billing/webhook path via the service role, never
-- directly by org members.

-- =======================================================================
-- plans (platform-level catalog, public-read, not tenant data)
-- =======================================================================
alter table plans enable row level security;

create policy plans_select on plans
  for select using (true);

-- No write policy for any non-service-role caller: the plan catalog is
-- managed by platform admins via the service role.

-- =======================================================================
-- platform_admins (service-role only — no policies, RLS enabled with
-- zero grants, matching the "ops table" pattern from docs/DATABASE.md §6)
-- =======================================================================
alter table platform_admins enable row level security;

-- =======================================================================
-- activity_log (service-role write; org members can read their own org's
-- log, platform admins can read everything — every such read is expected
-- to itself be logged by the calling application code, not by RLS, since
-- RLS cannot trigger on SELECT)
-- =======================================================================
alter table activity_log enable row level security;

create policy activity_log_select on activity_log
  for select using (org_id = current_org_id() or is_platform_admin());

-- No insert/update/delete policy for tenant roles: written only via the
-- service role, from application code, after the real action succeeds.

-- =======================================================================
-- ai_usage_log (service-role only — no policies)
-- =======================================================================
alter table ai_usage_log enable row level security;
