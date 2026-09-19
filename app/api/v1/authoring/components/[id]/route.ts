import { withAuth } from "@/lib/api/with-auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";
import { LeafBlock } from "@/lib/spec";

type Ctx = { params: Promise<{ id: string }> };

const COLUMNS = "id, org_id, name, description, category, status, version, definition, created_at, updated_at";

async function load(supabase: Awaited<ReturnType<typeof createClient>>, id: string, orgId: string | null) {
  const { data, error } = await supabase
    .from("component_definitions")
    .select(COLUMNS)
    .eq("id", id)
    .is("deleted_at", null)
    .single();
  if (error || !data || data.org_id !== orgId) return null;
  return data;
}

export const GET = withAuth<Ctx>(
  async (_request, { session, params }) => {
    const { id } = await params;
    const supabase = await createClient();
    const row = await load(supabase, id, session.orgId);
    if (!row) return errorResponse("NOT_FOUND", "No such component in your organization.", 404);
    return successResponse({ component: row });
  },
  { minRole: "org_admin" }
);

export const PATCH = withAuth<Ctx>(
  async (request, { session, params }) => {
    const { id } = await params;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return errorResponse("INVALID_INPUT", "A request body is required.", 400);
    }

    const supabase = await createClient();
    const row = await load(supabase, id, session.orgId);
    if (!row) return errorResponse("NOT_FOUND", "No such component in your organization.", 404);

    const update: Record<string, unknown> = {};
    if (typeof body.name === "string" && body.name.trim()) update.name = body.name.trim();
    if (typeof body.description === "string") update.description = body.description.trim() || null;
    if (typeof body.category === "string") update.category = body.category.trim() || null;

    if (body.definition !== undefined) {
      const parsed = LeafBlock.safeParse(body.definition);
      if (!parsed.success) {
        return errorResponse("INVALID_DEFINITION", "That is not a valid block.", 422, {
          issues: parsed.error.issues.map((i) => ({ path: i.path.join("/"), message: i.message })),
        });
      }
      update.definition = parsed.data;
    }

    if (Object.keys(update).length === 0) {
      return errorResponse("INVALID_INPUT", "Nothing to update.", 400);
    }

    const { data, error } = await supabase
      .from("component_definitions")
      .update(update)
      .eq("id", id)
      .eq("org_id", session.orgId)
      .select(COLUMNS)
      .single();

    if (error) return errorResponse("UPDATE_FAILED", error.message, 500);
    return successResponse({ component: data });
  },
  { minRole: "org_admin" }
);

/**
 * Soft delete.
 *
 * Components are referenced by id from specs rather than copied into them,
 * so a hard delete would break every course using one. Soft-deleting keeps
 * existing references resolvable while removing it from the library.
 */
export const DELETE = withAuth<Ctx>(
  async (_request, { session, params }) => {
    const { id } = await params;
    const supabase = await createClient();
    const row = await load(supabase, id, session.orgId);
    if (!row) return errorResponse("NOT_FOUND", "No such component in your organization.", 404);

    const { error } = await supabase
      .from("component_definitions")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .eq("org_id", session.orgId);

    if (error) return errorResponse("DELETE_FAILED", error.message, 500);
    return successResponse({ deleted: true });
  },
  { minRole: "org_admin" }
);
