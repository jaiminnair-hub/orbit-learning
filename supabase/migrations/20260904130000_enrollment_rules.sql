-- ===========================================================================
-- enrollment_rules — automated enrollment & re-enrollment (2026-09-04, item 2
-- of the comparison-matrix follow-up)
--
-- Two trigger shapes, deliberately not a general rule-engine: `on_join`
-- (every new member) and `role_equals` (members placed at a specific role).
-- Both are evaluated at the one real moment a member "joins" an org —
-- accepting an invitation (app/api/v1/orgs/invitations/accept/route.ts) —
-- not on a schedule, since that is the only place profiles.org_id actually
-- transitions from null to a real org today.
--
-- `recur_after_days`, when set, is the re-enrollment half: once a rule's
-- own most recent enrollment for a learner is completed and that many days
-- old with no newer enrollment already covering it, a fresh one is created
-- automatically the next time that learner loads their own worklist
-- (lib/lms/enrollment-rules.ts's applyDueReenrollments — a lazy check on
-- read, not a cron job; this product has no scheduler infrastructure yet,
-- and a real check on the one screen a learner's own re-enrollment would
-- actually matter to them on is a smaller, real thing to ship first).
-- ===========================================================================
create table enrollment_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  course_id uuid not null references courses(id) on delete cascade,
  trigger text not null check (trigger in ('on_join', 'role_equals')),
  role_value text check (role_value in ('learner', 'manager', 'org_admin', 'org_owner')),
  recur_after_days integer check (recur_after_days is null or recur_after_days > 0),
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint enrollment_rules_role_value_matches_trigger check (
    (trigger = 'role_equals' and role_value is not null)
    or (trigger = 'on_join' and role_value is null)
  )
);

create index enrollment_rules_org_active_idx on enrollment_rules (org_id, active) where active;

alter table enrollment_rules enable row level security;

create policy enrollment_rules_select on enrollment_rules
  for select using (org_id = current_org_id() and has_role('manager'));

create policy enrollment_rules_insert on enrollment_rules
  for insert with check (org_id = current_org_id() and has_role('org_admin'));

create policy enrollment_rules_update on enrollment_rules
  for update using (org_id = current_org_id() and has_role('org_admin'));

create policy enrollment_rules_delete on enrollment_rules
  for delete using (org_id = current_org_id() and has_role('org_admin'));
