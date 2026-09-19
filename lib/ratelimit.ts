import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

/**
 * Shared rate limiting, backed by Upstash Redis.
 *
 * Vercel functions are stateless across instances — an in-memory counter
 * would reset per invocation and protect nothing. Upstash's REST-based
 * client is Edge-compatible (plain fetch, no raw TCP), which is what lets
 * this run from both `middleware.ts` (pre-auth routes: login, signup,
 * password reset) and inside `withAuth()` (authenticated API routes,
 * keyed by user id instead of IP).
 *
 * Every limiter is a named export rather than a generic
 * `checkRateLimit(key, config)` — Upstash's own guidance is to construct
 * one `Ratelimit` instance per distinct limit and reuse it (each instance
 * carries its own Lua script + prefix), not to build a fresh one per
 * request.
 */

let redisSingleton: Redis | null = null;

/**
 * Vercel's own "Upstash for Redis" marketplace integration names its
 * auto-injected variables KV_REST_API_URL / KV_REST_API_TOKEN (a Vercel KV
 * naming holdover), not the UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
 * pair Upstash's own docs and `Redis.fromEnv()` expect. Rather than require
 * hand-copying values into a second, differently-named variable in Vercel,
 * this resolves either naming — UPSTASH_* takes precedence when both exist.
 */
function resolveRedisCredentials(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  return url && token ? { url, token } : null;
}

/**
 * Lazily constructed so importing this module never fails when Upstash
 * env vars aren't set yet — local dev and every existing test run without
 * them today, and `isRateLimitConfigured()` is how a caller checks before
 * relying on it.
 */
function getRedis(): Redis {
  if (!redisSingleton) {
    const credentials = resolveRedisCredentials();
    if (!credentials) throw new Error("Rate limiting is not configured.");
    redisSingleton = new Redis(credentials);
  }
  return redisSingleton;
}

export function isRateLimitConfigured(): boolean {
  return resolveRedisCredentials() !== null;
}

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  /** Unix ms when the window resets — for a `Retry-After`-style hint. */
  reset: number;
}

/**
 * The thing every named limiter below actually is: something with a
 * `.limit(key)` call returning this shape. Real limiters are backed by
 * `@upstash/ratelimit`'s `Ratelimit` class; tests substitute a fake
 * satisfying just this interface, so a unit test never needs a real
 * Redis connection to prove this module's own logic (key construction,
 * fail-open behavior) is correct.
 */
export interface Limiter {
  limit(key: string): Promise<RateLimitResult>;
}

function makeLimiter(tokens: number, window: `${number} ${"s" | "m" | "h"}`, prefix: string): Limiter {
  let instance: Ratelimit | null = null;
  return {
    async limit(key: string): Promise<RateLimitResult> {
      // Deliberately fails open: a misconfigured or unreachable Upstash
      // instance must not take down login/signup/uploads for everyone.
      // Rate limiting is a defense-in-depth control, not the primary
      // authorization boundary (RLS is) — losing it under an outage is
      // an acceptable trade against losing the whole app under one.
      if (!isRateLimitConfigured()) {
        return { success: true, limit: tokens, remaining: tokens, reset: Date.now() };
      }
      if (!instance) {
        instance = new Ratelimit({
          redis: getRedis(),
          limiter: Ratelimit.slidingWindow(tokens, window),
          prefix,
        });
      }
      const result = await instance.limit(key);
      return { success: result.success, limit: result.limit, remaining: result.remaining, reset: result.reset };
    },
  };
}

// One instance per surface, per the module-level note above. Limits and
// rationale mirror docs/SECURITY_REVIEW_SCORM.md's follow-up plan.
export const loginLimiter: Limiter = makeLimiter(10, "5 m", "ratelimit:login");
export const signupLimiter: Limiter = makeLimiter(5, "1 h", "ratelimit:signup");
export const passwordResetLimiter: Limiter = makeLimiter(3, "1 h", "ratelimit:password-reset");
// Named for the route, not the content type — /api/v1/content/upload-url
// mints signed upload URLs for every content type (video, PDF, image,
// SCORM, ...), not SCORM alone. It's listed as a SCORM-adjacent control
// because it's the step immediately before SCORM extraction, but the
// limit applies to all uploads through this route.
export const uploadUrlLimiter: Limiter = makeLimiter(20, "1 h", "ratelimit:upload-url");
export const scormRegisterLimiter: Limiter = makeLimiter(10, "1 h", "ratelimit:scorm-register");
export const xapiRegisterLimiter: Limiter = makeLimiter(10, "1 h", "ratelimit:xapi-register");
// The LRS statements/state endpoints are hit repeatedly by an ingested
// package's own JS over the course of one attempt (every interaction,
// every autosave) — a per-route request-rate backstop, not a per-org
// content-creation limit like the ones above.
export const xapiLrsLimiter: Limiter = makeLimiter(120, "5 m", "ratelimit:xapi-lrs");
export const publishBuildLimiter: Limiter = makeLimiter(20, "1 h", "ratelimit:publish-build");
// Security-audit finding (2026-09-16): the invitation-accept endpoint
// validates a token (org_invitations.token) with no rate limit, unlike
// login/signup/password-reset — a per-user backstop against token-guessing
// by an authenticated-but-orgless account cycling through candidates.
export const invitationAcceptLimiter: Limiter = makeLimiter(10, "1 h", "ratelimit:invitation-accept");
// AI generation is cost-bearing (the org-level budget in lib/ai/budget.ts is
// the primary control; this is a per-user request-rate backstop alongside it).
export const aiGenerateLimiter: Limiter = makeLimiter(10, "1 h", "ratelimit:ai-generate");

/** For tests: replace a named limiter's underlying instance construction is
 * not possible from outside (module-private), so tests import `Limiter`
 * and construct their own fake to exercise callers directly instead of
 * reaching into these singletons. */
