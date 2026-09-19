-- ===========================================================================
-- Authored-content bridge (2026-09-11) — makes the publish-time upsert in
-- app/api/v1/authoring/specs/[id]/publish/route.ts race-safe: two rapid
-- publishes of the same specification must sync one learning_objects row,
-- never create two. Partial (nulls excluded) since every non-authored
-- learning object leaves course_specification_id null.
-- ===========================================================================

create unique index learning_objects_course_specification_id_idx
  on learning_objects (course_specification_id)
  where course_specification_id is not null;
