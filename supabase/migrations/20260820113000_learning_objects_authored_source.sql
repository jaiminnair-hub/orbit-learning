-- learning_objects — add a source discriminator (Phase 3 step 4,
-- docs/PHASE3_DATA_MODEL.md §3.1).
--
-- Why this and not a new parallel entity: the learning object is the reuse
-- unit for the whole content model. Making authored content a KIND of
-- learning object means it is immediately reusable across lessons and
-- courses via the existing lesson_learning_objects join, with zero change
-- to that table, to modules, to lessons, or to courses.
--
-- No Phase 1/2 row is affected: every existing row defaults to 'assets'
-- and behaves exactly as it does today.

alter table learning_objects
  add column source text not null default 'assets'
    check (source in ('assets', 'authored', 'scorm'));

alter table learning_objects
  add column course_specification_id uuid references course_specifications(id) on delete set null;

create index learning_objects_course_specification_idx
  on learning_objects (course_specification_id)
  where course_specification_id is not null;
