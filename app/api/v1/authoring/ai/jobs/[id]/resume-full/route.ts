import { withAuth } from "@/lib/api/with-auth";
import { errorResponse, successResponse } from "@/lib/api/response";
import { advanceFullCourseJob } from "@/lib/ai/full-course-builder";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Advances a full-course job by one invocation's worth of work, synchronously
 * — the response doesn't return until that chunk is actually done (or the
 * job finishes/fails). This is the ONLY thing that ever advances a full-course
 * job now: `components/authoring/ai-generate-panel.tsx`'s poll loop calls it
 * once per tick whenever it sees no new step, for every chunk after the
 * first (the first runs inline in generate-full's own POST). See
 * lib/ai/full-course-builder.ts's header for why nothing server-side
 * self-triggers a continuation any more — a real production incident
 * (Vercel's own loop protection, HTTP 508) is exactly the failure mode a
 * real external caller (a browser tab, not a deployment calling itself)
 * doesn't hit.
 *
 * Also genuinely a recovery control, unchanged from its original purpose: a
 * job whose tab was closed mid-generation is still `running` and still
 * resumable here from wherever it left off, org-admin-gated, org-scoped.
 */
export const POST = withAuth<{ params: Promise<{ id: string }> }>(
  async (_request, { session, params }) => {
    const { id } = await params;
    const supabase = await createClient();
    const { data: job, error } = await supabase
      .from("authoring_jobs")
      .select("id, org_id, status, input, error, started_at")
      .eq("id", id)
      .eq("org_id", session.orgId)
      .single();

    if (error || !job) return errorResponse("NOT_FOUND", "No such generation job in your organization.", 404);
    const input = job.input as { mode?: string } | null;
    const isInterrupted = ["queued", "running"].includes(job.status)
      || (job.status === "failed" && job.error?.includes("time limit allows"));
    if (input?.mode !== "full" || !isInterrupted) {
      return errorResponse("NOT_RESUMABLE", "Only an interrupted full-course generation can be resumed.", 409);
    }

    const admin = createAdminClient();
    // `started_at` anchors lib/ai/full-course-builder.ts's one-hour ceiling
    // (MAX_TOTAL_JOB_MS) — only set it the first time. This route is now
    // called every few seconds for the length of a whole generation; resetting
    // the clock on every call would make that ceiling never actually trigger.
    await admin
      .from("authoring_jobs")
      .update({
        status: "running",
        error: null,
        finished_at: null,
        ...(job.started_at ? {} : { started_at: new Date().toISOString() }),
      })
      .eq("id", id)
      .eq("org_id", session.orgId);

    await advanceFullCourseJob(admin, id);
    return successResponse({ jobId: id, resumed: true }, 202);
  },
  { minRole: "org_admin" }
);

export const maxDuration = 300;
