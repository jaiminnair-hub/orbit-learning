import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Learning paths — an ordered sequence of published courses, enrollable as
 * its own unit (`enrollments.enrollable_type = 'learning_path'`, a value
 * reserved since Phase 2 and never used until now).
 *
 * A path's completion is deliberately *not* re-derived from learning
 * objects a second way: it's "N of M courses completed," reading each
 * course's own enrollment status — the same status
 * app/api/v1/progress/route.ts already derives and keeps honest. Two
 * independent notions of "is this course done" for the same learner would
 * drift, the same reasoning lib/lms/course-objects.ts's own header gives
 * for sharing one course→learning-object walk.
 */

export interface PathCourseRef {
  courseId: string;
  sequence: number;
}

/** Ordered course ids for one path, by `learning_path_items.sequence`. */
export async function courseIdsForPath(supabase: SupabaseClient, pathId: string): Promise<string[]> {
  const { data } = await supabase
    .from("learning_path_items")
    .select("course_id")
    .eq("path_id", pathId)
    .order("sequence");
  return (data ?? []).map((row) => row.course_id as string);
}

export type CreatePathEnrollmentResult =
  | { ok: true; enrollmentId: string }
  | { ok: false; reason: "NOT_FOUND" | "NOT_PUBLISHED" | "ALREADY_ENROLLED" | "FAILED"; message?: string };

/** Same shape and error handling as lib/lms/enrollment.ts's createEnrollment
 * — a parallel function, not a generalized one, since a path's "is this
 * valid" check reads a different table (learning_paths, not courses) and
 * the two are unlikely to grow more branches in common than that. */
export async function createLearningPathEnrollment(
  client: SupabaseClient,
  params: { orgId: string; userId: string; pathId: string; dueDate?: string | null; createdBy: string }
): Promise<CreatePathEnrollmentResult> {
  const { data: path } = await client
    .from("learning_paths")
    .select("id, org_id, status, version")
    .eq("id", params.pathId)
    .single();

  if (!path || path.org_id !== params.orgId) {
    return { ok: false, reason: "NOT_FOUND" };
  }
  if (path.status !== "published") {
    return { ok: false, reason: "NOT_PUBLISHED" };
  }

  const { data: enrollment, error } = await client
    .from("enrollments")
    .insert({
      org_id: params.orgId,
      user_id: params.userId,
      enrollable_type: "learning_path",
      enrollable_id: params.pathId,
      enrolled_version: path.version,
      due_date: params.dueDate ?? null,
      created_by: params.createdBy,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") return { ok: false, reason: "ALREADY_ENROLLED" };
    return { ok: false, reason: "FAILED", message: error.message };
  }

  return { ok: true, enrollmentId: enrollment.id };
}

export interface PathProgress {
  totalCourses: number;
  completedCourses: number;
  percent: number;
  /** Whether every course in the path is complete for this learner. */
  isComplete: boolean;
}

/** Reads each constituent course's own enrollment status for this learner —
 * never assumes a course enrollment exists (a path can be assigned before
 * the learner has started any of its courses). */
export async function computePathProgress(
  supabase: SupabaseClient,
  params: { orgId: string; userId: string; pathId: string }
): Promise<PathProgress> {
  const courseIds = await courseIdsForPath(supabase, params.pathId);
  if (courseIds.length === 0) return { totalCourses: 0, completedCourses: 0, percent: 0, isComplete: false };

  const { data: courseEnrollments } = await supabase
    .from("enrollments")
    .select("enrollable_id, status")
    .eq("org_id", params.orgId)
    .eq("user_id", params.userId)
    .eq("enrollable_type", "course")
    .in("enrollable_id", courseIds);

  const statusByCourse = new Map((courseEnrollments ?? []).map((e) => [e.enrollable_id as string, e.status as string]));
  const completedCourses = courseIds.filter((id) => statusByCourse.get(id) === "completed").length;

  return {
    totalCourses: courseIds.length,
    completedCourses,
    percent: Math.round((completedCourses / courseIds.length) * 100),
    isComplete: completedCourses === courseIds.length,
  };
}

/** Called after a course enrollment flips to 'completed' — updates every
 * learning-path enrollment this learner holds that contains that course.
 * A path can contain the same course as another path, so this checks all
 * of the learner's in-progress path enrollments, not just one. */
export async function recomputePathEnrollmentsForCourse(
  supabase: SupabaseClient,
  params: { orgId: string; userId: string; courseId: string }
): Promise<void> {
  const { data: items } = await supabase
    .from("learning_path_items")
    .select("path_id")
    .eq("org_id", params.orgId)
    .eq("course_id", params.courseId);
  const pathIds = [...new Set((items ?? []).map((i) => i.path_id as string))];
  if (pathIds.length === 0) return;

  const { data: pathEnrollments } = await supabase
    .from("enrollments")
    .select("id, enrollable_id, status")
    .eq("org_id", params.orgId)
    .eq("user_id", params.userId)
    .eq("enrollable_type", "learning_path")
    .in("enrollable_id", pathIds)
    .neq("status", "completed");

  for (const enrollment of pathEnrollments ?? []) {
    const progress = await computePathProgress(supabase, {
      orgId: params.orgId,
      userId: params.userId,
      pathId: enrollment.enrollable_id as string,
    });
    await supabase
      .from("enrollments")
      .update({
        status: progress.isComplete ? "completed" : "in_progress",
        completed_at: progress.isComplete ? new Date().toISOString() : null,
      })
      .eq("id", enrollment.id);
  }
}
