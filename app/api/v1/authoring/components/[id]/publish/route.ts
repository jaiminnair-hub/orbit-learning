import { withAuth } from "@/lib/api/with-auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canTransition, snapshotVersion, transitionError } from "@/lib/content/publish";

type Ctx = { params: Promise<{ id: string }> };

// Same workflow state machine as every other content type. A component is
// reviewable content because it propagates: a spec references it by id, so
// republishing one changes every course that uses it on next publish.
export const POST = withAuth<Ctx>(
  async (request, { session, params }) => {
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const to = typeof body?.status === "string" ? body.status : "";
    const comments = typeof body?.comments === "string" ? body.comments : null;

    const supabase = await createClient();
    const { data: row, error } = await supabase
      .from("component_definitions")
      .select("id, org_id, name, status, version, definition, spec_schema_version")
      .eq("id", id)
      .is("deleted_at", null)
      .single();

    if (error || !row || row.org_id !== session.orgId) {
      return errorResponse("NOT_FOUND", "No such component in your organization.", 404);
    }
    if (!canTransition(row.status, to)) {
      return errorResponse("INVALID_TRANSITION", transitionError(row.status, to), 409);
    }

    const isPublishing = to === "published";
    const nextVersion = isPublishing ? row.version + 1 : row.version;

    const { data: updated, error: updateError } = await supabase
      .from("component_definitions")
      .update({ status: to, version: nextVersion })
      .eq("id", id)
      .eq("org_id", session.orgId)
      .select("id, name, status, version, updated_at")
      .single();

    if (updateError) return errorResponse("UPDATE_FAILED", updateError.message, 500);

    if (isPublishing) {
      const { error: snapError } = await snapshotVersion(createAdminClient(), {
        orgId: session.orgId!,
        entityType: "component_definition",
        entityId: id,
        versionNumber: nextVersion,
        snapshot: { name: row.name, definition: row.definition, specSchemaVersion: row.spec_schema_version },
        publishedBy: session.userId,
      });
      if (snapError) return errorResponse("SNAPSHOT_FAILED", snapError, 500);
    }

    await supabase.from("content_reviews").insert({
      org_id: session.orgId,
      content_type: "component_definition",
      content_id: id,
      reviewer_id: session.userId,
      decision: to === "published" ? "published" : to === "archived" ? "archived" : "submitted",
      comments,
    });

    return successResponse({ component: updated });
  },
  { minRole: "org_admin" }
);
