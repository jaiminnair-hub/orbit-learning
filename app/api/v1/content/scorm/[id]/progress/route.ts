import { withAuth } from "@/lib/api/with-auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";

const VALID_STATUSES = [
  "not attempted",
  "incomplete",
  "completed",
  "passed",
  "failed",
  "browsed",
];

// The SCORM runtime's persistence endpoint — the learner's own client
// writes here as the course reports CMI values. No minRole: a learner
// must be able to record their own progress. RLS
// (scorm_progress_insert/_update, scoped to user_id = auth.uid()) is what
// guarantees they can only ever write their own row, so this route
// doesn't need to re-derive that.
type Ctx = { params: Promise<{ id: string }> };

export const GET = withAuth<Ctx>(async (_request, { session, params }) => {
  const { id } = await params;
  const supabase = await createClient();

  const { data: progress, error } = await supabase
    .from("scorm_progress")
    .select("cmi_data, lesson_status, score_raw, total_time_sec, completed_at")
    .eq("scorm_package_id", id)
    .eq("user_id", session.userId)
    .maybeSingle();

  if (error) return errorResponse("QUERY_FAILED", error.message, 500);
  return successResponse({ progress: progress ?? null });
});

export const PUT = withAuth<Ctx>(async (request, { session, params }) => {
  const { id } = await params;

  const body = await request.json().catch(() => null);
  const cmiData = body?.cmiData && typeof body.cmiData === "object" ? body.cmiData : {};
  const lessonStatus = typeof body?.lessonStatus === "string" ? body.lessonStatus : "incomplete";
  const scoreRaw = typeof body?.scoreRaw === "number" ? body.scoreRaw : null;
  // total_time_sec is an integer column, but the SCORM adapter reports
  // elapsed time with sub-second precision (e.g. 82.31) — round rather
  // than reject, since a fractional second lost here is not meaningful.
  const totalTimeSec =
    typeof body?.totalTimeSec === "number" ? Math.round(body.totalTimeSec) : 0;

  if (!VALID_STATUSES.includes(lessonStatus)) {
    return errorResponse("INVALID_INPUT", "Invalid lesson status.", 400);
  }

  const supabase = await createClient();

  // Confirm the package is visible to this user's org before recording
  // progress against it — RLS would deny the write anyway, but a clean
  // 404 beats a confusing constraint error.
  const { data: pkg } = await supabase
    .from("scorm_packages")
    .select("id, org_id")
    .eq("id", id)
    .single();

  if (!pkg || pkg.org_id !== session.orgId) {
    return errorResponse("NOT_FOUND", "No such SCORM package.", 404);
  }

  const isComplete = ["completed", "passed", "failed"].includes(lessonStatus);

  const { data: progress, error } = await supabase
    .from("scorm_progress")
    .upsert(
      {
        org_id: session.orgId,
        user_id: session.userId,
        scorm_package_id: id,
        cmi_data: cmiData,
        lesson_status: lessonStatus,
        score_raw: scoreRaw,
        total_time_sec: totalTimeSec,
        completed_at: isComplete ? new Date().toISOString() : null,
      },
      { onConflict: "user_id,scorm_package_id" }
    )
    .select("cmi_data, lesson_status, score_raw, total_time_sec, completed_at")
    .single();

  if (error) return errorResponse("SAVE_FAILED", error.message, 500);
  return successResponse({ progress });
});

// navigator.sendBeacon can only issue POST, and a learner closing the tab
// mid-course is exactly when the final CMI state matters most. Same
// handler, different verb.
export const POST = PUT;
