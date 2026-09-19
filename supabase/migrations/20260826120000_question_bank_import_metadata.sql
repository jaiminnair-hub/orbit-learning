-- Metadata carried by the administrator-friendly question-bank workbook.
-- These fields preserve context for the future skills/capability layer;
-- they do not create automated competency claims.
alter table question_bank_items
  add column if not exists external_id text,
  add column if not exists learning_objective text,
  add column if not exists skill_code text,
  add column if not exists difficulty text check (difficulty is null or difficulty in ('foundation', 'working', 'advanced')),
  add column if not exists tags text[] not null default '{}';

create unique index if not exists question_bank_items_org_external_id_unique_idx
  on question_bank_items(org_id, external_id)
  where external_id is not null;
