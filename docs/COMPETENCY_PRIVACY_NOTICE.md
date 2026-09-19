# Competency development — purpose and legal basis

**Status:** an honest, code-verified description of how the feature behaves, written and
maintained alongside the implementation — not a substitute for an organisation's own
legal review of applicable data-protection law (in India, the DPDP Act). The same text
appears inline in the product itself (`/skills/development`, "Purpose and legal basis").

## Purpose

To connect a learner's own released 360-degree feedback to learning content they might
act on. The feature does not score, rank, certify, or report an individual to anyone else
— see `docs/ORBIT_COMPETENCY_SCOPING.md` for the product decisions behind that boundary.

## Legal basis

Explicit, opt-in consent (`competency_privacy_preferences.consented`, default `false` for
every account — verified in `orbit-foundation/supabase/migrations/20260916125643_p1_competency_development.sql`).
Recommendations are off until the learner turns them on, and turning them off immediately
stops processing (`competency_workspace`'s `consent` action deletes the learner's own
`competency_recommendation_choices` rows the moment consent is withdrawn).

## What is processed

Only computed development signals: a competency code, a gap size, the *category* of
reviewer group it came from (never an individual reviewer), a cycle name, and a release
date. Raw ratings, written comments, and reviewer identity are excluded at the SQL query
itself — the signal-computation query aggregates by rater group and threshold-checks
anonymity before any row is selected, so there is no downstream filtering step that could
be bypassed or forgotten. Verified by direct code review, not asserted from
documentation.

## Data minimisation

Signals are computed at read time, scoped to the signed-in caller's own identity
(`auth.uid()`), never batch-exported or shared with a third party. The one exception is
AI-assisted content-mapping suggestions, which see only a course/assessment's own
title and description plus the organisation's competency definitions — never any
feedback, rating, or learner-identifying data (`app/api/v1/competencies/suggest/route.ts`).

## Retention

Signals older than 365 days, or older than when consent was last re-enabled, are excluded
regardless of when the underlying report was released (`greatest(retained_from, now() -
interval '365 days')` as the cutoff). Recommendation choices and unresolved-for-over-a-year
rights requests are pruned automatically on every workspace call.

## Rights

A learner can, at any time, from `/skills/development`:
- **Download their own data** (the `export` action returns exactly what a `read` call
  would show them).
- **Request a correction** — routed to an organisation administrator with the Competencies
  role, who must record a real resolution before it can be marked resolved.
- **Delete their development choices** — stops processing immediately, resets consent to
  off, and excludes existing reports from future recommendation regeneration. This does
  **not** delete the underlying 360 report itself; that follows Orbit 360's own,
  separately governed retention policy — a deliberate distinction, not an oversight,
  since the 360 report is the organisation's record of a completed feedback cycle, not
  data this feature created.

## Access boundary

Every action requires product entitlement and, for reads, active organisation membership,
enforced by `competency_private.workspace`'s own checks — never a client-supplied
organisation or user id. Full authorisation model in the migration itself.
