import { withAuth } from "@/lib/api/with-auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";
import { learningObjectIdsForCourse as objectIdsForCourse } from "@/lib/lms/course-objects";
import { issueCertificate } from "@/lib/certificates/issue";
import { recomputePathEnrollmentsForCourse } from "@/lib/lms/learning-paths";

const VALID = ["not_started", "in_progress", "completed"];

export const GET = withAuth(async (request, { session }) => {
  const url = new URL(request.url);
  const courseId = url.searchParams.get("courseId");

  const supabase = await createClient();

  if (!courseId) {
    const { data, error } = await supabase
      .from("progress")
      .select("learning_object_id, status, score, time_spent_sec, completed_at")
      .eq("org_id", session.orgId)
      .eq("user_id", session.userId);
    if (error) return errorResponse("QUERY_FAILED", error.message, 500);
    return successResponse({ progress: data ?? [] });
  }

  const objectIds = await learningObjectIdsForCourse(supabase, courseId, session.orgId!);
  if (objectIds === null) {
    return errorResponse("NOT_FOUND", "No such course in your organization.", 404);
  }

  const { data: rows, error } = objectIds.length
    ? await supabase
        .from("progress")
        .select("learning_object_id, status, score, time_spent_sec, completed_at")
        .eq("org_id", session.orgId)
        .eq("user_id", session.userId)
        .in("learning_object_id", objectIds)
    : { data: [], error: null };

  if (error) return errorResponse("QUERY_FAILED", error.message, 500);

  const completed = (rows ?? []).filter((r) => r.status === "completed").length;
  return successResponse({
    progress: rows ?? [],
    summary: {
      total: objectIds.length,
      completed,
      percent: objectIds.length ? Math.round((completed / objectIds.length) * 100) : 0,
    },
  });
});

// Records progress on one learning object, then derives whether the
// enclosing course is now complete. Completion is *derived* from the
// learning objects rather than self-reported, so a client can't mark a
// course complete without actually finishing its parts.
export const PUT = withAuth(async (request, { session }) => {
  const body = await request.json().catch(() => null);
  const learningObjectId =
    typeof body?.learningObjectId === "string" ? body.learningObjectId : "";
  const status = typeof body?.status === "string" ? body.status : "";
  const courseId = typeof body?.courseId === "string" ? body.courseId : null;
  const score = typeof body?.score === "number" ? body.score : null;
  // progress.time_spent_sec is an integer column, but callers like the
  // SCORM player report elapsed time with sub-second precision (e.g.
  // 360.49) — round rather than reject, same fix already applied to the
  // SCORM-specific progress route for the same reason.
  const timeSpentSec = typeof body?.timeSpentSec === "number" ? Math.round(body.timeSpentSec) : 0;

  if (!learningObjectId) return errorResponse("INVALID_INPUT", "learningObjectId is required.", 400);
  if (!VALID.includes(status)) return errorResponse("INVALID_INPUT", "Invalid progress status.", 400);

  const supabase = await createClient();

  const { data: lo } = await supabase
    .from("learning_objects")
    .select("id, org_id")
    .eq("id", learningObjectId)
    .single();
  if (!lo || lo.org_id !== session.orgId) {
    return errorResponse("NOT_FOUND", "No such learning object.", 404);
  }

  let enrollmentId: string | null = null;
  if (courseId) {
    const { data: enr } = await supabase
      .from("enrollments")
      .select("id")
      .eq("org_id", session.orgId)
      .eq("user_id", session.userId)
      .eq("enrollable_type", "course")
      .eq("enrollable_id", courseId)
      .maybeSingle();
    enrollmentId = enr?.id ?? null;
  }

  const { data: saved, error } = await supabase
    .from("progress")
    .upsert(
      {
        org_id: session.orgId,
        user_id: session.userId,
        learning_object_id: learningObjectId,
        enrollment_id: enrollmentId,
        status,
        score,
        time_spent_sec: timeSpentSec,
        completed_at: status === "completed" ? new Date().toISOString() : null,
      },
      { onConflict: "org_id,user_id,learning_object_id" }
    )
    .select("learning_object_id, status, score, time_spent_sec, completed_at")
    .single();

  if (error) return errorResponse("SAVE_FAILED", error.message, 500);

  let courseCompleted = false;
  if (courseId && enrollmentId) {
    const objectIds = await learningObjectIdsForCourse(supabase, courseId, session.orgId!);
    if (objectIds && objectIds.length) {
      const { data: done } = await supabase
        .from("progress")
        .select("learning_object_id")
        .eq("org_id", session.orgId)
        .eq("user_id", session.userId)
        .eq("status", "completed")
        .in("learning_object_id", objectIds);

      courseCompleted = (done ?? []).length === objectIds.length;

      await supabase
        .from("enrollments")
        .update({
          status: courseCompleted ? "completed" : "in_progress",
          completed_at: courseCompleted ? new Date().toISOString() : null,
        })
        .eq("id", enrollmentId);

      // A path enrollment's own completion is derived from its courses',
      // never re-walked from learning objects a second way — see
      // lib/lms/learning-paths.ts's header. Only worth checking once this
      // course itself just became complete or incomplete.
      if (courseCompleted) {
        await recomputePathEnrollmentsForCourse(supabase, { orgId: session.orgId!, userId: session.userId, courseId });
      }
    }
  }

  // This branch runs on every PUT once a course is done, not only the
  // first time it flips — issueCertificate's check-then-insert is what
  // keeps that cheap and idempotent.
  let certificateId: string | null = null;
  if (courseCompleted && courseId) {
    const [{ data: course }, { data: profile }] = await Promise.all([
      supabase.from("courses").select("title").eq("id", courseId).single(),
      supabase.from("profiles").select("full_name").eq("id", session.userId).single(),
    ]);
    certificateId = await issueCertificate({
      orgId: session.orgId!,
      userId: session.userId,
      sourceType: "course",
      sourceId: courseId,
      title: course?.title ?? "Course",
      recipientName: profile?.full_name?.trim() || session.email,
      scorePercent: null,
    });
  }

  return successResponse({ progress: saved, courseCompleted, certificateId });
});

// Ownership check plus the shared course walk. The walk itself now lives
// in lib/lms/course-objects.ts because reporting needs the same answer —
// two implementations of "what is in this course" would drift into two
// different completion percentages for the same learner.
async function learningObjectIdsForCourse(
  supabase: Awaited<ReturnType<typeof createClient>>,
  courseId: string,
  orgId: string
): Promise<string[] | null> {
  const { data: course } = await supabase
    .from("courses")
    .select("id, org_id")
    .eq("id", courseId)
    .single();
  if (!course || course.org_id !== orgId) return null;

  return objectIdsForCourse(supabase, courseId);
}
