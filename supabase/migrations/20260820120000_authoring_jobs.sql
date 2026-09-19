-- authoring_jobs — Phase 3 step 4 (docs/PHASE3_DATA_MODEL.md §2.4).
--
-- Long-running AI generation as a durable job, not a request — the
-- table-level counterpart to the job-execution spike (step 1,
-- docs/JOB_EXECUTION_SPIKE_RESULTS.md): Cloudflare Workflows in a separate
-- `jobs` worker read/write this row's status per step. The worker writes
-- via the service role (which bypasses RLS by design, so no policy is
-- needed for it); the policies below govern the human-facing side only —
-- an org_admin queuing a job and being able to see/cancel it.

create table authoring_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  kind text not null
    check (kind in ('generate_course', 'generate_items', 'translate', 'publish_package')),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  steps jsonb not null default '[]'::jsonb,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger authoring_jobs_set_updated_at
  before update on authoring_jobs
  for each row execute function set_updated_at();

create index authoring_jobs_org_status_idx on authoring_jobs (org_id, status);

alter table authoring_jobs enable row level security;

create policy authoring_jobs_select on authoring_jobs
  for select using (org_id = current_org_id() or is_platform_admin());

create policy authoring_jobs_insert on authoring_jobs
  for insert with check (org_id = current_org_id() and has_role('org_admin'));

create policy authoring_jobs_update on authoring_jobs
  for update using (org_id = current_org_id() and has_role('org_admin'))
  with check (org_id = current_org_id());

-- No delete policy: jobs are a durable record of what generation ran,
-- kept for the same audit reasons activity_log and ai_usage_log are never
-- deleted (docs/DATABASE.md §8).

-- ---------------------------------------------------------------------
-- Deferred FK: course_specifications.generated_by_job_id -> this table.
-- Left off in 20260820103000_course_specifications.sql because
-- authoring_jobs is created later in the migration ordering
-- (docs/PHASE3_DATA_MODEL.md §6) — added here now that the target exists.
-- ---------------------------------------------------------------------
alter table course_specifications
  add constraint course_specifications_generated_by_job_id_fkey
  foreign key (generated_by_job_id) references authoring_jobs(id) on delete set null;

create index course_specifications_generated_by_job_idx
  on course_specifications (generated_by_job_id)
  where generated_by_job_id is not null;
