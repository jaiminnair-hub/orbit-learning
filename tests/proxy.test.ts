import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch, getRedirectUrl } from "next/experimental/testing/server";
import { config } from "@/proxy";

/**
 * proxy.ts — Next 16's renamed middleware.js (checked against
 * node_modules/next/dist/docs/.../file-conventions/proxy.md rather than
 * assumed, per AGENTS.md). This is the only place that can protect
 * login/signup/password-reset, since those are Server Actions that run
 * before any session exists.
 */

describe("matcher", () => {
  // Widened from just the 3 rate-limited auth paths to every page route,
  // so the front-door redirect (below) covers the whole app — api/_next
  // stay excluded so server-to-server traffic and static assets are never
  // redirected.
  it("matches page routes, including the three protected auth paths and the root", () => {
    // "/" is app/page.tsx, a real Next page (the capability-hero page) --
    // it needs the same nonce-based CSP as every other page.
    for (const path of ["/login", "/signup", "/reset-password", "/dashboard", "/reset-password/confirm", "/"]) {
      expect(unstable_doesMiddlewareMatch({ config, url: `https://example.test${path}` })).toBe(
        true
      );
    }
  });

  it("does not match api routes, static assets, or Orbit 360's static pages", () => {
    // Orbit 360's pages carry no per-request CSP nonce, so this file's
    // nonce-based CSP would silently block their inline <script> tags if it
    // applied. They get their own fixed CSP from next.config.ts's headers()
    // instead. robots.txt/sitemap.xml are rewritten to Orbit 360's own
    // files regardless of which page is at "/", so they stay excluded too.
    for (const path of [
      "/api/v1/orgs/me",
      "/_next/static/chunk.js",
      "/favicon.ico",
      "/orbit-360/orbit-console.html",
      "/robots.txt",
      "/sitemap.xml",
    ]) {
      expect(unstable_doesMiddlewareMatch({ config, url: `https://example.test${path}` })).toBe(
        false
      );
    }
  });
});

const mocks = vi.hoisted(() => ({
  loginLimit: vi.fn(),
  signupLimit: vi.fn(),
  resetLimit: vi.fn(),
}));

vi.mock("@/lib/ratelimit", () => ({
  loginLimiter: { limit: mocks.loginLimit },
  signupLimiter: { limit: mocks.signupLimit },
  passwordResetLimiter: { limit: mocks.resetLimit },
}));

const ALLOWED = { success: true, limit: 10, remaining: 9, reset: Date.now() + 60_000 };
const DENIED = { success: false, limit: 10, remaining: 0, reset: Date.now() + 60_000 };

describe("front-door redirect", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("redirects to app.example.com in production when not already there", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("FRONT_DOOR_HOST", "app.example.com");
    const { proxy } = await import("@/proxy");
    const request = new NextRequest("https://raw-app.vercel.app/dashboard?x=1", {
      headers: { "x-forwarded-host": "raw-app.vercel.app" },
    });
    const response = await proxy(request);

    expect(getRedirectUrl(response)).toBe("https://app.example.com/dashboard?x=1");
  });

  it("does not redirect a request already forwarded from app.example.com", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("FRONT_DOOR_HOST", "app.example.com");
    const { proxy } = await import("@/proxy");
    const request = new NextRequest("https://raw-app.vercel.app/dashboard", {
      headers: { "x-forwarded-host": "app.example.com" },
    });
    const response = await proxy(request);

    expect(getRedirectUrl(response)).toBeNull();
  });

  it("never redirects when no front-door host is configured", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("FRONT_DOOR_HOST", "");
    const { proxy } = await import("@/proxy");
    const request = new NextRequest("https://raw-app.example.test/dashboard", {
      headers: { "x-forwarded-host": "raw-app.example.test" },
    });
    const response = await proxy(request);

    expect(getRedirectUrl(response)).toBeNull();
  });

  it("never redirects outside production (e.g. a Preview deployment)", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    const { proxy } = await import("@/proxy");
    const request = new NextRequest("https://preview-app.vercel.app/dashboard", {
      headers: { "x-forwarded-host": "preview-app.vercel.app" },
    });
    const response = await proxy(request);

    expect(getRedirectUrl(response)).toBeNull();
  });
});

describe("proxy()", () => {
  beforeEach(() => {
    mocks.loginLimit.mockReset().mockResolvedValue(ALLOWED);
    mocks.signupLimit.mockReset().mockResolvedValue(ALLOWED);
    mocks.resetLimit.mockReset().mockResolvedValue(ALLOWED);
    // These requests carry no x-forwarded-host at all, so if this ever ran
    // with an ambient VERCEL_ENV=production (a real Vercel CI runner, say),
    // the front-door redirect above would fire before any rate-limit logic
    // ever ran. Pinned here so this block only ever tests rate-limiting.
    vi.stubEnv("VERCEL_ENV", "test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("never checks the limiter for a GET — only a POST is a real attempt", async () => {
    const { proxy } = await import("@/proxy");
    const request = new NextRequest("https://example.test/login", { method: "GET" });
    const response = await proxy(request);

    expect(mocks.loginLimit).not.toHaveBeenCalled();
    expect(getRedirectUrl(response)).toBeNull();
  });

  it("passes an allowed POST through untouched", async () => {
    const { proxy } = await import("@/proxy");
    const request = new NextRequest("https://example.test/login", { method: "POST" });
    const response = await proxy(request);

    expect(mocks.loginLimit).toHaveBeenCalledWith("local-dev");
    expect(getRedirectUrl(response)).toBeNull();
  });

  it("redirects a denied login POST back to /login with the existing error-param UI path", async () => {
    mocks.loginLimit.mockResolvedValue(DENIED);
    const { proxy } = await import("@/proxy");
    const request = new NextRequest("https://example.test/login", { method: "POST" });
    const response = await proxy(request);

    const redirect = getRedirectUrl(response);
    expect(redirect).not.toBeNull();
    const url = new URL(redirect!);
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("error")).toMatch(/too many attempts/i);
  });

  it("keys signup and password-reset through their own limiters, not login's", async () => {
    mocks.signupLimit.mockResolvedValue(DENIED);
    const { proxy } = await import("@/proxy");

    const signup = await proxy(new NextRequest("https://example.test/signup", { method: "POST" }));
    expect(mocks.signupLimit).toHaveBeenCalled();
    expect(mocks.loginLimit).not.toHaveBeenCalled();
    expect(getRedirectUrl(signup)).not.toBeNull();

    const reset = await proxy(
      new NextRequest("https://example.test/reset-password", { method: "POST" })
    );
    expect(mocks.resetLimit).toHaveBeenCalled();
    expect(getRedirectUrl(reset)).toBeNull(); // resetLimit still mocked to ALLOWED
  });

  it("ignores POSTs to paths outside the matcher entirely", async () => {
    const { proxy } = await import("@/proxy");
    const request = new NextRequest("https://example.test/dashboard", { method: "POST" });
    const response = await proxy(request);

    expect(mocks.loginLimit).not.toHaveBeenCalled();
    expect(mocks.signupLimit).not.toHaveBeenCalled();
    expect(mocks.resetLimit).not.toHaveBeenCalled();
    expect(getRedirectUrl(response)).toBeNull();
  });
});
