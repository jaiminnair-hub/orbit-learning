-- course_specifications — index the authored body, not just the title.
-- Phase 3 step 11.
--
-- 20260820103000 created `search_vector` over the title alone and recorded
-- why: a course's readable text lives inside a nested block tree of
-- structured RichText spans, and walking that shape in pure SQL would be a
-- fragile JSON walk invented speculatively. It was to wait for "whichever of
-- steps 5/6 first has code that already parses the tree for another reason."
--
-- Steps 6 (editor) and 9 (export renderer) are both that reason. The walk now
-- lives in application code (lib/authoring/spec-text.ts), which writes its
-- result into `search_text`; this migration makes the generated vector cover
-- it. The column stays generated rather than trigger-maintained so the vector
-- can never drift from the text it is derived from.
--
-- Weighting: the title stays 'A' and the body is 'B', so a course *called*
-- "Fire safety" still outranks one that merely mentions fire safety in a
-- paragraph.
--
-- Existing rows get a null `search_text` and keep matching on title until
-- they are next saved, at which point the authoring routes populate it. No
-- backfill is attempted here: the source of truth is a jsonb tree only the
-- application can read correctly, and a SQL approximation of it is exactly
-- what this design avoids.

alter table course_specifications add column search_text text;

-- Generated columns cannot be altered in place; drop and recreate.
alter table course_specifications drop column search_vector;

alter table course_specifications
  add column search_vector tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(search_text, '')), 'B')
  ) stored;

create index course_specifications_search_idx on course_specifications using gin (search_vector);
