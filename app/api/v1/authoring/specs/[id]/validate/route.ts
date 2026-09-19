import { withAuth } from "@/lib/api/with-auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";
import { validateCourseSpec } from "@/lib/spec";
import { isPublishable, loadSpec, recordValidationReport } from "@/lib/authoring/spec-store";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Validates without saving, and records the result — docs/PHASE3_API_EVENTS.md §1.
 *
 * Validates the *stored* document by default, or a candidate passed in the
 * body, which is what lets the editor answer "would this publish?" before the
 * author commits to it.
 *
 * The report is persisted to spec_validation_reports because the reason a
 * publish was refused has to outlive the request that discovered it — an
 * author who comes back tomorrow should still be able to see what failed.
 */
export const POST = withAuth<Ctx>(
  async (request, { session, params }) => {
    const { id } = await params;
    const body = await request.json().catch(() => null);

    const supabase = await createClient();
    const row = await loadSpec(supabase, id, session.orgId);
    if (!row) return errorResponse("NOT_FOUND", "No such specification in your organization.", 404);

    const candidate = body && typeof body === "object" && body.spec !== undefined ? body.spec : row.spec;
    const report = validateCourseSpec(candidate);

    await recordValidationReport(supabase, {
      orgId: session.orgId!,
      specId: id,
      specVersion: row.version,
      report,
      userId: session.userId,
      kind: "publish_readiness",
    });

    return successResponse({ validation: report, publishable: isPublishable(report) });
  },
  { minRole: "org_admin" }
);
