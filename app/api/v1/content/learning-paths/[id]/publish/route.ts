import { withAuth } from "@/lib/api/with-auth";
import { errorResponse, successResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logActivity } from "@/lib/activity-log";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withAuth<Ctx>(async (_request, { session, params }) => {
  const { id } = await params;
  const supabase = await createClient();
  const { data: path } = await supabase.from("learning_paths").select("id, title, status").eq("id", id).eq("org_id", session.orgId).single();
  if (!path) return errorResponse("NOT_FOUND", "Learning path not found.", 404);
  if (path.status !== "draft") return errorResponse("NOT_EDITABLE", "Only a draft can be published.", 409);

  const { count, error: countError } = await supabase.from("learning_path_items").select("id", { count: "exact", head: true }).eq("path_id", id);
  if (countError) return errorResponse("QUERY_FAILED", countError.message, 500);
  if (!count) return errorResponse("NO_COURSES", "Add at least one course before publishing.", 409);

  const { data, error } = await supabase.from("learning_paths").update({ status: "published" }).eq("id", id)
    .select("id, title, status, version").single();
  if (error) return errorResponse("PUBLISH_FAILED", error.message, 500);

  await logActivity(createAdminClient(), {
    orgId: session.orgId,
    actorId: session.userId,
    eventType: "org.learning_path.published",
    entityType: "learning_paths",
    entityId: id,
    metadata: { title: data.title, courseCount: count },
  });

  return successResponse({ learningPath: data });
}, { minRole: "org_admin" });
