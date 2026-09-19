import { withAuth } from "@/lib/api/with-auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { mintLaunchToken, launchTokenToAuthHeader } from "@/lib/xapi/launch-token";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Builds everything an ingested xAPI/Tin Can package needs to launch and
 * start reporting to our LRS — the Tin Can/xAPI Launch convention real
 * authoring-tool output (Storyline, Rise, Adapt) reads off its own launch
 * URL's query string. See docs/XAPI_INGEST_ARCHITECTURE.md.
 *
 * Session-authenticated and RLS-scoped exactly like every other route —
 * a learner needs this to play a course they're enrolled in, the same
 * bar the SCORM bridge-token route uses. No minRole.
 */
export const GET = withAuth<Ctx>(async (request, { session, params }) => {
  const { id } = await params;
  const supabase = await createClient();

  const { data: pkg, error } = await supabase
    .from("xapi_packages")
    .select("id, org_id, activity_id, launch_path")
    .eq("id", id)
    .single();

  if (error || !pkg || pkg.org_id !== session.orgId) {
    return errorResponse("NOT_FOUND", "No such xAPI package.", 404);
  }

  // One registration per (user, package) attempt, reused across
  // relaunches so every statement the package emits — and any
  // suspend-data it stores via the State API — lands under the same
  // grouping. xapi_progress has no insert/update policy for a session
  // client (see the migration's rationale: only the LRS routes, via the
  // service role, ever write it), so this upsert has to go through the
  // admin client — justified here because the authorization decision
  // (does this user get to launch this package) was already made above,
  // and the row being created is for session.userId, never client-supplied.
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("xapi_progress")
    .select("registration")
    .eq("user_id", session.userId)
    .eq("xapi_package_id", pkg.id)
    .maybeSingle();

  let registration = existing?.registration ?? crypto.randomUUID();
  if (!existing) {
    const { error: insertError } = await admin.from("xapi_progress").insert({
      org_id: session.orgId,
      user_id: session.userId,
      xapi_package_id: pkg.id,
      registration,
    });
    // 23505 = unique_violation on (user_id, xapi_package_id) — two
    // concurrent launches (e.g. the course open in two tabs) both saw
    // "no existing row" and both tried to create one. Not an error: the
    // other request won, so fetch its registration instead of failing
    // this one.
    if (insertError?.code === "23505") {
      const { data: won } = await admin
        .from("xapi_progress")
        .select("registration")
        .eq("user_id", session.userId)
        .eq("xapi_package_id", pkg.id)
        .single();
      if (won) registration = won.registration;
    } else if (insertError) {
      return errorResponse("CREATE_FAILED", insertError.message, 500);
    }
  }

  const token = mintLaunchToken({
    packageId: pkg.id,
    orgId: session.orgId!,
    userId: session.userId,
    registration,
  });

  const origin = new URL(request.url).origin;
  const endpoint = `${origin}/api/v1/xapi-lrs/`;
  const auth = launchTokenToAuthHeader(token);
  // Account-based actor identification (userId only) rather than mbox —
  // this rides in a URL query string the third-party package's own JS
  // handles, so it's kept to an opaque id rather than the learner's real
  // email (which the native runtime's xapi_statements writer uses
  // instead, over an authenticated POST body, not a URL).
  const actor = { objectType: "Agent", account: { homePage: origin, name: session.userId } };

  const launchUrl = new URL(`${origin}/api/v1/content/xapi/${pkg.id}/assets/${pkg.launch_path}`);
  launchUrl.searchParams.set("endpoint", endpoint);
  launchUrl.searchParams.set("auth", auth);
  launchUrl.searchParams.set("actor", JSON.stringify(actor));
  launchUrl.searchParams.set("registration", registration);
  launchUrl.searchParams.set("activity_id", pkg.activity_id);

  return successResponse({
    packageId: pkg.id,
    registration,
    launchUrl: launchUrl.toString(),
  });
});
