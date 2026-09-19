import path from "node:path";
import type { NextConfig } from "next";

// This deployment never issues or reads an application session — it has
// no login, no cookies, no user-facing pages besides the bridge itself.
// Same baseline hardening headers as the main app's next.config.ts,
// for the same reasons.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), midi=(), magnetometer=(), gyroscope=()",
  },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  // Without this, Next infers the workspace root from the *nearest*
  // lockfile going up the tree and finds the main app's — a real bug
  // hit while building this: Turbopack then resolved `@/*` against the
  // main app's directory and tried to pull in its proxy.ts. This app
  // must never resolve anything outside its own directory; that's the
  // entire point of it being a separate deployable with no Supabase
  // credential (docs/SCORM_CONTENT_ISOLATION_ARCHITECTURE.md).
  turbopack: {
    root: path.join(__dirname),
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
