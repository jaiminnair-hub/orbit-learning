import { withAuth } from "@/lib/api/with-auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiGenerateLimiter } from "@/lib/ratelimit";
import {
  isFullCourseBuilderConfigured,
  startFullCourseJob,
  MAX_SOURCE_TEXT_LENGTH,
  MIN_SOURCE_TEXT_LENGTH,
  type FullCourseBuilderRequest,
} from "@/lib/ai/full-course-builder";
import { extractFromPdf, extractFromDocx, extractFromPptx, extractFromUrl, ExtractionError } from "@/lib/authoring/extract";

const BUCKET = "content-assets";

// Full generation intentionally uses bounded continuation calls. A provider
// response can still take longer than a platform's short default window, so
// leave enough headroom for the step to be written and the next invocation to
// be scheduled. Vercel supports this route-segment option for App Router
// functions; the actual upper bound remains the deployment plan's limit.
export const maxDuration = 300;

/** Maps a content_assets.type to its extractor and the source_kind the resulting course_specifications row should carry. */
const ASSET_EXTRACTORS: Record<string, { extract: (bytes: Uint8Array) => Promise<{ text: string }>; sourceKind: FullCourseBuilderRequest["sourceKind"] }> = {
  pdf: { extract: extractFromPdf, sourceKind: "pdf" },
  document: { extract: extractFromDocx, sourceKind: "docx" },
  ppt: { extract: extractFromPptx, sourceKind: "pptx" },
};

/**
 * Starts a full-course generation job. Three source shapes, matching the
 * pipeline diagram in docs/PHASE3_AI_ARCHITECTURE.md §5:
 *
 * - `sourceAssetId` — a PDF/DOCX/PPTX already uploaded through the existing
 *   two-step Storage flow (POST /content/upload-url → PUT → POST
 *   /content/assets). Reused deliberately rather than accepting raw file
 *   bytes here: Vercel's default request body limit (4.5 MB) would reject a
 *   real image-heavy slide deck long before this route ever saw it, which is
 *   exactly the problem the existing signed-upload flow already solves.
 * - `sourceUrl` — fetched and extracted server-side (lib/authoring/extract.ts,
 *   including its SSRF guard).
 * - `sourceText` — pasted text, same as Lite but with a much higher length
 *   ceiling (a real extracted document, not a short paste).
 *
 * Extraction happens synchronously here, before the job is even created —
 * parsing a document is seconds of work, not the multi-minute generation
 * this job's own chaining exists for, so there is no reason to make it part
 * of the resumable chain.
 */
export const POST = withAuth(
  async (request, { session }) => {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return errorResponse("INVALID_INPUT", "A request body is required.", 400);
    }

    const titleHintRaw = typeof body.titleHint === "string" ? body.titleHint.trim() : "";
    const titleHint = titleHintRaw.slice(0, 200) || undefined;

    const supabase = await createClient();
    const admin = createAdminClient();

    let sourceText: string;
    let sourceKind: FullCourseBuilderRequest["sourceKind"];

    if (typeof body.sourceAssetId === "string" && body.sourceAssetId) {
      const { data: asset } = await supabase
        .from("content_assets")
        .select("id, org_id, type, storage_path")
        .eq("id", body.sourceAssetId)
        .is("deleted_at", null)
        .single();

      if (!asset || asset.org_id !== session.orgId) {
        return errorResponse("NOT_FOUND", "No such asset in your organization.", 404);
      }

      const mapping = ASSET_EXTRACTORS[asset.type as string];
      if (!mapping) {
        return errorResponse(
          "UNSUPPORTED_TYPE",
          `Cannot generate a course from a '${asset.type}' asset. Supported: PDF, Word (.docx), PowerPoint (.pptx).`,
          400
        );
      }

      const { data: blob, error: downloadError } = await admin.storage.from(BUCKET).download(asset.storage_path);
      if (downloadError || !blob) {
        return errorResponse("DOWNLOAD_FAILED", downloadError?.message ?? "Could not read the uploaded file.", 500);
      }

      try {
        const result = await mapping.extract(new Uint8Array(await blob.arrayBuffer()));
        sourceText = result.text;
      } catch (error) {
        if (error instanceof ExtractionError) return errorResponse(error.code, error.message, 422);
        throw error;
      }
      sourceKind = mapping.sourceKind;
    } else if (typeof body.sourceUrl === "string" && body.sourceUrl.trim()) {
      try {
        const result = await extractFromUrl(body.sourceUrl.trim());
        sourceText = result.text;
      } catch (error) {
        if (error instanceof ExtractionError) return errorResponse(error.code, error.message, 422);
        throw error;
      }
      sourceKind = "url";
    } else if (typeof body.sourceText === "string" && body.sourceText.trim()) {
      sourceText = body.sourceText.trim();
      sourceKind = "prompt";
    } else {
      return errorResponse("INVALID_INPUT", "Provide sourceAssetId, sourceUrl, or sourceText.", 400);
    }

    if (sourceText.length < MIN_SOURCE_TEXT_LENGTH) {
      return errorResponse(
        "INVALID_INPUT",
        `That source has too little readable text (at least ${MIN_SOURCE_TEXT_LENGTH} characters are needed).`,
        400
      );
    }
    if (sourceText.length > MAX_SOURCE_TEXT_LENGTH) {
      return errorResponse(
        "INVALID_INPUT",
        `Source material is limited to ${MAX_SOURCE_TEXT_LENGTH.toLocaleString()} characters in this release.`,
        400
      );
    }

    if (!isFullCourseBuilderConfigured()) {
      return errorResponse(
        "AI_NOT_CONFIGURED",
        "AI generation is not configured for this platform. Add a provider (e.g. ANTHROPIC_API_KEY) to enable AI Course Builder.",
        422
      );
    }

    // The authenticated client, not the service role — RLS's own
    // authoring_jobs_insert policy (org match + org_admin) enforces the same
    // boundary withAuth's minRole check does, as defense in depth.
    const { data: job, error: jobError } = await supabase
      .from("authoring_jobs")
      .insert({
        org_id: session.orgId,
        kind: "generate_course",
        status: "queued",
        input: { mode: "full", sourceKind, sourceTextLength: sourceText.length, titleHint: titleHint ?? null },
        created_by: session.userId,
      })
      .select("id, status, kind, created_at")
      .single();

    if (jobError || !job) return errorResponse("JOB_FAILED", jobError?.message ?? "Could not create the job.", 500);

    // Runs the first chunk of work synchronously (one invocation's worth —
    // see lib/ai/full-course-builder.ts's TIME_BUDGET_PER_INVOCATION_MS)
    // rather than firing it into the background: nothing here or after this
    // self-triggers a continuation any more (that pattern is what hit
    // Vercel's own loop protection in production — see that file's header),
    // so the client's poll loop is what drives every chunk after this one
    // via POST .../resume-full. Delaying this response by one chunk's worth
    // of work is a small, deliberate trade for a job whose progress can
    // actually be trusted.
    await startFullCourseJob(createAdminClient(), {
      orgId: session.orgId!,
      userId: session.userId,
      jobId: job.id,
      sourceText,
      sourceKind,
      titleHint,
    });

    return successResponse({ job }, 202);
  },
  { minRole: "org_admin", rateLimit: aiGenerateLimiter }
);
