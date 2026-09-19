import { withAuth } from "@/lib/api/with-auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const BUCKET = "content-assets";
const TTL_SECONDS = 300;

type Ctx = { params: Promise<{ id: string }> };

// Issues a short-lived signed download URL for one content asset.
// No minRole: a learner has to be able to open the material in a course
// they're taking. RLS on content_assets decides visibility — an asset in
// another org resolves to 404 here, never a URL.
//
// Signed server-side and short-lived on purpose: the bucket is private
// and has no storage.objects policy, so this route is the only way in.
export const GET = withAuth<Ctx>(async (_request, { session, params }) => {
  const { id } = await params;

  const supabase = await createClient();
  const { data: asset, error } = await supabase
    .from("content_assets")
    .select("id, org_id, type, storage_path, mime_type")
    .eq("id", id)
    .is("deleted_at", null)
    .single();

  if (error || !asset || asset.org_id !== session.orgId) {
    return errorResponse("NOT_FOUND", "No such content asset.", 404);
  }

  const admin = createAdminClient();
  // A signed URL to text/html or image/svg+xml renders as a full document,
  // script and all, if ever opened as a top-level navigation rather than
  // embedded in an <img>/<video> tag — forcing a download disposition here
  // (Storage sets Content-Disposition: attachment) closes that without
  // affecting normal in-app embedding, which browsers don't gate on it.
  const RENDERS_AS_DOCUMENT = new Set(["text/html", "image/svg+xml", "application/xhtml+xml"]);
  const forceDownload = !!asset.mime_type && RENDERS_AS_DOCUMENT.has(asset.mime_type);
  const { data: signed, error: signError } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(asset.storage_path, TTL_SECONDS, forceDownload ? { download: true } : undefined);

  if (signError || !signed) {
    return errorResponse("SIGN_FAILED", signError?.message ?? "Could not sign URL.", 500);
  }

  return successResponse({
    url: signed.signedUrl,
    type: asset.type,
    mimeType: asset.mime_type,
    expiresInSeconds: TTL_SECONDS,
  });
});
