-- Orbit 360: server-issued reviewer invitation delivery.
-- Tokens are stored only as SHA-256 hashes. The raw token exists only while
-- the delivery service builds the one-time reviewer link.

create table if not exists public.feedback_invitation_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.foundation_organizations(id) on delete cascade,
  cycle_id uuid not null references public.feedback_cycles(id) on delete cascade,
  roster_rater_id uuid not null references public.feedback_cycle_roster_raters(id) on delete cascade,
  recipient_email text not null,
  token_hash text not null unique,
  delivery_kind text not null default 'initial'
    check (delivery_kind in ('initial', 'reminder', 'resend')),
  status text not null default 'queued'
    check (status in ('queued', 'sent', 'failed', 'opened', 'completed', 'revoked', 'expired')),
  provider_message_id text,
  failure_reason text,
  sent_at timestamptz,
  opened_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz not null,
  created_by uuid references public.foundation_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists feedback_invitation_deliveries_roster_idx
  on public.feedback_invitation_deliveries (organization_id, roster_rater_id, created_at desc);
create index if not exists feedback_invitation_deliveries_cycle_status_idx
  on public.feedback_invitation_deliveries (organization_id, cycle_id, status, expires_at);

alter table public.feedback_invitation_deliveries enable row level security;

create policy "feedback admins view invitation delivery"
  on public.feedback_invitation_deliveries for select to authenticated
  using (public.is_feedback_admin(organization_id));

-- Creation and email sending are server-only operations. The browser never
-- receives a raw token and cannot insert, update, or revoke delivery records.

create or replace function public.feedback_invitation_deliveries_set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger feedback_invitation_deliveries_set_updated_at
  before update on public.feedback_invitation_deliveries
  for each row execute function public.feedback_invitation_deliveries_set_updated_at();
