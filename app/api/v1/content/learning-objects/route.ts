import { withAuth } from "@/lib/api/with-auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";

const VALID_KINDS = ["content", "knowledge_check", "assignment", "scenario"];

export const GET = withAuth(
  async (_request, { session }) => {
    const supabase = await createClient();
    const { data: objects, error } = await supabase
      .from("learning_objects")
      .select("id, kind, title, description, status, version, owner_id, created_at")
      .eq("org_id", session.orgId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (error) return errorResponse("QUERY_FAILED", error.message, 500);
    return successResponse({ learningObjects: objects ?? [] });
  },
  { minRole: "org_admin" }
);

export const POST = withAuth(
  async (request, { session }) => {
    if (!session.orgId) {
      return errorResponse("NO_ORG", "You must belong to an organization.", 409);
    }

    const body = await request.json().catch(() => null);
    const title = typeof body?.title === "string" ? body.title.trim() : "";
    const kind = typeof body?.kind === "string" ? body.kind : "content";
    const description = typeof body?.description === "string" ? body.description : null;
    const assetIds: string[] = Array.isArray(body?.assetIds) ? body.assetIds : [];

    if (!title) return errorResponse("INVALID_INPUT", "A title is required.", 400);
    if (!VALID_KINDS.includes(kind)) {
      return errorResponse("INVALID_INPUT", "Invalid learning object kind.", 400);
    }

    const supabase = await createClient();
    const { data: object, error } = await supabase
      .from("learning_objects")
      .insert({
        org_id: session.orgId,
        kind,
        title,
        description,
        owner_id: session.userId,
        created_by: session.userId,
      })
      .select("id, kind, title, description, status, version, created_at")
      .single();

    if (error) return errorResponse("CREATE_FAILED", error.message, 500);

    // Composition is optional at creation — a learning object can be
    // created empty and have assets attached later.
    if (assetIds.length > 0) {
      const rows = assetIds.map((assetId, i) => ({
        org_id: session.orgId,
        learning_object_id: object.id,
        content_asset_id: assetId,
        sequence: i,
      }));
      const { error: linkError } = await supabase.from("learning_object_assets").insert(rows);
      if (linkError) return errorResponse("LINK_FAILED", linkError.message, 500);
    }

    return successResponse({ learningObject: object }, 201);
  },
  { minRole: "org_admin" }
);
