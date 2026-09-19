-- Orbit Foundation Phase 1: RLS baseline.
-- Product tables added later must use can_access_product(product_key, role)
-- plus their product-specific resource-level rules.

alter table public.foundation_organizations enable row level security;
alter table public.foundation_profiles enable row level security;
alter table public.foundation_departments enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.user_active_organizations enable row level security;
alter table public.products enable row level security;
alter table public.product_roles enable row level security;
alter table public.organization_product_entitlements enable row level security;
alter table public.product_role_assignments enable row level security;
alter table public.foundation_platform_admins enable row level security;
alter table public.organization_invitations enable row level security;
alter table public.organization_invitation_product_roles enable row level security;
alter table public.audit_events enable row level security;

-- A user needs to see every organization they actively belong to in order to
-- choose one; active-org-only filtering would make organization switching fail.
create policy organizations_select_member on public.foundation_organizations
  for select to authenticated
  using (public.is_active_organization_member(id));

create policy organizations_update_owner on public.foundation_organizations
  for update to authenticated
  using (id = public.current_organization_id()
    and public.has_organization_role('org_owner'))
  with check (id = public.current_organization_id()
    and public.has_organization_role('org_owner'));

create policy profiles_select_self_or_current_org on public.foundation_profiles
  for select to authenticated
  using (id = auth.uid() or public.is_user_in_current_organization(id));

create policy profiles_update_self on public.foundation_profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy departments_select_member on public.foundation_departments
  for select to authenticated
  using (public.is_active_organization_member(organization_id));

create policy departments_write_org_admin on public.foundation_departments
  for all to authenticated
  using (organization_id = public.current_organization_id()
    and public.has_organization_role('org_admin'))
  with check (organization_id = public.current_organization_id()
    and public.has_organization_role('org_admin'));

-- Members may read colleagues in their currently selected organization.
-- Writes are intentionally server-controlled until the audited member and
-- invitation management endpoints are implemented.
create policy organization_memberships_select_self_or_current_org on public.organization_memberships
  for select to authenticated
  using (user_id = auth.uid() or organization_id = public.current_organization_id());

create policy user_active_organizations_select_self on public.user_active_organizations
  for select to authenticated
  using (user_id = auth.uid());

-- The switch happens only through set_active_organization(), which checks an
-- active membership before it writes. No direct client mutation is allowed.

create policy products_select_authenticated on public.products
  for select to authenticated using (true);

create policy product_roles_select_authenticated on public.product_roles
  for select to authenticated using (true);

create policy entitlements_select_member on public.organization_product_entitlements
  for select to authenticated
  using (public.is_active_organization_member(organization_id));

create policy product_role_assignments_select_self_or_org_admin on public.product_role_assignments
  for select to authenticated
  using (
    user_id = auth.uid()
    or (
      organization_id = public.current_organization_id()
      and public.has_organization_role('org_admin')
    )
  );

-- Product roles, subscriptions, invitations, platform administrators and
-- audit writes have no direct browser policies. They are managed by explicit,
-- audited server-side workflows using the service role.

create policy audit_events_select_org_admin on public.audit_events
  for select to authenticated
  using (
    organization_id = public.current_organization_id()
    and public.has_organization_role('org_admin')
  );
