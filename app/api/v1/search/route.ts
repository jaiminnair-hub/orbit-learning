import { withAuth } from "@/lib/api/with-auth";
import { errorResponse, successResponse } from "@/lib/api/response";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { searchLearnerWorkspace } from "@/lib/search/learner-search";

export const GET = withAuth(async (request, { session }) => {
  if (!session.orgId) return errorResponse("NO_ORG", "You must belong to an organization.", 409);
  const query = (new URL(request.url).searchParams.get("q") ?? "").trim();
  if (query.length < 2 || query.length > 100) {
    return errorResponse("INVALID_QUERY", "Search must be between 2 and 100 characters.", 400);
  }
  try {
    const results = await searchLearnerWorkspace(await createClient(), createAdminClient(), {
      orgId: session.orgId,
      userId: session.userId,
      query,
    });
    return successResponse({ query, results, count: results.length });
  } catch (error) {
    return errorResponse("SEARCH_FAILED", error instanceof Error ? error.message : "Search failed.", 500);
  }
});
