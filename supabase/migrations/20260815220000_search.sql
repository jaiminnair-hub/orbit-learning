-- Real server-side search (Phase 2, step 7). See docs/CONTENT_MODEL.md §7.
--
-- an earlier project's search was client-side `.includes()` over static arrays
-- (Stage 1 audit) — this is the deliberate replacement. It lands here
-- rather than earlier because Phase 2 step 7 is the first point real
-- content exists to search; building it sooner would have been
-- speculative infrastructure.
--
-- Generated columns rather than triggers: Postgres keeps them in sync
-- automatically, so there's no way for the index to drift from the row.

alter table learning_objects
  add column search_vector tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B')
  ) stored;

create index learning_objects_search_idx on learning_objects using gin (search_vector);

alter table courses
  add column search_vector tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B')
  ) stored;

create index courses_search_idx on courses using gin (search_vector);

-- content_assets has no human-authored title today (it's a file), so the
-- searchable text is its path — enough to find "that PDF called
-- handbook" without inventing a field the upload flow doesn't collect.
alter table content_assets
  add column search_vector tsvector
  generated always as (
    to_tsvector('english', coalesce(replace(storage_path, '/', ' '), ''))
  ) stored;

create index content_assets_search_idx on content_assets using gin (search_vector);
