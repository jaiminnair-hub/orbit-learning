import { withAuth } from "@/lib/api/with-auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";

const COLUMNS = "id, name, description, external_ref, created_at, updated_at";

/**
 * LMS skill tags — Phase 3 step 11.
 *
 * **Deliberately LMS-local, and temporary in that scope.** `skill_tags` was
 * named to avoid colliding with a future `skills` engine carrying proficiency
 * semantics, and Orbit's Competency Management product is that engine. When
 * it ships it should own Orbit's canonical skills and proficiency taxonomy,
 * and this table becomes either a reference into it or a migration source —
 * see docs/ORBIT_PLATFORM_INTEGRATION_REVIEW.md §2b.
 *
 * Nothing here anticipates that. It is a flat org-scoped vocabulary with no
 * proficiency levels, no hierarchy and no cross-product meaning, because
 * inventing any of those now would be inventing Competency Management badly
 * and in the wrong repository. `external_ref` is the seam a later taxonomy
 * import lands on.
 *
 * Authorization is `org_admin` via `withAuth`, matching every other authoring
 * surface. That is an LMS role today; under Orbit it maps to the `lms`
 * product role `l_and_d_admin` or `content_author`.
 */
export const GET = withAuth(
  async (request, { session }) => {
    const url = new URL(request.url);
    const q = (url.searchParams.get("q") ?? "").trim();

    const supabase = await createClient();
    let query = supabase
      .from("skill_tags")
      .select(COLUMNS)
      .eq("org_id", session.orgId)
      .order("name");

    if (q) query = query.ilike("name", `%${q}%`);

    const { data, error } = await query;
    if (error) return errorResponse("QUERY_FAILED", error.message, 500);
    return successResponse({ skillTags: data ?? [] });
  },
  { minRole: "org_admin" }
);

export const POST = withAuth(
  async (request, { session }) => {
    const body = await request.json().catch(() => null);
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const description = typeof body?.description === "string" ? body.description.trim() : null;
    const externalRef = typeof body?.externalRef === "string" ? body.externalRef.trim() : null;

    if (!name) return errorResponse("INVALID_INPUT", "A name is required.", 400);
    if (name.length > 120) return errorResponse("INVALID_INPUT", "That name is too long.", 400);

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("skill_tags")
      .insert({
        org_id: session.orgId,
        name,
        description,
        external_ref: externalRef,
        created_by: session.userId,
      })
      .select(COLUMNS)
      .single();

    if (error) {
      // unique (org_id, name) — a duplicate is an ordinary authoring mistake,
      // not a server fault, and the author wants to be told which one.
      if (error.code === "23505") {
        return errorResponse("ALREADY_EXISTS", `A skill tag named "${name}" already exists.`, 409);
      }
      return errorResponse("CREATE_FAILED", error.message, 500);
    }

    return successResponse({ skillTag: data }, 201);
  },
  { minRole: "org_admin" }
);
