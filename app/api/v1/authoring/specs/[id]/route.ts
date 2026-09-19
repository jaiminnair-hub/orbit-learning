import { withAuth } from "@/lib/api/with-auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";
import { applyPatch, JsonPatchError, parsePatchBody } from "@/lib/authoring/json-patch";
import { loadSpec, validateForWrite, writeSpec } from "@/lib/authoring/spec-store";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withAuth<Ctx>(
  async (_request, { session, params }) => {
    const { id } = await params;
    const supabase = await createClient();
    const row = await loadSpec(supabase, id, session.orgId);
    if (!row) return errorResponse("NOT_FOUND", "No such specification in your organization.", 404);
    return successResponse({ spec: row });
  },
  { minRole: "org_admin" }
);

/**
 * Updates a specification — docs/PHASE3_API_EVENTS.md §1.
 *
 * Two body shapes, because the editor produces both: `patch` (a JSON-Patch
 * array, what block editing and reordering emit) and `spec` (a whole
 * document, what a coarse structural change emits). Both take the same path
 * afterwards: apply, validate, then write conditionally on the caller's
 * `baseUpdatedAt`.
 *
 * The order is the point. Validating *after* writing would leave invalid
 * documents in the table that the runtime would later refuse to play, with
 * no indication of when they broke.
 */
export const PATCH = withAuth<Ctx>(
  async (request, { session, params }) => {
    const { id } = await params;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return errorResponse("INVALID_INPUT", "A request body is required.", 400);
    }

    const baseUpdatedAt = typeof body.baseUpdatedAt === "string" ? body.baseUpdatedAt : null;
    if (!baseUpdatedAt) {
      return errorResponse(
        "INVALID_INPUT",
        "baseUpdatedAt is required — it is the revision this edit was made against.",
        400
      );
    }

    const supabase = await createClient();
    const row = await loadSpec(supabase, id, session.orgId);
    if (!row) return errorResponse("NOT_FOUND", "No such specification in your organization.", 404);

    if (row.status === "published") {
      return errorResponse(
        "NOT_EDITABLE",
        "A published specification is immutable. Move it back to draft to make a new version.",
        409
      );
    }

    let candidate: unknown;
    if (body.patch !== undefined) {
      try {
        candidate = applyPatch(row.spec, parsePatchBody(body.patch));
      } catch (error) {
        if (error instanceof JsonPatchError) return errorResponse("INVALID_PATCH", error.message, 400);
        throw error;
      }
    } else if (body.spec !== undefined) {
      candidate = body.spec;
    } else {
      return errorResponse("INVALID_INPUT", "Provide either 'patch' or 'spec'.", 400);
    }

    const { report, blocking } = validateForWrite(candidate);
    if (blocking) {
      return errorResponse(
        "INVALID_SPEC",
        "This change would make the specification invalid.",
        422,
        { findings: report.findings.filter((f) => f.kind === "schema" && f.severity === "error") }
      );
    }

    const result = await writeSpec(supabase, {
      id,
      orgId: session.orgId!,
      baseUpdatedAt,
      spec: candidate as { meta: { title: string } } & object,
    });

    if (result.conflict) {
      return errorResponse(
        "CONFLICT",
        "This specification changed since you loaded it. Reload to pick up the newer version before saving again.",
        409
      );
    }
    if (result.error) return errorResponse("SAVE_FAILED", result.error, 500);

    return successResponse({ spec: result.row, validation: report });
  },
  { minRole: "org_admin" }
);

/**
 * Beacon alias for PATCH.
 *
 * The editor flushes queued operations on pagehide via navigator.sendBeacon,
 * which is POST-only — the same trade the runtime state route makes for the
 * same reason (an author who closes the tab mid-edit must not lose the edit).
 * Identical handler, so the validate-then-write and optimistic-concurrency
 * guarantees are exactly the ones PATCH gives.
 */
export const POST = PATCH;

/** Soft delete, per docs/DATABASE.md §8 — authored content is never hard-deleted. */
export const DELETE = withAuth<Ctx>(
  async (_request, { session, params }) => {
    const { id } = await params;
    const supabase = await createClient();
    const row = await loadSpec(supabase, id, session.orgId);
    if (!row) return errorResponse("NOT_FOUND", "No such specification in your organization.", 404);

    const { error } = await supabase
      .from("course_specifications")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .eq("org_id", session.orgId);

    if (error) return errorResponse("DELETE_FAILED", error.message, 500);
    return successResponse({ deleted: true });
  },
  { minRole: "org_admin" }
);
