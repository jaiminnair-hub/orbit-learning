import { withAuth } from "@/lib/api/with-auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";

const COLUMNS = "id, org_id, name, description, external_ref, created_at, updated_at";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withAuth<Ctx>(
  async (request, { session, params }) => {
    const { id } = await params;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return errorResponse("INVALID_INPUT", "A request body is required.", 400);
    }

    const supabase = await createClient();
    const { data: existing } = await supabase
      .from("skill_tags")
      .select("id, org_id")
      .eq("id", id)
      .single();

    if (!existing || existing.org_id !== session.orgId) {
      return errorResponse("NOT_FOUND", "No such skill tag in your organization.", 404);
    }

    const update: Record<string, unknown> = {};
    if (typeof body.name === "string" && body.name.trim()) update.name = body.name.trim();
    if (typeof body.description === "string") update.description = body.description.trim() || null;
    if (typeof body.externalRef === "string") update.external_ref = body.externalRef.trim() || null;

    if (Object.keys(update).length === 0) {
      return errorResponse("INVALID_INPUT", "Nothing to update.", 400);
    }

    const { data, error } = await supabase
      .from("skill_tags")
      .update(update)
      .eq("id", id)
      .eq("org_id", session.orgId)
      .select(COLUMNS)
      .single();

    if (error) {
      if (error.code === "23505") {
        return errorResponse("ALREADY_EXISTS", "Another skill tag already has that name.", 409);
      }
      return errorResponse("UPDATE_FAILED", error.message, 500);
    }
    return successResponse({ skillTag: data });
  },
  { minRole: "org_admin" }
);

/**
 * Hard delete, unlike most content in this codebase.
 *
 * A skill tag carries no content of its own — it is a label. Specifications
 * reference it by id inside their `spec` jsonb, which no foreign key can
 * reach, so deleting one leaves dangling ids in any course that used it. That
 * is tolerable for a label and is why `skillTagIds` is validated as a plain
 * uuid array rather than a referential constraint: a course keeps working,
 * it simply stops showing a tag that no longer exists.
 *
 * When Competency Management owns the canonical taxonomy this becomes its
 * decision rather than the LMS's.
 */
export const DELETE = withAuth<Ctx>(
  async (_request, { session, params }) => {
    const { id } = await params;
    const supabase = await createClient();

    const { data: existing } = await supabase
      .from("skill_tags")
      .select("id, org_id")
      .eq("id", id)
      .single();

    if (!existing || existing.org_id !== session.orgId) {
      return errorResponse("NOT_FOUND", "No such skill tag in your organization.", 404);
    }

    const { error } = await supabase.from("skill_tags").delete().eq("id", id).eq("org_id", session.orgId);
    if (error) return errorResponse("DELETE_FAILED", error.message, 500);
    return successResponse({ deleted: true });
  },
  { minRole: "org_admin" }
);
