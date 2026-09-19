-- skill_tags — Phase 3 step 4 (docs/PHASE3_DATA_MODEL.md §2.8).
--
-- Deliberately named skill_tags, not skills: a minimal Phase 3 vocabulary
-- with NO proficiency logic. Specs reference tags by id in spec.skills[].
-- The Phase 6 Skills engine defines `skills` with proficiency semantics
-- later, without colliding with or inheriting this simpler concept.

create table skill_tags (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  description text,
  external_ref text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger skill_tags_set_updated_at
  before update on skill_tags
  for each row execute function set_updated_at();

create unique index skill_tags_org_name_idx on skill_tags (org_id, name);

alter table skill_tags enable row level security;

create policy skill_tags_select on skill_tags
  for select using (org_id = current_org_id() or is_platform_admin());

create policy skill_tags_insert on skill_tags
  for insert with check (org_id = current_org_id() and has_role('org_admin'));

create policy skill_tags_update on skill_tags
  for update using (org_id = current_org_id() and has_role('org_admin'))
  with check (org_id = current_org_id());

create policy skill_tags_delete on skill_tags
  for delete using (org_id = current_org_id() and has_role('org_admin'));
