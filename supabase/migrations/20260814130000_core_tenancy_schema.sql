-- Core tenancy schema: organizations, departments, profiles, invitations,
-- platform admin grants, plans/subscriptions, and generic log shells.
--
-- RLS and the current_org_id()/is_org_member()/has_role()/is_platform_admin()
-- helper functions are added in the next migration (...143000_rls_and_helpers)
-- deliberately split per DEVELOPMENT_SEQUENCE.md steps 4 and 5 — applied
-- together in the same sitting so no window of unsecured access exists
-- against real data (this project has none yet).
--
-- See docs/DATABASE.md §1-2 and §6 for the design rationale.

-- Shared trigger: keep updated_at current on every UPDATE.
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- plans (platform-level product catalog — no org_id, these aren't tenants)
-- ---------------------------------------------------------------------
create table plans (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  tier text not null check (tier in ('free', 'starter', 'pro', 'enterprise')),
  feature_flags jsonb not null default '{}'::jsonb,
  price_usd_cents integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger plans_set_updated_at
  before update on plans
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- organizations (the tenant root — no org_id column, it IS the tenant)
-- ---------------------------------------------------------------------
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  plan_id uuid references plans(id),
  seats integer not null default 5,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger organizations_set_updated_at
  before update on organizations
  for each row execute function set_updated_at();

create index organizations_slug_idx on organizations (slug) where deleted_at is null;

-- ---------------------------------------------------------------------
-- subscriptions (one entitlement source per org — replaces an earlier project's
-- two-parallel-plan-concepts bug: organizations.plan vs profiles.plan)
-- ---------------------------------------------------------------------
create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  plan_id uuid not null references plans(id),
  status text not null check (status in ('trialing', 'active', 'past_due', 'canceled')),
  current_period_end timestamptz,
  provider_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger subscriptions_set_updated_at
  before update on subscriptions
  for each row execute function set_updated_at();

create index subscriptions_org_idx on subscriptions (org_id);
create unique index subscriptions_one_active_per_org
  on subscriptions (org_id) where status in ('trialing', 'active');

-- ---------------------------------------------------------------------
-- departments (org-scoped groups, self-referencing hierarchy)
-- ---------------------------------------------------------------------
create table departments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  parent_department_id uuid references departments(id) on delete set null,
  manager_id uuid, -- FK added below, once profiles exists
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger departments_set_updated_at
  before update on departments
  for each row execute function set_updated_at();

create index departments_org_idx on departments (org_id);
create unique index departments_org_name_parent_idx
  on departments (org_id, name, coalesce(parent_department_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where deleted_at is null;

-- ---------------------------------------------------------------------
-- profiles (one per auth.users row — the RBAC + tenancy anchor)
-- ---------------------------------------------------------------------
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  org_id uuid references organizations(id) on delete set null,
  department_id uuid references departments(id) on delete set null,
  full_name text,
  email text not null,
  role text not null default 'learner'
    check (role in ('learner', 'manager', 'org_admin', 'org_owner')),
  status text not null default 'active' check (status in ('active', 'invited', 'suspended')),
  last_seen_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on profiles
  for each row execute function set_updated_at();

create index profiles_org_idx on profiles (org_id);
create index profiles_department_idx on profiles (department_id);
create unique index profiles_org_email_idx on profiles (org_id, email) where deleted_at is null;

alter table departments
  add constraint departments_manager_fkey
  foreign key (manager_id) references profiles(id) on delete set null;

create index departments_manager_idx on departments (manager_id);

-- ---------------------------------------------------------------------
-- org_invitations
-- ---------------------------------------------------------------------
create table org_invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  email text not null,
  role text not null check (role in ('learner', 'manager', 'org_admin', 'org_owner')),
  token text not null unique,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  invited_by uuid references profiles(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger org_invitations_set_updated_at
  before update on org_invitations
  for each row execute function set_updated_at();

create index org_invitations_org_idx on org_invitations (org_id);
create index org_invitations_token_idx on org_invitations (token);
create index org_invitations_pending_email_idx
  on org_invitations (org_id, email) where status = 'pending';

-- ---------------------------------------------------------------------
-- platform_admins (replaces an earlier project's hardcoded-email admin pattern —
-- see docs/MULTI_TENANCY.md §4)
-- ---------------------------------------------------------------------
create table platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_by uuid references auth.users(id),
  granted_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- activity_log (unified — replaces an earlier project's four independent log
-- tables; see docs/DATABASE.md §6)
-- ---------------------------------------------------------------------
create table activity_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  entity_type text,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  is_platform_admin_action boolean not null default false,
  created_at timestamptz not null default now()
);

create index activity_log_org_idx on activity_log (org_id, created_at desc);
create index activity_log_actor_idx on activity_log (actor_id, created_at desc);
create index activity_log_event_type_idx on activity_log (event_type);

-- ---------------------------------------------------------------------
-- ai_usage_log
-- ---------------------------------------------------------------------
create table ai_usage_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  feature text not null,
  provider text not null,
  model text,
  tokens_in integer,
  tokens_out integer,
  latency_ms integer,
  success boolean not null,
  error_message text,
  cost_usd numeric(10, 6),
  created_at timestamptz not null default now()
);

create index ai_usage_log_org_idx on ai_usage_log (org_id, created_at desc);
create index ai_usage_log_feature_idx on ai_usage_log (feature);

-- ---------------------------------------------------------------------
-- Auto-create a bare profile row on signup. Org assignment happens later,
-- via invitation acceptance in the application layer (Phase 1, step 9) —
-- not here, so this trigger stays simple and has nothing to get wrong.
-- ---------------------------------------------------------------------
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
