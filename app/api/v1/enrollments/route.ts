import { withAuth } from "@/lib/api/with-auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasRole } from "@/lib/auth/roles";
import { logActivity } from "@/lib/activity-log";
import { createEnrollment } from "@/lib/lms/enrollment";

// A learner sees their own enrolments; a manager+ can pass ?scope=org to
// see the whole org's (the team dashboard). RLS enforces both — the
// scope switch only decides which query to issue, never what's allowed.
export const GET = withAuth(async (request, { session }) => {
  const url = new URL(request.url);
  const scope = url.searchParams.get("scope");

  const supabase = await createClient();
  let query = supabase
    .from("enrollments")
    .select("id, user_id, enrollable_type, enrollable_id, enrolled_version, status, enrolled_at, due_date, completed_at")
    .eq("org_id", session.orgId);

  if (scope !== "org") query = query.eq("user_id", session.userId);

  const { data: enrollments, error } = await query.order("enrolled_at", { ascending: false });
  if (error) return errorResponse("QUERY_FAILED", error.message, 500);
  return successResponse({ enrollments: enrollments ?? [] });
});

// Enrol someone. Omitting userId enrols yourself (the learner-facing
// "Enrol" button); passing another userId requires org_admin, checked
// here as well as by RLS.
export const POST = withAuth(async (request, { session }) => {
  if (!session.orgId) {
    return errorResponse("NO_ORG", "You must belong to an organization.", 409);
  }

  const body = await request.json().catch(() => null);
  const courseId = typeof body?.courseId === "string" ? body.courseId : "";
  const targetUserId = typeof body?.userId === "string" ? body.userId : session.userId;
  const dueDate = typeof body?.dueDate === "string" ? body.dueDate : null;

  if (!courseId) return errorResponse("INVALID_INPUT", "courseId is required.", 400);
  if (targetUserId !== session.userId && !hasRole(session.role, "org_admin")) {
    return errorResponse("FORBIDDEN", "Only an org admin can enrol other people.", 403);
  }

  const supabase = await createClient();

  const result = await createEnrollment(supabase, {
    orgId: session.orgId,
    userId: targetUserId,
    courseId,
    dueDate,
    createdBy: session.userId,
  });

  if (!result.ok) {
    if (result.reason === "NOT_FOUND") return errorResponse("NOT_FOUND", "No such course in your organization.", 404);
    if (result.reason === "NOT_PUBLISHED") return errorResponse("NOT_PUBLISHED", "Only published courses can be enrolled into.", 409);
    if (result.reason === "ALREADY_ENROLLED") return errorResponse("ALREADY_ENROLLED", "Already enrolled in this course.", 409);
    return errorResponse("CREATE_FAILED", result.message ?? "Could not create the enrollment.", 500);
  }

  await logActivity(createAdminClient(), {
    orgId: session.orgId,
    actorId: session.userId,
    eventType: "org.enrollment.created",
    entityType: "enrollments",
    entityId: result.enrollmentId,
    metadata: {
      courseId,
      enrolledUser: targetUserId,
      selfEnrolled: targetUserId === session.userId,
    },
  });

  const { data: enrollment } = await supabase
    .from("enrollments")
    .select("id, user_id, enrollable_id, enrolled_version, status, enrolled_at, due_date")
    .eq("id", result.enrollmentId)
    .single();

  return successResponse({ enrollment }, 201);
});
