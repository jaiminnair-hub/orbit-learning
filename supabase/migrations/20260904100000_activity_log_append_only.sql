-- ===========================================================================
-- activity_log becomes append-only at the database level (2026-09-04)
--
-- The existing RLS select-only policy (20260814143000_rls_and_helpers.sql)
-- already stops ordinary tenant roles from mutating rows, but every write
-- path in the app goes through the service-role client, which bypasses RLS
-- entirely (see lib/supabase/admin.ts) — nothing stopped a bug, or a
-- compromised service-role key, from silently rewriting or deleting audit
-- history. Confirmed before writing this: no code path anywhere in the
-- repo issues an UPDATE or DELETE against activity_log (grepped every
-- `.from("activity_log")` call site — insert and select only), so this
-- cannot break any existing behaviour.
--
-- A BEFORE UPDATE OR DELETE trigger enforces append-only at the table
-- level for every role, including the service role — triggers fire
-- regardless of RLS bypass, which is what makes this the correct
-- enforcement point rather than another RLS policy.
-- ===========================================================================
create function reject_activity_log_mutation() returns trigger as $$
begin
  raise exception 'activity_log is append-only: % is not permitted', tg_op;
end;
$$ language plpgsql;

create trigger activity_log_append_only
  before update or delete on activity_log
  for each row execute function reject_activity_log_mutation();
