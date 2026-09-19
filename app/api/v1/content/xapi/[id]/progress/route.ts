import { withAuth } from "@/lib/api/with-auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";

type Ctx = { params: Promise<{ id: string }> };

// Read-only: XapiPlayer polls this while a launched package's iframe is
// open to learn when the package itself POSTed a completed/passed/failed
// statement to the LRS route — the write side of xapi_progress belongs
// entirely to app/api/v1/xapi-lrs/statements/route.ts (via the service
// role, per the migration's RLS note), never to a session-authenticated
// route.
export const GET = withAuth<Ctx>(async (_request, { session, params }) => {
  const { id } = await params;
  const supabase = await createClient();

  const { data: progress, error } = await supabase
    .from("xapi_progress")
    .select("registration, lesson_status, score_raw, completed_at")
    .eq("xapi_package_id", id)
    .eq("user_id", session.userId)
    .maybeSingle();

  if (error) return errorResponse("QUERY_FAILED", error.message, 500);
  return successResponse({ progress: progress ?? null });
});
