import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ipAddress } from "@vercel/functions";
import { loginLimiter, signupLimiter, passwordResetLimiter, type Limiter } from "@/lib/ratelimit";

/**
 * `proxy.ts` — Next.js 16 renamed `middleware.ts` to this; same mechanism,
 * per node_modules/next/dist/docs/.../file-conventions/proxy.md. This is
 * the only place that can protect login/signup/password-reset: those are
 * Server Actions (`<form action={login}>` etc.), which run *before* any
 * session exists, so withAuth() can't cover them — it only wraps routes
 * that already require one.
 *
 * Runs on the Node.js runtime by default in Next 16 (a change from older
 * Next versions where middleware was Edge-only) — checked against the
 * docs rather than assumed, since AGENTS.md flags exactly this kind of
 * stale-training-data risk. @upstash/redis's REST client works
 * identically either way (plain fetch, no raw TCP).
 *
 * Only the POST (the actual Server Action submission) is limited — the
 * GET that loads the page first must never be throttled, or viewing the
 * login page would count against the same budget as attempting it.
 */

const LIMITED_PATHS: Record<string, Limiter> = {
  "/login": loginLimiter,
  "/signup": signupLimiter,
  "/reset-password": passwordResetLimiter,
};

// Content-Security-Policy — 2026-09-16 security-hardening pass, closing the
// gap next.config.ts's header list deliberately left open (see the comment
// there). Nonce + 'strict-dynamic' rather than a static script-src allowlist:
// per Next's documented CSP pattern, propagating `x-nonce` through the
// request headers here makes Next automatically apply the same nonce to the
// runtime scripts it renders, so the app needs no per-component changes.
// Third-party SCORM/xAPI package content is served under /api/** — outside
// this file's matcher below — so its own inline scripts are untouched; this
// only tightens what the app's *own* pages may execute.
const EMBED_FRAME_SRC = [
  "https://www.youtube.com",
  "https://player.vimeo.com",
  "https://view.genially.com",
  "https://docs.google.com",
  "https://codepen.io",
];

function buildCsp(nonce: string): string {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseOrigin = supabaseUrl ? new URL(supabaseUrl).origin : "";
  const supabaseWs = supabaseOrigin ? supabaseOrigin.replace(/^http/, "ws") : "";
  // The isolated content origin is itself an iframe target of the app's own
  // pages (IsolatedScormPlayer) — needs an explicit frame-src grant since it's
  // a different origin, unlike the legacy same-origin /api/** asset route.
  // The Supabase storage origin needs the same grant: player.tsx frames a
  // PDF asset directly from its signed Storage URL, a different origin
  // than the app itself.
  const scormContentOrigin = process.env.NEXT_PUBLIC_SCORM_CONTENT_ORIGIN || "";
  const frameSrc = ["'self'", ...EMBED_FRAME_SRC, scormContentOrigin, supabaseOrigin].filter(Boolean).join(" ");
  const connectSrc = ["'self'", supabaseOrigin, supabaseWs].filter(Boolean).join(" ");
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    // Inline `style="..."` attributes are load-bearing across this app's
    // component styling (components/authoring/theme.ts and friends) — a
    // strict style-src would silently strip all of it. Style injection is a
    // much lower-severity vector than script injection, so this is the
    // accepted trade, not an oversight.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' https: blob: data:",
    "font-src 'self' data:",
    `connect-src ${connectSrc}`,
    `frame-src ${frameSrc}`,
    "frame-ancestors 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

function withCsp<T extends NextResponse>(response: T, csp: string): T {
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

// Optional: when FRONT_DOOR_HOST is set, that domain is the single public front door
// (docs/MULTI_TENANCY.md) — the app is also directly reachable at its own
// raw Vercel domain, which must never be what a browser's address bar
// shows in production. Vercel's edge rewrite (the front door proxying
// here) always sets x-forwarded-host — confirmed live, it is present on
// *every* request, not just proxied ones; a direct hit carries this app's
// own raw domain there instead of being absent. So the real signal is
// whether it equals the front door, not whether it exists.
// Scoped to VERCEL_ENV === "production" only — a Preview deployment has no
// route through the front door at all (it only ever proxies to whatever is
// currently promoted to production), so redirecting a preview there would
// just replace the branch being reviewed with production.

export async function proxy(request: NextRequest) {
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const csp = buildCsp(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  const next = () => withCsp(NextResponse.next({ request: { headers: requestHeaders } }), csp);

  const frontDoorHost = process.env.FRONT_DOOR_HOST;
  if (
    frontDoorHost &&
    process.env.VERCEL_ENV === "production" &&
    request.headers.get("x-forwarded-host") !== frontDoorHost
  ) {
    const redirectUrl = new URL(
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
      `https://${frontDoorHost}`
    );
    return withCsp(NextResponse.redirect(redirectUrl, { status: 307 }), csp);
  }

  if (request.method !== "POST") return next();

  const limiter = LIMITED_PATHS[request.nextUrl.pathname];
  if (!limiter) return next();

  // No real client IP in local dev (no proxy in front of `next dev`) — a
  // fixed fallback key means local testing shares one bucket rather than
  // throwing, which is the right trade-off for a control that fails open
  // by design anyway (see lib/ratelimit.ts).
  const key = ipAddress(request) ?? "local-dev";
  const result = await limiter.limit(key);

  if (!result.success) {
    // Reuses the existing `?error=` pattern every auth page already reads
    // (app/login/page.tsx, app/signup/page.tsx, app/reset-password/page.tsx)
    // — no new UI needed for this to surface correctly.
    const url = request.nextUrl.clone();
    url.searchParams.set("error", "Too many attempts. Please wait a few minutes and try again.");
    return withCsp(NextResponse.redirect(url, { status: 303 }), csp);
  }

  return next();
}

export const config = {
  // Widened from just the 3 rate-limited paths so the front-door redirect
  // above covers every page — api/_next/static/_next/image/favicon.ico
  // excluded per the documented negative-matching pattern
  // (node_modules/next/dist/docs/.../file-conventions/proxy.md), so
  // server-to-server API traffic (the Orbit entry bridge, xAPI package
  // launches, which intentionally address this app's own raw domain) and
  // static assets are never redirected.
  //
  // orbit-360 is also excluded: it's static HTML with no per-request nonce
  // mechanism, so this file's nonce-based CSP would silently block its
  // inline scripts. It carries its own fixed CSP from next.config.ts's
  // headers() instead. "/" is NOT excluded — it's app/page.tsx, a real Next
  // page, so it correctly gets the same nonce-based CSP as every other page.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|orbit-360).*)"],
};
