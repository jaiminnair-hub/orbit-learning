import { withAuth } from "@/lib/api/with-auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const BUCKET = "content-assets";
// 'image' added in Phase 3 step 6, 'xapi' added 2026-09-03 (xAPI/Tin Can
// ingest) — each alongside a matching content_assets_type_check widening.
const VALID_TYPES = ["text", "video", "audio", "pdf", "ppt", "document", "url", "embed", "scorm", "image", "xapi"];

// Security-audit finding (2026-09-16): nothing previously checked that a
// claimed `type` matched what was actually uploaded, and the bucket's
// allowlist permits text/html and image/svg+xml (needed for legitimate
// SCORM re-upload). Combined, an org_admin could register HTML/SVG-with-
// script as an "image" asset and hand out a signed URL to it. Types with no
// real uploaded bytes behind them ("url", "embed") are deliberately absent
// here — this only constrains types that carry an actual Storage object.
const TYPE_MIME_RULES: Record<string, (mime: string) => boolean> = {
  image: (m) => m.startsWith("image/"),
  video: (m) => m.startsWith("video/"),
  audio: (m) => m.startsWith("audio/"),
  pdf: (m) => m === "application/pdf",
  ppt: (m) =>
    m === "application/vnd.ms-powerpoint" ||
    m === "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  document: (m) =>
    m === "application/msword" ||
    m === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    m === "text/plain",
  text: (m) => m.startsWith("text/") && m !== "text/html",
  scorm: (m) => m === "application/zip" || m === "application/x-zip-compressed",
  xapi: (m) => m === "application/zip" || m === "application/x-zip-compressed",
};

export const GET = withAuth(
  async (_request, { session }) => {
    const supabase = await createClient();
    const { data: assets, error } = await supabase
      .from("content_assets")
      .select("id, type, storage_path, mime_type, file_size, status, version, created_at")
      .eq("org_id", session.orgId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (error) return errorResponse("QUERY_FAILED", error.message, 500);
    return successResponse({ assets: assets ?? [] });
  },
  { minRole: "org_admin" }
);

// Step 2 of the two-step upload flow (docs/API_SPEC.md §6). Confirms the
// object genuinely landed in Storage — via the service-role client,
// since it's the only thing with access to the private bucket — before
// creating the content_asset row; never trusts the client's say-so
// alone. The actual row insert goes through the caller's own session
// client: content_assets_insert's RLS policy already permits org_admin+
// (docs/MULTI_TENANCY.md §3), unlike profile/org mutations which need
// service_role because of the escalation-prevention trigger.
export const POST = withAuth(
  async (request, { session }) => {
    if (!session.orgId) {
      return errorResponse("NO_ORG", "You must belong to an organization.", 409);
    }

    const body = await request.json().catch(() => null);
    const storagePath = typeof body?.storagePath === "string" ? body.storagePath : "";
    const type = body?.type as string | undefined;
    const mimeType = typeof body?.mimeType === "string" ? body.mimeType : null;
    const fileSize = typeof body?.fileSize === "number" ? body.fileSize : null;

    if (!storagePath.startsWith(`${session.orgId}/`)) {
      return errorResponse(
        "INVALID_INPUT",
        "storagePath does not belong to your organization.",
        400
      );
    }
    if (!type || !VALID_TYPES.includes(type)) {
      return errorResponse("INVALID_INPUT", "A valid content type is required.", 400);
    }

    const admin = createAdminClient();
    const slashIndex = storagePath.lastIndexOf("/");
    const dir = storagePath.slice(0, slashIndex);
    const filename = storagePath.slice(slashIndex + 1);
    const { data: listed, error: listError } = await admin.storage
      .from(BUCKET)
      .list(dir, { search: filename });

    if (listError) return errorResponse("STORAGE_CHECK_FAILED", listError.message, 500);
    const uploaded = listed?.find((f) => f.name === filename);
    if (!uploaded) {
      return errorResponse("UPLOAD_NOT_FOUND", "No uploaded object found at storagePath.", 404);
    }

    // Storage's own record of what was actually uploaded, not the client's
    // say-so — the whole point of this check is that the client's claimed
    // `type` and `mimeType` can't be trusted on their own.
    const actualMimeType = (uploaded as { metadata?: { mimetype?: string } }).metadata?.mimetype ?? mimeType;
    const rule = TYPE_MIME_RULES[type];
    if (rule && actualMimeType && !rule(actualMimeType)) {
      return errorResponse(
        "TYPE_MISMATCH",
        `The uploaded file's content type (${actualMimeType}) does not match the declared type '${type}'.`,
        400
      );
    }

    const supabase = await createClient();
    const { data: asset, error } = await supabase
      .from("content_assets")
      .insert({
        org_id: session.orgId,
        type,
        storage_path: storagePath,
        mime_type: actualMimeType,
        file_size: fileSize,
        created_by: session.userId,
      })
      .select("id, type, storage_path, mime_type, file_size, status, version, created_at")
      .single();

    if (error) return errorResponse("CREATE_FAILED", error.message, 500);
    return successResponse({ asset }, 201);
  },
  { minRole: "org_admin" }
);
