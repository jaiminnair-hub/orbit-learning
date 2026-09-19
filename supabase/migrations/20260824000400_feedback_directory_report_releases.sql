-- Orbit 360: report release state for the private-directory roster model.
-- Reports are calculated server-side; this table records only whether an
-- administrator has deliberately released a subject's protected report.
create table if not exists public.feedback_directory_report_releases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.foundation_organizations(id) on delete cascade,
  cycle_id uuid not null references public.feedback_cycles(id) on delete cascade,
  roster_subject_id uuid not null references public.feedback_cycle_roster_subjects(id) on delete cascade,
  status text not null default 'withheld' check (status in ('withheld', 'released')),
  released_at timestamptz,
  released_by uuid references public.foundation_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (roster_subject_id)
);

create index if not exists feedback_directory_report_releases_cycle_idx
  on public.feedback_directory_report_releases (organization_id, cycle_id, status);

create or replace function public.validate_feedback_directory_report_release()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.feedback_cycle_roster_subjects subject
    where subject.id = new.roster_subject_id
      and subject.organization_id = new.organization_id
      and subject.cycle_id = new.cycle_id
  ) then
    raise exception 'Report release must belong to the same organization and cycle.';
  end if;
  if new.status = 'released' and new.released_at is null then new.released_at = now(); end if;
  return new;
end;
$$;

drop trigger if exists feedback_directory_report_releases_validate on public.feedback_directory_report_releases;
create trigger feedback_directory_report_releases_validate before insert or update on public.feedback_directory_report_releases
for each row execute function public.validate_feedback_directory_report_release();
drop trigger if exists feedback_directory_report_releases_set_updated_at on public.feedback_directory_report_releases;
create trigger feedback_directory_report_releases_set_updated_at before update on public.feedback_directory_report_releases
for each row execute function public.foundation_set_updated_at();

alter table public.feedback_directory_report_releases enable row level security;
create policy "feedback admins manage directory report releases"
on public.feedback_directory_report_releases for all to authenticated
using (public.is_feedback_admin(organization_id))
with check (public.is_feedback_admin(organization_id));
revoke all on function public.validate_feedback_directory_report_release() from public;
