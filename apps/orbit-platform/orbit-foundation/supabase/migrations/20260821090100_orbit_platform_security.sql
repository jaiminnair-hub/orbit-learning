-- Orbit Foundation Phase 1: timestamps, identity lifecycle, authorization
-- helpers, and controlled organization/invitation RPCs.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger organizations_set_updated_at before update on public.organizations
  for each row execute function public.set_updated_at();
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger departments_set_updated_at before update on public.departments
  for each row execute function public.set_updated_at();
create trigger organization_memberships_set_updated_at before update on public.organization_memberships
  for each row execute function public.set_updated_at();
create trigger organization_product_entitlements_set_updated_at before update on public.organization_product_entitlements
  for each row execute function public.set_updated_at();
create trigger product_role_assignments_set_updated_at before update on public.product_role_assignments
  for each row execute function public.set_updated_at();
create trigger organization_invitations_set_updated_at before update on public.organization_invitations
  for each row execute function public.set_updated_at();

-- Auth creates an identity only. Joining or creating an organization happens
-- through a controlled flow, never as a side effect of signup.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.email, ''),
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'avatar_url', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_auth_user();

-- A signed-in user may edit their public display details, but cannot replace
-- the identity email from the application database.
create or replace function public.protect_profile_identity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is not null and auth.uid() = old.id
     and new.email is distinct from old.email then
    raise exception 'Profile email is managed by Supabase Auth.';
  end if;
  return new;
end;
$$;

create trigger profiles_protect_identity before update on public.profiles
  for each row execute function public.protect_profile_identity();

create or replace function public.org_role_rank(target_role text)
returns integer
language sql
immutable
set search_path = public
as $$
  select case target_role
    when 'employee' then 1
    when 'manager' then 2
    when 'org_admin' then 3
    when 'org_owner' then 4
    else 0
  end;
$$;

-- The only organization context used by RLS. It returns null if a user was
-- suspended after selecting an organization.
create or replace function public.current_organization_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select active.organization_id
  from public.user_active_organizations active
  join public.organization_memberships membership
    on membership.organization_id = active.organization_id
   and membership.user_id = active.user_id
  join public.organizations organization
    on organization.id = active.organization_id
  where active.user_id = auth.uid()
    and membership.status = 'active'
    and organization.status = 'active'
  limit 1;
$$;

create or replace function public.is_active_organization_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_memberships membership
    join public.organizations organization
      on organization.id = membership.organization_id
    where membership.organization_id = target_organization_id
      and membership.user_id = auth.uid()
      and membership.status = 'active'
      and organization.status = 'active'
  );
$$;

create or replace function public.has_organization_role(
  minimum_role text,
  target_organization_id uuid default public.current_organization_id()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = auth.uid()
      and membership.status = 'active'
      and public.org_role_rank(membership.org_role) >= public.org_role_rank(minimum_role)
  );
$$;

create or replace function public.is_user_in_current_organization(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = public.current_organization_id()
      and membership.user_id = target_user_id
      and membership.status = 'active'
  );
$$;

create or replace function public.has_product_entitlement(
  target_product_key text,
  target_organization_id uuid default public.current_organization_id()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_active_organization_member(target_organization_id)
    and exists (
      select 1
      from public.organization_product_entitlements entitlement
      where entitlement.organization_id = target_organization_id
        and entitlement.product_key = target_product_key
        and entitlement.status in ('trial', 'active')
        and entitlement.starts_at <= now()
        and (entitlement.ends_at is null or entitlement.ends_at >= now())
    );
$$;

create or replace function public.has_product_role(
  target_product_key text,
  target_role_key text default null,
  target_organization_id uuid default public.current_organization_id()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_product_entitlement(target_product_key, target_organization_id)
    and exists (
      select 1
      from public.product_role_assignments assignment
      where assignment.organization_id = target_organization_id
        and assignment.user_id = auth.uid()
        and assignment.product_key = target_product_key
        and (target_role_key is null or assignment.role_key = target_role_key)
        and (assignment.expires_at is null or assignment.expires_at > now())
    );
$$;

-- Product tables should call this helper in their RLS policies. It deliberately
-- does not grant platform administrators implicit access to customer data.
create or replace function public.can_access_product(
  target_product_key text,
  required_role_key text default null,
  target_organization_id uuid default public.current_organization_id()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_product_role(
    target_product_key,
    required_role_key,
    target_organization_id
  );
$$;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.platform_admins admin where admin.user_id = auth.uid()
  );
$$;

create or replace function public.set_active_organization(target_organization_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in is required.';
  end if;

  if not public.is_active_organization_member(target_organization_id) then
    raise exception 'You are not an active member of this organization.';
  end if;

  insert into public.user_active_organizations (user_id, organization_id, set_at)
  values (auth.uid(), target_organization_id, now())
  on conflict (user_id) do update
    set organization_id = excluded.organization_id,
        set_at = excluded.set_at;
end;
$$;

create or replace function public.create_organization_for_current_user(
  organization_name text,
  organization_slug text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  created_organization_id uuid;
  normalized_slug text := lower(trim(organization_slug));
begin
  if auth.uid() is null then
    raise exception 'Sign in is required.';
  end if;

  if normalized_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    raise exception 'Organization slug must use lowercase letters, numbers, and hyphens.';
  end if;

  insert into public.profiles (id, email)
  values (auth.uid(), coalesce(auth.jwt() ->> 'email', ''))
  on conflict (id) do nothing;

  insert into public.organizations (name, slug)
  values (trim(organization_name), normalized_slug)
  returning id into created_organization_id;

  insert into public.organization_memberships (
    organization_id, user_id, org_role, status, joined_at
  ) values (
    created_organization_id, auth.uid(), 'org_owner', 'active', now()
  );

  perform public.set_active_organization(created_organization_id);

  insert into public.audit_events (organization_id, actor_id, event_type, entity_type, entity_id)
  values (created_organization_id, auth.uid(), 'organization.created', 'organization', created_organization_id::text);

  return created_organization_id;
end;
$$;

-- Invitations store only a SHA-256 hash. The raw token is generated and sent
-- by the server-side invitation workflow and must never be written to a table.
create or replace function public.accept_organization_invitation(raw_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  invitation public.organization_invitations%rowtype;
  invitation_role record;
  invitation_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if auth.uid() is null then
    raise exception 'Sign in is required.';
  end if;

  select * into invitation
  from public.organization_invitations
  where token_hash = encode(digest(raw_token, 'sha256'), 'hex')
    and status = 'pending'
    and expires_at > now()
  for update;

  if not found then
    raise exception 'Invitation is invalid or expired.';
  end if;

  if lower(invitation.email) <> invitation_email then
    raise exception 'This invitation belongs to a different email address.';
  end if;

  insert into public.profiles (id, email)
  values (auth.uid(), invitation_email)
  on conflict (id) do nothing;

  insert into public.organization_memberships (
    organization_id, user_id, org_role, status, joined_at, invited_by
  ) values (
    invitation.organization_id, auth.uid(), invitation.org_role, 'active', now(), invitation.invited_by
  )
  on conflict (organization_id, user_id) do update
    set status = 'active',
        joined_at = coalesce(public.organization_memberships.joined_at, now());

  for invitation_role in
    select product_key, role_key
    from public.organization_invitation_product_roles
    where invitation_id = invitation.id
  loop
    insert into public.product_role_assignments (
      organization_id, user_id, product_key, role_key, granted_by
    ) values (
      invitation.organization_id, auth.uid(), invitation_role.product_key,
      invitation_role.role_key, invitation.invited_by
    )
    on conflict (organization_id, user_id, product_key, role_key) do nothing;
  end loop;

  update public.organization_invitations
  set status = 'accepted', accepted_by = auth.uid(), accepted_at = now()
  where id = invitation.id;

  perform public.set_active_organization(invitation.organization_id);

  insert into public.audit_events (organization_id, actor_id, event_type, entity_type, entity_id)
  values (invitation.organization_id, auth.uid(), 'invitation.accepted', 'organization_invitation', invitation.id::text);

  return invitation.organization_id;
end;
$$;

-- Product grants must always rest on an active organization membership and an
-- active/trial entitlement. A cancelled entitlement may retain historical
-- grants, but they cannot be exercised or newly created.
create or replace function public.validate_product_role_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = new.organization_id
      and membership.user_id = new.user_id
      and membership.status = 'active'
  ) then
    raise exception 'Product roles require an active organization membership.';
  end if;

  if not exists (
    select 1 from public.organization_product_entitlements entitlement
    where entitlement.organization_id = new.organization_id
      and entitlement.product_key = new.product_key
      and entitlement.status in ('trial', 'active')
      and entitlement.starts_at <= now()
      and (entitlement.ends_at is null or entitlement.ends_at >= now())
  ) then
    raise exception 'Product roles require an active product entitlement.';
  end if;

  return new;
end;
$$;

create trigger product_role_assignments_validate
  before insert or update on public.product_role_assignments
  for each row execute function public.validate_product_role_assignment();

revoke all on function public.current_organization_id() from public;
revoke all on function public.is_active_organization_member(uuid) from public;
revoke all on function public.has_organization_role(text, uuid) from public;
revoke all on function public.is_user_in_current_organization(uuid) from public;
revoke all on function public.has_product_entitlement(text, uuid) from public;
revoke all on function public.has_product_role(text, text, uuid) from public;
revoke all on function public.can_access_product(text, text, uuid) from public;
revoke all on function public.is_platform_admin() from public;
revoke all on function public.set_active_organization(uuid) from public;
revoke all on function public.create_organization_for_current_user(text, text) from public;
revoke all on function public.accept_organization_invitation(text) from public;

grant execute on function public.current_organization_id() to authenticated;
grant execute on function public.is_active_organization_member(uuid) to authenticated;
grant execute on function public.has_organization_role(text, uuid) to authenticated;
grant execute on function public.is_user_in_current_organization(uuid) to authenticated;
grant execute on function public.has_product_entitlement(text, uuid) to authenticated;
grant execute on function public.has_product_role(text, text, uuid) to authenticated;
grant execute on function public.can_access_product(text, text, uuid) to authenticated;
grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.set_active_organization(uuid) to authenticated;
grant execute on function public.create_organization_for_current_user(text, text) to authenticated;
grant execute on function public.accept_organization_invitation(text) to authenticated;
