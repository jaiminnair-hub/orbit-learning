import { withAuth } from "@/lib/api/with-auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";
import { LeafBlock, SPEC_SCHEMA_VERSION } from "@/lib/spec";

const LIST_COLUMNS = "id, name, description, category, status, version, definition, created_at, updated_at";

// The saved-block library — docs/PHASE3_API_EVENTS.md §2. A component is a
// block subtree, so it is validated against the real block schema on the way
// in: the library must not be able to hold something the editor can insert
// and the runtime then cannot render.
export const GET = withAuth(
  async (request, { session }) => {
    const url = new URL(request.url);
    const status = url.searchParams.get("status");

    const supabase = await createClient();
    let query = supabase
      .from("component_definitions")
      .select(LIST_COLUMNS)
      .eq("org_id", session.orgId)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false });

    if (status) query = query.eq("status", status);

    const { data, error } = await query;
    if (error) return errorResponse("QUERY_FAILED", error.message, 500);
    return successResponse({ components: data ?? [] });
  },
  { minRole: "org_admin" }
);

export const POST = withAuth(
  async (request, { session }) => {
    const body = await request.json().catch(() => null);
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const description = typeof body?.description === "string" ? body.description.trim() : null;
    const category = typeof body?.category === "string" ? body.category.trim() : null;

    if (!name) return errorResponse("INVALID_INPUT", "A name is required.", 400);
    if (body?.definition === undefined) {
      return errorResponse("INVALID_INPUT", "A block definition is required.", 400);
    }

    const parsed = LeafBlock.safeParse(body.definition);
    if (!parsed.success) {
      return errorResponse("INVALID_DEFINITION", "That is not a valid block.", 422, {
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("/"), message: i.message })),
      });
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("component_definitions")
      .insert({
        org_id: session.orgId,
        name,
        description,
        category,
        definition: parsed.data,
        spec_schema_version: SPEC_SCHEMA_VERSION,
        created_by: session.userId,
      })
      .select(LIST_COLUMNS)
      .single();

    if (error) return errorResponse("CREATE_FAILED", error.message, 500);
    return successResponse({ component: data }, 201);
  },
  { minRole: "org_admin" }
);
