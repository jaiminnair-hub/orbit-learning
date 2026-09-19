-- published_packages — Phase 3 step 4 (docs/PHASE3_DATA_MODEL.md §2.5, §4).
--
-- An exported, immutable distributable (SCORM/xAPI/cmi5/AICC), built by
-- the step-9 publishing pipeline running as an authoring_jobs job. Never
-- updated after creation — a rebuild produces a new row, the same
-- immutability discipline content_versions already follows. That's also
-- why there is no insert policy for authenticated tenant roles: rows are
-- written only by the publish job via the service role, exactly like
-- content_versions' snapshot-writing path.
--
-- Storage: a new private bucket, objects namespaced org_id/... (same
-- discipline as content-assets — docs/MULTI_TENANCY.md §5), reached only
-- via server-generated signed download URLs. No storage.objects policy
-- needed: public = false already denies all direct/unauthenticated access.

insert into storage.buckets (id, name, public)
values ('published-packages', 'published-packages', false)
on conflict (id) do nothing;

create table published_packages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  course_specification_id uuid not null references course_specifications(id) on delete cascade,
  spec_version integer not null,
  format text not null check (format in ('scorm12', 'scorm2004', 'xapi', 'cmi5', 'aicc')),
  storage_path text not null,
  manifest jsonb not null default '{}'::jsonb,
  checksum text,
  file_size bigint,
  built_by_job_id uuid references authoring_jobs(id) on delete set null,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index published_packages_spec_idx
  on published_packages (course_specification_id, spec_version);
create index published_packages_org_format_idx on published_packages (org_id, format);
create unique index published_packages_storage_path_idx on published_packages (storage_path);

alter table published_packages enable row level security;

create policy published_packages_select on published_packages
  for select using (org_id = current_org_id() or is_platform_admin());

-- No insert/update/delete policy for tenant roles: see header comment.
