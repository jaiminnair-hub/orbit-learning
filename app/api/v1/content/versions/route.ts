import { withAuth } from "@/lib/api/with-auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";

const VALID_TYPES = ["learning_object", "course", "content_asset", "assessment"];

// Reads the publish snapshots written by the step-3/4 publish paths.
// content_versions already had a select policy scoped to the caller's
// org; this is just the route that lets the authoring UI show them.
// Read-only by design — snapshots are immutable audit records.
export const GET = withAuth(
  async (request, { session }) => {
    const url = new URL(request.url);
    const entityType = url.searchParams.get("entityType") ?? "";
    const entityId = url.searchParams.get("entityId") ?? "";

    if (!VALID_TYPES.includes(entityType)) {
      return errorResponse("INVALID_INPUT", "A valid entityType is required.", 400);
    }
    if (!entityId) {
      return errorResponse("INVALID_INPUT", "entityId is required.", 400);
    }

    const supabase = await createClient();
    const { data: versions, error } = await supabase
      .from("content_versions")
      .select("id, version_number, snapshot, published_by, published_at")
      .eq("org_id", session.orgId)
      .eq("entity_type", entityType)
      .eq("entity_id", entityId)
      .order("version_number", { ascending: false });

    if (error) return errorResponse("QUERY_FAILED", error.message, 500);

    const { data: reviews } = await supabase
      .from("content_reviews")
      .select("decision, comments, reviewed_at, reviewer_id")
      .eq("org_id", session.orgId)
      .eq("content_type", entityType)
      .eq("content_id", entityId)
      .order("reviewed_at", { ascending: false });

    return successResponse({ versions: versions ?? [], reviews: reviews ?? [] });
  },
  { minRole: "org_admin" }
);
