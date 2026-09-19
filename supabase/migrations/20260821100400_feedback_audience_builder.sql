-- Orbit 360 assessment-audience snapshots.
-- Every roster subject records how they entered the cycle so an administrator
-- can audit a bulk selection without future directory updates changing it.

alter table public.feedback_cycle_roster_subjects
  add column if not exists selection_source jsonb not null default '{"method":"manual"}'::jsonb
  check (jsonb_typeof(selection_source) = 'object');

create index if not exists feedback_cycle_roster_subjects_source_idx
  on public.feedback_cycle_roster_subjects using gin (selection_source);
