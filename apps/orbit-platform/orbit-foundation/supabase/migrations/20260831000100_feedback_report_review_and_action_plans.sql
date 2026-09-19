-- Orbit 360: comment-safety review gate on report release, and durable
-- action plans for the private-directory roster model.

-- 1. Comment-safety review gate ---------------------------------------
-- Records that a feedback administrator has read every free-text comment
-- in a cycle before any report is released. This is a deliberate human
-- checkpoint, not automated content screening -- no major 360 tool in the
-- market runs algorithmic identity-risk detection on comments; the
-- standard is reviewer guidance at write time plus human judgment at
-- release time.
alter table public.feedback_cycles
  add column if not exists comments_reviewed_at timestamptz,
  add column if not exists comments_reviewed_by uuid references public.profiles(id) on delete set null;

-- 2. Durable action plans (directory-native) ---------------------------
-- Mirrors the field design of the legacy feedback_action_plans /
-- feedback_action_goals tables, but keyed to roster_subject_id (the
-- directory-native model) instead of participant_id + subject_user_id
-- (the legacy authenticated-user model). One plan per feedback subject,
-- holding one or more concrete behavioral-commitment goals.
create table if not exists public.feedback_directory_action_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  cycle_id uuid not null references public.feedback_cycles(id) on delete cascade,
  roster_subject_id uuid not null references public.feedback_cycle_roster_subjects(id) on delete cascade,
  status text not null default 'not_started'
    check (status in ('not_started', 'in_progress', 'complete', 'archived')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (roster_subject_id)
);

create table if not exists public.feedback_directory_action_goals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  action_plan_id uuid not null references public.feedback_directory_action_plans(id) on delete cascade,
  competency_id uuid references public.feedback_competencies(id) on delete set null,
  title text not null check (char_length(trim(title)) between 3 and 240),
  behavioral_commitment text not null check (char_length(trim(behavioral_commitment)) between 10 and 4000),
  due_at date,
  status text not null default 'not_started'
    check (status in ('not_started', 'in_progress', 'complete', 'cancelled')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (action_plan_id, sort_order)
);

create or replace function public.validate_feedback_directory_action_plan()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.feedback_cycle_roster_subjects subject
    where subject.id = new.roster_subject_id
      and subject.organization_id = new.organization_id
      and subject.cycle_id = new.cycle_id
  ) then
    raise exception 'An action plan must belong to the same organization and cycle as its feedback subject.';
  end if;
  return new;
end;
$$;

create or replace function public.validate_feedback_directory_action_goal()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.feedback_directory_action_plans plan
    where plan.id = new.action_plan_id
      and plan.organization_id = new.organization_id
  ) then
    raise exception 'An action goal must belong to the same organization as its action plan.';
  end if;
  return new;
end;
$$;

drop trigger if exists feedback_directory_action_plans_validate on public.feedback_directory_action_plans;
create trigger feedback_directory_action_plans_validate before insert or update on public.feedback_directory_action_plans
for each row execute function public.validate_feedback_directory_action_plan();
drop trigger if exists feedback_directory_action_plans_set_updated_at on public.feedback_directory_action_plans;
create trigger feedback_directory_action_plans_set_updated_at before update on public.feedback_directory_action_plans
for each row execute function public.set_updated_at();

drop trigger if exists feedback_directory_action_goals_validate on public.feedback_directory_action_goals;
create trigger feedback_directory_action_goals_validate before insert or update on public.feedback_directory_action_goals
for each row execute function public.validate_feedback_directory_action_goal();
drop trigger if exists feedback_directory_action_goals_set_updated_at on public.feedback_directory_action_goals;
create trigger feedback_directory_action_goals_set_updated_at before update on public.feedback_directory_action_goals
for each row execute function public.set_updated_at();

create index if not exists feedback_directory_action_plans_cycle_idx
  on public.feedback_directory_action_plans (organization_id, cycle_id);
create index if not exists feedback_directory_action_goals_plan_idx
  on public.feedback_directory_action_goals (organization_id, action_plan_id, status);

alter table public.feedback_directory_action_plans enable row level security;
alter table public.feedback_directory_action_goals enable row level security;

drop policy if exists "feedback admins manage directory action plans" on public.feedback_directory_action_plans;
create policy "feedback admins manage directory action plans"
on public.feedback_directory_action_plans for all to authenticated
using (public.is_feedback_admin(organization_id))
with check (public.is_feedback_admin(organization_id));

drop policy if exists "feedback admins manage directory action goals" on public.feedback_directory_action_goals;
create policy "feedback admins manage directory action goals"
on public.feedback_directory_action_goals for all to authenticated
using (public.is_feedback_admin(organization_id))
with check (public.is_feedback_admin(organization_id));

revoke all on function public.validate_feedback_directory_action_plan() from public;
revoke all on function public.validate_feedback_directory_action_goal() from public;
