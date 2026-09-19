import { withAuth } from "@/lib/api/with-auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Polls a package-build job.
 *
 * The counterpart to POST /publishing/packages returning 202: the client gets
 * a job id immediately and asks here whether it finished. Polling is the
 * baseline PHASE3_API_EVENTS.md §3 sets for job status; a stream is optional
 * and unnecessary for a build measured in seconds.
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
