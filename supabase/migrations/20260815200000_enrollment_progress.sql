-- Enrollment and progress (Phase 2, step 6). See docs/DATABASE.md §5.
--
-- enrollments is polymorphic (course/path/program) so learning paths and
-- programs — deliberately out of scope for Phase 2 — can reuse it later
-- without a migration that rewrites existing rows.
--
-- enrollments.course_version pins the published version the learner
-- started on. That's what makes the step-3 versioning promise real at
-- the enrolment level: authors can publish new versions freely, and an
-- in-progress learner keeps replaying the snapshot they began with.

create table enrollments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  enrollable_type text not null check (enrollable_type in ('course', 'learning_path', 'program')),
  enrollable_id uuid not null,
  -- Version of the enrollable at the moment of enrolment (null for
  -- types that aren't versioned yet).
  enrolled_version integer,
  status text not null default 'enrolled'
    check (status in ('enrolled', 'in_progress', 'completed', 'expired', 'withdrawn')),
  enrolled_at timestamptz not null default now(),
  due_date timestamptz,
  completed_at timestamptz,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger enrollments_set_updated_at
  before update on enrollments
  for each row execute function set_updated_at();

create unique index enrollments_unique_idx
  on enrollments (org_id, user_id, enrollable_type, enrollable_id);
create index enrollments_user_idx on enrollments (user_id, status);
create index enrollments_enrollable_idx on enrollments (enrollable_type, enrollable_id);

alter table enrollments enable row level security;

-- A learner sees their own enrolments; managers and above see the whole
-- org's, which is what the team dashboard below reads.
create policy enrollments_select on enrollments
  for select using (
    (org_id = current_org_id() and (user_id = auth.uid() or has_role('manager')))
    or is_platform_admin()
  );

-- Admins enrol people; a learner may also self-enrol in their own org
-- (the `user_id = auth.uid()` arm), which is how the learner-facing
-- "Enrol" button on a published course works.
create policy enrollments_insert on enrollments
  for insert with check (
    org_id = current_org_id() and (has_role('org_admin') or user_id = auth.uid())
  );

create policy enrollments_update on enrollments
  for update using (
    org_id = current_org_id() and (user_id = auth.uid() or has_role('org_admin'))
  )
  with check (org_id = current_org_id());

create policy enrollments_delete on enrollments
  for delete using (org_id = current_org_id() and has_role('org_admin'));

-- ---------------------------------------------------------------------
-- progress — one row per (user, learning object), the atom completion
-- is derived from. Deliberately keyed to the learning object rather than
-- the lesson: because learning objects are reusable across courses, this
-- is also the level at which "already completed elsewhere" will be
-- answerable later without reshaping the table.
-- ---------------------------------------------------------------------
create table progress (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  learning_object_id uuid not null references learning_objects(id) on delete cascade,
  -- Which enrolment this progress was earned under; nullable so ad hoc
  -- viewing outside an enrolment doesn't break.
  enrollment_id uuid references enrollments(id) on delete set null,
  status text not null default 'not_started'
    check (status in ('not_started', 'in_progress', 'completed')),
  score numeric(6, 2),
  time_spent_sec integer not null default 0,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger progress_set_updated_at
  before update on progress
  for each row execute function set_updated_at();

create unique index progress_unique_idx on progress (org_id, user_id, learning_object_id);
create index progress_user_idx on progress (user_id, status);
create index progress_enrollment_idx on progress (enrollment_id);

alter table progress enable row level security;

create policy progress_select on progress
  for select using (
    (org_id = current_org_id() and (user_id = auth.uid() or has_role('manager')))
    or is_platform_admin()
  );

create policy progress_insert on progress
  for insert with check (org_id = current_org_id() and user_id = auth.uid());

create policy progress_update on progress
  for update using (org_id = current_org_id() and user_id = auth.uid())
  with check (org_id = current_org_id() and user_id = auth.uid());
