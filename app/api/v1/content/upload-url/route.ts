import { withAuth } from "@/lib/api/with-auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createAdminClient } from "@/lib/supabase/admin";
import { uploadUrlLimiter } from "@/lib/ratelimit";

const BUCKET = "content-assets";

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
}

// Step 1 of the two-step upload flow (docs/API_SPEC.md §6): generates a
// signed Storage upload URL scoped to this org's path prefix
// (docs/MULTI_TENANCY.md §5 — "org_id/..."). The client uploads
// directly to Storage with this URL/token, then confirms via
// POST /api/v1/content/assets to create the content_asset row — this
// route never touches the database. Uses the service-role client
// because the bucket is private with no storage.objects RLS policy;
// every upload is mediated server-side, never direct client access.
export const POST = withAuth(
  async (request, { session }) => {
    if (!session.orgId) {
      return errorResponse("NO_ORG", "You must belong to an organization.", 409);
    }

    const body = await request.json().catch(() => null);
    const filename = typeof body?.filename === "string" ? body.filename.trim() : "";
    if (!filename) {
      return errorResponse("INVALID_INPUT", "A filename is required.", 400);
    }

    const storagePath = `${session.orgId}/${crypto.randomUUID()}-${sanitizeFilename(filename)}`;

    const admin = createAdminClient();
    const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(storagePath);

    if (error) {
      return errorResponse("UPLOAD_URL_FAILED", error.message, 500);
    }

    return successResponse({ path: data.path, token: data.token, signedUrl: data.signedUrl });
  },
  { minRole: "org_admin", rateLimit: uploadUrlLimiter }
);
