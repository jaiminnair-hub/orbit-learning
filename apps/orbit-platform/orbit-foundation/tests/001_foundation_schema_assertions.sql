-- Structural verification for the fresh Orbit Foundation database.
-- Run only AFTER every migration in ../supabase/migrations has been applied.

do $$
declare
  expected_table text;
begin
  foreach expected_table in array array[
    'organizations',
    'profiles',
    'departments',
    'organization_memberships',
    'user_active_organizations',
    'products',
    'product_roles',
    'organization_product_entitlements',
    'product_role_assignments',
    'platform_admins',
    'organization_invitations',
    'organization_invitation_product_roles',
    'audit_events'
  ] loop
    if to_regclass('public.' || expected_table) is null then
      raise exception 'Missing required Orbit Foundation table: %', expected_table;
    end if;

    if not exists (
      select 1
      from pg_class relation
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public'
        and relation.relname = expected_table
        and relation.relrowsecurity
    ) then
      raise exception 'RLS is not enabled on required table: %', expected_table;
    end if;
  end loop;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name in ('org_id', 'organization_id', 'role', 'workspace_role')
  ) then
    raise exception 'profiles must remain organization- and product-role-neutral.';
  end if;

  if to_regprocedure('public.current_organization_id()') is null
     or to_regprocedure('public.set_active_organization(uuid)') is null
     or to_regprocedure('public.has_product_entitlement(text,uuid)') is null
     or to_regprocedure('public.has_product_role(text,text,uuid)') is null
     or to_regprocedure('public.can_access_product(text,text,uuid)') is null then
    raise exception 'One or more required Orbit authorization helpers are missing.';
  end if;

  if (select count(*) from public.products) <> 4 then
    raise exception 'Expected exactly four seeded Orbit products.';
  end if;

  if (select count(*) from public.product_roles where product_key = 'lms') <> 5
     or (select count(*) from public.product_roles where product_key = 'feedback') <> 5 then
    raise exception 'LMS or Feedback product role catalogue is incomplete.';
  end if;
end;
$$;

select 'Orbit Foundation Phase 1 structural assertions passed.' as result;
