import { withAuth } from "@/lib/api/with-auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { extractPackage, contentTypeFor, ScormPackageTooLargeError } from "@/lib/content/scorm";
import { scormRegisterLimiter } from "@/lib/ratelimit";

const BUCKET = "content-assets";

export const GET = withAuth(
  async (_request, { session }) => {
    const supabase = await createClient();
    const { data: packages, error } = await supabase
      .from("scorm_packages")
      .select("id, title, scorm_version, entry_point, status, version, content_asset_id, created_at")
      .eq("org_id", session.orgId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (error) return errorResponse("QUERY_FAILED", error.message, 500);
    return successResponse({ packages: packages ?? [] });
  },
  { minRole: "org_admin" }
);

// Registers an already-uploaded SCORM .zip content asset: downloads it,
// extracts it, reads imsmanifest.xml for the title/version/entry point,
// and writes every extracted file back to Storage under a per-package
// prefix so the player can serve them individually.
//
// Extraction happens server-side (never trusting a client-supplied
// manifest) via fflate, which runs on Cloudflare Workers — the whole
// reason this step is sequenced before the CMS is built on top of it.
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

    // Read the asset through the caller's own session client so RLS
    // decides whether they may see it at all.
    const supabase = await createClient();
    const { data: asset, error: assetError } = await supabase
      .from("content_assets")
      .select("id, org_id, type, storage_path")
      .eq("id", contentAssetId)
      .single();

    if (assetError || !asset) {
      return errorResponse("NOT_FOUND", "No such content asset in your organization.", 404);
    }
    if (asset.type !== "scorm") {
      return errorResponse("INVALID_INPUT", "Content asset is not of type 'scorm'.", 400);
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
      extracted = extractPackage(new Uint8Array(await blob.arrayBuffer()));
    } catch (err) {
      if (err instanceof ScormPackageTooLargeError) {
        return errorResponse("PACKAGE_TOO_LARGE", err.message, 413);
      }
      return errorResponse(
        "INVALID_PACKAGE",
        err instanceof Error ? err.message : "Could not read SCORM package.",
        400
      );
    }

    const packageId = crypto.randomUUID();
    const extractedPrefix = `${session.orgId}/scorm/${packageId}`;

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
      .from("scorm_packages")
      .insert({
        id: packageId,
        org_id: session.orgId,
        content_asset_id: asset.id,
        title: extracted.manifest.title,
        scorm_version: extracted.manifest.scormVersion,
        entry_point: extracted.manifest.entryPoint,
        extracted_prefix: extractedPrefix,
        manifest: { fileCount: extracted.files.length },
        created_by: session.userId,
      })
      .select("id, title, scorm_version, entry_point, status, version, created_at")
      .single();

    if (insertError) return errorResponse("CREATE_FAILED", insertError.message, 500);

    return successResponse({ package: pkg, fileCount: extracted.files.length }, 201);
  },
  { minRole: "org_admin", rateLimit: scormRegisterLimiter }
);
