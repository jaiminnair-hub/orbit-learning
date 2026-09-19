-- ===========================================================================
-- Fix: the append-only trigger (20260904100000) also blocked the FK-cascade
-- nullification it never should have (2026-09-04)
--
-- Real bug, found by live verification, not by review: activity_log.org_id
-- and .actor_id are both declared `on delete set null` — deleting an
-- organization or a user issues an UPDATE against every activity_log row
-- that references it, setting that one column to NULL, to preserve the
-- log entry as orphaned history rather than losing it. The previous
-- version of this trigger rejected *every* UPDATE unconditionally,
-- including that cascade — which meant an organization with any activity
-- history could never be deleted again, full stop (confirmed live: a real
-- disposable test org's DELETE failed with the trigger's own error).
--
-- This replaces the trigger function (the existing trigger already points
-- at it by name, so it doesn't need to be recreated) to allow exactly one
-- kind of UPDATE — org_id and/or actor_id moving to NULL, nothing else
-- about the row changed — and continues rejecting every other UPDATE and
-- all DELETEs, which is the actual tamper-evidence guarantee this table
-- needs.
-- ===========================================================================
create or replace function reject_activity_log_mutation() returns trigger as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'activity_log is append-only: DELETE is not permitted';
  end if;

  if new.id is distinct from old.id
    or new.event_type is distinct from old.event_type
    or new.entity_type is distinct from old.entity_type
    or new.entity_id is distinct from old.entity_id
    or new.metadata is distinct from old.metadata
    or new.is_platform_admin_action is distinct from old.is_platform_admin_action
    or new.created_at is distinct from old.created_at
    or (new.org_id is not null and new.org_id is distinct from old.org_id)
    or (new.actor_id is not null and new.actor_id is distinct from old.actor_id)
  then
    raise exception 'activity_log is append-only: UPDATE is not permitted (only the org_id/actor_id FK-cascade nullification on a deleted organization or user is allowed)';
  end if;

  return new;
end;
$$ language plpgsql;
