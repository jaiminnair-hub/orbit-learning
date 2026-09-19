import type { NextConfig } from "next";

// Baseline security headers (2026-08-21 SCORM security review, item 1 of
// the pre-Orbit hardening order). These are the low-risk, no-tradeoff
// headers — they cannot break an existing page, so they ship now rather
// than waiting on the full review.
//
// Content-Security-Policy lives in proxy.ts, not here: it needs a
// per-request nonce (Next's own runtime scripts pick it up automatically
// when propagated through middleware request headers), which a static
// next.config.ts headers() list can't generate. Built and tested against
// both the legacy same-origin SCORM player and the isolated content origin
// in the 2026-09-16 hardening pass — see proxy.ts's buildCsp().
const securityHeaders = [
  // Stops a browser from executing an upload as something other than
  // its declared Content-Type — the specific class of attack where a
  // file registered as one type is served and interpreted as another.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Same-origin framing only. The SCORM player and the runtime course
  // player both frame our own asset routes deliberately; nothing in the
  // product frames a *different* origin's page, and nothing needs to be
  // frameable from outside this app.
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // No feature here has ever needed hardware/sensor access; the default
  // posture is "nothing gets it" rather than trusting every page
  // (including uploaded SCORM content rendered in-app) not to ask.
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), midi=(), magnetometer=(), gyroscope=()",
  },
  // Ignored by browsers over plain HTTP (local dev), so this is safe to
  // ship unconditionally rather than gated on environment. `preload` opts
  // this domain into browsers' built-in HSTS preload list — a one-way
  // commitment to HTTPS-only, appropriate now that the app enforces a
  // single canonical front-door host (proxy.ts) rather than being an
  // environment-dependent toggle.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

// Orbit 360 is static HTML, not Next-rendered — its inline <script> tags
// carry no per-request nonce, so proxy.ts's nonce-based CSP
// (script-src 'nonce-...' only, no 'self') would silently block every one
// of them if it applied here. These paths get their own fixed CSP instead,
// carried over unchanged from orbit-platform/vercel.json's per-path header
// blocks, and are excluded from proxy.ts's matcher (see that file) so its
// CSP never touches them.
//
// "/" itself is NOT in this list: per explicit product direction, the root
// is app/page.tsx (the LMS's own capability-hero page), a real Next page —
// it gets the normal nonce-based CSP like any other page in the app. The
// suite-wide landing.html this used to route to is still served at
// /landing.html directly, just no longer the root.
const ORBIT_360_CSP =
  "default-src 'self'; connect-src 'self' https://*.supabase.co; img-src 'self' data: https://*.supabase.co; style-src 'self' https://fonts.googleapis.com; script-src 'self' https://cdn.jsdelivr.net; font-src 'self' https://fonts.gstatic.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self' mailto:;";

// Orbit 360's original vercel.json also set X-Frame-Options: DENY (stricter
// than this app's own SAMEORIGIN, which exists for the SCORM/course
// player's own same-origin iframes — no page under these paths frames or
// is framed by anything, so DENY carries over unchanged).
const orbit360Headers = [
  { key: "Content-Security-Policy", value: ORBIT_360_CSP },
  { key: "X-Frame-Options", value: "DENY" },
];

const nextConfig: NextConfig = {
  // Browser QA uses its own output directory, so its disposable production
  // build never contends with the desktop app's normal .next cache.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Listed after the rule above: Next.js applies later entries' values
      // for a repeated header key, so these intentionally override the
      // generic X-Frame-Options for exactly these paths, without touching
      // it anywhere else. Verified against the actual served response
      // headers, not assumed from documentation.
      { source: "/orbit-360/:path*", headers: orbit360Headers },
      { source: "/robots.txt", headers: orbit360Headers },
      { source: "/sitemap.xml", headers: orbit360Headers },
    ];
  },
  async rewrites() {
    return {
      // beforeFiles: runs before Next checks pages/public files, so this
      // correctly intercepts "/" ahead of app/page.tsx (which would
      // otherwise win, since it's a real filesystem route).
      beforeFiles: [
        { source: "/robots.txt", destination: "/orbit-360/robots.txt" },
        { source: "/sitemap.xml", destination: "/orbit-360/sitemap.xml" },
        { source: "/orbit-360/360", destination: "/orbit-360/feedback.html" },
        { source: "/orbit-360/learning", destination: "/orbit-360/learning.html" },
        { source: "/orbit-360/sign-in", destination: "/orbit-360/orbit-console.html" },
        { source: "/orbit-360/review", destination: "/orbit-360/review.html" },
      ],
    };
  },
  async redirects() {
    return [
      // Dead legacy URLs from before the single-landing-page cleanup —
      // carried over unchanged from orbit-platform/vercel.json.
      { source: "/index.html", destination: "/", permanent: true },
      { source: "/feedback-response.html", destination: "/", permanent: true },
      { source: "/builder-demo.html", destination: "/", permanent: true },
      { source: "/auth-page.html", destination: "/", permanent: true },
      { source: "/workspace-settings.html", destination: "/", permanent: true },
      { source: "/workspace-response.html", destination: "/", permanent: true },
      { source: "/magic-link-page.html", destination: "/", permanent: true },
      { source: "/orbit-360", destination: "/", permanent: false },
      { source: "/orbit-360/", destination: "/", permanent: false },
      { source: "/orbit-360/workspace.html", destination: "/orbit-360/orbit-console.html", permanent: true },
    ];
  },
};

export default nextConfig;
