import { withAuth } from "@/lib/api/with-auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canTransition, transitionError, snapshotVersion } from "@/lib/content/publish";

type Ctx = { params: Promise<{ id: string }> };

// Moves a learning object through draft → review → approval → published
// → archived, enforcing the state machine from docs/CONTENT_MODEL.md §6.
//
// On reaching `published` this writes an immutable content_versions
// snapshot — the mechanism that lets an in-progress learner keep seeing
// the version they started on while authors publish new ones.
export const POST = withAuth<Ctx>(
  async (request, { session, params }) => {
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const to = typeof body?.status === "string" ? body.status : "";
    const comments = typeof body?.comments === "string" ? body.comments : null;

    const supabase = await createClient();
    const { data: object, error } = await supabase
      .from("learning_objects")
      .select("id, org_id, kind, title, description, metadata, status, version")
      .eq("id", id)
      .single();

    if (error || !object || object.org_id !== session.orgId) {
      return errorResponse("NOT_FOUND", "No such learning object in your organization.", 404);
    }
    if (!canTransition(object.status, to)) {
      return errorResponse("INVALID_TRANSITION", transitionError(object.status, to), 409);
    }

    const isPublishing = to === "published";
    // Publishing bumps the version; every other transition leaves it be.
    const nextVersion = isPublishing ? object.version + 1 : object.version;

    const { data: updated, error: updateError } = await supabase
      .from("learning_objects")
      .update({ status: to, version: nextVersion })
      .eq("id", id)
      .select("id, kind, title, description, status, version")
      .single();

    if (updateError) return errorResponse("UPDATE_FAILED", updateError.message, 500);

    const admin = createAdminClient();

    if (isPublishing) {
      // Snapshot the state as published, including its composed assets so
      // the version is self-contained rather than a pointer into rows
      // that may change later.
      const { data: assets } = await supabase
        .from("learning_object_assets")
        .select("content_asset_id, sequence")
        .eq("learning_object_id", id)
        .order("sequence");

      const { error: snapError } = await snapshotVersion(admin, {
        orgId: session.orgId!,
        entityType: "learning_object",
        entityId: id,
        versionNumber: nextVersion,
        snapshot: {
          title: updated.title,
          description: updated.description,
          kind: updated.kind,
          metadata: object.metadata,
          assets: assets ?? [],
        },
        publishedBy: session.userId,
      });
      if (snapError) return errorResponse("SNAPSHOT_FAILED", snapError, 500);
    }

    // Audit trail for every transition, not just publishes.
    await supabase.from("content_reviews").insert({
      org_id: session.orgId,
      content_type: "learning_object",
      content_id: id,
      reviewer_id: session.userId,
      decision: to === "published" ? "published" : to === "archived" ? "archived" : "submitted",
      comments,
    });

    return successResponse({ learningObject: updated });
  },
  { minRole: "org_admin" }
);
