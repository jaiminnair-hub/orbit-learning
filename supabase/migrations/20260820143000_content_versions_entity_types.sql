-- content_versions — accept new entity types (Phase 3 step 4,
-- docs/PHASE3_DATA_MODEL.md §3.2).
--
-- Purely an added enum value on the existing entity_type check constraint.
-- The polymorphic design from Phase 2 step 3 (20260815160000_learning_objects.sql)
-- was built for precisely this: course_specifications and
-- component_definitions get the same immutable publish-snapshot promise
-- learning_objects and courses already have, with zero structural change.
--
-- Postgres has no ALTER CONSTRAINT for a CHECK's definition: drop the
-- original (its default name, table_column_check, from the inline
-- constraint in 20260815160000_learning_objects.sql) and recreate it
-- widened.

alter table content_versions drop constraint content_versions_entity_type_check;

alter table content_versions
  add constraint content_versions_entity_type_check
  check (entity_type in (
    'learning_object', 'course', 'content_asset', 'assessment',
    'course_specification', 'component_definition'
  ));
