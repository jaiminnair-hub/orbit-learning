import { withAuth } from "@/lib/api/with-auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withAuth<Ctx>(
  async (_request, { session, params }) => {
    const { id } = await params;
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("course_templates")
      .select("id, org_id, name, description, thumbnail_asset_id, spec, spec_schema_version, status, version")
      .eq("id", id)
      .is("deleted_at", null)
      .single();

    if (error || !data || data.org_id !== session.orgId) {
      return errorResponse("NOT_FOUND", "No such template in your organization.", 404);
    }
    return successResponse({ template: data });
  },
  { minRole: "org_admin" }
);

/** Soft delete — templates are referenced by nothing, but §8's rule is uniform. */
export const DELETE = withAuth<Ctx>(
  async (_request, { session, params }) => {
    const { id } = await params;
    const supabase = await createClient();
    const { data } = await supabase
      .from("course_templates")
      .select("id, org_id")
      .eq("id", id)
      .is("deleted_at", null)
      .single();

    if (!data || data.org_id !== session.orgId) {
      return errorResponse("NOT_FOUND", "No such template in your organization.", 404);
    }

    const { error } = await supabase
      .from("course_templates")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .eq("org_id", session.orgId);

    if (error) return errorResponse("DELETE_FAILED", error.message, 500);
    return successResponse({ deleted: true });
  },
  { minRole: "org_admin" }
);
