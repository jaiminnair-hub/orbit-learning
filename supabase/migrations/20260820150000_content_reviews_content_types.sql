-- content_reviews — accept the Phase 3 authored entity types (step 6).
--
-- Step 4 widened content_versions.entity_type for course_specification and
-- component_definition, but missed its sibling: content_reviews carries the
-- review/approval trail written by the same publish path
-- (lib/content/publish.ts), so a specification publish would have passed the
-- snapshot write and then failed on the audit insert. Found while wiring the
-- authoring publish route, which is the first caller that writes one.
--
-- Same drop-and-recreate as 20260820143000: Postgres has no ALTER CONSTRAINT
-- for a CHECK's definition, and the original was created inline in
-- 20260815160000_learning_objects.sql, so it carries the default
-- {table}_{column}_check name.

alter table content_reviews drop constraint content_reviews_content_type_check;

alter table content_reviews
  add constraint content_reviews_content_type_check
  check (content_type in (
    'learning_object', 'course', 'content_asset', 'assessment',
    'course_specification', 'component_definition'
  ));
