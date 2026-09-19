-- Certificates — the shared credential record for both trigger points: an
-- assessment pass (app/api/v1/assessments/[id]/submit/route.ts) and a
-- course completion (app/api/v1/progress/route.ts's PUT handler). One
-- table, two producers, distinguished by source_type/source_id rather
-- than two tables, because a certificate list/verification page needs to
-- render both kinds identically.
--
-- source_id is deliberately not a foreign key: it points at either
-- assessments.id or courses.id depending on source_type, and Postgres
-- can't express a conditional FK. Integrity is enforced at the two
-- insert sites instead, both of which already validated the source row
-- before deciding to issue.
--
-- title and recipient_name are captured at issue time (not joined live)
-- so a certificate's printed/verified text stays stable even if the
-- course or assessment is later renamed, or the learner's profile name
-- changes, or the source row is deleted.
create table certificates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  source_type text not null check (source_type in ('assessment', 'course')),
  source_id uuid not null,
  title text not null check (length(trim(title)) > 0),
  recipient_name text not null check (length(trim(recipient_name)) > 0),
  -- Only meaningful for assessment-sourced certificates; a course
  -- completion has no single score to show.
  score_percent numeric(5,2) check (score_percent is null or score_percent between 0 and 100),
  check (
    (source_type = 'assessment' and score_percent is not null) or
    (source_type = 'course' and score_percent is null)
  ),
  issued_at timestamptz not null default now(),
  -- One certificate per (org, user, source) — the idempotency guard both
  -- hook points rely on. A learner who re-passes an assessment on a
  -- later attempt, or whose progress PUT recomputes course completion on
  -- every subsequent write, must not accumulate duplicate certificates.
  unique (org_id, user_id, source_type, source_id)
);

create index certificates_user_idx on certificates (org_id, user_id, issued_at desc);

alter table certificates enable row level security;

-- Same shape as assessment_attempts_select / xapi_progress_select: a
-- learner sees their own, managers and above see their org's, platform
-- admins see across tenants.
create policy certificates_select on certificates
  for select using (
    (org_id = current_org_id() and (user_id = auth.uid() or has_role('manager')))
    or is_platform_admin()
  );

-- No insert/update/delete policy for anon or authenticated — deliberate,
-- same reasoning as xapi_progress (20260903070000_xapi_packages.sql): a
-- certificate is a credential. A plain "user_id = auth.uid()" insert
-- policy would let a learner mint their own fake certificate directly
-- via the Data API, bypassing the actual pass/completion check. Only
-- the two hook-point routes write here, via the service role, after
-- each has already independently verified the pass/completion decision
-- using the caller's own session.
--
-- The public verification page (app/certificates/verify/[id]/page.tsx)
-- also does not read this table as anon through PostgREST/RLS — anon
-- has no matching select policy above. It goes through the admin client
-- server-side instead and returns only a narrow, whitelisted field set,
-- which is what actually prevents bulk-scraping the table (recipient
-- names, scores) rather than an open anon RLS policy would.
