-- ===========================================================================
-- Learning paths (2026-09-04) — an ordered sequence of published courses,
-- enrollable as its own unit. `enrollments.enrollable_type` has allowed
-- 'learning_path' since Phase 2 (20260815200000_enrollment_progress.sql)
-- but nothing ever used it — this is that value's first real consumer.
--
-- Deliberately simpler than `courses`: a path is a container of course
-- *references*, not authored content of its own, so it gets a 3-state
-- lifecycle (draft/published/archived, matching `assessments`) rather than
-- courses' 5-state review workflow — the referenced courses already went
-- through that. `learning_path_items` mirrors `lesson_learning_objects`'
-- shape exactly (an org-scoped ordered join table), not a new pattern.
--
-- A path's completion is derived from its courses' own enrollment status,
-- not re-derived from learning objects — lib/lms/learning-paths.ts computes
-- it as "N of M courses completed," reusing each course's own completion
-- rather than re-walking every course's learning-object tree a second way.
-- ===========================================================================

create table learning_paths (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  slug text not null,
  description text,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  version integer not null default 1,
  created_by uuid references profiles(id) on delete set null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index learning_paths_org_slug_idx on learning_paths (org_id, slug) where deleted_at is null;
create trigger learning_paths_set_updated_at before update on learning_paths
  for each row execute function set_updated_at();

alter table learning_paths enable row level security;
-- Org-wide read, no role gate — same as courses_select: a learner has to
-- see a path to enrol in it, and RLS on the underlying courses still
-- governs whether they can actually open one.
create policy learning_paths_select on learning_paths
  for select using (org_id = current_org_id() or is_platform_admin());
create policy learning_paths_write on learning_paths
  for all using (org_id = current_org_id() and has_role('org_admin'))
  with check (org_id = current_org_id() and has_role('org_admin'));

create table learning_path_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  path_id uuid not null references learning_paths(id) on delete cascade,
  course_id uuid not null references courses(id) on delete cascade,
  sequence integer not null default 0,
  created_at timestamptz not null default now(),
  unique (path_id, course_id)
);
create index learning_path_items_path_idx on learning_path_items (path_id, sequence);

alter table learning_path_items enable row level security;
create policy learning_path_items_select on learning_path_items
  for select using (org_id = current_org_id() or is_platform_admin());
create policy learning_path_items_write on learning_path_items
  for all using (org_id = current_org_id() and has_role('org_admin'))
  with check (org_id = current_org_id() and has_role('org_admin'));
