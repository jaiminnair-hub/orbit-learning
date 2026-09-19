import { withAuth } from "@/lib/api/with-auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";
import { hasRole } from "@/lib/auth/roles";

type Ctx = { params: Promise<{ specId: string }> };

// Serves the course specification the runtime interpreter plays — per
// docs/PHASE3_API_EVENTS.md §5. No minRole: any org member (a learner)
// must be able to reach this. RLS on course_specifications scopes it to
// the caller's org; a spec in another org resolves to 404, never a body.
//
// Only a published spec is servable to a plain learner. An author
// previewing a draft passes ?preview=true, honoured only when the caller
// also passes the org_admin check — a learner cannot get an unpublished
// draft by adding a query parameter.
export const GET = withAuth<Ctx>(async (request, { session, params }) => {
  const { specId } = await params;
  const url = new URL(request.url);
  const preview = url.searchParams.get("preview") === "true";

  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("course_specifications")
    .select("id, org_id, title, spec, spec_schema_version, status, version")
    .eq("id", specId)
    .is("deleted_at", null)
    .single();

  if (error || !row || row.org_id !== session.orgId) {
    return errorResponse("NOT_FOUND", "No such course specification.", 404);
  }

  if (row.status !== "published" && !(preview && hasRole(session.role, "org_admin"))) {
    return errorResponse("NOT_PUBLISHED", "This course is not published.", 403);
  }

  return successResponse({
    id: row.id,
    title: row.title,
    spec: row.spec,
    specSchemaVersion: row.spec_schema_version,
    status: row.status,
    version: row.version,
  });
});
