import { withAuth } from "@/lib/api/with-auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";

function slugify(title: string): string {
  return (
    title.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) ||
    "course"
  );
}

// Any org member may list courses — learners need to see published ones
// to enrol (step 6). Callers filter by status; RLS handles the tenancy.
export const GET = withAuth(async (request, { session }) => {
  const url = new URL(request.url);
  const status = url.searchParams.get("status");

  const supabase = await createClient();
  let query = supabase
    .from("courses")
    .select("id, title, slug, description, status, version, published_at, created_at")
    .eq("org_id", session.orgId)
    .is("deleted_at", null);

  if (status) query = query.eq("status", status);

  const { data: courses, error } = await query.order("created_at", { ascending: false });
  if (error) return errorResponse("QUERY_FAILED", error.message, 500);
  return successResponse({ courses: courses ?? [] });
});

export const POST = withAuth(
  async (request, { session }) => {
    if (!session.orgId) {
      return errorResponse("NO_ORG", "You must belong to an organization.", 409);
    }

    const body = await request.json().catch(() => null);
    const title = typeof body?.title === "string" ? body.title.trim() : "";
    const description = typeof body?.description === "string" ? body.description : null;
    if (!title) return errorResponse("INVALID_INPUT", "A title is required.", 400);

    const supabase = await createClient();
    const base = slugify(title);

    for (let attempt = 0; attempt < 5; attempt++) {
      const slug = attempt === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 7)}`;
      const { data: course, error } = await supabase
        .from("courses")
        .insert({
          org_id: session.orgId,
          title,
          slug,
          description,
          owner_id: session.userId,
          created_by: session.userId,
        })
        .select("id, title, slug, description, status, version, created_at")
        .single();

      if (!error) return successResponse({ course }, 201);
      if (error.code !== "23505") return errorResponse("CREATE_FAILED", error.message, 500);
    }

    return errorResponse("CREATE_FAILED", "Could not allocate a unique course slug.", 500);
  },
  { minRole: "org_admin" }
);
