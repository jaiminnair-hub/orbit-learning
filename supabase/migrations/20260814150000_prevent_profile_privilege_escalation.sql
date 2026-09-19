-- The profiles_update_self RLS policy (previous migration) correctly
-- restricts *which row* a user can update (their own), but says nothing
-- about *which columns* — as written, a learner could UPDATE their own
-- role to org_owner and RLS would allow it. This is the exact
-- vulnerability an earlier project actually had and fixed
-- (007_prevent_role_escalation.sql, per the Stage 1 audit) — reusing
-- that same defense-in-depth pattern here, deliberately, not
-- rediscovering it in production.
--
-- role / org_id / department_id can only change via the service role —
-- i.e. through a trusted server-side admin action that has already done
-- its own authorization check, never directly through a client-permitted
-- RLS update, even for an org_admin acting on someone else's row.

create or replace function prevent_profile_privilege_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    new.role := old.role;
    new.org_id := old.org_id;
    new.department_id := old.department_id;
  end if;
  return new;
end;
$$;

create trigger trg_prevent_profile_privilege_escalation
  before update on profiles
  for each row execute function prevent_profile_privilege_escalation();
