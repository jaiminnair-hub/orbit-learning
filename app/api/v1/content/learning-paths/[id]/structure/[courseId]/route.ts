import { withAuth } from "@/lib/api/with-auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";

type Ctx = { params: Promise<{ id: string; courseId: string }> };

export const DELETE = withAuth<Ctx>(
  async (_request, { session, params }) => {
    const { id, courseId } = await params;
    const supabase = await createClient();

    const { data: path } = await supabase.from("learning_paths").select("id, org_id, status").eq("id", id).single();
    if (!path || path.org_id !== session.orgId) return errorResponse("NOT_FOUND", "No such learning path.", 404);
    if (path.status !== "draft") return errorResponse("NOT_EDITABLE", "Only a draft path can be changed.", 409);

    const { error } = await supabase.from("learning_path_items").delete().eq("path_id", id).eq("course_id", courseId);
    if (error) return errorResponse("REMOVE_FAILED", error.message, 500);
    return successResponse({ removed: true });
  },
  { minRole: "org_admin" }
);
