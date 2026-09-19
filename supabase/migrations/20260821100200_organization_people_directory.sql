-- Orbit workforce directory
-- People exist before they receive a product account. This lets an authorized
-- administrator import a workforce privately, then invite only the people who
-- need to sign in for a particular Orbit product.

create table if not exists public.organization_people (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.foundation_organizations(id) on delete cascade,
  linked_user_id uuid references public.foundation_profiles(id) on delete set null,
  employee_number text,
  first_name text,
  last_name text,
  full_name text not null check (char_length(trim(full_name)) >= 2),
  work_email text not null check (position('@' in work_email) > 1),
  normalized_email text generated always as (lower(work_email)) stored,
  job_title text,
  department text,
  location text,
  manager_email text,
  employment_status text not null default 'active'
    check (employment_status in ('active', 'inactive', 'on_leave')),
  start_date date,
  source text not null default 'manual' check (source in ('manual', 'spreadsheet_import', 'hris_sync')),
  imported_by uuid references public.foundation_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, normalized_email),
  unique (organization_id, employee_number)
);

create index if not exists organization_people_org_status_idx
  on public.organization_people (organization_id, employment_status, full_name);

create index if not exists organization_people_org_department_idx
  on public.organization_people (organization_id, department);

drop trigger if exists organization_people_set_updated_at on public.organization_people;
create trigger organization_people_set_updated_at
before update on public.organization_people
for each row execute function public.foundation_set_updated_at();

alter table public.organization_people enable row level security;

drop policy if exists "feedback admins can view their workforce directory" on public.organization_people;
create policy "feedback admins can view their workforce directory"
on public.organization_people for select to authenticated
using (public.is_feedback_admin(organization_id));

drop policy if exists "feedback admins can add workforce people" on public.organization_people;
create policy "feedback admins can add workforce people"
on public.organization_people for insert to authenticated
with check (
  public.is_feedback_admin(organization_id)
  and (imported_by is null or imported_by = auth.uid())
);

drop policy if exists "feedback admins can edit their workforce directory" on public.organization_people;
create policy "feedback admins can edit their workforce directory"
on public.organization_people for update to authenticated
using (public.is_feedback_admin(organization_id))
with check (public.is_feedback_admin(organization_id));

drop policy if exists "feedback admins can remove workforce people" on public.organization_people;
create policy "feedback admins can remove workforce people"
on public.organization_people for delete to authenticated
using (public.is_feedback_admin(organization_id));

