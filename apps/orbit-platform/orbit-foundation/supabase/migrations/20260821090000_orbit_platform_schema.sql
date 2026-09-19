-- Orbit Foundation Phase 1
-- Apply only to a NEW, empty Orbit Supabase project.
-- Never apply this package to the existing LMS or Orbit 360 projects.

create extension if not exists pgcrypto;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 160),
  slug text not null unique check (slug = lower(slug) and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  status text not null default 'active' check (status in ('active', 'suspended', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

-- One identity record per Supabase Auth user. Organization membership and
-- permissions intentionally do not live here: one person may join many orgs.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, name)
);

create table public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  org_role text not null default 'employee'
    check (org_role in ('org_owner', 'org_admin', 'manager', 'employee')),
  department_id uuid,
  status text not null default 'active'
    check (status in ('active', 'invited', 'suspended')),
  joined_at timestamptz,
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id),
  foreign key (department_id, organization_id)
    references public.departments(id, organization_id) on delete set null (department_id)
);

-- Stores the organization selected by a user. The composite foreign key makes
-- selecting an organization without membership impossible at the data layer.
create table public.user_active_organizations (
  user_id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null,
  set_at timestamptz not null default now(),
  foreign key (organization_id, user_id)
    references public.organization_memberships(organization_id, user_id) on delete cascade
);

create table public.products (
  product_key text primary key check (product_key ~ '^[a-z][a-z0-9_]*$'),
  name text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Product roles are data, not one global enum, so future products can define
-- their own vocabulary without allowing LMS roles in Feedback by mistake.
create table public.product_roles (
  product_key text not null references public.products(product_key) on delete cascade,
  role_key text not null check (role_key ~ '^[a-z][a-z0-9_]*$'),
  name text not null,
  description text,
  is_assignable boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (product_key, role_key)
);

-- This is the commercial source of truth. A customer can hold LMS only,
-- Feedback only, several products, or the entire Orbit suite.
create table public.organization_product_entitlements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_key text not null references public.products(product_key),
  status text not null check (status in ('trial', 'active', 'suspended', 'cancelled')),
  plan_tier text,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  seat_limit integer check (seat_limit is null or seat_limit > 0),
  usage_limit integer check (usage_limit is null or usage_limit > 0),
  feature_flags jsonb not null default '{}'::jsonb check (jsonb_typeof(feature_flags) = 'object'),
  billing_provider_ref text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, product_key),
  check (ends_at is null or ends_at >= starts_at)
);

-- Explicit product grants. A membership in an organization and purchase of a
-- product are both insufficient by themselves to expose confidential data.
create table public.product_role_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  user_id uuid not null,
  product_key text not null,
  role_key text not null,
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id, product_key, role_key),
  foreign key (organization_id, user_id)
    references public.organization_memberships(organization_id, user_id) on delete cascade,
  foreign key (product_key, role_key)
    references public.product_roles(product_key, role_key) on delete restrict,
  check (expires_at is null or expires_at > granted_at)
);

-- Platform staff are deliberately outside customer memberships. Any
-- cross-tenant action must be performed server-side and written to audit events.
create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create table public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  org_role text not null default 'employee'
    check (org_role in ('org_owner', 'org_admin', 'manager', 'employee')),
  token_hash text not null unique,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'revoked', 'expired')),
  expires_at timestamptz not null,
  invited_by uuid references auth.users(id) on delete set null,
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'accepted') = (accepted_at is not null))
);

create table public.organization_invitation_product_roles (
  invitation_id uuid not null references public.organization_invitations(id) on delete cascade,
  product_key text not null,
  role_key text not null,
  created_at timestamptz not null default now(),
  primary key (invitation_id, product_key, role_key),
  foreign key (product_key, role_key)
    references public.product_roles(product_key, role_key) on delete restrict
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null default now()
);

create index organization_memberships_user_idx
  on public.organization_memberships(user_id, status);
create index organization_memberships_org_idx
  on public.organization_memberships(organization_id, status);
create index departments_organization_idx on public.departments(organization_id);
create index product_role_assignments_access_idx
  on public.product_role_assignments(organization_id, user_id, product_key, expires_at);
create index organization_product_entitlements_access_idx
  on public.organization_product_entitlements(organization_id, product_key, status, starts_at, ends_at);
create index organization_invitations_pending_idx
  on public.organization_invitations(organization_id, status, expires_at);
create unique index organization_invitations_one_pending_email_idx
  on public.organization_invitations(organization_id, lower(email))
  where status = 'pending';
create index audit_events_organization_idx
  on public.audit_events(organization_id, occurred_at desc);
