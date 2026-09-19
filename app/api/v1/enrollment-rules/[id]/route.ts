import { withAuth } from "@/lib/api/with-auth";
import { errorResponse, successResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logActivity } from "@/lib/activity-log";

type Ctx = { params: Promise<{ id: string }> };

export const DELETE = withAuth<Ctx>(
  async (_request, { session, params }) => {
    const { id } = await params;
    const supabase = await createClient();

    const { data: existing } = await supabase
      .from("enrollment_rules")
      .select("id")
      .eq("id", id)
      .eq("org_id", session.orgId)
      .single();
    if (!existing) return errorResponse("NOT_FOUND", "No such enrollment rule.", 404);

    const { error } = await supabase.from("enrollment_rules").delete().eq("id", id);
    if (error) return errorResponse("DELETE_FAILED", error.message, 500);

    await logActivity(createAdminClient(), {
      orgId: session.orgId,
      actorId: session.userId,
      eventType: "org.enrollment_rule.deleted",
      entityType: "enrollment_rules",
      entityId: id,
    });

    return successResponse({ deleted: true });
  },
  { minRole: "org_admin" }
);
