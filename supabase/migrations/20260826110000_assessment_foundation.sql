-- Standalone assessment foundation. SCORM results remain a separate signal;
-- these assessments can be attached to any learning experience or assigned
-- independently. Correct answers never leave server-side scoring routes.

create table question_bank_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  prompt text not null check (length(trim(prompt)) > 0),
  options jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 6),
  correct_option_index integer not null check (correct_option_index between 0 and 5),
  explanation text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger question_bank_items_set_updated_at before update on question_bank_items
  for each row execute function set_updated_at();
create index question_bank_items_org_idx on question_bank_items(org_id, created_at desc);
alter table question_bank_items enable row level security;
create policy question_bank_items_admin_only on question_bank_items
  for all using (org_id = current_org_id() and has_role('org_admin'))
  with check (org_id = current_org_id() and has_role('org_admin'));

create table assessments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  description text,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  pass_percent integer not null default 80 check (pass_percent between 1 and 100),
  max_attempts integer not null default 2 check (max_attempts between 1 and 10),
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger assessments_set_updated_at before update on assessments
  for each row execute function set_updated_at();
create index assessments_org_status_idx on assessments(org_id, status, created_at desc);
alter table assessments enable row level security;
create policy assessments_select on assessments for select using (
  org_id = current_org_id() and (status = 'published' or has_role('org_admin'))
);
create policy assessments_admin_write on assessments for all using (
  org_id = current_org_id() and has_role('org_admin')
) with check (org_id = current_org_id() and has_role('org_admin'));

create table assessment_questions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  assessment_id uuid not null references assessments(id) on delete cascade,
  question_id uuid not null references question_bank_items(id) on delete restrict,
  sequence integer not null default 0 check (sequence >= 0),
  points integer not null default 1 check (points between 1 and 100),
  unique (assessment_id, question_id)
);
create index assessment_questions_assessment_idx on assessment_questions(assessment_id, sequence);
alter table assessment_questions enable row level security;
create policy assessment_questions_admin_only on assessment_questions for all using (
  org_id = current_org_id() and has_role('org_admin')
) with check (org_id = current_org_id() and has_role('org_admin'));

create table assessment_assignments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  assessment_id uuid not null references assessments(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  due_date timestamptz,
  status text not null default 'assigned' check (status in ('assigned', 'submitted', 'passed', 'expired')),
  assigned_by uuid references profiles(id) on delete set null,
  assigned_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (assessment_id, user_id)
);
create index assessment_assignments_user_idx on assessment_assignments(org_id, user_id, status);
alter table assessment_assignments enable row level security;
create policy assessment_assignments_select on assessment_assignments for select using (
  org_id = current_org_id() and (user_id = auth.uid() or has_role('manager'))
);
create policy assessment_assignments_admin_write on assessment_assignments for all using (
  org_id = current_org_id() and has_role('org_admin')
) with check (org_id = current_org_id() and has_role('org_admin'));

create table assessment_attempts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  assessment_id uuid not null references assessments(id) on delete cascade,
  assignment_id uuid not null references assessment_assignments(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  attempt_number integer not null check (attempt_number > 0),
  answers jsonb not null default '{}'::jsonb,
  score_percent numeric(5,2) not null check (score_percent between 0 and 100),
  passed boolean not null,
  submitted_at timestamptz not null default now(),
  unique (assignment_id, attempt_number)
);
create index assessment_attempts_assignment_idx on assessment_attempts(assignment_id, attempt_number desc);
alter table assessment_attempts enable row level security;
create policy assessment_attempts_select on assessment_attempts for select using (
  org_id = current_org_id() and (user_id = auth.uid() or has_role('manager'))
);
