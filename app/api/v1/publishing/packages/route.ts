import { after } from "next/server";
import { withAuth } from "@/lib/api/with-auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PACKAGE_FORMATS, UNIMPLEMENTED_FORMATS, runPackageJob, type PackageFormat } from "@/lib/publishing/build";
import { publishBuildLimiter } from "@/lib/ratelimit";

const LIST_COLUMNS =
  "id, course_specification_id, spec_version, format, storage_path, file_size, manifest, built_by_job_id, created_at";

// docs/PHASE3_API_EVENTS.md §4.
export const GET = withAuth(
  async (request, { session }) => {
    const url = new URL(request.url);
    const specId = url.searchParams.get("specId");

    const supabase = await createClient();
    let query = supabase
      .from("published_packages")
      .select(LIST_COLUMNS)
      .eq("org_id", session.orgId)
      .order("created_at", { ascending: false });

    if (specId) query = query.eq("course_specification_id", specId);

    const { data, error } = await query;
    if (error) return errorResponse("QUERY_FAILED", error.message, 500);
    return successResponse({ packages: data ?? [] });
  },
  { minRole: "org_admin" }
);

/**
 * Starts a package build and returns a job id without waiting for it.
 *
 * Accept-and-return rather than build-in-the-request, for the reason
 * PHASE3_API_EVENTS.md §4 gives: zipping a course with media is not a
 * request-time operation, and a client that has to hold a connection open for
 * it will eventually meet a proxy that disagrees.
 *
 * The work runs in `after()`, which Next defers until the response has been
 * sent while keeping the invocation alive — the platform-native equivalent of
 * the durable job the step-1 spike built on Cloudflare Workflows, without
 * binding the publishing surface to that host.
 */
export const POST = withAuth(
  async (request, { session }) => {
    const body = await request.json().catch(() => null);
    const specId = typeof body?.specId === "string" ? body.specId : "";
    const format = typeof body?.format === "string" ? body.format : "";

    if (!specId) return errorResponse("INVALID_INPUT", "specId is required.", 400);

    if (!PACKAGE_FORMATS.includes(format as PackageFormat)) {
      const planned = (UNIMPLEMENTED_FORMATS as readonly string[]).includes(format);
      return errorResponse(
        "INVALID_INPUT",
        planned
          ? `'${format}' is planned but not built yet. Available now: ${PACKAGE_FORMATS.join(", ")}.`
          : `format must be one of: ${PACKAGE_FORMATS.join(", ")}.`,
        400
      );
    }

    const supabase = await createClient();
    const { data: spec } = await supabase
      .from("course_specifications")
      .select("id, org_id, status")
      .eq("id", specId)
      .is("deleted_at", null)
      .single();

    if (!spec || spec.org_id !== session.orgId) {
      return errorResponse("NOT_FOUND", "No such course specification in your organization.", 404);
    }
    // Checked here as well as in the builder so the author is told immediately
    // rather than by a job that fails a moment later.
    if (spec.status !== "published") {
      return errorResponse("NOT_PUBLISHED", "Only a published course can be packaged.", 409);
    }

    const { data: job, error: jobError } = await supabase
      .from("authoring_jobs")
      .insert({
        org_id: session.orgId,
        kind: "publish_package",
        status: "queued",
        input: { specId, format },
        created_by: session.userId,
      })
      .select("id, status, kind, created_at")
      .single();

    if (jobError) return errorResponse("JOB_FAILED", jobError.message, 500);

    after(async () => {
      await runPackageJob(createAdminClient(), {
        specId,
        orgId: session.orgId!,
        userId: session.userId,
        format: format as PackageFormat,
        jobId: job.id,
      });
    });

    return successResponse({ job }, 202);
  },
  { minRole: "org_admin", rateLimit: publishBuildLimiter }
);
