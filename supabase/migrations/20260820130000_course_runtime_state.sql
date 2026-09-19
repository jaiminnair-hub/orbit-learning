-- course_runtime_state — Phase 3 step 4 (docs/PHASE3_DATA_MODEL.md §2.6).
--
-- Resumable interaction state. Deliberately separate from `progress`
-- (Phase 2), which stays the completion ledger it is today — this table
-- is richer, per-spec-version, and specific to the runtime interpreter
-- (step 5), not something the existing completion model should be
-- overloaded to carry (docs/PHASE3_TECHNICAL_ARCHITECTURE.md §4.3a).
--
-- State is version-scoped (course_specification_id + spec_version) so a
-- learner resuming after a republish is never fed state addressed against
-- a structure that no longer matches — the same versioning promise
-- enrollments.enrolled_version already makes for courses.
--
-- current_page_id is a spec-internal SpecId (lib/spec/primitives.ts), not
-- a foreign key: pages live inside the `spec` jsonb document, not as rows.

create table course_runtime_state (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  course_specification_id uuid not null references course_specifications(id) on delete cascade,
  spec_version integer not null,
  enrollment_id uuid references enrollments(id) on delete set null,
  current_page_id text,
  variables jsonb not null default '{}'::jsonb,
  block_states jsonb not null default '{}'::jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger course_runtime_state_set_updated_at
  before update on course_runtime_state
  for each row execute function set_updated_at();

create unique index course_runtime_state_unique_idx
  on course_runtime_state (org_id, user_id, course_specification_id, spec_version);
create index course_runtime_state_enrollment_idx
  on course_runtime_state (enrollment_id)
  where enrollment_id is not null;

alter table course_runtime_state enable row level security;

-- Same shape as progress (20260815200000_enrollment_progress.sql): a
-- learner sees their own state; managers and above see the whole org's.
create policy course_runtime_state_select on course_runtime_state
  for select using (
    (org_id = current_org_id() and (user_id = auth.uid() or has_role('manager')))
    or is_platform_admin()
  );

create policy course_runtime_state_insert on course_runtime_state
  for insert with check (org_id = current_org_id() and user_id = auth.uid());

create policy course_runtime_state_update on course_runtime_state
  for update using (org_id = current_org_id() and user_id = auth.uid())
  with check (org_id = current_org_id() and user_id = auth.uid());
