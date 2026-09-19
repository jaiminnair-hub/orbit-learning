import { withAuth } from "@/lib/api/with-auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";

type Ctx = { params: Promise<{ id: string }> };

// Editing a course's own fields. Thin plumbing over the existing
// courses_update RLS policy so the authoring UI can do the "edit" half
// of "create/edit course" — no new capability, just the missing verb.
//
// Deliberately does NOT touch status or version: those move only through
// the /publish state machine, so there's no back door around it.
export const PATCH = withAuth<Ctx>(
  async (request, { session, params }) => {
    const { id } = await params;
    const body = await request.json().catch(() => null);

    const patch: Record<string, string | null> = {};
    if (typeof body?.title === "string") {
      const title = body.title.trim();
      if (!title) return errorResponse("INVALID_INPUT", "Title cannot be empty.", 400);
      patch.title = title;
    }
    if (typeof body?.description === "string" || body?.description === null) {
      patch.description = body.description === null ? null : String(body.description);
    }
    if (Object.keys(patch).length === 0) {
      return errorResponse("INVALID_INPUT", "Nothing to update.", 400);
    }

    const supabase = await createClient();
    const { data: course } = await supabase
      .from("courses")
      .select("id, org_id")
      .eq("id", id)
      .single();

    if (!course || course.org_id !== session.orgId) {
      return errorResponse("NOT_FOUND", "No such course in your organization.", 404);
    }

    const { data: updated, error } = await supabase
      .from("courses")
      .update(patch)
      .eq("id", id)
      .select("id, title, slug, description, status, version, published_at")
      .single();

    if (error) return errorResponse("UPDATE_FAILED", error.message, 500);
    return successResponse({ course: updated });
  },
  { minRole: "org_admin" }
);
