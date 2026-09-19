import { withAuth } from "@/lib/api/with-auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";

// minRole: manager — exercises the 403 branch of withAuth() (a learner is
// rejected before this handler or RLS ever runs). RLS (profiles_select)
// still scopes the actual rows to the caller's own org regardless.
export const GET = withAuth(
  async (_request, { session }) => {
    const supabase = await createClient();
    const { data: members, error } = await supabase
      .from("profiles")
      .select("id, email, full_name, role, department_id, status")
      .eq("org_id", session.orgId)
      .is("deleted_at", null);

    if (error) {
      return errorResponse("QUERY_FAILED", error.message, 500);
    }

    return successResponse({ members: members ?? [] });
  },
  { minRole: "manager" }
);
