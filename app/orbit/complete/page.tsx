import { OrbitCompleteClient } from "./complete-client";

// Security fix (2026-09-16): a statically prerendered page's HTML is
// generated once at build time with no request to draw a CSP nonce from,
// so Next bakes its own hydration/RSC-payload <script> tags in with no
// nonce at all — permanently mismatching proxy.ts's fresh per-request
// nonce now that script-src no longer trusts bare 'self' for inline
// content. The practical effect: this page's hydration script-src
// violation would silently kill complete-client.tsx's useEffect, so it
// never calls verifyOtp() and never redirects — "Signing you in…"
// forever, with no console error a user would ever see.
//
// `dynamic` route config only takes effect from a Server Component page
// file — hence the split from complete-client.tsx (a "use client" file
// can't carry this export) — force-dynamic makes every request
// regenerate the HTML with a matching nonce, like every other route.
export const dynamic = "force-dynamic";

export default function OrbitCompletePage() {
  return <OrbitCompleteClient />;
}
