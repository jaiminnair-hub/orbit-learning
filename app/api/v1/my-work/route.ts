import { withAuth } from "@/lib/api/with-auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";
import { buildMyWorkRows } from "@/lib/lms/my-work";
import { applyDueReenrollments } from "@/lib/lms/enrollment-rules";

/**
 * A learner's unified worklist — courses and assessments assigned to them,
 * merged into one list. Replaces the course-only /api/v1/my-learning as the
 * dashboard's data source; my-learning stays in place for now since it also
 * backs the manager-scoped completion report's row shape.
 */
export const GET = withAuth(async (_request, { session }) => {
  if (!session.orgId) {
    return errorResponse("NO_ORG", "You must belong to an organization.", 409);
  }

  const supabase = await createClient();

  // Ahead of building the worklist, not after: a rule that fires here
  // must show up in the same response, not a screen behind. Only ever
  // called with the caller's own session client, checking their own
  // work — never from the manager drill-down (app/api/v1/reports/
  // learner/[id]/route.ts), which reuses buildMyWorkRows() to view
  // someone else's list and must stay a pure read.
  await applyDueReenrollments(supabase, { orgId: session.orgId, userId: session.userId });

  const rows = await buildMyWorkRows(supabase, session.orgId, session.userId);

  // A real, separate signal from the worklist above — proof already earned,
  // not work still outstanding. Cheap (head-only count, no row transfer);
  // the dashboard's metrics strip is the first place a learner sees this
  // number without navigating to /certificates.
  const { count: certificateCount } = await supabase
    .from("certificates")
    .select("id", { count: "exact", head: true })
    .eq("org_id", session.orgId)
    .eq("user_id", session.userId);

  return successResponse({ rows, certificateCount: certificateCount ?? 0 });
});
