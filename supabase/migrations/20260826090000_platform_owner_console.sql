-- Platform Owner Console: make the existing platform_admins grant explicit
-- about authority level, and provide the helper functions.
-- This does not change any tenant role or make an organization admin global.

alter table platform_admins
  add column if not exists role text not null default 'platform_admin'
  check (role in ('platform_owner', 'platform_admin'));

create or replace function platform_admin_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from platform_admins where user_id = auth.uid();
$$;

create or replace function is_platform_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from platform_admins
    where user_id = auth.uid() and role = 'platform_owner'
  );
$$;
