# Security review — SCORM upload, extraction, storage, runtime isolation

**Date:** 2026-08-21 · **Scope:** the full SCORM path — signed upload → server-side extraction → private Storage → asset serving → the runtime API adapter. Item 1 of the pre-Orbit hardening order (see `ORBIT_STATUS.md` §8).

Findings are ranked by real-world reachability. `org_admin` is a **customer-controlled role**, not platform staff — every finding below assumes the attacker is at most an org's own admin, never a platform insider, and asks what damage that role could do beyond its intended scope.

---

## Fixed

### 1. Zip-bomb denial of service — HIGH — fixed in `c79ddda`

`extractPackage()` (`lib/content/scorm.ts`) called fflate's `unzipSync` with no bound on file count or decompressed size, and extraction runs synchronously inside a request handler (`app/api/v1/content/scorm/route.ts`). A small crafted zip could decompress to an amount of memory large enough to exhaust the server process — a denial-of-service against the whole platform, reachable by any org's admin, not just their own tenant.

**Fix:** a `filter` callback on `unzipSync` rejects entries by their *declared* size before fflate decompresses them, with per-file (200MB), per-package aggregate (2GB), and file-count (5,000) caps, all overridable for testing.

**Caveat, stated in the code comment, not glossed over:** the declared size a zip entry carries is attacker-supplied. This bounds the realistic case — an oversized or absurdly numerous set of files — but does not exclude a stream that lies about its own size and decompresses past what it claimed. A fully airtight bound needs streaming decompression with a live byte-count abort, which fflate's synchronous API doesn't offer. **Tracked as a follow-up**, not claimed solved.

**Verified:** `tests/content/scorm-extraction.test.ts` — 12 tests, including file-count, per-file, and aggregate cap rejection, plus confirming a normal package still extracts unchanged.

### 2. No storage-level size or MIME limits — HIGH — fixed in `c79ddda`

Neither the `content-assets` nor `published-packages` bucket had a `file_size_limit` or `allowed_mime_types` set. An org_admin could upload an arbitrarily large file before any application code ran at all — the zip-bomb cap above only helps once a file is already inside a route handler.

**Fix:** `supabase/migrations/20260821140000_storage_bucket_limits.sql` sets both at the Storage layer — the point that actually matters, since it rejects an oversized upload at the signed-URL step, before a route handler ever downloads it.

**Non-obvious gotcha, worth recording:** Storage's `allowed_mime_types` check matches the Content-Type string **exactly, charset parameter included** — not a `type/subtype` prefix. `contentTypeFor()` in `lib/content/scorm.ts` appends `; charset=utf-8` to html/js/css/json/xml. The allowlist has to mirror those exact strings, or a perfectly legitimate SCORM package fails extraction — which is exactly what happened on the first pass here, caught by rerunning the full e2e suite rather than assuming the migration was correct because it applied cleanly.

**Verified:** full suite rerun after the fix — 360 unit + 65 e2e, all green, including all four SCORM tracking e2e tests against the new limits.

---

## Confirmed solid — reviewed, no action needed

- **Path traversal** in the asset-serving route (`app/api/v1/content/scorm/[id]/assets/[...path]/route.ts`) is blocked by an explicit `..` check before the Storage read.
- **Both buckets are private** (`public = false`); all access is mediated server-side through the service-role client, gated by an RLS-checked ownership read first. No client ever talks to Storage directly except through a signed URL this app generated.
- **Service-role key never reaches the browser** — `SUPABASE_SECRET_KEY`, no `NEXT_PUBLIC_` prefix, used only in `lib/supabase/admin.ts`.
- **Cross-org isolation** on SCORM packages and progress is RLS-enforced and covered by `tests/e2e/scorm-tracking.spec.ts`'s dedicated boundary test.
- **No token in `localStorage`** — the browser Supabase client (`lib/supabase/client.ts`) uses `createBrowserClient` from `@supabase/ssr`, which syncs the same cookie-based session the server reads. A same-origin script can't just read a bearer token out of storage the way it could with the plain `supabase-js` client's default persistence.
- **Baseline security headers added** (`next.config.ts`): `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, a restrictive `Permissions-Policy`, HSTS. All zero-tradeoff — none of them can break an existing page, so they shipped immediately rather than waiting on a full CSP.

**Deliberately not done here: a Content-Security-Policy.** The SCORM player depends on same-origin script execution to reach the CMI adapter, and exported course content ships a self-contained inline `<script>`. A CSP tight enough to matter and loose enough not to break either needs to be built and tested against both, not bolted on inside this review. (**2026-09-04 correction:** the landing page's hero no longer uses WebGL/Workers — it was rebuilt as a pure CSS/SVG animated orbit — so that's one fewer constraint a future CSP has to satisfy, not a reason to add one as part of this review.)

---

## Open — architectural, not a patch

### 3. Same-origin SCORM runtime — the design is inherently risky, by necessity

`ScormPlayer.tsx` mounts the CMI adapter on `window.API` / `window.API_1484_11` and loads the package in a same-origin iframe, because the SCORM API-discovery algorithm (walking `window.parent` looking for the API object) only works across frames that share an origin — a cross-origin frame cannot read an arbitrary named property off its parent window at all. That's not a bug in this implementation; it's the actual constraint SCORM's 1999-era API-discovery design imposes on anyone hosting third-party content.

The consequence: uploaded, admin-controlled HTML/JS runs with full same-origin privileges inside the real app. It can manipulate the live DOM (a phishing overlay indistinguishable from the real UI), and it can issue authenticated `fetch()` calls to any of this app's own API routes, carrying the viewer's session cookie automatically — reading or acting as whoever happens to open that course. No CSP header and no cookie flag closes this; the request is same-origin by definition, which is the one thing browsers don't gate.

**Reachability, which is what actually bounds the severity:** this requires `org_admin` — a customer role — to upload the malicious package in the first place. It is "a malicious or compromised admin can attack their own org's learners and admins," not an anonymous internet attacker, and not a cross-tenant attack (RLS still stops the attack from reaching a *different* org's data even if the fetch succeeds). Real, worth closing properly, not an emergency.

**The correct fix** — what commercial SCORM hosting (SCORM Cloud included) actually does — is to serve content from a genuinely separate origin: a content subdomain, with a small bridge iframe on *that* origin exposing the API object and relaying CMI calls back to the real app via `postMessage`, which the app validates on receipt. That gives the content a real, browser-enforced origin boundary against the app's own cookies and DOM, while still letting the CMI protocol function (the bridge, not the content itself, is what reaches back into the app).

**Decision, 2026-08-21:** deferred to item 2 (Vercel port). A real production domain doesn't exist yet — the LMS's name/domain is still undecided — and choosing one is a natural part of setting up the Vercel deployment anyway, so the content-subdomain architecture will be designed and built as part of that migration rather than against a placeholder domain now.

---

## Summary for the record

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | Zip-bomb DoS via unbounded decompression | High | **Fixed**, `c79ddda` |
| 2 | No storage-level size/MIME limits | High | **Fixed**, `c79ddda` |
| 3 | Same-origin SCORM runtime isolation | Medium (bounded by org_admin-only reachability) | **Open — deferred to item 2 by decision** |

No secrets, keys, or credentials were touched, added, or exposed in this review, per the standing constraint on this repository.
