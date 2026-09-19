-- Orbit Foundation integration — first safe slice. Purely additive: no
-- existing table, column, RLS policy, or auth flow is touched by this
-- migration. See docs/ORBIT_LMS_INTEGRATION_PLAN.md for the full design.
--
-- All three tables are written exclusively by the service-role client from
-- app/api/orbit/entry/route.ts — never by a tenant-facing session — so each
-- gets RLS enabled with zero policies (the "ops table" pattern already used
-- by platform_admins: deny-all to authenticated/anon, service role bypasses).

-- ---------------------------------------------------------------------
-- orbit_organization_links — explicit, admin-populated Orbit org -> LMS
-- org mapping. An Orbit org with no row here cannot enter the LMS: this
-- is what stops an unrecognized Orbit org from silently provisioning an
-- LMS tenant.
-- ---------------------------------------------------------------------
create table orbit_organization_links (
  orbit_organization_id uuid primary key,
  lms_organization_id   uuid not null references organizations(id) on delete cascade,
  linked_by             uuid references profiles(id) on delete set null,
  linked_at             timestamptz not null default now(),
  unique (lms_organization_id)
);

alter table orbit_organization_links enable row level security;

-- ---------------------------------------------------------------------
-- orbit_entry_token_uses — replay guard. Every Orbit entry token's jti is
-- inserted here before anything else happens on that request; the primary
-- key uniqueness constraint is what makes a replay fail atomically, not an
-- application-level check-then-act race.
-- ---------------------------------------------------------------------
create table orbit_entry_token_uses (
  jti         uuid primary key,
  consumed_at timestamptz not null default now()
);

alter table orbit_entry_token_uses enable row level security;

-- ---------------------------------------------------------------------
-- orbit_role_map — the Orbit lms product role -> LMS role mapping as
-- data, not hard-coded application logic, so a confirmed change to it is
-- an update, not a redeploy. A role with no row here (or an explicit
-- lms_role of null) denies LMS entry outright rather than guessing.
-- ---------------------------------------------------------------------
create table orbit_role_map (
  orbit_product_role_key text primary key,
  lms_role                text check (lms_role in ('learner', 'manager', 'org_admin', 'org_owner')),
  notes                   text
);

alter table orbit_role_map enable row level security;

insert into orbit_role_map (orbit_product_role_key, lms_role, notes) values
  ('learner', 'learner', 'Exact match.'),
  ('learning_manager', 'manager', 'Matches LMS manager''s existing gate (completion reports, member list).'),
  ('l_and_d_admin', 'org_admin', 'Matches this repo''s own prior Orbit integration review recommendation.'),
  ('content_author', null, 'LMS has no role between manager and org_admin today; denies entry rather than over-granting org_admin. Follow-up work, not this slice.'),
  ('instructor', 'learner', 'No ILT/instructor concept in this LMS yet; least-privilege default rather than over-granting.');
