// Security guard (2026-09-16): a statically prerendered App Router page's
// HTML is baked once at build time, with none of proxy.ts's per-request
// CSP nonce to give its own hydration/RSC-payload <script> tags — so once
// script-src stopped trusting bare 'self' for inline content, any static
// page's client-side JS silently stops running (no console error, no
// thrown exception — it just never hydrates). app/orbit/complete/page.tsx
// hit exactly this: verifyOtp() never ran, the page never redirected.
//
// The fix on each real page is one line (`export const dynamic =
// "force-dynamic"`), but nothing stops a *future* page from being added
// without it and quietly breaking the same way. This script is the
// backstop: it reads the build's own prerender manifest — the structured
// source of truth for which routes got statically prerendered — and fails
// the build if anything beyond the two framework-internal exceptions
// (Next's own error boundaries, which have no interactive requirement and
// aren't ours to annotate) shows up there.
import { readFileSync } from "node:fs";

const ALLOWED_STATIC = new Set(["/_not-found", "/_global-error"]);

const manifest = JSON.parse(readFileSync(".next/prerender-manifest.json", "utf-8"));
const staticRoutes = Object.keys(manifest.routes ?? {}).filter((route) => !ALLOWED_STATIC.has(route));

if (staticRoutes.length > 0) {
  console.error(
    "\n✖ The following routes are statically prerendered, which silently breaks their client-side JS under the app's CSP (see this file's header comment):\n"
  );
  for (const route of staticRoutes) console.error(`  ${route}`);
  console.error(
    '\nAdd `export const dynamic = "force-dynamic";` to each page above, then rebuild.\n'
  );
  process.exit(1);
}

console.log("✓ No unexpectedly-static pages — every route can carry a matching CSP nonce.");
