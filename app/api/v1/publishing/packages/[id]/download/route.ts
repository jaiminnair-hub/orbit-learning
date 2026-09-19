import { withAuth } from "@/lib/api/with-auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const BUCKET = "published-packages";
const TTL_SECONDS = 300;

type Ctx = { params: Promise<{ id: string }> };

/**
 * Short-lived signed download for a built package — docs/PHASE3_API_EVENTS.md §4.
 *
 * The row is read through the caller's own session client first, so RLS
 * decides whether this org may see this package at all; the service-role
 * client is used only to sign, because the bucket is private and has no
 * `storage.objects` policy. A package belonging to another org resolves to a
 * 404 here and never reaches the signing step — which is the specific leak
 * PHASE3_DATA_MODEL.md §7 called out as easy to overlook.
 */
export const GET = withAuth<Ctx>(
  async (_request, { session, params }) => {
    const { id } = await params;

    const supabase = await createClient();
    const { data: pkg, error } = await supabase
      .from("published_packages")
      .select("id, org_id, format, storage_path, file_size, spec_version, course_specification_id")
      .eq("id", id)
      .single();

    if (error || !pkg || pkg.org_id !== session.orgId) {
      return errorResponse("NOT_FOUND", "No such package in your organization.", 404);
    }

    const admin = createAdminClient();
    const { data: signed, error: signError } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(pkg.storage_path, TTL_SECONDS, {
        download: `${pkg.format}-v${pkg.spec_version}.zip`,
      });

    if (signError || !signed) {
      return errorResponse("SIGN_FAILED", signError?.message ?? "Could not sign the download URL.", 500);
    }

    return successResponse({
      url: signed.signedUrl,
      format: pkg.format,
      fileSize: pkg.file_size,
      specVersion: pkg.spec_version,
      expiresInSeconds: TTL_SECONDS,
    });
  },
  { minRole: "org_admin" }
);
