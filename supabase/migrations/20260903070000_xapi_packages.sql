-- xAPI (Tin Can) package ingest — companion to scorm_packages
-- (20260815140000_scorm.sql), added 2026-09-03 alongside removing AICC
-- from the build (20260903060000_drop_aicc_format.sql). Same tenancy
-- pattern, same content-asset tie-in, same "extracted files live in
-- Storage under a per-package prefix" shape as SCORM — deliberately
-- parallel, not reusing scorm_packages, because the two formats carry
-- different metadata (no scorm_version/entry_point; an xAPI package has
-- an activity IRI and a launch path) and progress means something
-- structurally different (a stream of LRS statements, not a CMI blob).

alter table content_assets drop constraint content_assets_type_check;

alter table content_assets
  add constraint content_assets_type_check
  check (type in (
    'text', 'video', 'audio', 'pdf', 'ppt', 'document', 'url', 'embed', 'scorm',
    'image', 'xapi'
  ));

create table xapi_packages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  content_asset_id uuid not null references content_assets(id) on delete cascade,
  title text not null,
  -- The activity IRI this package launches as, read from tincan.xml at
  -- registration time — every statement the package emits is expected to
  -- carry this as its object.id, and the launch URL passes it as
  -- activity_id per the Tin Can/xAPI Launch convention.
  activity_id text not null,
  -- Path *within* the extracted package that the launch URL points at,
  -- read from tincan.xml's <launch> element.
  launch_path text not null,
  -- Where the extracted files live in Storage: org_id/xapi/<package id>/...
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

create trigger xapi_packages_set_updated_at
  before update on xapi_packages
  for each row execute function set_updated_at();

create index xapi_packages_org_idx on xapi_packages (org_id, status);
create unique index xapi_packages_content_asset_idx on xapi_packages (content_asset_id);

alter table xapi_packages enable row level security;

create policy xapi_packages_select on xapi_packages
  for select using (org_id = current_org_id() or is_platform_admin());

create policy xapi_packages_insert on xapi_packages
  for insert with check (org_id = current_org_id() and has_role('org_admin'));

create policy xapi_packages_update on xapi_packages
  for update using (org_id = current_org_id() and has_role('org_admin'))
  with check (org_id = current_org_id());

create policy xapi_packages_delete on xapi_packages
  for delete using (org_id = current_org_id() and has_role('org_admin'));

-- ---------------------------------------------------------------------
-- xapi_progress — one row per (user, package), derived from the
-- statements the package actually POSTs to our LRS endpoint
-- (app/api/v1/xapi-lrs/statements/route.ts). Unlike scorm_progress there
-- is no cmi_data blob to persist: the statements themselves (in
-- xapi_statements, source = 'external') are the record. This table is a
-- promoted-columns summary purely so the player can cheaply poll "is this
-- done yet" without scanning statements, exactly the same reporting
-- shortcut scorm_progress already takes over cmi_data.
--
-- registration is not null and is minted once per (user, package) by the
-- launch route (lib/xapi/launch-token.ts) — it is what ties a package's
-- otherwise-anonymous-to-us statements back to this row.
-- ---------------------------------------------------------------------
create table xapi_progress (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  xapi_package_id uuid not null references xapi_packages(id) on delete cascade,
  registration uuid not null,
  lesson_status text not null default 'not attempted'
    check (lesson_status in ('not attempted', 'incomplete', 'completed', 'passed', 'failed')),
  score_raw numeric(6, 2),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger xapi_progress_set_updated_at
  before update on xapi_progress
  for each row execute function set_updated_at();

create unique index xapi_progress_user_package_idx on xapi_progress (user_id, xapi_package_id);
create index xapi_progress_org_idx on xapi_progress (org_id, xapi_package_id);

alter table xapi_progress enable row level security;

-- Same shape as scorm_progress_select: a learner sees their own,
-- managers and above see their org's.
create policy xapi_progress_select on xapi_progress
  for select using (
    (org_id = current_org_id() and (user_id = auth.uid() or has_role('manager')))
    or is_platform_admin()
  );

-- Written only by the LRS statements route via the service role (the
-- package's own launch-token credential is not a Supabase session, so it
-- cannot satisfy auth.uid() = user_id the way scorm_progress_insert's
-- policy does) — no insert/update policy for the anon/authenticated
-- roles here is deliberate, not an oversight: this table has no path
-- other than the service role, which bypasses RLS entirely.

-- ---------------------------------------------------------------------
-- xapi_activity_state — the xAPI State API's Document Resource
-- (https://github.com/adlnet/xAPI-Spec, State Resource), needed because
-- real authoring-tool exports (Storyline's Tin Can publish in
-- particular) store suspend-data/bookmarking there, not in a statement.
-- Scoped narrowly: this is the one piece of "be a real LRS" beyond
-- statement ingestion that Phase 3's xAPI ingest slice implements —
-- Agent Profile and Activity Profile documents are not, since nothing in
-- the launch/statements path needs them yet (see
-- docs/XAPI_INGEST_ARCHITECTURE.md's explicit scope section).
-- ---------------------------------------------------------------------
create table xapi_activity_state (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  xapi_package_id uuid not null references xapi_packages(id) on delete cascade,
  registration uuid not null,
  activity_id text not null,
  state_id text not null,
  -- text, not jsonb: the State Resource's body is spec'd as arbitrary
  -- content of whatever content_type the client declares (almost always
  -- JSON in practice, but not guaranteed) — storing the raw body avoids
  -- rejecting a well-formed state document merely for not being valid
  -- JSON.
  content text not null,
  content_type text not null default 'application/json',
  updated_at timestamptz not null default now()
);

create unique index xapi_activity_state_doc_idx
  on xapi_activity_state (xapi_package_id, registration, activity_id, state_id);

alter table xapi_activity_state enable row level security;

create policy xapi_activity_state_select on xapi_activity_state
  for select using ((org_id = current_org_id() and has_role('manager')) or is_platform_admin());

-- No insert/update/delete policy for the same reason as xapi_progress:
-- only the LRS state route (service role) ever writes here, since the
-- writer is a launch-token credential, not a Supabase session.
