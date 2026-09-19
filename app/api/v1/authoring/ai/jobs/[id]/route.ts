import { withAuth } from "@/lib/api/with-auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Polls an AI Course Builder job — the counterpart to POST
 * /api/v1/authoring/ai/generate returning 202, mirroring
 * GET /api/v1/publishing/jobs/[id] for the publishing pipeline's own job kind.
 * `authoring_jobs` is one generic table for every job kind; this route just
 * scopes the client-facing polling surface to the authoring namespace.
 */
export const GET = withAuth<Ctx>(
  async (_request, { session, params }) => {
    const { id } = await params;

    const supabase = await createClient();
    const { data: job, error } = await supabase
      .from("authoring_jobs")
      .select("id, org_id, kind, status, input, output, steps, error, started_at, finished_at, created_at")
      .eq("id", id)
      .single();

    if (error || !job || job.org_id !== session.orgId) {
      return errorResponse("NOT_FOUND", "No such job in your organization.", 404);
    }

    return successResponse({ job });
  },
  { minRole: "org_admin" }
);
