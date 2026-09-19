import { withAuth } from "@/lib/api/with-auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";
import { SPEC_SCHEMA_VERSION } from "@/lib/spec";
import { validateForWrite } from "@/lib/authoring/spec-store";

const LIST_COLUMNS = "id, name, description, thumbnail_asset_id, status, version, created_at, updated_at";

// Course starting points — docs/PHASE3_API_EVENTS.md §2. A template holds a
// whole-course skeleton, so it is validated as a full specification rather
// than as a fragment.
export const GET = withAuth(
  async (_request, { session }) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("course_templates")
      .select(LIST_COLUMNS)
      .eq("org_id", session.orgId)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false });

    if (error) return errorResponse("QUERY_FAILED", error.message, 500);
    return successResponse({ templates: data ?? [] });
  },
  { minRole: "org_admin" }
);

export const POST = withAuth(
  async (request, { session }) => {
    const body = await request.json().catch(() => null);
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const description = typeof body?.description === "string" ? body.description.trim() : null;
    const fromSpecId = typeof body?.fromSpecId === "string" ? body.fromSpecId : null;

    if (!name) return errorResponse("INVALID_INPUT", "A name is required.", 400);

    const supabase = await createClient();

    let spec: unknown = body?.spec;
    if (fromSpecId) {
      // Saving an existing course as a reusable starting point is the common
      // path — authors build one good course, then template it.
      const { data: source } = await supabase
        .from("course_specifications")
        .select("id, org_id, spec")
        .eq("id", fromSpecId)
        .is("deleted_at", null)
        .single();
      if (!source || source.org_id !== session.orgId) {
        return errorResponse("NOT_FOUND", "No such specification in your organization.", 404);
      }
      spec = source.spec;
    }

    if (spec === undefined) {
      return errorResponse("INVALID_INPUT", "Provide either 'spec' or 'fromSpecId'.", 400);
    }

    const { report, blocking } = validateForWrite(spec);
    if (blocking) {
      return errorResponse("INVALID_SPEC", "A template must be a valid specification.", 422, {
        findings: report.findings.filter((f) => f.kind === "schema" && f.severity === "error"),
      });
    }

    const { data, error } = await supabase
      .from("course_templates")
      .insert({
        org_id: session.orgId,
        name,
        description,
        spec,
        spec_schema_version: SPEC_SCHEMA_VERSION,
        created_by: session.userId,
      })
      .select(LIST_COLUMNS)
      .single();

    if (error) return errorResponse("CREATE_FAILED", error.message, 500);
    return successResponse({ template: data }, 201);
  },
  { minRole: "org_admin" }
);
