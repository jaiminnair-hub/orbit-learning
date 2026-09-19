import { withAuth } from "@/lib/api/with-auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";
import { loadSpec } from "@/lib/authoring/spec-store";
import { specSearchText } from "@/lib/authoring/spec-text";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Copies a specification as a fresh draft.
 *
 * This is also the supported way to revise something already published:
 * the workflow has no published → draft edge (docs/CONTENT_MODEL.md §6),
 * because pulling a live course back into an editable state would change
 * what in-progress learners are playing. Duplicating leaves the published
 * version serving traffic while the copy is edited.
 */
export const POST = withAuth<Ctx>(
  async (request, { session, params }) => {
    const { id } = await params;
    const body = await request.json().catch(() => null);

    const supabase = await createClient();
    const row = await loadSpec(supabase, id, session.orgId);
    if (!row) return errorResponse("NOT_FOUND", "No such specification in your organization.", 404);

    const title = typeof body?.title === "string" && body.title.trim() ? body.title.trim() : `${row.title} (copy)`;
    const source = row.spec as { meta?: Record<string, unknown> };
    const spec = { ...source, meta: { ...(source.meta ?? {}), title } };

    const { data, error } = await supabase
      .from("course_specifications")
      .insert({
        org_id: session.orgId,
        title,
        spec,
        spec_schema_version: row.spec_schema_version,
        search_text: specSearchText(spec as never),
        // A copy starts at draft/version 1 regardless of its source's state:
        // it has never been published, and inheriting a version number would
        // make the snapshot history of two different documents collide.
        status: "draft",
        source_kind: "manual",
        locale: row.locale,
        created_by: session.userId,
      })
      .select("id, title, status, version, created_at, updated_at")
      .single();

    if (error) return errorResponse("DUPLICATE_FAILED", error.message, 500);
    return successResponse({ spec: data }, 201);
  },
  { minRole: "org_admin" }
);
