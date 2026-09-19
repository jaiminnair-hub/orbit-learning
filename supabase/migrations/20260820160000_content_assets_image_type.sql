-- content_assets — accept images (Phase 3 step 6).
--
-- Phase 2 built the asset type list around documents, video and SCORM
-- packages; nothing then needed an image as a first-class piece of learning
-- content. Phase 3's block model does: `image`, `imageGallery`,
-- `labeledGraphic` and `hotspot` all carry an AssetRef pointing at a
-- content_assets row, and without this value the editor's media picker has
-- nothing valid to offer them.
--
-- Found while building the media picker, which is the first surface that has
-- to list images for insertion.
--
-- Same drop-and-recreate as the other widenings in this phase: Postgres has
-- no ALTER CONSTRAINT for a CHECK's definition, and the original was inline
-- in 20260815100000_content_assets.sql so it carries the default
-- {table}_{column}_check name.

alter table content_assets drop constraint content_assets_type_check;

alter table content_assets
  add constraint content_assets_type_check
  check (type in (
    'text', 'video', 'audio', 'pdf', 'ppt', 'document', 'url', 'embed', 'scorm',
    'image'
  ));
