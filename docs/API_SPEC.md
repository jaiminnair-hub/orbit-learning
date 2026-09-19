# API Architecture

Next.js API routes (App Router `route.ts` handlers) — same mechanism an earlier project uses, but formalized with conventions an earlier project never had (no centralized session resolution, ~89 routes each hand-rolling auth). This is the pattern for the new repo, not a change to an earlier project.

> **Revised 2026-08-14 after the Cloudflare validation spike** ([CLOUDFLARE_VALIDATION_RESULTS.md](CLOUDFLARE_VALIDATION_RESULTS.md)): a single global `middleware.ts`/`proxy.ts` interceptor is **not usable** on this stack — Next.js 16's `proxy.ts` no longer supports the Edge runtime, and `@opennextjs/cloudflare` doesn't yet support Node.js middleware. Session/org-context resolution below is centralized differently: through route-group layouts and a shared API wrapper, not a single interception file. This was proven out, not just theorized — see the results doc.

## 1. Route conventions

- **Grouped by domain**, mirroring [DATABASE.md](DATABASE.md): `/api/v1/orgs/*`, `/api/v1/users/*`, `/api/v1/content/*`, `/api/v1/courses/*`, `/api/v1/assessments/*`, `/api/v1/ai/*`, `/api/v1/admin/*` (org-scoped admin), `/api/v1/platform-admin/*` (cross-tenant, see [MULTI_TENANCY.md](MULTI_TENANCY.md) §4).
- **Versioned from day one** (`/api/v1/...`) — an earlier project has no version prefix; a multi-tenant SaaS product will need to evolve routes without breaking existing integrations.
- **A shared `getSessionContext()` resolves session + org context once per call site**, attaching `{ userId, orgId, role }` — replacing an earlier project's per-route `requireAdminAccess()`/`hasB2BAccess()`/raw `supabase.auth.getUser()` duplication. It's centralized at two levels rather than one global interceptor: **route-group layouts** (`app/(app)/layout.tsx`, `app/(admin)/layout.tsx`, `app/(platform-admin)/layout.tsx` — Server Components that call it and `redirect()` on failure, shared by every nested page) for pages, and **a thin `withAuth(handler, { minRole })` wrapper** for API routes so each `route.ts` opts in with one line. Route handlers still trust the attached context rather than re-deriving it — the number of places that call `getSessionContext()` is small and fixed, not one-per-route.

## 2. Request/response envelope

```json
// Success
{ "data": { ... }, "meta": { "requestId": "..." } }

// Error
{ "error": { "code": "TENANT_MISMATCH", "message": "...", "requestId": "..." } }
```

Consistent shape across every route — no route returns a bare array or a raw error string, matching neither an earlier project's ad hoc per-route response shapes.

## 3. Pagination

Cursor-based (`?cursor=...&limit=...`) for anything list-shaped (content library, users, assessment attempts) — offset pagination degrades on large orgs and doesn't compose well with RLS-filtered queries.

## 4. Auth & authorization pattern per route

```
request → withAuth() wrapper (session + org context via getSessionContext()) → route handler
  → has_role() check appropriate to the action (mirrors DB-level has_role(), see MULTI_TENANCY.md)
  → RLS enforces the actual data boundary regardless — the route-level check is defense in depth, not the only gate
```

**Implemented (2026-08-14, [DEVELOPMENT_SEQUENCE.md](DEVELOPMENT_SEQUENCE.md) step 8):** `lib/api/with-auth.ts` — `withAuth(handler, { minRole? })`. `minRole` is checked via `lib/auth/roles.ts`'s `hasRole()`, a small TypeScript mirror of the DB's `role_rank()`. Three routes exist so far: `GET /api/v1/orgs/me`, `GET /api/v1/orgs/members` (`minRole: "manager"`), and `GET /api/v1/platform-admin/orgs` (platform-admin path, not built on `withAuth()`'s `minRole` since platform admin is a separate grant, not a rank in the tenant hierarchy — see [MULTI_TENANCY.md](MULTI_TENANCY.md) §4). All verified against real signed-in sessions, not just typechecked.

**Extended (2026-08-14, step 9):** `withAuth()` was generalized to accept a `RouteCtx` generic so it can forward Next.js's own route context (e.g. `{ params: Promise<{ id: string }> }` for a dynamic segment) through to the handler — needed for the first dynamic-params route, `PATCH /api/v1/orgs/members/[id]`. Four more routes: `POST /api/v1/orgs` (create org + first `org_owner`), `GET`/`POST /api/v1/orgs/invitations` (`minRole: org_admin`), `POST /api/v1/orgs/invitations/accept`, `PATCH /api/v1/orgs/members/[id]` (role assignment). All verified through the actual admin UI in a real browser, not just direct API calls — see step 9 in [DEVELOPMENT_SEQUENCE.md](DEVELOPMENT_SEQUENCE.md).

Every mutating route additionally validates that any `org_id` implied by the request body matches the session's `org_id` (or the caller is a platform admin acting through the dedicated `/platform-admin/*` path) — closing the class of bug where a client-supplied `org_id` could be trusted.

## 5. Streaming (AI)

`/api/v1/ai/assistant` and `/api/v1/ai/course-builder/*` use Server-Sent Events for token-by-token streaming (reusing `streamChatResponse()` from [AI_ARCHITECTURE.md](AI_ARCHITECTURE.md)). Streaming compatibility on the chosen host is one of the items [CLOUDFLARE_VALIDATION.md](CLOUDFLARE_VALIDATION.md) explicitly tests before this is assumed to work in production.

## 6. File upload

Two-step signed-URL flow (pattern reused from an earlier project, which built it to work around a platform-specific body-size cap): client requests a signed upload URL from `/api/v1/content/upload-url`, uploads directly to storage, then confirms via `/api/v1/content/assets` to create the `content_asset` row. Whether this exact flow is still necessary under Cloudflare (different limits than Vercel) is validated in [CLOUDFLARE_VALIDATION.md](CLOUDFLARE_VALIDATION.md), not assumed.

**Implemented (2026-08-15, Phase 2 step 1 — [DEVELOPMENT_SEQUENCE_PHASE2.md](DEVELOPMENT_SEQUENCE_PHASE2.md)).** Both routes are `withAuth({ minRole: "org_admin" })`-gated. The signed path is always namespaced `org_id/<uuid>-<sanitized filename>` ([MULTI_TENANCY.md](MULTI_TENANCY.md) §5), and the confirm step **verifies the object actually exists in Storage before inserting the row** — a client can't register an asset for a file it never uploaded, nor one under another org's prefix. The bucket is private with no `storage.objects` RLS policy by design: it's reached only through the service-role client server-side, so there is no direct client path to it. The row insert itself goes through the caller's own session client, since `content_assets_insert`'s RLS policy already permits `org_admin`+ — service-role is used only where RLS structurally can't do the job. Proven end to end against both the local instance and the real remote project, with the two negative cases tested by actually attempting them.

## 7. Rate limiting

Applied as a platform-wide default inside the `withAuth()` wrapper (§1) (Redis-backed, reused pattern from an earlier project), not opt-in per route — every route gets a sane default limit; AI and auth routes get tighter limits explicitly configured.

## 8. Webhooks (future-facing, not built in MVP)

Route naming reserved now (`/api/v1/webhooks/*`) so payment-provider and future integration webhooks have a stable convention when they're built, without needing a routing rework.
