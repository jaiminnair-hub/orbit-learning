-- content_assets — the atomic content unit (Phase 2, step 1). See
-- docs/CONTENT_MODEL.md §2 and docs/DATABASE.md §3 for the design
-- rationale: this table has no pedagogical meaning by itself — it's the
-- base unit learning_objects will compose from, starting in a later
-- Phase 2 step.
--
-- Storage: a private Supabase Storage bucket, objects namespaced
-- org_id/... per docs/MULTI_TENANCY.md §5, reached only via
-- server-generated signed URLs (docs/API_SPEC.md §6) — the service-role
-- client mediates every upload/download, so no client ever talks to
-- the bucket directly. That's why no storage.objects RLS policy is
-- added here: public = false already denies all unauthenticated/direct
-- access, and the signed-URL flow is the only path in or out.

insert into storage.buckets (id, name, public)
values ('content-assets', 'content-assets', false)
on conflict (id) do nothing;

create table content_assets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  type text not null
    check (type in ('text', 'video', 'audio', 'pdf', 'ppt', 'document', 'url', 'embed', 'scorm')),
  storage_path text not null,
  mime_type text,
  file_size bigint,
  checksum text,
  status text not null default 'draft'
    check (status in ('draft', 'review', 'approval', 'published', 'archived')),
  version integer not null default 1,
  created_by uuid references profiles(id) on delete set null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger content_assets_set_updated_at
  before update on content_assets
  for each row execute function set_updated_at();

create index content_assets_org_type_status_idx on content_assets (org_id, type, status);
create unique index content_assets_storage_path_idx on content_assets (storage_path);

-- ---------------------------------------------------------------------
-- RLS — the same four-policy shape as every table since Phase 1
-- (docs/MULTI_TENANCY.md §3): select scoped to org membership (or a
-- platform admin), writes gated at org_admin+. No exception for this
-- table — the one lesson from the original an earlier project audit this
-- platform exists to not repeat.
-- ---------------------------------------------------------------------
alter table content_assets enable row level security;

create policy content_assets_select on content_assets
  for select using (org_id = current_org_id() or is_platform_admin());

create policy content_assets_insert on content_assets
  for insert with check (org_id = current_org_id() and has_role('org_admin'));

create policy content_assets_update on content_assets
  for update using (org_id = current_org_id() and has_role('org_admin'))
  with check (org_id = current_org_id());

create policy content_assets_delete on content_assets
  for delete using (org_id = current_org_id() and has_role('org_admin'));
