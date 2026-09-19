import { verifyBridgeToken } from "@/lib/bridge-token";

/**
 * Serves one file from a SCORM package, without this deployment ever
 * touching Supabase directly — see
 * docs/SCORM_CONTENT_ISOLATION_ARCHITECTURE.md. Validates the token
 * itself first (a fast local rejection that never leaves this process),
 * then asks the app origin — the only place holding SUPABASE_SECRET_KEY —
 * for the actual bytes, authorized by CONTENT_BRIDGE_SECRET.
 *
 * The token lives in the URL *path* (.../assets/{token}/lms/foo.js),
 * not a query string. A real package's HTML/JS references its own
 * sub-resources by plain relative path (`<script src="lms/scormdriver.js">`),
 * which the browser resolves against the current document's path only —
 * a query string on the entry HTML's own URL never carries forward to
 * those requests, but everything up to the last "/" in the path does.
 * Putting the token there means every relative reference, however
 * deeply nested, keeps it automatically. A cookie-based fallback was
 * tried first (2026-08-24) and rejected: this bridge page is loaded
 * inside a cross-site iframe from the learner's real session, and
 * browsers now block or partition cookies set in that context by
 * default (Safari ITP, Chrome's third-party cookie phase-out) —
 * confirmed by direct top-level navigation working while the real,
 * iframe-embedded flow still failed.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ packageId: string; token: string; path: string[] }> }
): Promise<Response> {
  const { packageId, token, path } = await params;

  const claims = verifyBridgeToken(decodeURIComponent(token));
  if (!claims || claims.packageId !== packageId) {
    return new Response("Not found", { status: 404 });
  }

  const appOrigin = process.env.APP_ORIGIN;
  const bridgeSecret = process.env.CONTENT_BRIDGE_SECRET;
  if (!appOrigin || !bridgeSecret) {
    return new Response("Not configured", { status: 500 });
  }

  const upstream = await fetch(`${appOrigin}/api/internal/scorm-bytes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Bridge-Secret": bridgeSecret },
    body: JSON.stringify({ token: decodeURIComponent(token), path: path.join("/") }),
  });

  if (!upstream.ok) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/octet-stream" },
  });
}
