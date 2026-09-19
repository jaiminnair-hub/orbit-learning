-- Private, revocable report-access links. Tokens are stored only as hashes.
create table if not exists public.feedback_report_access_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  cycle_id uuid not null references public.feedback_cycles(id) on delete cascade,
  roster_subject_id uuid not null references public.feedback_cycle_roster_subjects(id) on delete cascade,
  recipient_email text not null,
  token_hash text not null unique,
  status text not null default 'sent' check (status in ('sent', 'opened', 'revoked', 'expired')),
  expires_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (roster_subject_id)
);
create index if not exists feedback_report_access_delivery_token_idx on public.feedback_report_access_deliveries (token_hash, status);
alter table public.feedback_report_access_deliveries enable row level security;
create policy "feedback admins manage report access deliveries"
on public.feedback_report_access_deliveries for all to authenticated
using (public.is_feedback_admin(organization_id))
with check (public.is_feedback_admin(organization_id));
