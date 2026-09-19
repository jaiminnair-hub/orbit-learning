import { verifyBridgeToken } from "@/lib/bridge-token";

/**
 * Same-origin proxy for the bridge client's resume-state fetch — see
 * app/api/internal/scorm-resume-state/route.ts on the main app, whose
 * own doc comment already says "Server-to-server only, same trust model
 * as scorm-bytes." bridge-client.tsx was calling that endpoint directly
 * from the browser instead, a genuine cross-origin request with no
 * CORS headers, so it always failed silently (caught by the client's
 * own try/catch — the isolated player still loaded, resume state just
 * never did). The fix isn't adding CORS: that would require sending
 * CONTENT_BRIDGE_SECRET from browser-side code, leaking the one secret
 * server-to-server calls exist to keep server-side. This route is the
 * missing hop — same-origin from the browser's perspective (no CORS at
 * all), and it attaches the secret itself before calling the app origin,
 * exactly like the assets route already does for package bytes.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ packageId: string }> }
): Promise<Response> {
  const { packageId } = await params;
  const body = await request.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token : "";

  const claims = verifyBridgeToken(token);
  if (!claims || claims.packageId !== packageId) {
    return Response.json({ error: { code: "INVALID_TOKEN" } }, { status: 401 });
  }

  const appOrigin = process.env.APP_ORIGIN;
  const bridgeSecret = process.env.CONTENT_BRIDGE_SECRET;
  if (!appOrigin || !bridgeSecret) {
    return Response.json({ error: { code: "NOT_CONFIGURED" } }, { status: 500 });
  }

  const upstream = await fetch(`${appOrigin}/api/internal/scorm-resume-state`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Bridge-Secret": bridgeSecret },
    body: JSON.stringify({ token }),
  });

  const responseBody = await upstream.text();
  return new Response(responseBody, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}
