# SCORM content isolation — architecture

**Status: implemented and live in Production**, as of 2026-08-24 — see `docs/ORBIT_STATUS.md` §8 item 1 for current verification status and the bugs found while confirming it end to end. The design below was written before implementation and is kept as the record of the original design decisions (why three origins, why postMessage-only, why the sandbox flags); it no longer describes a proposal. The one deviation from the design as written: the content-origin deployment (`apps/scorm-content/`) lives under a separate Vercel project with its own `*.vercel.app` domain, not a subdomain of the app's own domain (`content.<domain>` below) — functionally equivalent for origin-isolation purposes, since Vercel gives every project a genuinely distinct origin.

## The problem, restated precisely

SCORM's API-discovery algorithm requires content to find `window.API`/`window.API_1484_11` by walking `window.parent`. Browsers only expose arbitrary named properties across a frame boundary when both frames share an origin. That constraint — not a mistake in this codebase — is why `ScormPlayer.tsx` today mounts the adapter on the *application's own* window and loads content same-origin: it's the only way the 1999-era discovery algorithm works at all.

The cost: admin-uploaded content runs with full same-origin privileges against the real app — it can manipulate the live DOM and issue authenticated `fetch()` calls carrying the viewer's session cookie.

## The fix: three origins, one narrow bridge

```
app.<domain>                    content.<domain>
┌─────────────────────┐        ┌──────────────────────────────┐
│  Next.js app         │        │  minimal static/edge server   │
│  Supabase session     │        │  NO cookies, NO app session   │
│  cookies scoped here  │        │  ever issued or read here     │
│  only                 │        │                                │
│                        │  iframe │  ┌──────────────────────┐  │
│  <iframe src=          │────────▶│  │  bridge.html          │  │
│    content.<domain>/   │  sandboxed │  window.API lives here│  │
│    bridge/{pkg}        │        │  │  ┌────────────────┐  │  │
│    ?token=...>         │        │  │  │ SCORM content   │  │  │
│                        │        │  │  │ (uploaded zip)  │  │  │
│  postMessage listener  │◀───────────────┘ same origin,   │  │
│  (snapshot only,       │ postMessage    │ finds window.  │  │
│   origin-checked)      │ (one direction,│ parent.API      │  │
│                        │  bridge→app    │ here            │  │
│                        │  only)         │                 │  │
└─────────────────────┘        └──────────────────────────────┘
```

### 1. Application origin — `app.<domain>`

Unchanged from today. Real Supabase session, real cookies, `getSessionContext()`, RLS. Nothing about the main app's authorization model changes.

### 2. Content origin — `content.<domain>`

A genuinely separate origin (different host — subdomains are separate origins under browser same-origin policy). Two properties are load-bearing:

- **Never issues or reads authentication cookies.** No `Set-Cookie` header from any response on this host, ever. This is what makes the origin boundary actually protective rather than cosmetic — if Supabase's cookie helper were ever configured with a wildcarded `Domain=.{domain}` instead of the exact host, cookies would leak across both origins and the whole isolation would be void. **This has to be explicitly verified, not assumed**, once a real domain exists.
- **Serves two things:** the extracted SCORM package files (replacing today's `/api/v1/content/scorm/[id]/assets/[...path]`), and a small static `bridge.html` that mounts the adapter.
- **Recommendation: a separate, minimal deployment**, not a second route inside the main Next.js app under a rewritten host. Coupling it to the main app risks a future refactor accidentally sharing middleware, layout, or session logic across the boundary this whole design exists to create. It needs almost none of the main app's dependencies — no Supabase Auth, no admin SDK for anything except reading the package's extracted files.

### 3. Authorization without cookies

The content origin can't use a session cookie, so it needs a different, narrower credential: a short-lived signed token (HMAC or JWT, 5-minute expiry, scoped to `packageId + userId + orgId`) that `app.<domain>` mints when it renders the player, passed as a query parameter on the bridge iframe's `src`. The content origin verifies the token itself — it never queries the main database or Supabase Auth directly. This is the same shape as the signed Storage URLs already used elsewhere in this codebase (`createSignedUploadUrl`), applied to a new purpose.

### 4. The bridge — where the adapter actually runs

`lib/scorm/adapter.ts` was already built as a pure state machine with no DOM or network dependency, specifically so it's testable without a browser. That design pays off directly here: **the adapter runs unmodified inside `bridge.html`**, on `content.<domain>`, not on the app. The SCORM content walks `window.parent` and finds it there — same origin as the bridge, so the discovery algorithm works exactly as SCORM expects, with zero changes to how content itself behaves.

### 5. The bridge → app channel — one direction, one shape

This is the "minimal, audited" part. Rather than relaying individual `LMSGetValue`/`LMSSetValue` calls across the boundary (which would mean re-exposing broad read/write access to the app, defeating much of the point), **only the existing `ScormSnapshot` shape crosses the boundary** — the same `{ cmiData, lessonStatus, scoreRaw, totalTimeSec }` object `onPersist` already receives today. The bridge posts a snapshot on commit, terminate, and reaching a terminal status — exactly the same triggers the adapter already uses.

```
postMessage({ type: "scorm-snapshot", snapshot }, "https://app.<domain>")
```

`app.<domain>`'s listener validates, in order: `event.origin === CONTENT_ORIGIN` (reject anything else outright), `event.data.type === "scorm-snapshot"`, and the payload shape matches `ScormSnapshot` before touching it. On a valid message, it calls the *existing* `queueSave`/`flush` logic in `ScormPlayer.tsx` — persistence to `/api/v1/content/scorm/[id]/progress` doesn't change at all, only what triggers it does.

No app → bridge postMessage channel is needed. Resume state (`initialCmi`, `totalTimeSec`) is fetched by the bridge itself from a narrow endpoint on `content.<domain>`, authorized by the same signed token — not pushed in via a message.

### 6. Iframe sandboxing — defense in depth on top of origin isolation

The origin boundary alone already stops DOM/cookie access. `sandbox` adds a second, independent layer restricting what the bridge frame can do even within its own origin:

```html
<iframe
  src="https://content.<domain>/bridge/{packageId}?token=..."
  sandbox="allow-scripts allow-same-origin allow-forms"
/>
```

`allow-same-origin` has to stay — without it, even genuinely-same-origin content is forced into a unique opaque origin per browser sandboxing rules, which would break the bridge/content relationship the same way it would break the app relationship if misapplied there. What matters is what's **excluded**: no `allow-top-navigation` (content can't redirect or replace the real app tab — closes the "full-page phishing redirect" risk), no `allow-popups` (no new-window phishing), no `allow-modals` (no fake native-looking alert/confirm dialogs).

## What changes in existing code, at implementation time

- `components/scorm/ScormPlayer.tsx`: iframe `src` points at the bridge on `content.<domain>` instead of the same-origin asset route; `window.API` mounting moves into `bridge.html`; `onPersist` becomes a `message` listener instead of a same-window callback.
- `app/api/v1/content/scorm/[id]/assets/[...path]/route.ts`: logic moves to the content-origin deployment; the app-origin route can be retired or kept as a redirect during migration.
- A token-minting step added wherever the player is rendered (currently `app/(app)/courses/[id]/page.tsx`).
- New: `bridge.html` + its serving function on `content.<domain>`, and the deployment/DNS for that subdomain.

None of this touches `lib/scorm/adapter.ts`, `lib/scorm/cmi.ts`, the SCORM progress data model, or any RLS policy — the fix is entirely about *where* the adapter runs and *how* its output reaches the app, not what it does.

## What this explicitly does not change

Tenancy, roles, auth architecture, the API namespace, or anything Orbit-adjacent — this is purely about isolating third-party HTML/JS execution from the app's own origin, unrelated to multi-tenancy or the eventual Orbit integration.
