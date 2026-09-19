import { createAdminClient } from "@/lib/supabase/admin";
import { verifyBridgeToken } from "@/lib/scorm/bridge-token";

/**
 * Server-to-server only, same trust model as
 * app/api/internal/scorm-bytes/route.ts — the content-origin bridge has
 * no session cookie, so it can't call the learner-facing
 * /api/v1/content/scorm/[id]/progress GET. This is that route's read
 * side, reached instead through the bridge token.
 *
 * The token stays small and URL-safe on purpose (query-string length
 * limits), so resume state is fetched here rather than embedded in it —
 * suspend_data alone can run to several KB.
 */
export async function POST(request: Request): Promise<Response> {
  const expectedSecret = process.env.CONTENT_BRIDGE_SECRET;
  if (!expectedSecret) {
    return Response.json({ error: { code: "NOT_CONFIGURED" } }, { status: 500 });
  }
  if (request.headers.get("x-bridge-secret") !== expectedSecret) {
    return Response.json({ error: { code: "FORBIDDEN" } }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token : "";
  const claims = verifyBridgeToken(token);
  if (!claims) {
    return Response.json({ error: { code: "INVALID_TOKEN" } }, { status: 401 });
  }

  const admin = createAdminClient();

  // Confirm the package genuinely belongs to the token's org before
  // returning anything — the token was minted by this same app, but this
  // costs nothing and closes the same class of gap the byte endpoint
  // guards against.
  const { data: pkg } = await admin
    .from("scorm_packages")
    .select("id, org_id")
    .eq("id", claims.packageId)
    .single();
  if (!pkg || pkg.org_id !== claims.orgId) {
    return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
  }

  const { data: progress, error } = await admin
    .from("scorm_progress")
    .select("cmi_data, lesson_status, total_time_sec")
    .eq("scorm_package_id", claims.packageId)
    .eq("user_id", claims.userId)
    .maybeSingle();

  if (error) return Response.json({ error: { code: "QUERY_FAILED" } }, { status: 500 });
  return Response.json({ data: { progress: progress ?? null } });
}
