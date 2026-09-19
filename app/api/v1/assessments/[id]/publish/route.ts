import { withAuth } from "@/lib/api/with-auth";
import { errorResponse, successResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logActivity } from "@/lib/activity-log";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withAuth<Ctx>(async (_request, { session, params }) => {
  const { id } = await params;
  const supabase = await createClient();
  const { data: assessment } = await supabase.from("assessments")
    .select("id, status").eq("id", id).eq("org_id", session.orgId).single();
  if (!assessment) return errorResponse("NOT_FOUND", "Assessment not found.", 404);
  if (assessment.status !== "draft") return errorResponse("NOT_EDITABLE", "Only a draft can be published.", 409);
  const { count, error: countError } = await supabase.from("assessment_questions")
    .select("id", { count: "exact", head: true }).eq("assessment_id", id);
  if (countError) return errorResponse("QUERY_FAILED", countError.message, 500);
  if (!count) return errorResponse("NO_QUESTIONS", "Add at least one question before publishing.", 409);
  const { data, error } = await supabase.from("assessments").update({ status: "published" }).eq("id", id)
    .select("id, title, status, pass_percent, max_attempts").single();
  if (error) return errorResponse("PUBLISH_FAILED", error.message, 500);

  await logActivity(createAdminClient(), {
    orgId: session.orgId,
    actorId: session.userId,
    eventType: "org.assessment.published",
    entityType: "assessments",
    entityId: id,
    metadata: { title: data.title, questionCount: count },
  });

  return successResponse({ assessment: data });
}, { minRole: "org_admin" });
