import type { SupabaseClient } from "@supabase/supabase-js";
import { createEnrollment } from "./enrollment";
import { learningObjectIdsForCourses } from "./course-objects";
import { logActivity } from "@/lib/activity-log";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendCourseEnrollmentEmail } from "@/lib/notifications";

interface EnrollmentRuleRow {
  id: string;
  course_id: string;
  trigger: "on_join" | "role_equals";
  role_value: string | null;
  recur_after_days: number | null;
}

/**
 * Applied at the one real moment a member "joins" an org — accepting an
 * invitation (app/api/v1/orgs/invitations/accept/route.ts). Best-effort by
 * design, same stance as lib/certificates/issue.ts: a rule that fails to
 * apply (course unpublished, already enrolled — shouldn't happen for a
 * brand-new member, but not fatal either way) must never fail the signup
 * it's attached to. Takes the admin client — the member isn't a session
 * holder acting on their own behalf here, an org policy is being applied
 * to them.
 */
export async function applyJoinRules(
  admin: SupabaseClient,
  params: { orgId: string; userId: string; role: string }
): Promise<void> {
  const { data: rules } = await admin
    .from("enrollment_rules")
    .select("id, course_id, trigger, role_value, recur_after_days")
    .eq("org_id", params.orgId)
    .eq("active", true);

  const matching = (rules ?? []).filter(
    (r: EnrollmentRuleRow) => r.trigger === "on_join" || (r.trigger === "role_equals" && r.role_value === params.role)
  );

  for (const rule of matching) {
    const result = await createEnrollment(admin, {
      orgId: params.orgId,
      userId: params.userId,
      courseId: rule.course_id,
      createdBy: params.userId,
    });
    if (result.ok) {
      await logActivity(admin, {
        orgId: params.orgId,
        actorId: null,
        eventType: "org.enrollment.auto_created",
        entityType: "enrollments",
        entityId: result.enrollmentId,
        metadata: { courseId: rule.course_id, ruleId: rule.id, trigger: rule.trigger, enrolledUser: params.userId },
      });
      await sendCourseEnrollmentEmail(admin, { orgId: params.orgId, enrollmentId: result.enrollmentId, courseId: rule.course_id, userId: params.userId, ruleId: rule.id, isReenrollment: false });
    }
    // NOT_FOUND / NOT_PUBLISHED / ALREADY_ENROLLED / FAILED are all silently
    // skipped — a misconfigured or already-satisfied rule must not block
    // the join it's attached to.
  }
}

/**
 * A learner's own worklist load is the trigger point — see
 * app/api/v1/my-work/route.ts. Deliberately not a scheduled sweep: this
 * product has no cron/scheduler infrastructure yet, and checking on the
 * one screen a learner's re-enrollment would actually matter to them on
 * is a real, working mechanism without adding one. Takes the caller's own
 * session client — this always acts as the learner re-enrolling
 * themselves, which enrollments_insert's RLS policy already permits
 * (`user_id = auth.uid()`).
 *
 * `enrollments` has a hard uniqueness constraint of one row per
 * (org, user, course) ever — there is no way to add a second historical
 * row for a repeat cycle without changing that model. So "re-enrollment"
 * here means resetting the existing row and the learner's underlying
 * progress for that course back to a fresh start, not creating a new one.
 * That's a real, disclosed limitation: a completed cycle's exact prior
 * score isn't preserved past the reset, the same way an assessment
 * attempt's history is (assessments have a real attempts table;
 * enrollments don't).
 *
 * Reads `enrollment_rules` and the course row via the admin client, not
 * the caller's session client: `enrollment_rules_select` requires
 * `has_role('manager')` (it's org-admin-facing config), which a learner —
 * the normal caller here — never has. Using the session client for that
 * read would make this permanently a no-op for real learners, silently:
 * a real bug caught by a local verification run against actual RLS,
 * not just reasoned through. The enrollments/progress *mutations* below
 * stay on the caller's session client deliberately — that's the
 * RLS-permitted path a learner resetting their own rows is meant to use.
 */
export async function applyDueReenrollments(
  supabase: SupabaseClient,
  params: { orgId: string; userId: string }
): Promise<void> {
  const admin = createAdminClient();
  const { data: rules } = await admin
    .from("enrollment_rules")
    .select("id, course_id, recur_after_days")
    .eq("org_id", params.orgId)
    .eq("active", true)
    .not("recur_after_days", "is", null);

  if (!rules?.length) return;

  const courseIds = rules.map((r) => r.course_id as string);
  const { data: enrollments } = await supabase
    .from("enrollments")
    .select("id, enrollable_id, status, completed_at")
    .eq("org_id", params.orgId)
    .eq("user_id", params.userId)
    .eq("enrollable_type", "course")
    .in("enrollable_id", courseIds);

  const enrollmentByCourse = new Map((enrollments ?? []).map((e) => [e.enrollable_id as string, e]));
  const now = Date.now();

  for (const rule of rules as Array<{ id: string; course_id: string; recur_after_days: number }>) {
    const enrollment = enrollmentByCourse.get(rule.course_id);
    if (!enrollment || enrollment.status !== "completed" || !enrollment.completed_at) continue;

    const dueAt = new Date(enrollment.completed_at).getTime() + rule.recur_after_days * 24 * 60 * 60 * 1000;
    if (now < dueAt) continue;

    const { data: course } = await supabase.from("courses").select("version").eq("id", rule.course_id).single();
    if (!course) continue;

    // Reset in place, not deleted: progress has no delete policy for any
    // role (by design — the table's own status default is 'not_started',
    // and progress_update already permits a learner resetting their own
    // rows, which is the RLS-permitted path this needs).
    const objectIdsByCourse = await learningObjectIdsForCourses(supabase, [rule.course_id]);
    const objectIds = objectIdsByCourse.get(rule.course_id) ?? [];
    if (objectIds.length > 0) {
      await supabase
        .from("progress")
        .update({ status: "not_started", completed_at: null, score: null, time_spent_sec: 0 })
        .eq("org_id", params.orgId)
        .eq("user_id", params.userId)
        .in("learning_object_id", objectIds);
    }

    const { error } = await supabase
      .from("enrollments")
      .update({ status: "enrolled", completed_at: null, enrolled_version: course.version, due_date: null })
      .eq("id", enrollment.id);

    if (!error) {
      // activity_log has no insert policy for authenticated roles (service
      // role only, by design — see lib/activity-log.ts) — the mutations
      // above correctly used the caller's own session client (RLS permits
      // a learner inserting/updating their own rows), but logging this
      // needs the admin client regardless of who triggered it.
      await logActivity(createAdminClient(), {
        orgId: params.orgId,
        actorId: params.userId,
        eventType: "org.enrollment.auto_reenrolled",
        entityType: "enrollments",
        entityId: enrollment.id as string,
        metadata: { courseId: rule.course_id, ruleId: rule.id },
      });
      await sendCourseEnrollmentEmail(admin, { orgId: params.orgId, enrollmentId: enrollment.id as string, courseId: rule.course_id, userId: params.userId, ruleId: rule.id, isReenrollment: true });
    }
  }
}
