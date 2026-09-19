import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * lib/ratelimit.ts's own contract, independent of Upstash's internals
 * (the sliding-window math is Upstash's own tested library, not ours to
 * re-verify). What matters here: this module must never take the app
 * down when Upstash isn't configured or is unreachable — rate limiting
 * is defense-in-depth, not the authorization boundary RLS already is —
 * and it must correctly translate a real limiter's decision into the
 * shape callers (proxy.ts, with-auth.ts) depend on.
 */

const ORIGINAL_ENV = { ...process.env };

function setUpstashEnv(configured: boolean) {
  if (configured) {
    process.env.UPSTASH_REDIS_REST_URL = "https://example-upstash.test";
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
  } else {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  }
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
  vi.doUnmock("@upstash/redis");
  vi.doUnmock("@upstash/ratelimit");
});

describe("isRateLimitConfigured", () => {
  it("is false when either Upstash env var is missing", async () => {
    setUpstashEnv(false);
    const { isRateLimitConfigured } = await import("@/lib/ratelimit");
    expect(isRateLimitConfigured()).toBe(false);
  });

  it("is true once both are present", async () => {
    setUpstashEnv(true);
    const { isRateLimitConfigured } = await import("@/lib/ratelimit");
    expect(isRateLimitConfigured()).toBe(true);
  });

  it("is true when Vercel's KV_REST_API_* names are set instead", async () => {
    setUpstashEnv(false);
    process.env.KV_REST_API_URL = "https://example-upstash.test";
    process.env.KV_REST_API_TOKEN = "test-token";
    const { isRateLimitConfigured } = await import("@/lib/ratelimit");
    expect(isRateLimitConfigured()).toBe(true);
  });
});

describe("a limiter with Upstash unconfigured", () => {
  beforeEach(() => setUpstashEnv(false));

  it("fails open — every request succeeds, no network call attempted", async () => {
    const { loginLimiter } = await import("@/lib/ratelimit");
    const first = await loginLimiter.limit("1.2.3.4");
    const second = await loginLimiter.limit("1.2.3.4");
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
  });
});

describe("a limiter with Upstash configured", () => {
  beforeEach(() => {
    setUpstashEnv(true);
    // The real Ratelimit class talks to real Redis via the real Redis
    // client's HTTP calls — neither exists in CI. Mocking at this
    // boundary tests exactly what this module owns: that it constructs
    // one Ratelimit per limiter (not per call) and passes its decision
    // through unchanged, not the sliding-window arithmetic itself.
    class FakeRedis {
      constructor(_config: unknown) {}
    }
    vi.doMock("@upstash/redis", () => ({ Redis: FakeRedis }));
  });

  it("passes through a denied decision", async () => {
    const limitMock = vi.fn().mockResolvedValue({
      success: false,
      limit: 10,
      remaining: 0,
      reset: Date.now() + 60_000,
    });
    class FakeRatelimit {
      static slidingWindow = vi.fn();
      limit = limitMock;
    }
    vi.doMock("@upstash/ratelimit", () => ({ Ratelimit: FakeRatelimit }));

    const { loginLimiter } = await import("@/lib/ratelimit");
    const result = await loginLimiter.limit("9.9.9.9");

    expect(result.success).toBe(false);
    expect(result.remaining).toBe(0);
    expect(limitMock).toHaveBeenCalledWith("9.9.9.9");
  });

  it("passes through an allowed decision", async () => {
    const limitMock = vi.fn().mockResolvedValue({
      success: true,
      limit: 10,
      remaining: 4,
      reset: Date.now() + 60_000,
    });
    class FakeRatelimit {
      static slidingWindow = vi.fn();
      limit = limitMock;
    }
    vi.doMock("@upstash/ratelimit", () => ({ Ratelimit: FakeRatelimit }));

    const { signupLimiter } = await import("@/lib/ratelimit");
    const result = await signupLimiter.limit("9.9.9.9");

    expect(result.success).toBe(true);
    expect(result.remaining).toBe(4);
  });

  it("constructs the underlying Ratelimit instance once, not per call", async () => {
    const RatelimitCtor = vi.fn();
    class FakeRatelimit {
      static slidingWindow = vi.fn();
      constructor(config: unknown) {
        RatelimitCtor(config);
      }
      limit = vi.fn().mockResolvedValue({ success: true, limit: 5, remaining: 5, reset: 0 });
    }
    vi.doMock("@upstash/ratelimit", () => ({ Ratelimit: FakeRatelimit }));

    const { passwordResetLimiter } = await import("@/lib/ratelimit");
    await passwordResetLimiter.limit("a");
    await passwordResetLimiter.limit("b");
    await passwordResetLimiter.limit("c");

    expect(RatelimitCtor).toHaveBeenCalledTimes(1);
  });
});
