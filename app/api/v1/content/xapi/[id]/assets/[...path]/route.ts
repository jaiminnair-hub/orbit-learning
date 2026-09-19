import { withAuth } from "@/lib/api/with-auth";
import { errorResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { contentTypeFor } from "@/lib/content/zip";

const BUCKET = "content-assets";

// Serves one extracted file from an xAPI/Tin Can package — the same
// same-origin serving shape as
// app/api/v1/content/scorm/[id]/assets/[...path]/route.ts, and safe here
// without that route's separate content-isolation origin
// (docs/SCORM_CONTENT_ISOLATION_ARCHITECTURE.md): unlike SCORM, xAPI
// content never needs `window.parent` access (there is no CMI API to
// discover), so the launch iframe is sandboxed *without*
// `allow-same-origin` (components/xapi/XapiPlayer.tsx) — the browser
// gives it a unique opaque origin regardless of where the bytes were
// served from, which fully blocks cookie/DOM access to the real app
// origin without a second Vercel deployment. See
// docs/XAPI_INGEST_ARCHITECTURE.md.
export const GET = withAuth(
  async (_request, { session, params }) => {
    const { id, path } = await params;
    const relativePath = path.join("/");

    if (relativePath.includes("..")) {
      return errorResponse("INVALID_PATH", "Path traversal is not allowed.", 400);
    }

    const supabase = await createClient();
    const { data: pkg, error } = await supabase
      .from("xapi_packages")
      .select("id, org_id, extracted_prefix")
      .eq("id", id)
      .single();

    if (error || !pkg || pkg.org_id !== session.orgId) {
      return errorResponse("NOT_FOUND", "No such xAPI package.", 404);
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
