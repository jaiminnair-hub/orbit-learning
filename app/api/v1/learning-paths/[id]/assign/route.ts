import { withAuth } from "@/lib/api/with-auth";
import { errorResponse, successResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logActivity } from "@/lib/activity-log";
import { createLearningPathEnrollment } from "@/lib/lms/learning-paths";

type Ctx = { params: Promise<{ id: string }> };

const REASON_STATUS = { NOT_FOUND: 404, NOT_PUBLISHED: 409, ALREADY_ENROLLED: 409, FAILED: 500 } as const;
const REASON_MESSAGE = {
  NOT_FOUND: "No such learning path in your organization.",
  NOT_PUBLISHED: "Publish this learning path before assigning it.",
  ALREADY_ENROLLED: "This person is already enrolled in this learning path.",
  FAILED: "Could not assign the learning path.",
} as const;

export const POST = withAuth<Ctx>(async (request, { session, params }) => {
  if (!session.orgId) return errorResponse("NO_ORG", "You must belong to an organization.", 409);
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const userId = typeof body?.userId === "string" ? body.userId : "";
  const dueDate = typeof body?.dueDate === "string" && body.dueDate ? body.dueDate : null;
  if (!userId) return errorResponse("INVALID_INPUT", "Choose a person to assign.", 400);

  const supabase = await createClient();
  const { data: person } = await supabase.from("profiles").select("id").eq("id", userId).eq("org_id", session.orgId).is("deleted_at", null).single();
  if (!person) return errorResponse("NOT_FOUND", "That person is not in this organization.", 404);

  const result = await createLearningPathEnrollment(supabase, { orgId: session.orgId, userId, pathId: id, dueDate, createdBy: session.userId });
  if (!result.ok) {
    return errorResponse(result.reason, result.message ?? REASON_MESSAGE[result.reason], REASON_STATUS[result.reason]);
  }

  await logActivity(createAdminClient(), {
    orgId: session.orgId,
    actorId: session.userId,
    eventType: "org.learning_path.assigned",
    entityType: "enrollments",
    entityId: result.enrollmentId,
    metadata: { pathId: id, assignedTo: userId, dueDate },
  });

  return successResponse({ enrollmentId: result.enrollmentId }, 201);
}, { minRole: "org_admin" });
