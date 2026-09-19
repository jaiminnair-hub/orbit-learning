import { withAuth } from "@/lib/api/with-auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";
import { loadSpec } from "@/lib/authoring/spec-store";

type Ctx = { params: Promise<{ id: string }> };

// Version history for a specification — the same content_versions rows the
// Phase 2 versions route reads, filtered to this entity. Snapshots are
// returned without their `snapshot` payload by default: the list is for
// choosing a version, and the documents are large.
export const GET = withAuth<Ctx>(
  async (request, { session, params }) => {
    const { id } = await params;
    const url = new URL(request.url);
    const versionNumber = url.searchParams.get("version");

    const supabase = await createClient();
    const row = await loadSpec(supabase, id, session.orgId);
    if (!row) return errorResponse("NOT_FOUND", "No such specification in your organization.", 404);

    if (versionNumber) {
      const { data, error } = await supabase
        .from("content_versions")
        .select("version_number, snapshot, published_by, published_at")
        .eq("org_id", session.orgId)
        .eq("entity_type", "course_specification")
        .eq("entity_id", id)
        .eq("version_number", Number(versionNumber))
        .maybeSingle();
      if (error) return errorResponse("QUERY_FAILED", error.message, 500);
      if (!data) return errorResponse("NOT_FOUND", "No such version of this specification.", 404);
      return successResponse({ version: data });
    }

    const { data, error } = await supabase
      .from("content_versions")
      .select("version_number, published_by, published_at")
      .eq("org_id", session.orgId)
      .eq("entity_type", "course_specification")
      .eq("entity_id", id)
      .order("version_number", { ascending: false });

    if (error) return errorResponse("QUERY_FAILED", error.message, 500);
    return successResponse({ versions: data ?? [] });
  },
  { minRole: "org_admin" }
);
