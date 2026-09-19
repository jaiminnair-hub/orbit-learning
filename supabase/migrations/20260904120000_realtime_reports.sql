-- ===========================================================================
-- Enable Supabase Realtime on the tables the completion report and the
-- new compliance activity trail read (2026-09-04, item 2 of the
-- comparison-matrix follow-up)
--
-- Realtime's postgres_changes delivery already respects each table's
-- existing RLS select policy at broadcast time — enrollments_select,
-- progress_select and activity_log_select all already scope correctly to
-- `org_id = current_org_id()` (manager+) or is_platform_admin(), so adding
-- these tables to the publication is the only change needed; no new RLS
-- policy, no new grant.
-- ===========================================================================
alter publication supabase_realtime add table enrollments;
alter publication supabase_realtime add table progress;
alter publication supabase_realtime add table activity_log;
