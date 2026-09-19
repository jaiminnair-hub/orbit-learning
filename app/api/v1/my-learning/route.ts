import { withAuth } from "@/lib/api/with-auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";
import { buildCompletionRows, emptySummary, summarize } from "@/lib/lms/completion";

/**
 * A learner's own assignments — what they have been given, what is due,
 * and how far they have got.
 *
 * Deliberately a separate route from the manager's report rather than a
 * `scope` parameter on it: the report is manager+, and adding a mode that
 * drops that gate would make the role check depend on a query string.
 * Both compute rows through the same function, so the number a learner
 * sees is the same number their manager sees.
 */
export const GET = withAuth(async (_request, { session }) => {
  if (!session.orgId) {
    return errorResponse("NO_ORG", "You must belong to an organization.", 409);
  }

  const supabase = await createClient();
  const rows = await buildCompletionRows(supabase, session.orgId, { userId: session.userId });

  if (!rows.length) return successResponse({ rows: [], summary: emptySummary() });
  return successResponse({ rows, summary: summarize(rows) });
});
