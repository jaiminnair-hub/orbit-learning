-- course_specifications — Phase 3 step 4 (docs/PHASE3_DATA_MODEL.md §2.1).
--
-- The versioned specification document: the contract between the AI, the
-- editor, the runtime interpreter (step 5), and every publish target
-- (step 9). Reuses the Phase 2 draft->review->approval->published->archived
-- workflow verbatim (docs/CONTENT_MODEL.md §5) rather than inventing a
-- second state machine.
--
-- generated_by_job_id has NO foreign-key constraint yet: authoring_jobs is
-- created later in this same step (per docs/PHASE3_DATA_MODEL.md §6's
-- ordering, which puts authoring_jobs after course_specifications). The
-- constraint is added once that table exists, in
-- 20260820120000_authoring_jobs.sql, rather than reordering the whole
-- sequence to satisfy one forward reference.

create table course_specifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  title text not null,
  spec jsonb not null,
  spec_schema_version text not null,
  status text not null default 'draft'
    check (status in ('draft', 'review', 'approval', 'published', 'archived')),
  version integer not null default 1,
  source_kind text not null default 'manual'
    check (source_kind in ('prompt', 'pdf', 'docx', 'pptx', 'url', 'manual')),
  source_asset_id uuid references content_assets(id) on delete set null,
  -- FK added later, see header comment.
  generated_by_job_id uuid,
  locale text not null default 'en',
  created_by uuid references profiles(id) on delete set null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger course_specifications_set_updated_at
  before update on course_specifications
  for each row execute function set_updated_at();

create index course_specifications_org_status_idx on course_specifications (org_id, status);

-- Text search over the title only for now, not the full spec body: `spec`
-- is a nested block tree whose readable text sits inside structured
-- RichText spans (docs/lib/spec/primitives.ts), not plain string columns —
-- walking that shape into a flat tsvector is an application-layer job for
-- whichever of steps 5/6 first has code that already parses the tree for
-- another reason, not a fragile pure-SQL JSON walk invented speculatively
-- here. Title-only search is a real, working increment; it is not the
-- final search experience.
alter table course_specifications
  add column search_vector tsvector
  generated always as (setweight(to_tsvector('english', coalesce(title, '')), 'A')) stored;

create index course_specifications_search_idx on course_specifications using gin (search_vector);

alter table course_specifications enable row level security;

create policy course_specifications_select on course_specifications
  for select using (org_id = current_org_id() or is_platform_admin());

create policy course_specifications_insert on course_specifications
  for insert with check (org_id = current_org_id() and has_role('org_admin'));

create policy course_specifications_update on course_specifications
  for update using (org_id = current_org_id() and has_role('org_admin'))
  with check (org_id = current_org_id());

create policy course_specifications_delete on course_specifications
  for delete using (org_id = current_org_id() and has_role('org_admin'));
