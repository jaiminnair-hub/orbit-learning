-- Learning objects, composition, versioning and review workflow
-- (Phase 2, step 3). See docs/CONTENT_MODEL.md §2-§6.
--
-- The learning object is THE reuse unit: everything to its left
-- (content assets) is raw material, everything to its right (lessons,
-- modules, courses) is structure. This is the level where sharing
-- happens, which is why lesson_learning_objects (step 4) is
-- many-to-many while lessons/modules/courses are not.

create table learning_objects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  kind text not null default 'content'
    check (kind in ('content', 'knowledge_check', 'assignment', 'scenario')),
  title text not null,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  owner_id uuid references profiles(id) on delete set null,
  status text not null default 'draft'
    check (status in ('draft', 'review', 'approval', 'published', 'archived')),
  version integer not null default 1,
  created_by uuid references profiles(id) on delete set null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger learning_objects_set_updated_at
  before update on learning_objects
  for each row execute function set_updated_at();

create index learning_objects_org_status_idx on learning_objects (org_id, status);

alter table learning_objects enable row level security;

create policy learning_objects_select on learning_objects
  for select using (org_id = current_org_id() or is_platform_admin());

create policy learning_objects_insert on learning_objects
  for insert with check (org_id = current_org_id() and has_role('org_admin'));

create policy learning_objects_update on learning_objects
  for update using (org_id = current_org_id() and has_role('org_admin'))
  with check (org_id = current_org_id());

create policy learning_objects_delete on learning_objects
  for delete using (org_id = current_org_id() and has_role('org_admin'));

-- ---------------------------------------------------------------------
-- learning_object_assets — a learning object composes 1..N content assets
-- ---------------------------------------------------------------------
create table learning_object_assets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  learning_object_id uuid not null references learning_objects(id) on delete cascade,
  content_asset_id uuid not null references content_assets(id) on delete cascade,
  sequence integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger learning_object_assets_set_updated_at
  before update on learning_object_assets
  for each row execute function set_updated_at();

create unique index learning_object_assets_unique_idx
  on learning_object_assets (learning_object_id, content_asset_id);
create index learning_object_assets_org_idx on learning_object_assets (org_id);

alter table learning_object_assets enable row level security;

create policy learning_object_assets_select on learning_object_assets
  for select using (org_id = current_org_id() or is_platform_admin());

create policy learning_object_assets_insert on learning_object_assets
  for insert with check (org_id = current_org_id() and has_role('org_admin'));

create policy learning_object_assets_update on learning_object_assets
  for update using (org_id = current_org_id() and has_role('org_admin'))
  with check (org_id = current_org_id());

create policy learning_object_assets_delete on learning_object_assets
  for delete using (org_id = current_org_id() and has_role('org_admin'));

-- ---------------------------------------------------------------------
-- content_versions — immutable snapshot of what an entity looked like at
-- each publish. Polymorphic so one table serves learning_objects,
-- courses, assessments, etc. (docs/CONTENT_MODEL.md §5).
--
-- This is what makes "a learner mid-course doesn't see content shift
-- under them" true: an enrollment pins a version number, and the
-- snapshot for that version never changes, no matter how many times the
-- live row is edited and republished afterwards.
--
-- Never deleted (docs/DATABASE.md §8) — no delete policy, and writes go
-- through the service role from the publish path only.
-- ---------------------------------------------------------------------
create table content_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  entity_type text not null check (entity_type in ('learning_object', 'course', 'content_asset', 'assessment')),
  entity_id uuid not null,
  version_number integer not null,
  snapshot jsonb not null,
  published_by uuid references profiles(id) on delete set null,
  published_at timestamptz not null default now()
);

create unique index content_versions_entity_version_idx
  on content_versions (entity_type, entity_id, version_number);
create index content_versions_org_idx on content_versions (org_id, entity_type);

alter table content_versions enable row level security;

create policy content_versions_select on content_versions
  for select using (org_id = current_org_id() or is_platform_admin());

-- ---------------------------------------------------------------------
-- content_reviews — the audit trail behind draft→review→approval→published
-- ---------------------------------------------------------------------
create table content_reviews (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  content_type text not null check (content_type in ('learning_object', 'course', 'content_asset', 'assessment')),
  content_id uuid not null,
  reviewer_id uuid references profiles(id) on delete set null,
  decision text not null check (decision in ('submitted', 'approved', 'rejected', 'published', 'archived')),
  comments text,
  reviewed_at timestamptz not null default now()
);

create index content_reviews_content_idx on content_reviews (content_type, content_id, reviewed_at desc);
create index content_reviews_org_idx on content_reviews (org_id);

alter table content_reviews enable row level security;

create policy content_reviews_select on content_reviews
  for select using (org_id = current_org_id() or is_platform_admin());

create policy content_reviews_insert on content_reviews
  for insert with check (org_id = current_org_id() and has_role('org_admin'));
