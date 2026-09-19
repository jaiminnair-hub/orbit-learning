import { withAuth } from "@/lib/api/with-auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const BUCKET = "content-assets";
const TTL_SECONDS = 300;

type Ctx = { params: Promise<{ id: string }> };

// Everything the player needs to render one learning object: a signed
// URL per composed content asset, plus the SCORM package details when
// one of those assets is a SCORM zip.
//
// No minRole — learners play courses. RLS on learning_objects,
// content_assets and scorm_packages scopes all of it to the caller's org.
export const GET = withAuth<Ctx>(async (_request, { session, params }) => {
  const { id } = await params;
  const supabase = await createClient();

  const { data: lo, error } = await supabase
    .from("learning_objects")
    .select("id, org_id")
    .eq("id", id)
    .is("deleted_at", null)
    .single();

  if (error || !lo || lo.org_id !== session.orgId) {
    return errorResponse("NOT_FOUND", "No such learning object.", 404);
  }

  const { data: links } = await supabase
    .from("learning_object_assets")
    .select("sequence, content_assets(id, type, storage_path, mime_type)")
    .eq("learning_object_id", id)
    .order("sequence");

  const admin = createAdminClient();
  const assets: Array<{ assetId: string; type: string; url: string }> = [];
  let scorm: { packageId: string; entryPoint: string; scormVersion: string } | null = null;
  let xapi: { packageId: string } | null = null;

  for (const link of links ?? []) {
    const asset = link.content_assets as unknown as {
      id: string;
      type: string;
      storage_path: string;
    } | null;
    if (!asset) continue;

    if (asset.type === "scorm") {
      // SCORM is served from its extracted prefix by its own route, not
      // as a signed zip download.
      const { data: pkg } = await supabase
        .from("scorm_packages")
        .select("id, entry_point, scorm_version")
        .eq("content_asset_id", asset.id)
        .maybeSingle();
      // The version decides which API name the player publishes on
      // window, so the client is never left to guess it.
      if (pkg) {
        scorm = {
          packageId: pkg.id,
          entryPoint: pkg.entry_point,
          scormVersion: pkg.scorm_version,
        };
      }
      continue;
    }

    if (asset.type === "xapi") {
      // Same shape as SCORM: served from its own extracted prefix, via
      // its own launch route, not a signed zip download. Unlike SCORM,
      // the player needs nothing else from here — the launch route looks
      // up everything (activity id, launch path) itself.
      const { data: pkg } = await supabase
        .from("xapi_packages")
        .select("id")
        .eq("content_asset_id", asset.id)
        .maybeSingle();
      if (pkg) xapi = { packageId: pkg.id };
      continue;
    }

    const { data: signed } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(asset.storage_path, TTL_SECONDS);
    if (signed) assets.push({ assetId: asset.id, type: asset.type, url: signed.signedUrl });
  }

  return successResponse({ assets, scorm, xapi });
});

// Attach an existing content asset to this learning object. The
// composition table and its RLS already existed (Phase 2 step 3) — the
// creation route just took assetIds up front, so this is the missing
// "attach later" verb the authoring UI needs, not a new capability.
export const POST = withAuth<Ctx>(
  async (request, { session, params }) => {
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const contentAssetId = typeof body?.contentAssetId === "string" ? body.contentAssetId : "";
    if (!contentAssetId) {
      return errorResponse("INVALID_INPUT", "contentAssetId is required.", 400);
    }

    const supabase = await createClient();
    const { data: lo } = await supabase
      .from("learning_objects")
      .select("id, org_id")
      .eq("id", id)
      .single();
    if (!lo || lo.org_id !== session.orgId) {
      return errorResponse("NOT_FOUND", "No such learning object.", 404);
    }

    const { count } = await supabase
      .from("learning_object_assets")
      .select("*", { count: "exact", head: true })
      .eq("learning_object_id", id);

    const { data: link, error } = await supabase
      .from("learning_object_assets")
      .insert({
        org_id: session.orgId,
        learning_object_id: id,
        content_asset_id: contentAssetId,
        sequence: count ?? 0,
      })
      .select("id, content_asset_id, sequence")
      .single();

    if (error) {
      if (error.code === "23505") {
        return errorResponse("ALREADY_ATTACHED", "That asset is already attached.", 409);
      }
      return errorResponse("ATTACH_FAILED", error.message, 500);
    }
    return successResponse({ attached: link }, 201);
  },
  { minRole: "org_admin" }
);

export const DELETE = withAuth<Ctx>(
  async (request, { session, params }) => {
    const { id } = await params;
    const url = new URL(request.url);
    const contentAssetId = url.searchParams.get("contentAssetId") ?? "";
    if (!contentAssetId) {
      return errorResponse("INVALID_INPUT", "contentAssetId is required.", 400);
    }

    const supabase = await createClient();
    const { error } = await supabase
      .from("learning_object_assets")
      .delete()
      .eq("learning_object_id", id)
      .eq("content_asset_id", contentAssetId)
      .eq("org_id", session.orgId);

    if (error) return errorResponse("DETACH_FAILED", error.message, 500);
    return successResponse({ detached: true });
  },
  { minRole: "org_admin" }
);
