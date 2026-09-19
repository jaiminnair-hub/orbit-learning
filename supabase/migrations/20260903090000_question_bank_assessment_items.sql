-- Unify question_bank_items onto the AssessmentItem shape (lib/spec/items.ts)
-- that Phase 3's authored-course quiz blocks already use. lib/spec/items.ts's
-- own header comment said Phase 4 should adopt this shape "rather than
-- inventing a second one" -- it didn't, when the standalone assessment
-- foundation shipped 2026-08-26. Fixed now, while there is real evidence
-- this is cheap: zero rows in question_bank_items, and the one real
-- assessment that exists ("POSH") has zero questions attached, so this is
-- schema cleanup, not a data migration.
--
-- Bank-organization metadata (external_id, learning_objective, skill_code,
-- difficulty, tags, explanation -- added in 20260826120000) is orthogonal to
-- the item's own pedagogical shape and is left untouched.

alter table question_bank_items drop column prompt;
alter table question_bank_items drop column options;
alter table question_bank_items drop column correct_option_index;

-- Full validation against the real AssessmentItem Zod schema happens
-- app-side on every write (app/api/v1/assessments/[id]/questions/route.ts)
-- -- the whole point of unifying is reusing that schema instead of a second,
-- hand-maintained one. This check is a backstop only: it catches a
-- write that bypassed the API (there is none today) or a schema
-- migration mistake, not a substitute for real validation.
alter table question_bank_items add column item jsonb not null
  check (item ? 'kind' and item ? 'id');
