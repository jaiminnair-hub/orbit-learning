-- xapi_statements — Phase 3 step 4 (docs/PHASE3_DATA_MODEL.md §2.7).
--
-- Emitted learning-experience statements. Append-only, immutable, the same
-- discipline as activity_log — no update policy, no delete policy.
--
-- `id` is the xAPI statement's OWN id, not a surrogate row id, and carries
-- no default: the emitting client (the runtime interpreter, or an external
-- package's tracking adapter forwarding into this table) always generates
-- it itself before the statement exists, exactly like the client-generated
-- statement ids proven working end to end against a real LRS in the
-- step-3 export-conformance spike (lib/export/cmi5.ts).
--
-- Select is manager+ rather than the usual org-wide read: this is
-- behavioural data about individual learners, more sensitive than most
-- content tables, per docs/PHASE3_DATA_MODEL.md §2.7.

create table xapi_statements (
  id uuid primary key,
  org_id uuid not null references organizations(id) on delete cascade,
  actor jsonb not null,
  verb jsonb not null,
  object jsonb not null,
  result jsonb,
  context jsonb,
  timestamp timestamptz not null,
  stored_at timestamptz not null default now(),
  source text not null default 'native_player'
    check (source in ('native_player', 'published_package', 'external')),
  registration uuid
);

create index xapi_statements_org_timestamp_idx on xapi_statements (org_id, timestamp desc);
create index xapi_statements_org_registration_idx
  on xapi_statements (org_id, registration)
  where registration is not null;

alter table xapi_statements enable row level security;

create policy xapi_statements_select on xapi_statements
  for select using (
    (org_id = current_org_id() and has_role('manager'))
    or is_platform_admin()
  );

-- Any authenticated member of their own org may emit their own statements
-- (the native player runs as the learner) — the service role covers
-- forwarding from published packages, and bypasses RLS entirely.
create policy xapi_statements_insert on xapi_statements
  for insert with check (org_id = current_org_id());

-- No update, no delete policy: statements are immutable once stored.
