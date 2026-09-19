-- spec_validation_reports — Phase 3 step 4 (docs/PHASE3_DATA_MODEL.md §2.9).
--
-- Why a spec was rejected or flagged. `findings` stores the exact
-- Finding[] shape lib/spec/validate.ts already produces (see
-- lib/spec/findings.ts) — this table is the storage target that shape was
-- built for ahead of time, per lib/spec/README.md.
--
-- Deviation from docs/PHASE3_DATA_MODEL.md §2.9, found here and written
-- back per the project's own discipline (docs/DEFINITION_OF_DONE.md
-- "Documentation" section): the conceptual doc lists `kind` as
-- schema | accessibility | publish_readiness, but the ALREADY-SHIPPED
-- lib/spec/findings.ts's FindingKind type (the real, tested source of
-- truth for what validateCourseSpec() actually emits) is
-- schema | semantic | accessibility | publish_readiness. validate.ts runs
-- structural (schema) and semantic (referential-integrity) passes in one
-- call, producing findings of both kinds in a single report — omitting
-- 'semantic' here would make this table unable to store real output from
-- code that already exists and is tested. Added.

create table spec_validation_reports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  course_specification_id uuid not null references course_specifications(id) on delete cascade,
  spec_version integer not null,
  kind text not null
    check (kind in ('schema', 'semantic', 'accessibility', 'publish_readiness')),
  severity text not null check (severity in ('error', 'warning', 'info')),
  findings jsonb not null default '[]'::jsonb,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index spec_validation_reports_spec_idx
  on spec_validation_reports (course_specification_id, spec_version);
create index spec_validation_reports_org_idx on spec_validation_reports (org_id);

alter table spec_validation_reports enable row level security;

create policy spec_validation_reports_select on spec_validation_reports
  for select using (org_id = current_org_id() or is_platform_admin());

create policy spec_validation_reports_insert on spec_validation_reports
  for insert with check (org_id = current_org_id() and has_role('org_admin'));

-- No update/delete policy: each validation run writes a new, immutable
-- report row rather than mutating a prior one — the same "append, never
-- rewrite" discipline as content_versions.
