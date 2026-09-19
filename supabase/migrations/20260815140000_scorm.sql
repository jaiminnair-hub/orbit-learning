-- SCORM packages and per-learner CMI progress (Phase 2, step 2).
--
-- Sequenced early on purpose: docs/CLOUDFLARE_VALIDATION_RESULTS.md only
-- ever gave SCORM a *partial* pass (a route serving .html with an explicit
-- Content-Type worked; no real package was ever extracted or served), and
-- it's the one item left in Phase 2 that could still force a design
-- change. Better to find that out before the CMS is built on top of it.
--
-- Table shape follows an earlier project's (pattern only — new tables, new
-- project), tied into the Phase 2 content model via content_asset_id so a
-- SCORM package is just another content asset with extra metadata, not a
-- parallel content system.

create table scorm_packages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  content_asset_id uuid not null references content_assets(id) on delete cascade,
  title text not null,
  scorm_version text not null default '1.2' check (scorm_version in ('1.2', '2004')),
  -- Path *within* the extracted package that the player loads first,
  -- read from imsmanifest.xml at registration time.
  entry_point text not null,
  -- Where the extracted files live in Storage: org_id/scorm/<package id>/...
  extracted_prefix text not null,
  manifest jsonb not null default '{}'::jsonb,
  status text not null default 'draft'
    check (status in ('draft', 'review', 'approval', 'published', 'archived')),
  version integer not null default 1,
  created_by uuid references profiles(id) on delete set null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger scorm_packages_set_updated_at
  before update on scorm_packages
  for each row execute function set_updated_at();

create index scorm_packages_org_idx on scorm_packages (org_id, status);
create unique index scorm_packages_content_asset_idx on scorm_packages (content_asset_id);

alter table scorm_packages enable row level security;

create policy scorm_packages_select on scorm_packages
  for select using (org_id = current_org_id() or is_platform_admin());

create policy scorm_packages_insert on scorm_packages
  for insert with check (org_id = current_org_id() and has_role('org_admin'));

create policy scorm_packages_update on scorm_packages
  for update using (org_id = current_org_id() and has_role('org_admin'))
  with check (org_id = current_org_id());

create policy scorm_packages_delete on scorm_packages
  for delete using (org_id = current_org_id() and has_role('org_admin'));

-- ---------------------------------------------------------------------
-- scorm_progress — one row per (user, package). cmi_data holds the raw
-- CMI key/value model the SCORM runtime reads and writes; the promoted
-- columns exist so reporting doesn't have to reach into jsonb.
--
-- Note the RLS shape differs from the content tables above, deliberately:
-- a *learner* must be able to write their own progress, so insert/update
-- are scoped to the row's own user_id rather than gated at org_admin.
-- ---------------------------------------------------------------------
create table scorm_progress (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  scorm_package_id uuid not null references scorm_packages(id) on delete cascade,
  cmi_data jsonb not null default '{}'::jsonb,
  lesson_status text not null default 'not attempted'
    check (lesson_status in ('not attempted', 'incomplete', 'completed', 'passed', 'failed', 'browsed')),
  score_raw numeric(6, 2),
  total_time_sec integer not null default 0,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger scorm_progress_set_updated_at
  before update on scorm_progress
  for each row execute function set_updated_at();

create unique index scorm_progress_user_package_idx on scorm_progress (user_id, scorm_package_id);
create index scorm_progress_org_idx on scorm_progress (org_id, scorm_package_id);

alter table scorm_progress enable row level security;

-- A learner sees their own progress; managers and above see their org's
-- (needed for the team dashboards in step 6).
create policy scorm_progress_select on scorm_progress
  for select using (
    (org_id = current_org_id() and (user_id = auth.uid() or has_role('manager')))
    or is_platform_admin()
  );

create policy scorm_progress_insert on scorm_progress
  for insert with check (org_id = current_org_id() and user_id = auth.uid());

create policy scorm_progress_update on scorm_progress
  for update using (org_id = current_org_id() and user_id = auth.uid())
  with check (org_id = current_org_id() and user_id = auth.uid());

-- No delete policy: progress is a record of what a learner did. Removing
-- it is an admin/service-role concern, not something a client can do.
