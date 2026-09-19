-- Course structure: courses → modules → lessons → learning objects
-- (Phase 2, step 4). See docs/CONTENT_MODEL.md §1-§4.
--
-- The asymmetry here is deliberate and is the heart of the model:
-- lesson_learning_objects is MANY-TO-MANY (the same learning object can
-- appear in an onboarding course and an annual refresher without being
-- copy-pasted), while lessons/modules belong to exactly one parent. That
-- keeps authoring predictable — a course owner is never surprised by
-- edits rippling in from an unrelated course — while still delivering
-- real reuse, one level down.

create table courses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  title text not null,
  slug text not null,
  description text,
  owner_id uuid references profiles(id) on delete set null,
  status text not null default 'draft'
    check (status in ('draft', 'review', 'approval', 'published', 'archived')),
  version integer not null default 1,
  published_at timestamptz,
  created_by uuid references profiles(id) on delete set null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger courses_set_updated_at
  before update on courses
  for each row execute function set_updated_at();

create unique index courses_org_slug_idx on courses (org_id, slug) where deleted_at is null;
create index courses_org_status_idx on courses (org_id, status);

alter table courses enable row level security;

-- Learners must be able to SEE published courses to enrol in them, so
-- select is org-wide (not org_admin-gated) — the status filter is the
-- application's job, and step 6's enrolment path relies on this.
create policy courses_select on courses
  for select using (org_id = current_org_id() or is_platform_admin());

create policy courses_insert on courses
  for insert with check (org_id = current_org_id() and has_role('org_admin'));

create policy courses_update on courses
  for update using (org_id = current_org_id() and has_role('org_admin'))
  with check (org_id = current_org_id());

create policy courses_delete on courses
  for delete using (org_id = current_org_id() and has_role('org_admin'));

-- ---------------------------------------------------------------------
-- modules — an ordered group of lessons within one course
-- ---------------------------------------------------------------------
create table modules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  course_id uuid not null references courses(id) on delete cascade,
  title text not null,
  sequence integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger modules_set_updated_at
  before update on modules
  for each row execute function set_updated_at();

create unique index modules_course_sequence_idx on modules (course_id, sequence);
create index modules_org_idx on modules (org_id);

alter table modules enable row level security;

create policy modules_select on modules
  for select using (org_id = current_org_id() or is_platform_admin());

create policy modules_insert on modules
  for insert with check (org_id = current_org_id() and has_role('org_admin'));

create policy modules_update on modules
  for update using (org_id = current_org_id() and has_role('org_admin'))
  with check (org_id = current_org_id());

create policy modules_delete on modules
  for delete using (org_id = current_org_id() and has_role('org_admin'));

-- ---------------------------------------------------------------------
-- lessons — an ordered group of learning objects within one module
-- ---------------------------------------------------------------------
create table lessons (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  module_id uuid not null references modules(id) on delete cascade,
  title text not null,
  sequence integer not null default 0,
  estimated_duration_min integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger lessons_set_updated_at
  before update on lessons
  for each row execute function set_updated_at();

create unique index lessons_module_sequence_idx on lessons (module_id, sequence);
create index lessons_org_idx on lessons (org_id);

alter table lessons enable row level security;

create policy lessons_select on lessons
  for select using (org_id = current_org_id() or is_platform_admin());

create policy lessons_insert on lessons
  for insert with check (org_id = current_org_id() and has_role('org_admin'));

create policy lessons_update on lessons
  for update using (org_id = current_org_id() and has_role('org_admin'))
  with check (org_id = current_org_id());

create policy lessons_delete on lessons
  for delete using (org_id = current_org_id() and has_role('org_admin'));

-- ---------------------------------------------------------------------
-- lesson_learning_objects — THE reuse join, many-to-many on purpose
-- ---------------------------------------------------------------------
create table lesson_learning_objects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  lesson_id uuid not null references lessons(id) on delete cascade,
  learning_object_id uuid not null references learning_objects(id) on delete cascade,
  sequence integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger lesson_learning_objects_set_updated_at
  before update on lesson_learning_objects
  for each row execute function set_updated_at();

create unique index lesson_learning_objects_unique_idx
  on lesson_learning_objects (lesson_id, learning_object_id);
create index lesson_learning_objects_lo_idx on lesson_learning_objects (learning_object_id);
create index lesson_learning_objects_org_idx on lesson_learning_objects (org_id);

alter table lesson_learning_objects enable row level security;

create policy lesson_learning_objects_select on lesson_learning_objects
  for select using (org_id = current_org_id() or is_platform_admin());

create policy lesson_learning_objects_insert on lesson_learning_objects
  for insert with check (org_id = current_org_id() and has_role('org_admin'));

create policy lesson_learning_objects_update on lesson_learning_objects
  for update using (org_id = current_org_id() and has_role('org_admin'))
  with check (org_id = current_org_id());

create policy lesson_learning_objects_delete on lesson_learning_objects
  for delete using (org_id = current_org_id() and has_role('org_admin'));
