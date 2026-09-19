-- Orbit 360 Feedback: real product data model.
-- Apply only after Orbit Foundation Phase 1 has been applied to the fresh
-- Orbit project. This is additive; it never touches LMS or prototype tables.

create table public.feedback_competencies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null check (code ~ '^[a-z][a-z0-9_]*$'),
  name text not null check (char_length(trim(name)) between 2 and 120),
  description text,
  sort_order integer not null default 0,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code),
  unique (id, organization_id)
);

create table public.feedback_question_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 160),
  description text,
  intended_purpose text not null default 'development'
    check (intended_purpose in ('development', 'appraisal', 'hybrid')),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  created_by uuid references auth.users(id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name),
  unique (id, organization_id)
);

create table public.feedback_template_questions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  template_id uuid not null,
  competency_id uuid references public.feedback_competencies(id) on delete set null,
  question_type text not null check (question_type in ('rating', 'open_text')),
  prompt text not null check (char_length(trim(prompt)) between 5 and 2000),
  scale_definition jsonb not null default '{"min":1,"max":5,"labels":{"1":"Rarely","5":"Consistently"}}'::jsonb
    check (jsonb_typeof(scale_definition) = 'object'),
  is_required boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (template_id, organization_id)
    references public.feedback_question_templates(id, organization_id) on delete cascade,
  foreign key (competency_id, organization_id)
    references public.feedback_competencies(id, organization_id) on delete set null (competency_id),
  unique (template_id, sort_order)
);

create table public.feedback_cycles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 160),
  description text,
  purpose text not null check (purpose in ('development', 'appraisal', 'hybrid')),
  status text not null default 'draft'
    check (status in ('draft', 'review', 'scheduled', 'live', 'closed', 'report_ready', 'archived')),
  questionnaire_name text,
  feedback_opens_at timestamptz,
  feedback_closes_at timestamptz,
  report_release_at timestamptz,
  timezone text not null default 'Asia/Kolkata',
  anonymous_group_threshold integer not null default 3 check (anonymous_group_threshold between 3 and 20),
  self_review_enabled boolean not null default true,
  allow_subject_rater_nominations boolean not null default true,
  require_manager_approval boolean not null default true,
  rating_scale_definition jsonb not null default '{"min":1,"max":5,"labels":{"1":"Rarely","5":"Consistently"}}'::jsonb
    check (jsonb_typeof(rating_scale_definition) = 'object'),
  created_by uuid references auth.users(id) on delete set null,
  launched_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name),
  unique (id, organization_id),
  check (feedback_closes_at is null or feedback_opens_at is null or feedback_closes_at > feedback_opens_at),
  check (report_release_at is null or feedback_closes_at is null or report_release_at >= feedback_closes_at)
);

-- Cycle questions are a snapshot, so changing a library template cannot alter a
-- live survey or invalidate historic reports.
create table public.feedback_cycle_questions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  cycle_id uuid not null,
  source_template_question_id uuid references public.feedback_template_questions(id) on delete set null,
  competency_id uuid references public.feedback_competencies(id) on delete set null,
  competency_label text,
  question_type text not null check (question_type in ('rating', 'open_text')),
  prompt text not null check (char_length(trim(prompt)) between 5 and 2000),
  scale_definition jsonb not null check (jsonb_typeof(scale_definition) = 'object'),
  is_required boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (cycle_id, organization_id)
    references public.feedback_cycles(id, organization_id) on delete cascade,
  foreign key (competency_id, organization_id)
    references public.feedback_competencies(id, organization_id) on delete set null (competency_id),
  unique (cycle_id, sort_order),
  unique (id, organization_id)
);

create table public.feedback_cycle_participants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  cycle_id uuid not null,
  subject_user_id uuid not null,
  manager_user_id uuid,
  status text not null default 'selected'
    check (status in ('selected', 'nominating', 'approved', 'live', 'complete', 'withdrawn')),
  report_status text not null default 'withheld'
    check (report_status in ('withheld', 'scheduled', 'released')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (cycle_id, organization_id)
    references public.feedback_cycles(id, organization_id) on delete cascade,
  foreign key (organization_id, subject_user_id)
    references public.organization_memberships(organization_id, user_id) on delete cascade,
  foreign key (organization_id, manager_user_id)
    references public.organization_memberships(organization_id, user_id) on delete set null (manager_user_id),
  unique (cycle_id, subject_user_id),
  unique (id, organization_id)
);

create table public.feedback_rater_nominations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  cycle_id uuid not null,
  subject_user_id uuid not null,
  reviewer_user_id uuid not null,
  rater_group text not null
    check (rater_group in ('self', 'manager', 'peer', 'direct_report', 'external')),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  nominated_by uuid references auth.users(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (cycle_id, organization_id)
    references public.feedback_cycles(id, organization_id) on delete cascade,
  foreign key (organization_id, subject_user_id)
    references public.organization_memberships(organization_id, user_id) on delete cascade,
  foreign key (organization_id, reviewer_user_id)
    references public.organization_memberships(organization_id, user_id) on delete cascade,
  unique (cycle_id, subject_user_id, reviewer_user_id),
  check ((rater_group = 'self') = (subject_user_id = reviewer_user_id))
);

create table public.feedback_review_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  cycle_id uuid not null,
  participant_id uuid not null,
  subject_user_id uuid not null,
  reviewer_user_id uuid not null,
  rater_group text not null
    check (rater_group in ('self', 'manager', 'peer', 'direct_report', 'external')),
  status text not null default 'not_started'
    check (status in ('not_started', 'in_progress', 'submitted', 'expired', 'withdrawn')),
  due_at timestamptz,
  started_at timestamptz,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (cycle_id, organization_id)
    references public.feedback_cycles(id, organization_id) on delete cascade,
  foreign key (participant_id, organization_id)
    references public.feedback_cycle_participants(id, organization_id) on delete cascade,
  foreign key (organization_id, subject_user_id)
    references public.organization_memberships(organization_id, user_id) on delete cascade,
  foreign key (organization_id, reviewer_user_id)
    references public.organization_memberships(organization_id, user_id) on delete cascade,
  unique (cycle_id, subject_user_id, reviewer_user_id),
  unique (id, organization_id),
  check ((rater_group = 'self') = (subject_user_id = reviewer_user_id)),
  check (submitted_at is null or status = 'submitted')
);

create table public.feedback_responses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  assignment_id uuid not null,
  cycle_question_id uuid not null,
  rating numeric(4,2) check (rating is null or (rating >= 0 and rating <= 10)),
  comment text check (comment is null or char_length(comment) <= 8000),
  is_skipped boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (assignment_id, organization_id)
    references public.feedback_review_assignments(id, organization_id) on delete cascade,
  foreign key (cycle_question_id, organization_id)
    references public.feedback_cycle_questions(id, organization_id) on delete cascade,
  unique (assignment_id, cycle_question_id),
  check (rating is not null or comment is not null or is_skipped)
);

create table public.feedback_report_releases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  cycle_id uuid not null,
  participant_id uuid not null,
  subject_user_id uuid not null,
  status text not null default 'withheld'
    check (status in ('withheld', 'scheduled', 'released')),
  scheduled_for timestamptz,
  released_at timestamptz,
  released_by uuid references auth.users(id) on delete set null,
  release_to_subject boolean not null default true,
  release_to_manager boolean not null default false,
  release_to_coach boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (cycle_id, organization_id)
    references public.feedback_cycles(id, organization_id) on delete cascade,
  foreign key (participant_id, organization_id)
    references public.feedback_cycle_participants(id, organization_id) on delete cascade,
  foreign key (organization_id, subject_user_id)
    references public.organization_memberships(organization_id, user_id) on delete cascade,
  unique (participant_id),
  unique (id, organization_id)
);

create table public.feedback_action_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  cycle_id uuid not null,
  participant_id uuid not null,
  subject_user_id uuid not null,
  status text not null default 'not_started'
    check (status in ('not_started', 'in_progress', 'complete', 'archived')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (cycle_id, organization_id)
    references public.feedback_cycles(id, organization_id) on delete cascade,
  foreign key (participant_id, organization_id)
    references public.feedback_cycle_participants(id, organization_id) on delete cascade,
  foreign key (organization_id, subject_user_id)
    references public.organization_memberships(organization_id, user_id) on delete cascade,
  unique (participant_id),
  unique (id, organization_id)
);

create table public.feedback_action_goals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  action_plan_id uuid not null,
  competency_id uuid references public.feedback_competencies(id) on delete set null,
  title text not null check (char_length(trim(title)) between 3 and 240),
  behavioral_commitment text not null check (char_length(trim(behavioral_commitment)) between 10 and 4000),
  owner_user_id uuid not null,
  due_at date,
  status text not null default 'not_started'
    check (status in ('not_started', 'in_progress', 'complete', 'cancelled')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (action_plan_id, organization_id)
    references public.feedback_action_plans(id, organization_id) on delete cascade,
  foreign key (organization_id, owner_user_id)
    references public.organization_memberships(organization_id, user_id) on delete cascade,
  foreign key (competency_id, organization_id)
    references public.feedback_competencies(id, organization_id) on delete set null (competency_id),
  unique (action_plan_id, sort_order)
);

create index feedback_cycles_org_status_idx on public.feedback_cycles(organization_id, status);
create index feedback_cycle_participants_subject_idx on public.feedback_cycle_participants(organization_id, subject_user_id, status);
create index feedback_rater_nominations_reviewer_idx on public.feedback_rater_nominations(organization_id, reviewer_user_id, status);
create index feedback_review_assignments_reviewer_idx on public.feedback_review_assignments(organization_id, reviewer_user_id, status, due_at);
create index feedback_review_assignments_subject_idx on public.feedback_review_assignments(organization_id, subject_user_id, status);
create index feedback_responses_assignment_idx on public.feedback_responses(organization_id, assignment_id);
create index feedback_action_plans_subject_idx on public.feedback_action_plans(organization_id, subject_user_id, status);
