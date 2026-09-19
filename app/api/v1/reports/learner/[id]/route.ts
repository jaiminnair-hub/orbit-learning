import { withAuth } from "@/lib/api/with-auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";
import { buildMyWorkRows } from "@/lib/lms/my-work";

/**
 * One learner's full worklist (courses + assessments), for the Assign &
 * Track drill-down — the same buildMyWorkRows() the learner's own
 * /api/v1/my-work uses, so a manager sees exactly what that person sees.
 * manager+ only; RLS still scopes the underlying tables to the caller's org.
 */
export const GET = withAuth<{ params: Promise<{ id: string }> }>(
  async (_request, { session, params }) => {
    if (!session.orgId) {
      return errorResponse("NO_ORG", "You must belong to an organization.", 409);
    }
    const { id } = await params;

    const supabase = await createClient();
    const { data: learner, error } = await supabase
      .from("profiles")
      .select("id, email, full_name")
      .eq("id", id)
      .eq("org_id", session.orgId)
      .is("deleted_at", null)
      .single();

    if (error || !learner) {
      return errorResponse("NOT_FOUND", "No such member in your organization.", 404);
    }

    const rows = await buildMyWorkRows(supabase, session.orgId, id);
    return successResponse({ learner, rows });
  },
  { minRole: "manager" }
);
