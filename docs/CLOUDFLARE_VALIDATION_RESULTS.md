# Cloudflare Validation — Results

**Superseded 2026-08-21: hosting target changed to Vercel.** This spike's findings stand as a historical record — the validation work was real and the verdict below was correct for its time — but the repository no longer targets Cloudflare Workers. `@opennextjs/cloudflare`, `wrangler.jsonc`, and the `preview`/`deploy`/`cf-typegen` scripts have been removed from the main app (item 2 of the pre-Orbit hardening order — see `ORBIT_STATUS.md` §8). `wrangler` itself remains a devDependency only because `spikes/job-execution` — the separate, already-documented Cloudflare Workflows spike — still needs it; that spike is unaffected by this change and is not what this note concerns.

**Date:** 2026-08-14. **Spike location:** local scratchpad (throwaway, per [CLOUDFLARE_VALIDATION.md](CLOUDFLARE_VALIDATION.md) §4 — not part of this repo). Stack tested: Next.js 16.3.1 (App Router, Turbopack), `@opennextjs/cloudflare` 1.20.2, `wrangler` 4.123.0, run under the real `workerd` runtime locally (`opennextjs-cloudflare build && preview`) — not merely `next dev`. No Cloudflare account or deployment was required for any of the results below; everything ran locally against the same runtime Cloudflare Workers uses in production.

## Verdict

**Proceed with Cloudflare.** One real, confirmed incompatibility was found (middleware/`proxy.ts`), it has a clean, idiomatic fix that doesn't weaken the architecture, and it's now folded into the spec set. The item this whole spike existed to de-risk — document processing for AI Course Builder — **passed cleanly**, which was the biggest open question in the entire plan.

## Results by item

| # | Item | Result | Notes |
|---|---|---|---|
| 1 | Next.js 16 App Router basics | ✅ **Pass** | Static + dynamic routes (`/dynamic/[id]`) render correctly under `workerd` |
| 2 | Supabase Auth | ✅ **Pass** (2026-08-14, step 7) | Full signup → session cookie → protected route → reload-persists → logout → password-reset-email → callback → new-password loop proven against the real Workers preview (port 8787), using real `@supabase/ssr` cookie handling — the exact thing this item existed to check |
| 3 | Supabase server/client access | ✅ **Pass** (2026-08-14, step 7) | `getSessionContext()` (server client, `auth.getUser()`) correctly resolves session + profile on every request through the Worker |
| 4 | `middleware.ts` / session handling | ❌ **Fail, with a clean fix** | See "The one real finding" below |
| 5 | API routes | ✅ **Pass** | GET/POST both verified |
| 6 | Streaming responses (general) | ✅ **Pass** | `ReadableStream` + SSE delivered correctly through the Worker |
| 7 | AI streaming specifically | ✅ **Pass (proxy test)** | Same mechanism as #6, tested without a real provider key; a real-provider run is still worth one confirmation pass once API keys exist, but the plumbing is proven |
| 8 | File upload | ✅ **Pass (small file)** | Multipart upload received correctly; the two-step signed-URL flow at production file sizes still needs a real Supabase Storage test |
| 9 | Supabase Storage | ⏸️ **Untested** | Requires a real Supabase project |
| 10 | Signed URLs | ⏸️ **Untested** | Requires a real Supabase project |
| 11 | Background jobs / cron | ⏸️ **Untested, unblocked** | Cloudflare account now connected and a real deploy succeeded (see below) — Cron Trigger config can be added and a real firing verified whenever it's needed, no longer blocked on account access |
| 12 | Caching | ⏸️ **Not exercised this pass** | Lower risk than the items above; defer to Phase 1 build itself |
| 13 | Image handling | 🟡 **Partial pass** | `next/image` renders correctly for the SVG case tested; on-the-fly raster optimization (`/_next/image`) wasn't exercised — worth one more check with a real raster image before Phase 2 |
| 14 | SCORM | 🟡 **Partial pass** | The specific mechanism that broke on an earlier project's Vercel+Supabase combo — a route serving `.html` with an explicit `Content-Type` header — works correctly and is preserved exactly (`text/html; charset=utf-8`, not downgraded). Full SCORM package extraction/serving still needs a real sample package + Supabase Storage |
| 15 | Document processing | ✅ **Pass — the highest-risk item, resolved** | Both PDF (`unpdf`) and DOCX (`mammoth`) text extraction work correctly under the real Workers runtime. See below |

## The one real finding: `middleware.ts` doesn't work as designed

**What happened:** Next.js 16 renamed `middleware.ts` to `proxy.ts` (confirmed via Next's own official codemod, `npx @next/codemod@canary middleware-to-proxy`) — this alone is a naming change, not a problem. The actual incompatibility: **Next 16's `proxy.ts` no longer supports declaring an Edge runtime at all** (`export const config = { runtime: "edge" }` is rejected outright by Next's own build: *"Proxy does not support Edge runtime"*). Left at its default, `proxy.ts` compiles as Node.js middleware — and `@opennextjs/cloudflare` 1.20.2 explicitly refuses to build a project with Node.js middleware (*"Node.js middleware is not currently supported. Consider switching to Edge Middleware."*). Confirmed against the latest published version of the adapter (1.20.2, no newer release exists) — this is a real, current gap between the two projects, not a version-lag issue on our side.

**What this means concretely:** the centralized "one file resolves session + org context for every request" design in [API_SPEC.md](API_SPEC.md) §1 cannot be built as a single `middleware.ts`/`proxy.ts` interceptor on this stack today.

**The fix — and why it's not actually a downgrade:** move session/org-context resolution into a shared server-only function (`getSessionContext()`), called from:
- **Route-group layouts** for pages — `app/(app)/layout.tsx`, `app/(admin)/layout.tsx`, `app/(platform-admin)/layout.tsx` — each a Server Component that calls `getSessionContext()` and `redirect()`s if it fails. Next.js layouts nest and are shared across every route beneath them, so this still centralizes the check in a small, fixed number of places — not per-leaf-page, and nowhere near an earlier project's ~89 independently-hand-rolled checks.
- **A thin `withAuth(handler, { minRole })` wrapper** for API routes, so every `route.ts` handler opts in with one line instead of duplicating the check.

This is a legitimate, idiomatic Next.js App Router pattern independent of hosting — several teams choose it over middleware even on Vercel, for exactly the reason it's forced here: middleware/edge runtime has a narrower API surface than a real Server Component or route handler. [API_SPEC.md](API_SPEC.md), [MULTI_TENANCY.md](MULTI_TENANCY.md), [DEVELOPMENT_SEQUENCE.md](DEVELOPMENT_SEQUENCE.md), and [DEFINITION_OF_DONE.md](DEFINITION_OF_DONE.md) have been updated to reflect this pattern in place of `middleware.ts`.

## Document processing — why this result matters most

This was flagged in [CLOUDFLARE_VALIDATION.md](CLOUDFLARE_VALIDATION.md) as *"the highest-risk item"* because most Node-native parsing libraries don't run on Workers even with `nodejs_compat`. Both candidates chosen specifically for edge/serverless compatibility worked on the first real attempt once a Node-API-usage bug was fixed (`mammoth`'s Node build wanted `{buffer}`, not `{arrayBuffer}` — a usage bug, not a runtime incompatibility):

- **PDF → `unpdf`**: extracted embedded text from a hand-built test PDF correctly (`"Cloudflare validation spike test PDF"`), including page count.
- **DOCX → `mammoth`**: extracted text from a minimal generated `.docx` correctly (`"Cloudflare validation spike test DOCX"`).

This directly de-risks [AI_ARCHITECTURE.md](AI_ARCHITECTURE.md) §3 (AI Course Builder's document ingestion step) — the single most AI-dependent, hardest-to-fall-back-on capability in the MVP.

## Update — real deployment confirmed (2026-08-14)

A real `wrangler login` (your Cloudflare account) plus `npm run deploy` (build via `@opennextjs/cloudflare`, upload via `wrangler`) succeeded end to end — not just local `preview`. Live at `https://lms.example.com`, verified `200 OK` with correct rendered content served from Cloudflare's edge (Bangalore PoP). This closes the "one real `wrangler deploy`" item below.

## Update — Supabase Auth confirmed working on Workers (2026-08-14, step 7)

Items 2 and 3 are closed. Building step 7 (signup/login/session/password-reset) doubled as the real validation: the full loop — signup → session cookie set → protected route → survives reload → logout clears it → password-reset email → real link → callback route exchanges the code → set new password → log in with it — was run against the actual Workers preview (`workerd`, port 8787), not just `next dev`. `@supabase/ssr`'s cookie handling works correctly through `@opennextjs/cloudflare`.

One real bug found and fixed along the way, unrelated to Cloudflare itself: `supabase/config.toml`'s default `additional_redirect_urls` (`https://127.0.0.1:3000` — wrong protocol, wrong host vs. what `next dev` actually serves) silently caused Supabase Auth to reject the app's custom `redirectTo` and fall back to the bare site URL, dropping the intended `/api/auth/callback` path. Fixed with a wildcarded allow-list (`http://localhost:3000/**`, `http://127.0.0.1:3000/**`). Caught only because the actual email was fetched from Mailpit and the real link was followed — a request that merely didn't error would have looked identical either way.

## What's still open before Phase 1 can be marked fully validated

Everything left untested requires **your** Supabase account access for the *remote* project specifically (items 2/3 are now proven against local Supabase, which uses the identical `@supabase/ssr` code path — revalidating against remote is low-risk, not required to keep moving):

1. Supabase Storage / signed URLs (items 9, 10) against the real project.
2. **Real Cloudflare Cron Trigger firing** (item 11) — config can be added and tested now that the account is connected.
3. One AI provider API key (any of Gemini/Groq/OpenRouter) — to confirm item 7 against a real model, not just the streaming mechanism.
4. A real SCORM package and a raster test image — to fully close items 13 and 14.

None of these block continuing Phase 1's remaining steps (8–11 of [DEVELOPMENT_SEQUENCE.md](DEVELOPMENT_SEQUENCE.md)), but they should be closed out before Phase 1 is marked done per [DEFINITION_OF_DONE.md](DEFINITION_OF_DONE.md).
