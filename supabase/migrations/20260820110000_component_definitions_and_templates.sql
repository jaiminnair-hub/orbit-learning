-- component_definitions, course_templates — Phase 3 step 4
-- (docs/PHASE3_DATA_MODEL.md §2.2-2.3).
--
-- component_definitions: org-scoped reusable blocks (Rise "saved blocks" /
-- Storyline shared objects). A `component` block in a spec holds a
-- component_definition_id and is REFERENCED, not copied — updating a
-- component propagates on next publish, mirroring how learning_objects
-- reuse already works in Phase 2.
--
-- course_templates: whole-course skeletons used as starting points for
-- new courses. Same workflow discipline as everything else authored.

create table component_definitions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  description text,
  definition jsonb not null,
  spec_schema_version text not null,
  status text not null default 'draft'
    check (status in ('draft', 'review', 'approval', 'published', 'archived')),
  version integer not null default 1,
  category text,
  created_by uuid references profiles(id) on delete set null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger component_definitions_set_updated_at
  before update on component_definitions
  for each row execute function set_updated_at();

create index component_definitions_org_status_idx on component_definitions (org_id, status);
create index component_definitions_org_category_idx on component_definitions (org_id, category);

alter table component_definitions enable row level security;

create policy component_definitions_select on component_definitions
  for select using (org_id = current_org_id() or is_platform_admin());

create policy component_definitions_insert on component_definitions
  for insert with check (org_id = current_org_id() and has_role('org_admin'));

create policy component_definitions_update on component_definitions
  for update using (org_id = current_org_id() and has_role('org_admin'))
  with check (org_id = current_org_id());

create policy component_definitions_delete on component_definitions
  for delete using (org_id = current_org_id() and has_role('org_admin'));

-- ---------------------------------------------------------------------
-- course_templates
-- ---------------------------------------------------------------------
create table course_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  description text,
  thumbnail_asset_id uuid references content_assets(id) on delete set null,
  spec jsonb not null,
  spec_schema_version text not null,
  status text not null default 'draft'
    check (status in ('draft', 'review', 'approval', 'published', 'archived')),
  version integer not null default 1,
  created_by uuid references profiles(id) on delete set null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger course_templates_set_updated_at
  before update on course_templates
  for each row execute function set_updated_at();

create index course_templates_org_status_idx on course_templates (org_id, status);

alter table course_templates enable row level security;

create policy course_templates_select on course_templates
  for select using (org_id = current_org_id() or is_platform_admin());

create policy course_templates_insert on course_templates
  for insert with check (org_id = current_org_id() and has_role('org_admin'));

create policy course_templates_update on course_templates
  for update using (org_id = current_org_id() and has_role('org_admin'))
  with check (org_id = current_org_id());

create policy course_templates_delete on course_templates
  for delete using (org_id = current_org_id() and has_role('org_admin'));
