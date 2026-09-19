# Orbit Foundation Phase 1

> **Historical foundation note — reconciled 2026-08-26.** This directory is
> the original stand-alone foundation specification and migration package. The
> operational Orbit Foundation project now supports the live Orbit-to-Learning
> entry handoff, but this document must not be read as a live infrastructure
> inventory or a claim that the LMS and 360 data stores have been merged. See
> the LMS repository's `docs/CURRENT_STATUS.md` for the current cross-product
> release ledger.

This folder is the fresh-database foundation for the unified Orbit platform.
It contains schema, access-control helpers, RLS policies, product catalogue
seeds, and structural verification. It does **not** connect to Supabase,
deploy an application, or move data from LMS or 360 Feedback.

## What it creates

- Multi-organization identity and active-organization switching.
- Organization roles separate from product roles.
- Entitlements that allow a customer to purchase LMS, Feedback, Growth, and
  Competencies independently.
- Explicit product-role assignments, so organization administrators do not
  automatically see confidential product data.
- Hashed invitations, audit events, shared authorization helpers, and RLS.

## Safety boundary

Apply these migrations **only** to a new, empty Supabase project created for
Orbit Foundation. Do not apply them to:

- the existing Orbit 360 Supabase project;
- the LMS development Supabase project; or
- any database containing customer data.

The migration package intentionally creates canonical names such as
`organizations` and `profiles`. Applying it to either source project would
cause table collisions and is unsafe.

## Files in order

1. `supabase/migrations/20260821090000_orbit_platform_schema.sql`
2. `supabase/migrations/20260821090100_orbit_platform_security.sql`
3. `supabase/migrations/20260821090200_orbit_platform_rls.sql`
4. `supabase/migrations/20260821090300_orbit_product_catalog.sql`
5. `tests/001_foundation_schema_assertions.sql`

## Validation process when the new project exists

1. Create a new local Supabase CLI project or link a new, empty remote Orbit
   project.
2. Copy these migration files into that new project's `supabase/migrations/`
   folder, retaining their filenames and order.
3. Apply migrations with the Supabase CLI.
4. Run `tests/001_foundation_schema_assertions.sql` in the SQL editor or with
   `supabase db execute`.
5. Run acceptance tests for: signup, organization creation, membership,
   organization switching, LMS-only entitlement, Feedback-only entitlement,
   expired role assignment, and cross-organization denial.
6. Only after those pass, connect the new project to a development branch of
   the Orbit application.

## What remains deliberately unbuilt

- Billing provider and webhook integration.
- Admin UI/API for issuing entitlements, invitations, and product-role grants.
- Product tables and RLS for LMS and Feedback.
- Data migration from either source database.
- Orbit app shell and product switcher.

Those are later phases, after this foundation has been reviewed against a new
Supabase project.
