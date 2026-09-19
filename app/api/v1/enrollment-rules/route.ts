import { withAuth } from "@/lib/api/with-auth";
import { errorResponse, successResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logActivity } from "@/lib/activity-log";

const VALID_ROLES = ["learner", "manager", "org_admin", "org_owner"];

export const GET = withAuth(
  async (_request, { session }) => {
    const supabase = await createClient();
    const { data: rules, error } = await supabase
      .from("enrollment_rules")
      .select("id, course_id, trigger, role_value, recur_after_days, active, created_at, courses(title)")
      .eq("org_id", session.orgId)
      .order("created_at", { ascending: false });

    if (error) return errorResponse("QUERY_FAILED", error.message, 500);
    return successResponse({ rules: rules ?? [] });
  },
  { minRole: "manager" }
);

/**
 * Automated enrollment rules — item 2 of the comparison-matrix follow-up.
 * Two trigger shapes deliberately, not a general rule-engine: `on_join`
 * (every new member) and `role_equals` (a specific role). See
 * lib/lms/enrollment-rules.ts for where these actually get applied.
 */
export const POST = withAuth(
  async (request, { session }) => {
    if (!session.orgId) return errorResponse("NO_ORG", "You must belong to an organization.", 409);

    const body = await request.json().catch(() => null);
    const courseId = typeof body?.courseId === "string" ? body.courseId : "";
    const trigger = body?.trigger === "role_equals" ? "role_equals" : body?.trigger === "on_join" ? "on_join" : "";
    const roleValue = typeof body?.roleValue === "string" ? body.roleValue : null;
    const recurAfterDays =
      typeof body?.recurAfterDays === "number" && body.recurAfterDays > 0 ? Math.floor(body.recurAfterDays) : null;

    if (!courseId) return errorResponse("INVALID_INPUT", "Choose a course.", 400);
    if (!trigger) return errorResponse("INVALID_INPUT", "Choose when this rule applies.", 400);
    if (trigger === "role_equals" && !VALID_ROLES.includes(roleValue ?? "")) {
      return errorResponse("INVALID_INPUT", "Choose a valid role.", 400);
    }

    const supabase = await createClient();
    const { data: course } = await supabase
      .from("courses")
      .select("id, status")
      .eq("id", courseId)
      .eq("org_id", session.orgId)
      .single();
    if (!course) return errorResponse("NOT_FOUND", "No such course in your organization.", 404);
    if (course.status !== "published") {
      return errorResponse("NOT_PUBLISHED", "Only a published course can have an enrollment rule.", 409);
    }

    const { data: rule, error } = await supabase
      .from("enrollment_rules")
      .insert({
        org_id: session.orgId,
        course_id: courseId,
        trigger,
        role_value: trigger === "role_equals" ? roleValue : null,
        recur_after_days: recurAfterDays,
        created_by: session.userId,
      })
      .select("id, course_id, trigger, role_value, recur_after_days, active, created_at")
      .single();

    if (error) return errorResponse("CREATE_FAILED", error.message, 500);

    await logActivity(createAdminClient(), {
      orgId: session.orgId,
      actorId: session.userId,
      eventType: "org.enrollment_rule.created",
      entityType: "enrollment_rules",
      entityId: rule.id,
      metadata: { courseId, trigger, roleValue, recurAfterDays },
    });

    return successResponse({ rule }, 201);
  },
  { minRole: "org_admin" }
);
