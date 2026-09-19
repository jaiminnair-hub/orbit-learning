import { withAuth } from "@/lib/api/with-auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";
import { buildCompletionRows, emptySummary, summarize } from "@/lib/lms/completion";

/**
 * The completion report — who was assigned what, and how far they got.
 *
 * This is the question an organisation buys an LMS to answer, and until
 * now nothing in the product could answer it: progress existed per
 * learner in the player sidebar and nowhere else.
 *
 * manager+ only. RLS on enrollments and progress already restricts a
 * learner to their own rows, so the role gate here is about not offering
 * a surface that would return a single useless row rather than about
 * being the thing that protects the data.
 */
export const GET = withAuth(
  async (request, { session }) => {
    if (!session.orgId) {
      return errorResponse("NO_ORG", "You must belong to an organization.", 409);
    }

    const url = new URL(request.url);
    const supabase = await createClient();

    const rows = await buildCompletionRows(supabase, session.orgId, {
      courseId: url.searchParams.get("courseId"),
      status: url.searchParams.get("status"),
    });

    if (!rows.length) return successResponse({ rows: [], summary: emptySummary() });
    return successResponse({ rows, summary: summarize(rows) });
  },
  { minRole: "manager" }
);
