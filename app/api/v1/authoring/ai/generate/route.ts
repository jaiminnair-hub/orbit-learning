import { after } from "next/server";
import { withAuth } from "@/lib/api/with-auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiGenerateLimiter } from "@/lib/ratelimit";
import {
  isCourseBuilderConfigured,
  runCourseBuilderJob,
  MAX_SOURCE_TEXT_LENGTH,
  MIN_SOURCE_TEXT_LENGTH,
} from "@/lib/ai/course-builder";

/**
 * Starts an AI Course Builder Lite job and returns immediately — the same
 * accept-and-return shape as POST /api/v1/publishing/packages, for the same
 * reason: a multi-step generation is not a request-time operation, and a
 * client holding a connection open for it will eventually meet a proxy that
 * disagrees. The work runs in `after()`; the client polls the job.
 *
 * Configuration is checked here, before a job row is even created, so an
 * organisation with no provider gets an honest, immediate answer rather than
 * a job that is created only to fail a moment later.
 */
export const POST = withAuth(
  async (request, { session }) => {
    const body = await request.json().catch(() => null);
    const sourceText = typeof body?.sourceText === "string" ? body.sourceText.trim() : "";
    const titleHintRaw = typeof body?.titleHint === "string" ? body.titleHint.trim() : "";
    const titleHint = titleHintRaw.slice(0, 200) || undefined;

    if (sourceText.length < MIN_SOURCE_TEXT_LENGTH) {
      return errorResponse(
        "INVALID_INPUT",
        `Paste at least ${MIN_SOURCE_TEXT_LENGTH} characters of source material to generate from.`,
        400
      );
    }
    if (sourceText.length > MAX_SOURCE_TEXT_LENGTH) {
      return errorResponse(
        "INVALID_INPUT",
        `Source material is limited to ${MAX_SOURCE_TEXT_LENGTH.toLocaleString()} characters in this release. Shorten it and try again.`,
        400
      );
    }

    if (!isCourseBuilderConfigured()) {
      return errorResponse(
        "AI_NOT_CONFIGURED",
        "AI generation is not configured for this platform. Add a provider (e.g. ANTHROPIC_API_KEY) to enable AI Course Builder.",
        422
      );
    }

    // The authenticated client, not the service role — RLS's own
    // authoring_jobs_insert policy (org match + org_admin) enforces the same
    // boundary withAuth's minRole check does, as defense in depth.
    const supabase = await createClient();
    const { data: job, error: jobError } = await supabase
      .from("authoring_jobs")
      .insert({
        org_id: session.orgId,
        kind: "generate_course",
        status: "queued",
        input: { sourceTextLength: sourceText.length, titleHint: titleHint ?? null },
        created_by: session.userId,
      })
      .select("id, status, kind, created_at")
      .single();

    if (jobError || !job) return errorResponse("JOB_FAILED", jobError?.message ?? "Could not create the job.", 500);

    after(async () => {
      await runCourseBuilderJob(createAdminClient(), {
        orgId: session.orgId!,
        userId: session.userId,
        jobId: job.id,
        sourceText,
        titleHint,
      });
    });

    return successResponse({ job }, 202);
  },
  { minRole: "org_admin", rateLimit: aiGenerateLimiter }
);
