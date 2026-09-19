import { withAuth } from "@/lib/api/with-auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";

type Ctx = { params: Promise<{ id: string }> };

const VALID_KINDS = ["content", "knowledge_check", "assignment", "scenario"];

export const GET = withAuth<Ctx>(
  async (_request, { session, params }) => {
    const { id } = await params;
    const supabase = await createClient();

    const { data: object, error } = await supabase
      .from("learning_objects")
      .select("id, org_id, kind, title, description, status, version, created_at")
      .eq("id", id)
      .is("deleted_at", null)
      .single();

    if (error || !object || object.org_id !== session.orgId) {
      return errorResponse("NOT_FOUND", "No such learning object.", 404);
    }
    return successResponse({ learningObject: object });
  },
  { minRole: "org_admin" }
);

// Same shape and same reasoning as the course PATCH: the missing "edit"
// verb over the existing learning_objects_update policy. Status and
// version stay owned by the /publish state machine.
export const PATCH = withAuth<Ctx>(
  async (request, { session, params }) => {
    const { id } = await params;
    const body = await request.json().catch(() => null);

    const patch: Record<string, string | null> = {};
    if (typeof body?.title === "string") {
      const title = body.title.trim();
      if (!title) return errorResponse("INVALID_INPUT", "Title cannot be empty.", 400);
      patch.title = title;
    }
    if (typeof body?.description === "string" || body?.description === null) {
      patch.description = body.description === null ? null : String(body.description);
    }
    if (typeof body?.kind === "string") {
      if (!VALID_KINDS.includes(body.kind)) {
        return errorResponse("INVALID_INPUT", "Invalid learning object kind.", 400);
      }
      patch.kind = body.kind;
    }
    if (Object.keys(patch).length === 0) {
      return errorResponse("INVALID_INPUT", "Nothing to update.", 400);
    }

    const supabase = await createClient();
    const { data: object } = await supabase
      .from("learning_objects")
      .select("id, org_id")
      .eq("id", id)
      .single();

    if (!object || object.org_id !== session.orgId) {
      return errorResponse("NOT_FOUND", "No such learning object.", 404);
    }

    const { data: updated, error } = await supabase
      .from("learning_objects")
      .update(patch)
      .eq("id", id)
      .select("id, kind, title, description, status, version")
      .single();

    if (error) return errorResponse("UPDATE_FAILED", error.message, 500);
    return successResponse({ learningObject: updated });
  },
  { minRole: "org_admin" }
);
