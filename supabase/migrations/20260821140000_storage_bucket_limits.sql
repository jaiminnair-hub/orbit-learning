-- SCORM security review (2026-08-21): neither storage bucket had a size
-- or MIME-type limit, so any org_admin — a customer-controlled role, not
-- platform staff — could upload an arbitrarily large file, and the
-- content-assets bucket had no allowlist at all. This is the first line
-- of defense, enforced by Storage itself before a byte reaches the
-- application: an oversized upload is rejected at the signed-URL step,
-- never downloaded into a route handler for extraction or processing.
--
-- content-assets carries genuinely mixed media (SCORM zips, video,
-- audio, PDF, documents, images) so its allowlist is broad by necessity
-- — and it is also where a SCORM package's *extracted* files land
-- (app/api/v1/content/scorm/route.ts writes every file back under
-- extracted_prefix), so the allowlist has to cover both what a client
-- can upload AND every Content-Type contentTypeFor() in
-- lib/content/scorm.ts can produce (xml manifests, JS, CSS, fonts —
-- whatever a real package happens to contain), or the extraction step
-- itself fails for a perfectly legitimate package. published-packages
-- holds only what this app itself produces (SCORM 2004 / cmi5 zips), so
-- it can stay narrow.
--
-- allowed_mime_types is checked against the client-declared Content-Type
-- header at upload time, not by sniffing actual bytes — it stops
-- accidental/casual mismatches, not a deliberately spoofed header. The
-- real content-sniffing risk (arbitrary bytes served back to a browser)
-- is handled where the bytes are served: contentTypeFor() in
-- lib/content/scorm.ts sets an explicit Content-Type on every response
-- rather than trusting what was stored, and X-Content-Type-Options:
-- nosniff (next.config.ts) stops the browser from second-guessing it.



update storage.buckets
set
  file_size_limit = 524288000, -- 500MB
  allowed_mime_types = array[
    'application/zip',
    'application/x-zip-compressed',
    'video/mp4',
    'video/webm',
    'audio/mpeg',
    'audio/wav',
    'audio/ogg',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/html',
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/svg+xml',
    'image/webp',
    -- What a SCORM package's own files decompress to, re-uploaded by
    -- extraction under contentTypeFor()'s classification. Storage
    -- matches the Content-Type string exactly, charset parameter
    -- included — these must mirror lib/content/scorm.ts's MIME_BY_EXT
    -- verbatim, not just the bare type/subtype.
    'text/html; charset=utf-8',
    'text/javascript; charset=utf-8',
    'text/css; charset=utf-8',
    'application/json; charset=utf-8',
    'application/xml; charset=utf-8',
    'font/woff',
    'font/woff2',
    -- Browsers don't always populate File.type on upload, and any
    -- extracted file extension contentTypeFor() doesn't recognise falls
    -- back here too. Not a meaningful weakening on its own — see the
    -- note above on what this allowlist actually defends against.
    'application/octet-stream'
  ]
where id = 'content-assets';

update storage.buckets
set
  file_size_limit = 209715200, -- 200MB
  allowed_mime_types = array['application/zip', 'application/x-zip-compressed']
where id = 'published-packages';
