import { createAdminClient } from "@/lib/supabase/admin";
import { contentTypeFor } from "@/lib/content/scorm";
import { verifyBridgeToken } from "@/lib/scorm/bridge-token";

const BUCKET = "content-assets";

/**
 * Server-to-server only — called exclusively by the SCORM content-origin
 * deployment (docs/SCORM_CONTENT_ISOLATION_ARCHITECTURE.md), never by a
 * browser. This is deliberately the *only* place on that boundary that
 * still holds SUPABASE_SECRET_KEY; the content origin holds no Supabase
 * credential of any kind.
 *
 * Two independent checks, not one: the shared secret proves the caller
 * really is the content-origin deployment, and the forwarded bridge
 * token proves *this specific request* was authorized for *this
 * specific viewer and package* — the content-origin's own token check
 * happens first (fast local rejection before this round trip), but a
 * bug or compromise there must not silently become "serve any package
 * to anyone who can reach content-origin," so this endpoint re-verifies
 * the token itself rather than trusting the caller's earlier check.
 */
export async function POST(request: Request): Promise<Response> {
  const expectedSecret = process.env.CONTENT_BRIDGE_SECRET;
  if (!expectedSecret) {
    return Response.json(
      { error: { code: "NOT_CONFIGURED", message: "CONTENT_BRIDGE_SECRET is not set." } },
      { status: 500 }
    );
  }
  if (request.headers.get("x-bridge-secret") !== expectedSecret) {
    return Response.json({ error: { code: "FORBIDDEN", message: "Invalid bridge secret." } }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token : "";
  const relativePath = typeof body?.path === "string" ? body.path : "";

  const claims = verifyBridgeToken(token);
  if (!claims) {
    return Response.json({ error: { code: "INVALID_TOKEN", message: "Token is missing, expired, or invalid." } }, { status: 401 });
  }

  // Same guard as the browser-facing asset route — a zip entry name
  // containing ".." must not escape the package's own storage prefix.
  if (relativePath.includes("..")) {
    return Response.json({ error: { code: "INVALID_PATH", message: "Path traversal is not allowed." } }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: pkg, error } = await admin
    .from("scorm_packages")
    .select("id, org_id, extracted_prefix")
    .eq("id", claims.packageId)
    .single();

  // The token's own orgId is attacker-supplied at mint time only in the
  // sense that it was chosen by *this app*, never by the content origin
  // or the browser — but checking it against the package's real org_id
  // here costs nothing and means a bug in how the token was minted can
  // never widen into a cross-org read.
  if (error || !pkg || pkg.org_id !== claims.orgId) {
    return Response.json({ error: { code: "NOT_FOUND", message: "No such SCORM package." } }, { status: 404 });
  }

  const { data: blob, error: dlError } = await admin.storage
    .from(BUCKET)
    .download(`${pkg.extracted_prefix}/${relativePath}`);

  if (dlError || !blob) {
    return Response.json({ error: { code: "NOT_FOUND", message: "No such file in this package." } }, { status: 404 });
  }

  return new Response(await blob.arrayBuffer(), {
    status: 200,
    headers: { "Content-Type": contentTypeFor(relativePath) },
  });
}
