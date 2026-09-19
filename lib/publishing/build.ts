import type { SupabaseClient } from "@supabase/supabase-js";
import { CourseSpec, validateCourseSpec } from "@/lib/spec";
import { renderCourse } from "@/lib/export/render";
import { buildScorm2004Package } from "@/lib/export/scorm2004";
import { buildScorm12Package } from "@/lib/export/scorm12";
import { buildCmi5Package } from "@/lib/export/cmi5";
import { buildXapiPackage } from "@/lib/export/xapi";

/**
 * Package building — Phase 3 step 9.
 *
 * Takes a published specification and produces a distributable an unrelated
 * LMS can ingest. The two formats here are the two proven end to end in
 * SCORM Cloud during step 3 (`spikes/export-conformance/`); adding another is
 * a registry entry plus a packager, not a change to this pipeline.
 *
 * Deliberately a plain async function rather than a Cloudflare Workflow. The
 * step-1 spike proved Workflows carry long multi-step AI generation, which is
 * what step 8 needs — packaging is a render, a zip and an upload, and wrapping
 * it in durable orchestration would buy nothing while tying it to a host the
 * platform is moving off.
 */

export const PACKAGE_FORMATS = ["scorm2004", "scorm12", "cmi5", "xapi"] as const;
export type PackageFormat = (typeof PACKAGE_FORMATS)[number];

/**
 * Declared in the data model but not yet implemented. Listed explicitly so the
 * gap is visible in code rather than discovered by an author picking one.
 * Empty now that xAPI export has shipped — kept as a typed array (not
 * removed) so a future format can be declared-but-unbuilt again the same
 * honest way, and so nothing downstream that types against this array
 * (e.g. the "format that is planned but unbuilt" test) needs restructuring.
 */
export const UNIMPLEMENTED_FORMATS = [] as const;

const BUCKET = "published-packages";

export interface BuildRequest {
  specId: string;
  orgId: string;
  userId: string;
  format: PackageFormat;
  jobId?: string | null;
}

export interface BuildResult {
  packageId: string;
  storagePath: string;
  fileSize: number;
  specVersion: number;
}

export class PublishBuildError extends Error {
  constructor(
    message: string,
    readonly code: "NOT_FOUND" | "NOT_PUBLISHED" | "INVALID_SPEC" | "UNSUPPORTED_FORMAT" | "BUILD_FAILED",
    readonly details?: unknown
  ) {
    super(message);
    this.name = "PublishBuildError";
  }
}

/**
 * `admin` is the service-role client throughout.
 *
 * `published_packages` has a select policy and deliberately no insert policy
 * for tenant roles (20260820133000): a package row asserts "this artifact was
 * built from this exact spec version", which only the build path may claim.
 * Storage writes need it for the same reason — the bucket is private with no
 * `storage.objects` policy at all.
 */
export async function buildPackage(admin: SupabaseClient, request: BuildRequest): Promise<BuildResult> {
  const { specId, orgId, userId, format, jobId } = request;

  if (!PACKAGE_FORMATS.includes(format)) {
    throw new PublishBuildError(
      `Format '${format}' is not supported yet. Available: ${PACKAGE_FORMATS.join(", ")}.`,
      "UNSUPPORTED_FORMAT"
    );
  }

  const { data: row, error } = await admin
    .from("course_specifications")
    .select("id, org_id, title, spec, spec_schema_version, status, version")
    .eq("id", specId)
    .is("deleted_at", null)
    .single();

  if (error || !row || row.org_id !== orgId) {
    throw new PublishBuildError("No such course specification.", "NOT_FOUND");
  }

  // Only a published spec is packageable. Exporting a draft would put an
  // unreviewed course into somebody else's LMS, where our workflow gate no
  // longer applies to it.
  if (row.status !== "published") {
    throw new PublishBuildError(
      "Only a published course can be packaged. Publish it first.",
      "NOT_PUBLISHED"
    );
  }

  const parsed = CourseSpec.safeParse(row.spec);
  if (!parsed.success) {
    throw new PublishBuildError("This course's specification is no longer valid.", "INVALID_SPEC", {
      issues: parsed.error.issues.slice(0, 10).map((i) => ({ path: i.path.join("/"), message: i.message })),
    });
  }

  // Re-validating rather than trusting the publish gate: the spec was valid
  // when published, but a schema version bump since then would change that,
  // and shipping a package built from a spec we can no longer interpret is
  // exactly the silent failure step 3 exists to prevent.
  const report = validateCourseSpec(parsed.data);
  if (report.findings.some((f) => f.severity === "error")) {
    throw new PublishBuildError("This course has validation errors and cannot be packaged.", "INVALID_SPEC", {
      findings: report.findings.filter((f) => f.severity === "error").slice(0, 10),
    });
  }

  const rendered = renderCourse(parsed.data);
  if (rendered.pages.length === 0) {
    throw new PublishBuildError("This course has no packageable pages.", "BUILD_FAILED");
  }

  let bytes: Uint8Array;
  try {
    bytes =
      format === "scorm2004"
        ? buildScorm2004Package({
            title: rendered.title,
            identifier: `urn:lms:course:${specId}`,
            pages: rendered.pages,
            contentScript: rendered.contentScript,
          })
        : format === "scorm12"
        ? buildScorm12Package({
            title: rendered.title,
            identifier: `urn:lms:course:${specId}`,
            pages: rendered.pages,
            contentScript: rendered.contentScript,
          })
        : format === "xapi"
        ? buildXapiPackage({
            title: rendered.title,
            description: rendered.description || rendered.title,
            // Tin Can activity ids are IRIs, not arbitrary strings.
            activityId: `https://lms.invalid/course/${specId}`,
            pages: rendered.pages,
            contentScript: rendered.contentScript,
          })
        : buildCmi5Package({
            title: rendered.title,
            description: rendered.description || rendered.title,
            // cmi5 ids are IRIs, not arbitrary strings.
            courseId: `https://lms.invalid/course/${specId}`,
            auId: `https://lms.invalid/course/${specId}/au/1`,
            pages: rendered.pages,
            contentScript: rendered.contentScript,
          });
  } catch (cause) {
    throw new PublishBuildError(
      `Packaging failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      "BUILD_FAILED"
    );
  }

  // org-prefixed, exactly like content-assets — the prefix is what makes a
  // stray signed URL scoped to one tenant's namespace.
  const storagePath = `${orgId}/${specId}/v${row.version}-${format}-${Date.now()}.zip`;

  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(storagePath, bytes, { contentType: "application/zip", upsert: false });

  if (uploadError) {
    throw new PublishBuildError(`Could not store the package: ${uploadError.message}`, "BUILD_FAILED");
  }

  const { data: pkg, error: insertError } = await admin
    .from("published_packages")
    .insert({
      org_id: orgId,
      course_specification_id: specId,
      spec_version: row.version,
      format,
      storage_path: storagePath,
      manifest: {
        pageCount: rendered.pages.length,
        quizBlockIds: rendered.quizBlockIds,
        assetIds: rendered.assetIds,
        specSchemaVersion: row.spec_schema_version,
        title: rendered.title,
      },
      file_size: bytes.byteLength,
      built_by_job_id: jobId ?? null,
      created_by: userId,
    })
    .select("id")
    .single();

  if (insertError) {
    // The bytes are already in storage; leaving them without a row would be an
    // orphan nobody can find or delete through the product.
    await admin.storage.from(BUCKET).remove([storagePath]);
    throw new PublishBuildError(`Could not record the package: ${insertError.message}`, "BUILD_FAILED");
  }

  return {
    packageId: pkg.id,
    storagePath,
    fileSize: bytes.byteLength,
    specVersion: row.version,
  };
}

/**
 * Runs a build as a tracked job.
 *
 * `authoring_jobs` already models exactly this — kind, status, input, output,
 * per-step detail — so packaging reuses it rather than inventing a second
 * notion of "work in progress" for the publishing surface to poll.
 */
export async function runPackageJob(admin: SupabaseClient, request: BuildRequest & { jobId: string }): Promise<void> {
  const startedAt = new Date().toISOString();
  await admin
    .from("authoring_jobs")
    .update({ status: "running", started_at: startedAt })
    .eq("id", request.jobId);

  try {
    const result = await buildPackage(admin, request);
    await admin
      .from("authoring_jobs")
      .update({
        status: "succeeded",
        finished_at: new Date().toISOString(),
        output: result,
        steps: [{ name: "build_package", status: "succeeded", format: request.format }],
      })
      .eq("id", request.jobId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = error instanceof PublishBuildError ? error.code : "BUILD_FAILED";
    await admin
      .from("authoring_jobs")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        error: message,
        steps: [{ name: "build_package", status: "failed", code, format: request.format }],
      })
      .eq("id", request.jobId);
  }
}
