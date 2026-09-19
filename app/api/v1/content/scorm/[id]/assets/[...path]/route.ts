import { withAuth } from "@/lib/api/with-auth";
import { errorResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { contentTypeFor } from "@/lib/content/scorm";

const BUCKET = "content-assets";

// Serves one extracted file from a SCORM package. Any authenticated org
// member may read (learners have to run the course), but RLS on
// scorm_packages still decides whether the package is visible to them at
// all — a package in another org resolves to 404 here, never its bytes.
//
// This route is the specific mechanism that broke on an earlier project's host:
// serving .html with an explicit, non-downgraded Content-Type. Preserved
// and verified deliberately.
export const GET = withAuth(
  async (_request, { session, params }) => {
    const { id, path } = await params;
    const relativePath = path.join("/");

    if (relativePath.includes("..")) {
      return errorResponse("INVALID_PATH", "Path traversal is not allowed.", 400);
    }

    const supabase = await createClient();
    const { data: pkg, error } = await supabase
      .from("scorm_packages")
      .select("id, org_id, extracted_prefix")
      .eq("id", id)
      .single();

    if (error || !pkg || pkg.org_id !== session.orgId) {
      return errorResponse("NOT_FOUND", "No such SCORM package.", 404);
    }

    const admin = createAdminClient();
    const { data: blob, error: dlError } = await admin.storage
      .from(BUCKET)
      .download(`${pkg.extracted_prefix}/${relativePath}`);

    if (dlError || !blob) {
      return errorResponse("NOT_FOUND", "No such file in this package.", 404);
    }

    return new Response(await blob.arrayBuffer(), {
      status: 200,
      headers: {
        "Content-Type": contentTypeFor(relativePath),
        "Cache-Control": "private, max-age=300",
      },
    });
  }
) as (
  request: Request,
  ctx: { params: Promise<{ id: string; path: string[] }> }
) => Promise<Response>;
