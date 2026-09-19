# Enabling rate limiting — provisioning checklist

**Current status: built, not active.** `lib/ratelimit.ts` fails open when Upstash isn't configured — every environment today. Nothing is throttled yet; this checklist is what turns it on. Do not describe rate limiting as "enabled" or "complete" until every box below is checked.

## 1. Provision Upstash Redis

Via Vercel Marketplace (recommended — no manual credential copying):

1. Vercel dashboard → the `learning-platform` project → **Integrations** → **Upstash** (native, "Storage" tag) → **Upstash for Redis** product → **Install**
2. Create a new Redis database — free tier is sufficient at this stage
3. Connect it to the `learning-platform` project

**Note, confirmed against a real install (2026-08-24):** this integration names its auto-injected variables `KV_REST_API_URL` / `KV_REST_API_TOKEN` (a Vercel KV naming holdover), not `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` as first assumed here. `lib/ratelimit.ts`'s `resolveRedisCredentials()` accepts either naming — `UPSTASH_REDIS_REST_*` takes precedence if both happen to be set, otherwise it falls back to `KV_REST_API_*`. **No manual copying is required either way** — whichever names Vercel actually injects are sufficient.

## 2. Confirm the env vars landed

Vercel → `learning-platform` → Settings → Environment Variables. Confirm this pair is present (from the integration, named `KV_REST_API_URL` / `KV_REST_API_TOKEN` unless Vercel's naming changes in the future):
- `KV_REST_API_URL` (or `UPSTASH_REDIS_REST_URL`)
- `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_TOKEN`)

For **both Production and Preview** — `lib/ratelimit.ts` checks both at once (`isRateLimitConfigured()`), so a partial setup (one environment only) leaves the other silently failing open.

## 3. Redeploy

Env var changes don't apply to an already-built deployment — trigger a new deployment after step 2.

## 4. Verify it's actually active, don't assume

Once deployed:
- Submit the login form more than 10 times in under 5 minutes from the same connection → expect the existing "Too many attempts" error to appear (the same `?error=` UI path login already has, not new UI).
- Hit `POST /api/v1/content/upload-url` more than 20 times in an hour as the same user → expect a `429` with code `RATE_LIMITED`.

If neither happens, the fail-open path is still active — recheck steps 1–3 before concluding rate limiting is live.

## What this does *not* need

- No code changes — `proxy.ts` and `withAuth()`'s `rateLimit` option are already wired to `lib/ratelimit.ts`'s exported limiters.
- `apps/scorm-content` does not need Upstash — it has no auth surface of its own.
