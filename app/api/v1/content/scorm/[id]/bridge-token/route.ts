import { withAuth } from "@/lib/api/with-auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";
import { mintBridgeToken } from "@/lib/scorm/bridge-token";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Mints the short-lived token that authorizes the SCORM content-origin
 * bridge to serve one package to the caller (docs/
 * SCORM_CONTENT_ISOLATION_ARCHITECTURE.md). Session-authenticated and
 * RLS-scoped exactly like every other route — the isolation this token
 * enables starts *after* the normal authorization check, not instead of
 * it.
 *
 * No minRole: a learner needs this to play a course they're enrolled in,
 * the same bar the existing same-origin asset route uses.
 */
export const GET = withAuth<Ctx>(async (_request, { session, params }) => {
  const { id } = await params;
  const supabase = await createClient();

  const { data: pkg, error } = await supabase
    .from("scorm_packages")
    .select("id, org_id, scorm_version, entry_point")
    .eq("id", id)
    .single();

  if (error || !pkg || pkg.org_id !== session.orgId) {
    return errorResponse("NOT_FOUND", "No such SCORM package.", 404);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", session.userId)
    .maybeSingle();

  const token = mintBridgeToken({
    packageId: pkg.id,
    orgId: session.orgId!,
    userId: session.userId,
    // Looked up server-side rather than trusted from the client — this
    // ends up inside the token a third-party origin will read.
    userName: profile?.full_name || session.email,
    scormVersion: pkg.scorm_version === "1.2" ? "1.2" : "2004",
    entryPoint: pkg.entry_point,
  });

  return successResponse({ token });
});
