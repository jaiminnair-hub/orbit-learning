import { withAuth } from "@/lib/api/with-auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";
import { hasRole } from "@/lib/auth/roles";

// Real Postgres full-text search across the content library, replacing
// the client-side substring matching the Stage 1 audit flagged.
//
// Scope depends on role rather than a query param a client could lie
// about: admins search the whole library (drafts included, since that's
// the authoring use case), everyone else searches published courses
// only. RLS scopes every query to the caller's org underneath.
export const GET = withAuth(async (request, { session }) => {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();

  if (!q) return errorResponse("INVALID_INPUT", "A search query 'q' is required.", 400);

  const supabase = await createClient();
  const isAuthor = hasRole(session.role, "org_admin");

  // websearch_to_tsquery handles ordinary human input ("fire safety",
  // quoted phrases, -exclusions) without throwing on punctuation the way
  // to_tsquery does.
  let courseQuery = supabase
    .from("courses")
    .select("id, title, description, slug, status")
    .eq("org_id", session.orgId)
    .is("deleted_at", null)
    .textSearch("search_vector", q, { type: "websearch", config: "english" })
    .limit(20);

  if (!isAuthor) courseQuery = courseQuery.eq("status", "published");

  const { data: courses, error: courseError } = await courseQuery;
  if (courseError) return errorResponse("SEARCH_FAILED", courseError.message, 500);

  if (!isAuthor) {
    return successResponse({ courses: courses ?? [], learningObjects: [], assets: [], specifications: [] });
  }

  const [{ data: objects }, { data: assets }, { data: specifications }] = await Promise.all([
    supabase
      .from("learning_objects")
      .select("id, title, description, kind, status")
      .eq("org_id", session.orgId)
      .is("deleted_at", null)
      .textSearch("search_vector", q, { type: "websearch", config: "english" })
      .limit(20),
    supabase
      .from("content_assets")
      .select("id, type, storage_path, status")
      .eq("org_id", session.orgId)
      .is("deleted_at", null)
      .textSearch("search_vector", q, { type: "websearch", config: "english" })
      .limit(20),
    // Authored courses (Phase 3 step 11). Their vector covers the authored
    // body, not just the title — the block-tree walk that makes that possible
    // lives in lib/authoring/spec-text.ts and runs on every save.
    supabase
      .from("course_specifications")
      .select("id, title, status, version, updated_at")
      .eq("org_id", session.orgId)
      .is("deleted_at", null)
      .textSearch("search_vector", q, { type: "websearch", config: "english" })
      .limit(20),
  ]);

  return successResponse({
    courses: courses ?? [],
    learningObjects: objects ?? [],
    assets: assets ?? [],
    specifications: specifications ?? [],
  });
});
