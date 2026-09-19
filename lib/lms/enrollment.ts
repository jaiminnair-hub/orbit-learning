import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The one real "enrol someone in a course" operation, extracted so the
 * manual route (app/api/v1/enrollments/route.ts) and the automated rule
 * paths (lib/lms/enrollment-rules.ts) can't drift into two different
 * ideas of what a valid enrollment is — same published-course check, same
 * version pin, same duplicate handling.
 */
export type CreateEnrollmentResult =
  | { ok: true; enrollmentId: string }
  | { ok: false; reason: "NOT_FOUND" | "NOT_PUBLISHED" | "ALREADY_ENROLLED" | "FAILED"; message?: string };

export async function createEnrollment(
  client: SupabaseClient,
  params: { orgId: string; userId: string; courseId: string; dueDate?: string | null; createdBy: string }
): Promise<CreateEnrollmentResult> {
  const { data: course } = await client
    .from("courses")
    .select("id, org_id, status, version")
    .eq("id", params.courseId)
    .single();

  if (!course || course.org_id !== params.orgId) {
    return { ok: false, reason: "NOT_FOUND" };
  }
  if (course.status !== "published") {
    return { ok: false, reason: "NOT_PUBLISHED" };
  }

  const { data: enrollment, error } = await client
    .from("enrollments")
    .insert({
      org_id: params.orgId,
      user_id: params.userId,
      enrollable_type: "course",
      enrollable_id: params.courseId,
      enrolled_version: course.version,
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
