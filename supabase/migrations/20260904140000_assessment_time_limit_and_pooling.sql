-- ===========================================================================
-- Assessment time limits + question pooling/randomization (2026-09-04, Tier 1
-- of the comparison-matrix follow-up). Both additive to the standalone
-- assessment engine shipped 2026-08-26 — no change to existing assessments,
-- which keep time_limit_minutes/question_pool_size null and
-- randomize_questions false (all questions, author order, no clock).
--
-- `current_attempt_started_at`/`current_attempt_question_ids` on
-- `assessment_assignments` persist the ONE decision made when an attempt
-- begins (lib/assessments/attempt.ts's startOrResumeAttempt): which
-- questions were drawn, in what order, and when the clock started. Both are
-- read back on submit so scoring and time-limit enforcement agree with what
-- was actually presented, and both are cleared once an attempt is recorded
-- (or expires), so the next attempt draws fresh. No RLS policy change is
-- needed: assessment_assignments already has no update policy for the
-- learner's own session client (only assessment_assignments_admin_write,
-- org_admin-only) — every existing mutation on this table already goes
-- through the admin client (see app/api/v1/assessments/[id]/submit/route.ts),
-- and these two columns follow the same established path.
-- ===========================================================================

alter table assessments
  add column time_limit_minutes integer check (time_limit_minutes is null or time_limit_minutes > 0),
  add column question_pool_size integer check (question_pool_size is null or question_pool_size > 0),
  add column randomize_questions boolean not null default false;

alter table assessment_assignments
  add column current_attempt_started_at timestamptz,
  add column current_attempt_question_ids jsonb;
