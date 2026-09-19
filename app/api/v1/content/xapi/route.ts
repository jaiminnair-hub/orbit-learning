import { withAuth } from "@/lib/api/with-auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { extractTincanPackage } from "@/lib/content/tincan";
import { contentTypeFor } from "@/lib/content/zip";
import { PackageTooLargeError } from "@/lib/content/zip";
import { xapiRegisterLimiter } from "@/lib/ratelimit";

const BUCKET = "content-assets";

export const GET = withAuth(
  async (_request, { session }) => {
    const supabase = await createClient();
    const { data: packages, error } = await supabase
      .from("xapi_packages")
      .select("id, title, activity_id, launch_path, status, version, content_asset_id, created_at")
      .eq("org_id", session.orgId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (error) return errorResponse("QUERY_FAILED", error.message, 500);
    return successResponse({ packages: packages ?? [] });
  },
  { minRole: "org_admin" }
);

// Registers an already-uploaded xAPI/Tin Can .zip content asset: downloads
// it, extracts it, reads tincan.xml for the title/activity id/launch path,
// and writes every extracted file back to Storage under a per-package
// prefix — the same shape as app/api/v1/content/scorm/route.ts, extraction
// happening server-side so a client-supplied manifest is never trusted.
export const POST = withAuth(
  async (request, { session }) => {
    if (!session.orgId) {
      return errorResponse("NO_ORG", "You must belong to an organization.", 409);
    }

    const body = await request.json().catch(() => null);
    const contentAssetId = typeof body?.contentAssetId === "string" ? body.contentAssetId : "";
    if (!contentAssetId) {
      return errorResponse("INVALID_INPUT", "contentAssetId is required.", 400);
    }

    const supabase = await createClient();
    const { data: asset, error: assetError } = await supabase
      .from("content_assets")
      .select("id, org_id, type, storage_path")
      .eq("id", contentAssetId)
      .single();

    if (assetError || !asset) {
      return errorResponse("NOT_FOUND", "No such content asset in your organization.", 404);
    }
    if (asset.type !== "xapi") {
      return errorResponse("INVALID_INPUT", "Content asset is not of type 'xapi'.", 400);
    }

    const admin = createAdminClient();
    const { data: blob, error: dlError } = await admin.storage
      .from(BUCKET)
      .download(asset.storage_path);
    if (dlError || !blob) {
      return errorResponse("STORAGE_READ_FAILED", dlError?.message ?? "Download failed.", 500);
    }

    let extracted;
    try {
      extracted = extractTincanPackage(new Uint8Array(await blob.arrayBuffer()));
    } catch (err) {
      if (err instanceof PackageTooLargeError) {
        return errorResponse("PACKAGE_TOO_LARGE", err.message, 413);
      }
      return errorResponse(
        "INVALID_PACKAGE",
        err instanceof Error ? err.message : "Could not read xAPI package.",
        400
      );
    }

    const packageId = crypto.randomUUID();
    const extractedPrefix = `${session.orgId}/xapi/${packageId}`;

    for (const file of extracted.files) {
      const { error: upError } = await admin.storage
        .from(BUCKET)
        .upload(`${extractedPrefix}/${file.path}`, file.bytes, {
          contentType: contentTypeFor(file.path),
          upsert: true,
        });
      if (upError) {
        return errorResponse("STORAGE_WRITE_FAILED", upError.message, 500);
      }
    }

    const { data: pkg, error: insertError } = await supabase
      .from("xapi_packages")
      .insert({
        id: packageId,
        org_id: session.orgId,
        content_asset_id: asset.id,
        title: extracted.manifest.title,
        activity_id: extracted.manifest.activityId,
        launch_path: extracted.manifest.launch,
        extracted_prefix: extractedPrefix,
        manifest: { fileCount: extracted.files.length },
        created_by: session.userId,
      })
      .select("id, title, activity_id, launch_path, status, version, created_at")
      .single();

    if (insertError) return errorResponse("CREATE_FAILED", insertError.message, 500);

    return successResponse({ package: pkg, fileCount: extracted.files.length }, 201);
  },
  { minRole: "org_admin", rateLimit: xapiRegisterLimiter }
);
