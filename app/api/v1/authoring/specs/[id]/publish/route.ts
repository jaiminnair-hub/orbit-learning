import type { SupabaseClient } from "@supabase/supabase-js";
import { withAuth } from "@/lib/api/with-auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canTransition, snapshotVersion, transitionError } from "@/lib/content/publish";
import { validateCourseSpec } from "@/lib/spec";
import { isPublishable, loadSpec, recordValidationReport } from "@/lib/authoring/spec-store";

type Ctx = { params: Promise<{ id: string }> };

/**
 * The bridge into Curriculum: a published spec is only playable by a real
 * learner once a `learning_objects` row exists for it (source: 'authored'),
 * because that's the only thing the Curriculum lesson-attach picker and the
 * course player's `source === 'authored'` branch actually key off. Nothing
 * else in the product ever created this row — confirmed by grep, the only
 * prior writer was a test's own setup fixture — so publishing a spec was a
 * dead end for reaching a learner until this. Upserts by
 * `course_specification_id` (unique-indexed) rather than inserting on every
 * publish, so a republish updates the existing bridge row instead of
 * duplicating it.
 */
async function syncAuthoredLearningObject(
  supabase: SupabaseClient,
  params: { orgId: string; specId: string; title: string; status: "published" | "archived" }
): Promise<{ error: string | null }> {
  const { data: existing } = await supabase
    .from("learning_objects")
    .select("id")
    .eq("org_id", params.orgId)
    .eq("course_specification_id", params.specId)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("learning_objects")
      .update({ title: params.title, status: params.status })
      .eq("id", existing.id);
    return { error: error?.message ?? null };
  }

  // An archive transition with no existing bridge row means the spec was
  // never published in the first place — nothing to create.
  if (params.status !== "published") return { error: null };

  const { error } = await supabase.from("learning_objects").insert({
    org_id: params.orgId,
    kind: "content",
    title: params.title,
    source: "authored",
    status: "published",
    course_specification_id: params.specId,
  });
  return { error: error?.message ?? null };
}

/**
 * Workflow transition for a specification, reusing lib/content/publish.ts —
 * the same state machine, snapshot mechanic and review trail that learning
 * objects and courses have used since Phase 2. Nothing bespoke here.
 *
 * The one addition is a validation gate on the way to `published`: a
 * specification that does not validate must never reach the runtime, because
 * the runtime's contract is that a published spec plays. A failed gate writes
 * its report so the author can see exactly which findings blocked it.
 */
export const POST = withAuth<Ctx>(
  async (request, { session, params }) => {
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const to = typeof body?.status === "string" ? body.status : "";
    const comments = typeof body?.comments === "string" ? body.comments : null;

    const supabase = await createClient();
    const row = await loadSpec(supabase, id, session.orgId);
    if (!row) return errorResponse("NOT_FOUND", "No such specification in your organization.", 404);

    if (!canTransition(row.status, to)) {
      return errorResponse("INVALID_TRANSITION", transitionError(row.status, to), 409);
    }

    const isPublishing = to === "published";

    if (isPublishing) {
      const report = validateCourseSpec(row.spec);
      await recordValidationReport(supabase, {
        orgId: session.orgId!,
        specId: id,
        specVersion: row.version,
        report,
        userId: session.userId,
        kind: "publish_readiness",
      });
      if (!isPublishable(report)) {
        return errorResponse(
          "NOT_PUBLISHABLE",
          "This course has validation errors and cannot be published. Fix them and try again.",
          422,
          { findings: report.findings.filter((f) => f.severity === "error") }
        );
      }
    }

    const nextVersion = isPublishing ? row.version + 1 : row.version;

    const { data: updated, error: updateError } = await supabase
      .from("course_specifications")
      .update({ status: to, version: nextVersion })
      .eq("id", id)
      .eq("org_id", session.orgId)
      .select("id, title, status, version, updated_at")
      .single();

    if (updateError) return errorResponse("UPDATE_FAILED", updateError.message, 500);

    if (isPublishing) {
      // The snapshot is what makes an in-progress learner immune to later
      // edits, and it is also what course_runtime_state's spec_version
      // points at.
      const { error: snapError } = await snapshotVersion(createAdminClient(), {
        orgId: session.orgId!,
        entityType: "course_specification",
        entityId: id,
        versionNumber: nextVersion,
        snapshot: { title: row.title, spec: row.spec, specSchemaVersion: row.spec_schema_version },
        publishedBy: session.userId,
      });
      if (snapError) return errorResponse("SNAPSHOT_FAILED", snapError, 500);
    }

    if (isPublishing || to === "archived") {
      const { error: bridgeError } = await syncAuthoredLearningObject(supabase, {
        orgId: session.orgId!,
        specId: id,
        title: updated.title,
        status: isPublishing ? "published" : "archived",
      });
      if (bridgeError) return errorResponse("BRIDGE_SYNC_FAILED", bridgeError, 500);
    }

    await supabase.from("content_reviews").insert({
      org_id: session.orgId,
      content_type: "course_specification",
      content_id: id,
      reviewer_id: session.userId,
      decision: to === "published" ? "published" : to === "archived" ? "archived" : "submitted",
      comments,
    });

    return successResponse({ spec: updated });
  },
  { minRole: "org_admin" }
);
