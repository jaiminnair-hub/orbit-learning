import { withAuth } from "@/lib/api/with-auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canTransition, transitionError, snapshotVersion } from "@/lib/content/publish";
import { logActivity } from "@/lib/activity-log";

type Ctx = { params: Promise<{ id: string }> };

// Same state machine and snapshot mechanic as learning objects — a
// course publish captures the whole structure, so an enrolment pinned to
// version N replays that exact tree even if modules/lessons are
// reordered afterwards.
export const POST = withAuth<Ctx>(
  async (request, { session, params }) => {
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const to = typeof body?.status === "string" ? body.status : "";
    const comments = typeof body?.comments === "string" ? body.comments : null;

    const supabase = await createClient();
    const { data: course, error } = await supabase
      .from("courses")
      .select("id, org_id, title, slug, description, status, version")
      .eq("id", id)
      .single();

    if (error || !course || course.org_id !== session.orgId) {
      return errorResponse("NOT_FOUND", "No such course in your organization.", 404);
    }
    if (!canTransition(course.status, to)) {
      return errorResponse("INVALID_TRANSITION", transitionError(course.status, to), 409);
    }

    const isPublishing = to === "published";
    const nextVersion = isPublishing ? course.version + 1 : course.version;

    const { data: updated, error: updateError } = await supabase
      .from("courses")
      .update({
        status: to,
        version: nextVersion,
        published_at: isPublishing ? new Date().toISOString() : null,
      })
      .eq("id", id)
      .select("id, title, slug, status, version, published_at")
      .single();

    if (updateError) return errorResponse("UPDATE_FAILED", updateError.message, 500);

    if (isPublishing) {
      const { data: modules } = await supabase
        .from("modules").select("id, title, sequence").eq("course_id", id).order("sequence");
      const moduleIds = (modules ?? []).map((m) => m.id);
      const { data: lessons } = moduleIds.length
        ? await supabase.from("lessons")
            .select("id, module_id, title, sequence").in("module_id", moduleIds).order("sequence")
        : { data: [] };
      const lessonIds = (lessons ?? []).map((l) => l.id);
      const { data: links } = lessonIds.length
        ? await supabase.from("lesson_learning_objects")
            .select("lesson_id, learning_object_id, sequence").in("lesson_id", lessonIds).order("sequence")
        : { data: [] };

      const { error: snapError } = await snapshotVersion(createAdminClient(), {
        orgId: session.orgId!,
        entityType: "course",
        entityId: id,
        versionNumber: nextVersion,
        snapshot: {
          title: updated.title,
          description: course.description,
          modules: modules ?? [],
          lessons: lessons ?? [],
          lessonLearningObjects: links ?? [],
        },
        publishedBy: session.userId,
      });
      if (snapError) return errorResponse("SNAPSHOT_FAILED", snapError, 500);
    }

    await supabase.from("content_reviews").insert({
      org_id: session.orgId,
      content_type: "course",
      content_id: id,
      reviewer_id: session.userId,
      decision: to === "published" ? "published" : to === "archived" ? "archived" : "submitted",
      comments,
    });

    await logActivity(createAdminClient(), {
      orgId: session.orgId,
      actorId: session.userId,
      eventType: `org.course.${to}`,
      entityType: "courses",
      entityId: id,
      metadata: { title: updated.title, version: nextVersion },
    });

    return successResponse({ course: updated });
  },
  { minRole: "org_admin" }
);
