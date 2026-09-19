import { withAuth } from "@/lib/api/with-auth";
import { errorResponse, successResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logActivity } from "@/lib/activity-log";
import { sendAssessmentAssignedEmail } from "@/lib/notifications";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withAuth<Ctx>(async (request, { session, params }) => {
  if (!session.orgId) return errorResponse("NO_ORG", "You must belong to an organization.", 409);
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const userId = typeof body?.userId === "string" ? body.userId : "";
  const dueDate = typeof body?.dueDate === "string" && body.dueDate ? body.dueDate : null;
  if (!userId) return errorResponse("INVALID_INPUT", "Choose a person to assess.", 400);
  const supabase = await createClient();
  const { data: assessment } = await supabase.from("assessments")
    .select("id, status, title").eq("id", id).eq("org_id", session.orgId).single();
  if (!assessment) return errorResponse("NOT_FOUND", "Assessment not found.", 404);
  if (assessment.status !== "published") return errorResponse("NOT_PUBLISHED", "Publish this assessment before assigning it.", 409);
  const { data: person } = await supabase.from("profiles").select("id, email, full_name").eq("id", userId).eq("org_id", session.orgId).is("deleted_at", null).single();
  if (!person) return errorResponse("NOT_FOUND", "That person is not in this organization.", 404);
  const { data, error } = await supabase.from("assessment_assignments").upsert({
    org_id: session.orgId, assessment_id: id, user_id: userId, due_date: dueDate, assigned_by: session.userId,
  }, { onConflict: "assessment_id,user_id" }).select("id, user_id, due_date, status, assigned_at").single();
  if (error) return errorResponse("ASSIGN_FAILED", error.message, 500);

  const admin = createAdminClient();
  await logActivity(admin, {
    orgId: session.orgId,
    actorId: session.userId,
    eventType: "org.assessment.assigned",
    entityType: "assessment_assignments",
    entityId: data.id,
    metadata: { assessmentId: id, assignedTo: userId, dueDate },
  });
  const notification = await sendAssessmentAssignedEmail(admin, {
    orgId: session.orgId, assignmentId: data.id, assessmentId: assessment.id,
    recipient: { userId: person.id, email: person.email, name: person.full_name }, assessmentTitle: assessment.title, dueDate,
  });

  return successResponse({ assignment: data, notification }, 201);
}, { minRole: "org_admin" });
