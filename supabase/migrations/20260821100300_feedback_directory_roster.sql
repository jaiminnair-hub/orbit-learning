-- Orbit 360 directory-native roster
-- A workforce record is not automatically a product account. These tables let
-- feedback administrators prepare subjects and raters from the private people
-- directory before invitations create any sign-in relationship.

create table if not exists public.feedback_cycle_roster_subjects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.foundation_organizations(id) on delete cascade,
  cycle_id uuid not null references public.feedback_cycles(id) on delete cascade,
  subject_person_id uuid not null references public.organization_people(id) on delete restrict,
  manager_person_id uuid references public.organization_people(id) on delete set null,
  status text not null default 'selected'
    check (status in ('selected', 'nominating', 'approved', 'invited', 'live', 'complete', 'withdrawn')),
  created_by uuid references public.foundation_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cycle_id, subject_person_id),
  unique (id, organization_id),
  check (manager_person_id is null or manager_person_id <> subject_person_id)
);

create table if not exists public.feedback_cycle_roster_raters (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.foundation_organizations(id) on delete cascade,
  cycle_id uuid not null references public.feedback_cycles(id) on delete cascade,
  subject_roster_id uuid not null references public.feedback_cycle_roster_subjects(id) on delete cascade,
  reviewer_person_id uuid not null references public.organization_people(id) on delete restrict,
  rater_group text not null
    check (rater_group in ('self', 'manager', 'peer', 'direct_report', 'external')),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'withdrawn', 'invited', 'submitted')),
  nominated_by uuid references public.foundation_profiles(id) on delete set null,
  reviewed_by uuid references public.foundation_profiles(id) on delete set null,
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (subject_roster_id, reviewer_person_id)
);

create or replace function public.validate_feedback_directory_roster_subject()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.feedback_cycles
    where id = new.cycle_id and organization_id = new.organization_id
  ) then
    raise exception 'The selected cycle does not belong to this organization.';
  end if;

  if not exists (
    select 1 from public.organization_people
    where id = new.subject_person_id and organization_id = new.organization_id
  ) then
    raise exception 'The selected feedback subject does not belong to this organization.';
  end if;

  if new.manager_person_id is not null and not exists (
    select 1 from public.organization_people
    where id = new.manager_person_id and organization_id = new.organization_id
  ) then
    raise exception 'The selected manager does not belong to this organization.';
  end if;
  return new;
end;
$$;

create or replace function public.validate_feedback_directory_roster_rater()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_subject uuid;
begin
  select subject_person_id into selected_subject
  from public.feedback_cycle_roster_subjects
  where id = new.subject_roster_id
    and cycle_id = new.cycle_id
    and organization_id = new.organization_id;

  if selected_subject is null then
    raise exception 'The selected feedback subject is not part of this cycle.';
  end if;

  if not exists (
    select 1 from public.organization_people
    where id = new.reviewer_person_id and organization_id = new.organization_id
  ) then
    raise exception 'The selected reviewer does not belong to this organization.';
  end if;

  if (new.rater_group = 'self') <> (new.reviewer_person_id = selected_subject) then
    raise exception 'Self feedback must be assigned to the feedback subject.';
  end if;
  return new;
end;
$$;

drop trigger if exists feedback_cycle_roster_subjects_validate on public.feedback_cycle_roster_subjects;
create trigger feedback_cycle_roster_subjects_validate
before insert or update on public.feedback_cycle_roster_subjects
for each row execute function public.validate_feedback_directory_roster_subject();

drop trigger if exists feedback_cycle_roster_subjects_set_updated_at on public.feedback_cycle_roster_subjects;
create trigger feedback_cycle_roster_subjects_set_updated_at
before update on public.feedback_cycle_roster_subjects
for each row execute function public.foundation_set_updated_at();

drop trigger if exists feedback_cycle_roster_raters_validate on public.feedback_cycle_roster_raters;
create trigger feedback_cycle_roster_raters_validate
before insert or update on public.feedback_cycle_roster_raters
for each row execute function public.validate_feedback_directory_roster_rater();

drop trigger if exists feedback_cycle_roster_raters_set_updated_at on public.feedback_cycle_roster_raters;
create trigger feedback_cycle_roster_raters_set_updated_at
before update on public.feedback_cycle_roster_raters
for each row execute function public.foundation_set_updated_at();

create index if not exists feedback_cycle_roster_subjects_cycle_idx
  on public.feedback_cycle_roster_subjects (organization_id, cycle_id, status);
create index if not exists feedback_cycle_roster_raters_subject_idx
  on public.feedback_cycle_roster_raters (organization_id, subject_roster_id, status);

alter table public.feedback_cycle_roster_subjects enable row level security;
alter table public.feedback_cycle_roster_raters enable row level security;

drop policy if exists "feedback admins manage directory roster subjects" on public.feedback_cycle_roster_subjects;
create policy "feedback admins manage directory roster subjects"
on public.feedback_cycle_roster_subjects for all to authenticated
using (public.is_feedback_admin(organization_id))
with check (public.is_feedback_admin(organization_id));

drop policy if exists "feedback admins manage directory roster raters" on public.feedback_cycle_roster_raters;
create policy "feedback admins manage directory roster raters"
on public.feedback_cycle_roster_raters for all to authenticated
using (public.is_feedback_admin(organization_id))
with check (public.is_feedback_admin(organization_id));

revoke all on function public.validate_feedback_directory_roster_subject() from public;
revoke all on function public.validate_feedback_directory_roster_rater() from public;
