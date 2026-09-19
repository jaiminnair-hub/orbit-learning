import { withAuth } from "@/lib/api/with-auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";
import { SPEC_SCHEMA_VERSION } from "@/lib/spec";
import { createBlankSpec } from "@/lib/authoring/block-factory";
import { validateForWrite } from "@/lib/authoring/spec-store";
import { specSearchText } from "@/lib/authoring/spec-text";

const LIST_COLUMNS = "id, title, status, version, locale, source_kind, created_at, updated_at";
const VALID_STATUSES = ["draft", "review", "approval", "published", "archived"];

// docs/PHASE3_API_EVENTS.md §1. org_admin throughout: authoring is not a
// learner surface, and RLS on course_specifications enforces the same bar
// independently.
export const GET = withAuth(
  async (request, { session }) => {
    const url = new URL(request.url);
    const status = url.searchParams.get("status");

    const supabase = await createClient();
    let query = supabase
      .from("course_specifications")
      .select(LIST_COLUMNS)
      .eq("org_id", session.orgId)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false });

    if (status) {
      if (!VALID_STATUSES.includes(status)) {
        return errorResponse("INVALID_INPUT", `Unknown status '${status}'.`, 400);
      }
      query = query.eq("status", status);
    }

    const { data, error } = await query;
    if (error) return errorResponse("QUERY_FAILED", error.message, 500);
    return successResponse({ specs: data ?? [] });
  },
  { minRole: "org_admin" }
);

// Creates a blank specification, or copies a template's document as the
// starting point. Either way the result is validated before insert — a
// template is stored content and could have been made invalid by a schema
// change since it was saved.
export const POST = withAuth(
  async (request, { session }) => {
    const body = await request.json().catch(() => null);
    const title = typeof body?.title === "string" ? body.title.trim() : "";
    const templateId = typeof body?.templateId === "string" ? body.templateId : null;

    if (!title) return errorResponse("INVALID_INPUT", "A title is required.", 400);

    const supabase = await createClient();

    let spec: unknown;
    if (templateId) {
      const { data: template } = await supabase
        .from("course_templates")
        .select("id, org_id, spec")
        .eq("id", templateId)
        .is("deleted_at", null)
        .single();
      if (!template || template.org_id !== session.orgId) {
        return errorResponse("NOT_FOUND", "No such template in your organization.", 404);
      }
      const fromTemplate = template.spec as { meta?: Record<string, unknown> };
      spec = { ...fromTemplate, meta: { ...(fromTemplate.meta ?? {}), title } };
    } else {
      spec = createBlankSpec(title, SPEC_SCHEMA_VERSION);
    }

    const { report, blocking } = validateForWrite(spec);
    if (blocking) {
      return errorResponse(
        "INVALID_SPEC",
        templateId
          ? "That template no longer matches the specification schema and cannot start a new course."
          : "Could not create a valid specification.",
        422
      );
    }

    const { data, error } = await supabase
      .from("course_specifications")
      .insert({
        org_id: session.orgId,
        title,
        spec,
        spec_schema_version: SPEC_SCHEMA_VERSION,
        search_text: specSearchText(spec as never),
        source_kind: templateId ? "manual" : "manual",
        created_by: session.userId,
      })
      .select(LIST_COLUMNS)
      .single();

    if (error) return errorResponse("CREATE_FAILED", error.message, 500);
    return successResponse({ spec: data, validation: report }, 201);
  },
  { minRole: "org_admin" }
);
