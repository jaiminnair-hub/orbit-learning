# Cloudflare Technical Validation Plan

> **The spike this document planned has now run — see [CLOUDFLARE_VALIDATION_RESULTS.md](CLOUDFLARE_VALIDATION_RESULTS.md) for the outcome (verdict: proceed with Cloudflare, one design change required).** This document is kept as the original plan/methodology for reference and for closing out the remaining items that need real account access.

This was a **plan for a spike**, run locally against the real Workers runtime once Phase 1 began. This document defines exactly what was proven, how, and what "pass" and "fail → fallback" looked like for each item.

Recommendation tested: Next.js 16 (App Router) deployed via `@opennextjs/cloudflare` to Cloudflare Workers. **Now validated — see the results doc.**

## 1. Why this can't be assumed

an earlier project's own docs already record Vercel-specific quirks that had to be worked around (Supabase Storage's `.html` content-type downgrade breaking SCORM serving, Vercel's ~4.5MB request-body cap forcing a two-step signed-upload flow, `next/og` being broken on their specific Next.js build). A different host has a different set of quirks, not zero quirks. This spike exists to find this platform's version of those problems before the whole codebase is built assuming they don't exist.

## 2. Items to validate, method, and pass criteria

| # | Item | Validation method | Pass criteria | If it fails |
|---|---|---|---|---|
| 1 | Next.js 16 App Router basics | Deploy a minimal multi-route app via `@opennextjs/cloudflare` | Static + dynamic routes render correctly, no build errors | Blocking — re-evaluate host entirely |
| 2 | Supabase Auth (browser + server) | Full signup/login/OAuth-callback/reset flow against a real Supabase project, deployed on Workers | Session cookies set/read correctly across Worker requests | Investigate `@supabase/ssr` compatibility with Workers cookie handling; likely fixable |
| 3 | Supabase server/client access patterns | Server-side data fetch (RLS-respecting) and service-role admin client, both from a Worker | Both work, service-role key never leaks to a client bundle | Blocking if the admin client can't run server-only on Workers |
| 4 | `middleware.ts` / session handling | Protected route redirects unauthenticated users; org context attaches correctly | Matches [API_SPEC.md](API_SPEC.md) §1 behavior | Workers-native middleware may differ from Vercel Edge Middleware semantics — verify explicitly, don't assume parity |
| 5 | API routes | A representative `route.ts` handling GET/POST/PATCH/DELETE | Behaves identically to local dev | — |
| 6 | Streaming responses (general) | An SSE endpoint | Client receives incremental chunks, not buffered-then-flushed | Workers have historically had rough edges with streaming — test explicitly |
| 7 | AI streaming specifically | `streamChatResponse()` equivalent, calling a real provider, streamed to the browser | Token-by-token delivery works end-to-end through the Worker | If buffering occurs, evaluate whether it's acceptable UX degradation or blocking for the Learning Assistant |
| 8 | File upload | Two-step signed-URL flow (§6, [API_SPEC.md](API_SPEC.md)) | Upload succeeds for a file above Vercel's old 4.5MB cap, confirming whether that workaround is still needed here | Adjust the upload flow to Workers' actual limits, whatever they are |
| 9 | Supabase Storage | Upload, signed download URL, direct fetch of a stored SCORM asset | Content-type is preserved (the exact bug an earlier project hit on Vercel/Supabase) | If `.html` content-type still downgrades, confirm whether it's Supabase-side (host-independent) or Worker-fetch-side |
| 10 | Signed URLs | Time-limited signed URL generation and expiry | Expiry enforced correctly | — |
| 11 | Background jobs / cron | Cloudflare Cron Triggers running a scheduled Worker | Fires on schedule, can call into the app/DB | Replaces Vercel Cron 1:1 in concept; confirm the trigger→execution model matches what email digests/health checks need |
| 12 | Caching | Static asset caching, any `fetch()` cache behavior Next.js relies on | No stale/incorrect cache serving across deploys | — |
| 13 | Image handling | `next/image` equivalent behavior | Images optimize/serve correctly | an earlier project already had `next/og`/`ImageResponse` break on a Vercel Next.js version — treat image handling as high-risk, not routine |
| 14 | SCORM | Serve an extracted SCORM package's assets (HTML/JS/CSS) through a Worker route | Correct content-types, inline scripts execute (matches the CSP carve-out pattern) | If Workers' response-streaming/body-size behavior breaks large SCORM asset serving, this is a hard blocker for a core MVP feature |
| 15 | Document processing | Parse a PDF/DOCX/PPT server-side for AI Course Builder ingestion | Text extraction succeeds within Workers' CPU-time and package-compatibility constraints | **Highest-risk item.** Many Node-native parsing libraries assume Node APIs unavailable on Workers even with the `nodejs_compat` flag. If no Workers-compatible library extracts DOCX/PPT reliably, the fallback is routing document-processing specifically to an external service (a small Node runtime — e.g. Fly.io/Render — or a queue-backed process) while the rest of the app stays on Workers |

## 3. Fallback framework

If any item above is a **hard blocker** (SCORM serving, document processing, or Supabase Auth session handling most likely candidates), the recommended fallback is **not** abandoning Cloudflare wholesale — it's a hybrid: Cloudflare Workers/Pages for the main app and edge-served content, with the specific blocked capability (most plausibly document processing) routed to a small dedicated Node-runtime service. This gets documented as a revision to [ARCHITECTURE.md](ARCHITECTURE.md) §3's system diagram if it happens — not silently patched around later.

## 4. What "done" looks like for this spike

A short throwaway repo (not the real platform repo) with each of the 15 items above demonstrated working (or documented as failing with a fallback decision), reviewed before Phase 1 of the real repo begins. This is the first line item in [DEVELOPMENT_SEQUENCE.md](DEVELOPMENT_SEQUENCE.md) and a gate in [DEFINITION_OF_DONE.md](DEFINITION_OF_DONE.md).
