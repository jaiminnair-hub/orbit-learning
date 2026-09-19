-- Add only two browser-friendly video formats to the existing private
-- content-library allowlist. This does not change the 500 MB file limit
-- or weaken the existing restriction for any other file types.
update storage.buckets
set allowed_mime_types = (
  select array_agg(distinct mime)
  from unnest(allowed_mime_types || array['video/quicktime', 'video/x-m4v']) as mime
)
where id = 'content-assets';
