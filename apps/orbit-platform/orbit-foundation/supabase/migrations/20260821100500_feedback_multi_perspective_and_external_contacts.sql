-- Orbit 360: multi-perspective rater plans and external customer contacts.
-- This extends the directory-native roster; it does not alter existing people
-- or remove any previous rater assignments.

create table if not exists public.feedback_external_contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  cycle_id uuid not null references public.feedback_cycles(id) on delete cascade,
  subject_roster_id uuid not null references public.feedback_cycle_roster_subjects(id) on delete cascade,
  full_name text not null check (char_length(trim(full_name)) >= 2),
  email text not null check (position('@' in email) > 1),
  normalized_email text generated always as (lower(trim(email))) stored,
  company_name text,
  relationship_label text,
  status text not null default 'active'
    check (status in ('active', 'invited', 'submitted', 'bounced', 'withdrawn')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (subject_roster_id, normalized_email),
  unique (id, organization_id)
);

alter table public.feedback_cycle_roster_raters
  drop constraint if exists feedback_cycle_roster_raters_rater_group_check;

alter table public.feedback_cycle_roster_raters
  add constraint feedback_cycle_roster_raters_rater_group_check
  check (rater_group in (
    'self', 'manager', 'skip_manager', 'peer', 'same_team',
    'cross_functional', 'direct_report', 'external'
  ));

alter table public.feedback_cycle_roster_raters
  alter column reviewer_person_id drop not null,
  add column if not exists external_contact_id uuid
    references public.feedback_external_contacts(id) on delete cascade;

alter table public.feedback_cycle_roster_raters
  drop constraint if exists feedback_cycle_roster_raters_exactly_one_reviewer;

alter table public.feedback_cycle_roster_raters
  add constraint feedback_cycle_roster_raters_exactly_one_reviewer
  check (
    (reviewer_person_id is not null and external_contact_id is null)
    or (reviewer_person_id is null and external_contact_id is not null)
  );

create unique index if not exists feedback_cycle_roster_raters_external_unique
  on public.feedback_cycle_roster_raters (subject_roster_id, external_contact_id)
  where external_contact_id is not null;

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

  if new.reviewer_person_id is not null and not exists (
    select 1 from public.organization_people
    where id = new.reviewer_person_id and organization_id = new.organization_id
  ) then
    raise exception 'The selected reviewer does not belong to this organization.';
  end if;

  if new.external_contact_id is not null and not exists (
    select 1 from public.feedback_external_contacts
    where id = new.external_contact_id
      and organization_id = new.organization_id
      and cycle_id = new.cycle_id
      and subject_roster_id = new.subject_roster_id
  ) then
    raise exception 'The selected external contact is not linked to this feedback subject.';
  end if;

  if new.rater_group = 'external' and new.external_contact_id is null then
    raise exception 'External feedback requires an external contact.';
  end if;

  if new.rater_group <> 'external' and new.reviewer_person_id is null then
    raise exception 'Internal feedback requires a person from the organization directory.';
  end if;

  if (new.rater_group = 'self') <> (new.reviewer_person_id = selected_subject) then
    raise exception 'Self feedback must be assigned to the feedback subject.';
  end if;
  return new;
end;
$$;

create index if not exists feedback_external_contacts_cycle_idx
  on public.feedback_external_contacts (organization_id, cycle_id, subject_roster_id, status);

alter table public.feedback_external_contacts enable row level security;

drop policy if exists "feedback admins manage external contacts" on public.feedback_external_contacts;
create policy "feedback admins manage external contacts"
on public.feedback_external_contacts for all to authenticated
using (public.is_feedback_admin(organization_id))
with check (public.is_feedback_admin(organization_id));

drop trigger if exists feedback_external_contacts_set_updated_at on public.feedback_external_contacts;
create trigger feedback_external_contacts_set_updated_at
before update on public.feedback_external_contacts
for each row execute function public.set_updated_at();
