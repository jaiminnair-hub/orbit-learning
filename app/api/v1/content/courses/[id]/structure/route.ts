import { withAuth } from "@/lib/api/with-auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";

type Ctx = { params: Promise<{ id: string }> };

// The whole course tree in one call: modules → lessons → learning
// objects (with their composed content assets). The player (step 5) and
// the admin course builder both read this, so there's one shape to keep
// correct rather than four ad hoc queries.
//
// Readable by any org member — a learner needs the tree to play the
// course. RLS scopes every table underneath to the caller's org.
export const GET = withAuth<Ctx>(async (_request, { session, params }) => {
  const { id } = await params;
  const supabase = await createClient();

  const { data: course, error } = await supabase
    .from("courses")
    .select("id, org_id, title, slug, description, status, version, published_at")
    .eq("id", id)
    .single();

  if (error || !course || course.org_id !== session.orgId) {
    return errorResponse("NOT_FOUND", "No such course in your organization.", 404);
  }

  const { data: modules } = await supabase
    .from("modules")
    .select("id, title, sequence")
    .eq("course_id", id)
    .order("sequence");

  const moduleIds = (modules ?? []).map((m) => m.id);

  const { data: lessons } = moduleIds.length
    ? await supabase
        .from("lessons")
        .select("id, module_id, title, sequence, estimated_duration_min")
        .in("module_id", moduleIds)
        .order("sequence")
    : { data: [] };

  const lessonIds = (lessons ?? []).map((l) => l.id);

  // Two queries rather than one embedded select (lesson_learning_objects
  // -> learning_objects) — found 2026-08-24 giving back an empty nested
  // array for real, RLS-visible rows (confirmed against the same session
  // via a direct SQL join and an RLS-simulated query, both correct) while
  // the plain PostgREST embed syntax silently returned nothing. Root cause
  // unconfirmed; this sidesteps it rather than leaving learner course
  // pages showing "no content" for lessons that genuinely have some.
  const linksQuery = lessonIds.length
    ? await supabase
        .from("lesson_learning_objects")
        .select("lesson_id, sequence, learning_object_id")
        .in("lesson_id", lessonIds)
        .order("sequence")
    : { data: [], error: null };
  if (linksQuery.error) {
    return errorResponse("QUERY_FAILED", `lesson_learning_objects: ${linksQuery.error.message}`, 500);
  }
  const links = linksQuery.data;

  const learningObjectIds = [...new Set((links ?? []).map((k) => k.learning_object_id))];

  const loQuery = learningObjectIds.length
    ? await supabase
        .from("learning_objects")
        .select("id, kind, title, description, status, version, source, course_specification_id")
        .in("id", learningObjectIds)
    : { data: [], error: null };
  if (loQuery.error) {
    return errorResponse("QUERY_FAILED", `learning_objects: ${loQuery.error.message}`, 500);
  }
  const learningObjectRows = loQuery.data;

  const learningObjectById = new Map((learningObjectRows ?? []).map((lo) => [lo.id, lo]));

  const tree = (modules ?? []).map((m) => ({
    ...m,
    lessons: (lessons ?? [])
      .filter((l) => l.module_id === m.id)
      .map((l) => ({
        ...l,
        learningObjects: (links ?? [])
          .filter((k) => k.lesson_id === l.id)
          .map((k) => ({ sequence: k.sequence, ...learningObjectById.get(k.learning_object_id) })),
      })),
  }));

  return successResponse({ course, modules: tree });
});

// Adds a module, a lesson, or attaches a learning object to a lesson —
// one route because they're the same authoring action at different
// depths, and each needs the identical org/course ownership check.
export const POST = withAuth<Ctx>(
  async (request, { session, params }) => {
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const kind = typeof body?.kind === "string" ? body.kind : "";

    const supabase = await createClient();
    const { data: course } = await supabase
      .from("courses")
      .select("id, org_id")
      .eq("id", id)
      .single();

    if (!course || course.org_id !== session.orgId) {
      return errorResponse("NOT_FOUND", "No such course in your organization.", 404);
    }

    if (kind === "module") {
      const title = typeof body?.title === "string" ? body.title.trim() : "";
      if (!title) return errorResponse("INVALID_INPUT", "A module title is required.", 400);
      const { data, error } = await supabase
        .from("modules")
        .insert({
          org_id: session.orgId,
          course_id: id,
          title,
          sequence: typeof body?.sequence === "number" ? body.sequence : 0,
        })
        .select("id, title, sequence")
        .single();
      if (error) return errorResponse("CREATE_FAILED", error.message, 500);
      return successResponse({ module: data }, 201);
    }

    if (kind === "lesson") {
      const title = typeof body?.title === "string" ? body.title.trim() : "";
      const moduleId = typeof body?.moduleId === "string" ? body.moduleId : "";
      if (!title || !moduleId) {
        return errorResponse("INVALID_INPUT", "moduleId and title are required.", 400);
      }
      // Confirm the module belongs to this course, not just this org.
      const { data: mod } = await supabase
        .from("modules")
        .select("id, course_id")
        .eq("id", moduleId)
        .single();
      if (!mod || mod.course_id !== id) {
        return errorResponse("NOT_FOUND", "No such module in this course.", 404);
      }
      const { data, error } = await supabase
        .from("lessons")
        .insert({
          org_id: session.orgId,
          module_id: moduleId,
          title,
          sequence: typeof body?.sequence === "number" ? body.sequence : 0,
          estimated_duration_min:
            typeof body?.estimatedDurationMin === "number" ? body.estimatedDurationMin : null,
        })
        .select("id, module_id, title, sequence")
        .single();
      if (error) return errorResponse("CREATE_FAILED", error.message, 500);
      return successResponse({ lesson: data }, 201);
    }

    if (kind === "attach") {
      const lessonId = typeof body?.lessonId === "string" ? body.lessonId : "";
      const learningObjectId =
        typeof body?.learningObjectId === "string" ? body.learningObjectId : "";
      if (!lessonId || !learningObjectId) {
        return errorResponse("INVALID_INPUT", "lessonId and learningObjectId are required.", 400);
      }
      const { data, error } = await supabase
        .from("lesson_learning_objects")
        .insert({
          org_id: session.orgId,
          lesson_id: lessonId,
          learning_object_id: learningObjectId,
          sequence: typeof body?.sequence === "number" ? body.sequence : 0,
        })
        .select("id, lesson_id, learning_object_id, sequence")
        .single();
      if (error) {
        if (error.code === "23505") {
          return errorResponse(
            "ALREADY_ATTACHED",
            "That learning object is already in this lesson.",
            409
          );
        }
        return errorResponse("ATTACH_FAILED", error.message, 500);
      }
      return successResponse({ attached: data }, 201);
    }

    return errorResponse("INVALID_INPUT", "kind must be 'module', 'lesson' or 'attach'.", 400);
  },
  { minRole: "org_admin" }
);
