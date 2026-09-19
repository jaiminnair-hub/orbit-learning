-- ai_usage_log — Phase 3 step 7 additions.
--
-- docs/PHASE3_AI_ARCHITECTURE.md §8: the Phase 1 table already carried
-- org/user/feature/provider/model/tokens/latency/success/cost, which is
-- enough for a single call. A multi-step generation pipeline needs three
-- more things to be operable:
--
--   job_id      correlation, so "what did this course cost to generate?" is
--               answerable rather than spread across anonymous rows
--   profile     which workload profile routed the call, so a cost or quality
--               regression can be traced to the config that caused it
--   retry_count which attempt this was, so a provider that only ever succeeds
--               on its second repair is visible rather than merely expensive
--
-- No RLS change: the table still has no policies for `authenticated` and is
-- written only through the service role (20260814143000_rls_and_helpers.sql).

alter table ai_usage_log
  add column job_id uuid references authoring_jobs(id) on delete set null,
  add column profile text,
  add column retry_count integer not null default 0;

-- Answers "total cost of this generation job" without scanning the table.
create index ai_usage_log_job_idx on ai_usage_log (job_id) where job_id is not null;

-- Answers "what is this profile costing us this month", the query behind any
-- decision to change a profile's provider chain.
create index ai_usage_log_profile_idx on ai_usage_log (profile, created_at desc)
  where profile is not null;
