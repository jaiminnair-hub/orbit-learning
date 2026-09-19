# xAPI (Tin Can) ingest — architecture

**Added 2026-09-03**, alongside removing AICC from the build and roadmap entirely (see
`docs/MASTER_FEATURE_MATRIX.md`'s xAPI ingest row and `docs/ROADMAP.md`'s decision record). SCORM
1.2/2004 ingest already existed and works end to end; xAPI and AICC packages were rejected outright
on upload before this, since the ingest parser only recognized `imsmanifest.xml`. This is the design
record for the xAPI half of that gap — what got built, what real conformance boundary it stops at, and
why the two content-isolation problems (SCORM's, xAPI's) turned out to need different solutions rather
than one shared bridge.

## 1. Why this is structurally not "SCORM again, different manifest"

SCORM content discovers a JS API object by walking `window.parent` — it needs same-origin access to
whoever hosts it, which is the entire reason `docs/SCORM_CONTENT_ISOLATION_ARCHITECTURE.md`'s three-origin
postMessage bridge exists (`apps/scorm-content/`, a genuinely separate Vercel deployment).

An xAPI/Tin Can package has no such API to discover. It launches into a page that reads
`endpoint`/`auth`/`actor`/`registration`/`activity_id` off its own launch URL's query string (the Tin
Can/xAPI Launch convention real authoring-tool output — Storyline, Rise, Adapt — actually implements),
and from then on talks to `endpoint` over plain HTTP using `auth` as a literal `Authorization` header
value. It never needs to reach into the page that embeds it.

**Consequence:** xAPI content can be isolated *more* simply than SCORM, with no second deployment. The
launch iframe is sandboxed with `sandbox="allow-scripts allow-forms allow-popups"` — **no**
`allow-same-origin`, unlike SCORM's bridge frame, which cannot drop it (SCORM needs same-origin access
to find its adapter). Without `allow-same-origin`, the browser gives the frame a unique **opaque**
origin regardless of where its bytes were actually served from: no cookie access, no DOM access to the
real app origin, full isolation — for free, using the existing same-origin asset route
(`app/api/v1/content/xapi/[id]/assets/[...path]/route.ts`, session-authenticated exactly like the
pre-isolation SCORM asset route it's modeled on).

If a future package genuinely needs same-origin access for some reason this design doesn't anticipate,
the fallback is the same one SCORM already proved: serve it from `apps/scorm-content/` instead. Nothing
about the launch/statements design below depends on which origin serves the bytes.

## 2. The launch

`GET /api/v1/content/xapi/[id]/launch` (session-authenticated, RLS-scoped — same bar as the SCORM
bridge-token route):

1. Looks up or creates one `xapi_progress` row per `(user, package)`, minting a `registration` UUID the
   first time and reusing it on every relaunch — every statement and state document from every attempt
   groups under the same id.
2. Mints a short-lived (4-hour, matching the SCORM bridge token's TTL — same lesson: a real narrated
   package can legitimately stay open that long) HMAC-signed credential (`lib/xapi/launch-token.ts`)
   binding `{packageId, orgId, userId, registration}`.
3. Formats it as a real `Authorization: Basic ...` header value — the wire format real xAPI content
   sends verbatim, taken straight from the launch URL. Nothing about it is a literal username/password;
   it's an opaque signed token riding in valid Basic-auth wire format, verified by re-deriving the HMAC,
   never by a database lookup.
4. Builds the launch URL: the package's own `launch_path` (read from `tincan.xml` at registration time),
   with `endpoint`, `auth`, `actor` (an Account-based agent — `{name: userId}` — deliberately not the
   learner's real email, unlike the native runtime's own statement writer, because this identifier rides
   in a URL query string a third-party package's code and possibly its own logging can see), `registration`,
   and `activity_id` appended as query parameters.

## 3. The LRS

`app/api/v1/xapi-lrs/` is a real, if narrowly scoped, Learning Record Store — not behind `withAuth`,
since the caller has no Supabase session, only the launch-token Basic credential.

**Implemented** (`.../statements/route.ts`, `.../activities/state/route.ts`):
- **Statement Resource**: `POST` (batch or single, LRS-assigned ids), `PUT` (single, client-assigned id
  via `?statementId=`), `GET` (filtered to the caller's own registration only). Every insert lands in the
  existing `xapi_statements` table with `source = 'external'` — the same table the native in-app runtime
  already writes to with `source = 'native_player'`, which is why that table's schema (and its
  `registration`/`external` source value) already anticipated this without a migration.
- **State Resource**: `GET`/`PUT`/`POST`/`DELETE`, backed by a new `xapi_activity_state` table. Needed
  because real Storyline/Rise Tin Can exports commonly store suspend-data/bookmark position here, not in
  a statement — skipping this would make a package's tracking *look* fine (statements post normally)
  while it silently restarted from the beginning on every relaunch.
- **CORS**: `Access-Control-Allow-Origin: *` on every response. Safe specifically because authentication
  here is never cookie-based — a wildcard origin cannot leak a session that was never sent in the first
  place.

**Explicitly not implemented** (documented here so a real package's failure mode against a genuinely
missing endpoint is diagnosable rather than mysterious):
- Agent Profile and Activity Profile Resources — nothing in the launch/statements path needs them; no
  package exercised so far has called them.
- Statement voiding, `GET /statements` filtering beyond `registration` (no `verb`/`activity`/`since`
  filters), and the State Resource's `POST` JSON-merge-patch semantics (`POST` is treated as a full
  replace, identical to `PUT`) — real content overwhelmingly uses `PUT` with a full document per save.
- Any authentication scheme other than the launch-token Basic credential (no OAuth, no separate
  per-org LRS credential pair for external tools to pull statements out) — this LRS exists to receive
  from one specific launched package, not to serve as a general-purpose external LRS integration point.

## 4. Completion

There is no in-page signal to trust from a sandboxed opaque-origin frame (unlike SCORM, where the bridge
posts a snapshot via `postMessage` on completion). Completion is instead **derived server-side**: when
`.../statements/route.ts` receives a statement whose verb is `.../verbs/completed`, `.../verbs/passed`,
or `.../verbs/failed`, it updates `xapi_progress` directly — no separate observer job, no polling of raw
statements. `components/xapi/XapiPlayer.tsx` polls `GET .../xapi/[id]/progress` every 5 seconds while the
iframe is open and fires `onCompleted` the moment that row flips, which is what
`app/(app)/courses/[id]/player.tsx` uses to advance the enrolment — the same "completion is observed, not
self-declared" principle SCORM already established.

## 5. Data model

New tables (`supabase/migrations/20260903070000_xapi_packages.sql`), all following the tenancy rule
(`org_id NOT NULL` + four-policy RLS in the creating migration) established since Phase 1:

- **`xapi_packages`** — mirrors `scorm_packages`'s shape (content-asset tie-in, extracted-files prefix,
  draft→review→approval→published→archived status, versioning) but carries `activity_id` and
  `launch_path` instead of `scorm_version`/`entry_point`.
- **`xapi_progress`** — mirrors `scorm_progress`'s promoted-columns-summary role, but has no `cmi_data`
  blob to persist — the statements themselves (`xapi_statements`, `source = 'external'`) are the record.
  Deliberately **no insert/update RLS policy for the authenticated role**: the only writer is the LRS
  route via the service role, since the credential authorizing a write here is a launch token, not a
  Supabase session, and so can never satisfy `auth.uid() = user_id`.
- **`xapi_activity_state`** — the State Resource's documents. Same "service-role-only write" reasoning
  as `xapi_progress`.
- **`content_assets.type`** CHECK constraint gains `'xapi'`, alongside the existing `'scorm'`/`'image'`.

No new Storage bucket — extracted files live in the existing `content-assets` bucket, under
`{org_id}/xapi/{package_id}/...`, exactly parallel to SCORM's `{org_id}/scorm/{package_id}/...`.

## 6. What was deliberately reused rather than rebuilt

- **Zip-bomb defense** (`lib/content/zip.ts`, factored out of `lib/content/scorm.ts` in this same change):
  the same entry-count/per-file/aggregate byte caps and path-traversal check SCORM ingest already had,
  applied to Tin Can extraction without reimplementing it.
- **HMAC signed-credential pattern** (`lib/xapi/launch-token.ts`): the same shape as
  `lib/scorm/bridge-token.ts`, proven live since 2026-08-24 for the SCORM content-isolation bridge.
- **`xapi_statements`**: built in Phase 3 step 4 for the native runtime's own emission, with a
  `source = 'external'` value and a `registration` column already anticipating exactly this use — no
  migration needed against that table at all, only new tables alongside it.
