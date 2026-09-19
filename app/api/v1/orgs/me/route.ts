import { withAuth } from "@/lib/api/with-auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";

// No minRole — any authenticated user can see their own org + role. The
// first real protected route (docs/DEVELOPMENT_SEQUENCE.md step 8),
// proving withAuth() end to end.
export const GET = withAuth(async (_request, { session }) => {
  if (!session.orgId) {
    return successResponse({ org: null, role: session.role });
  }

  const supabase = await createClient();
  const { data: org, error } = await supabase
    .from("organizations")
    .select("id, name, slug, seats, is_active")
    .eq("id", session.orgId)
    .single();

  if (error) {
    return errorResponse("QUERY_FAILED", error.message, 500);
  }

  return successResponse({ org, role: session.role });
});
