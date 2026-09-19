-- ===========================================================================
-- Insights articles (2026-09-10) — a public, platform-level editorial
-- section (LMS standards, succession planning, 360 feedback, competency
-- mapping), not org-scoped content. One article generated and published
-- automatically per day by app/api/cron/insights/route.ts — no draft state,
-- no review queue, per explicit product decision: fully automatic, no
-- human approval step. Written and inserted only by the service-role
-- client (see lib/lms/insights.ts); RLS grants everyone else read-only,
-- mirroring the `plans` table's own public-read shape
-- (20260814143000_rls_and_helpers.sql's `plans_select ... using (true)`).
-- ===========================================================================

create table insights_articles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null check (length(trim(title)) > 0),
  summary text not null check (length(trim(summary)) > 0),
  body text not null check (length(trim(body)) > 0),
  category text not null check (length(trim(category)) > 0),
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index insights_articles_published_idx on insights_articles (published_at desc);

alter table insights_articles enable row level security;

create policy insights_articles_select on insights_articles
  for select using (true);
