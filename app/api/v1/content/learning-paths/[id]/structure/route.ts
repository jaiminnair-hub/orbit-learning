import { withAuth } from "@/lib/api/with-auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";

type Ctx = { params: Promise<{ id: string }> };

// One call: the path plus its ordered course references, each enriched
// with the course's own title/status — the editor and the learner-facing
// path page both need that, matching content/courses/[id]/structure's
// single-tree precedent.
export const GET = withAuth<Ctx>(async (_request, { session, params }) => {
  const { id } = await params;
  const supabase = await createClient();

  const { data: path, error } = await supabase
    .from("learning_paths")
    .select("id, org_id, title, slug, description, status, version")
    .eq("id", id)
    .single();

  if (error || !path || path.org_id !== session.orgId) {
    return errorResponse("NOT_FOUND", "No such learning path in your organization.", 404);
  }

  const { data: items } = await supabase
    .from("learning_path_items")
    .select("id, course_id, sequence")
    .eq("path_id", id)
    .order("sequence");

  const courseIds = (items ?? []).map((i) => i.course_id as string);
  const { data: courses } = courseIds.length
    ? await supabase.from("courses").select("id, title, status").in("id", courseIds)
    : { data: [] };
  const courseById = new Map((courses ?? []).map((c) => [c.id, c]));

  const courseRefs = (items ?? []).map((item) => ({
    itemId: item.id,
    sequence: item.sequence,
    course: courseById.get(item.course_id as string) ?? { id: item.course_id, title: "Unknown course", status: "unknown" },
  }));

  return successResponse({ path, courses: courseRefs });
});

// Attaches one published course to this path, at the end.
export const POST = withAuth<Ctx>(
  async (request, { session, params }) => {
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const courseId = typeof body?.courseId === "string" ? body.courseId : "";
    if (!courseId) return errorResponse("INVALID_INPUT", "courseId is required.", 400);

    const supabase = await createClient();
    const { data: path } = await supabase.from("learning_paths").select("id, org_id, status").eq("id", id).single();
    if (!path || path.org_id !== session.orgId) return errorResponse("NOT_FOUND", "No such learning path.", 404);
    if (path.status !== "draft") return errorResponse("NOT_EDITABLE", "Only a draft path can be changed.", 409);

    const { data: course } = await supabase.from("courses").select("id, org_id, status").eq("id", courseId).single();
    if (!course || course.org_id !== session.orgId) return errorResponse("NOT_FOUND", "No such course in your organization.", 404);
    if (course.status !== "published") return errorResponse("NOT_PUBLISHED", "Only published courses can be added to a path.", 409);

    const { count } = await supabase.from("learning_path_items").select("id", { count: "exact", head: true }).eq("path_id", id);

    const { data, error } = await supabase
      .from("learning_path_items")
      .insert({ org_id: session.orgId, path_id: id, course_id: courseId, sequence: count ?? 0 })
      .select("id, course_id, sequence")
      .single();

    if (error) {
      if (error.code === "23505") return errorResponse("ALREADY_ATTACHED", "That course is already in this path.", 409);
      return errorResponse("ATTACH_FAILED", error.message, 500);
    }
    return successResponse({ item: data }, 201);
  },
  { minRole: "org_admin" }
);
