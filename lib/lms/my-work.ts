import type { SupabaseClient } from "@supabase/supabase-js";
import { buildCompletionRows } from "./completion";
import { computePathProgress } from "./learning-paths";

/**
 * One learner's full worklist — courses, assessments, and learning paths
 * merged into a single, sortable list — so "everything assigned to me" has
 * one shape instead of separate queries the UI has to reconcile itself.
 *
 * Course rows are built from the same buildCompletionRows() the manager's
 * report and the old course-only dashboard already used, so a course's
 * percent/overdue here can never disagree with what Reports shows for it.
 * Learning-path rows reuse computePathProgress() — same reasoning: a
 * path's percent here must agree with what the path's own enrollment
 * status says, which lib/lms/learning-paths.ts's progress route hook
 * already keeps in sync.
 */
export interface WorkRow {
  kind: "course" | "assessment" | "learning_path";
  id: string;
  refId: string;
  title: string;
  status: string;
  percent: number | null;
  score: number | null;
  dueDate: string | null;
  completedAt: string | null;
  overdue: boolean;
  href: string;
}

interface AssessmentAssignmentRow {
  id: string;
  assessment_id: string;
  status: string;
  due_date: string | null;
  completed_at: string | null;
  assigned_at: string;
  assessments: { title: string } | { title: string }[] | null;
}

const ASSESSMENT_DONE_STATUSES = new Set(["passed", "submitted"]);

export async function buildMyWorkRows(
  supabase: SupabaseClient,
  orgId: string,
  userId: string
): Promise<WorkRow[]> {
  const [courseRows, assignmentsResult, pathEnrollmentsResult] = await Promise.all([
    buildCompletionRows(supabase, orgId, { userId }),
    supabase
      .from("assessment_assignments")
      .select("id, assessment_id, status, due_date, completed_at, assigned_at, assessments(title)")
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .order("assigned_at", { ascending: false }),
    supabase
      .from("enrollments")
      .select("id, enrollable_id, status, due_date, completed_at, enrolled_at")
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .eq("enrollable_type", "learning_path")
      .order("enrolled_at", { ascending: false }),
  ]);

  const now = Date.now();

  const courseWork: WorkRow[] = courseRows.map((row) => ({
    kind: "course",
    id: row.enrollmentId,
    refId: row.courseId,
    title: row.courseTitle,
    status: row.status,
    percent: row.percent,
    score: row.score,
    dueDate: row.dueDate,
    completedAt: row.completedAt,
    overdue: row.overdue,
    href: `/courses/${row.courseId}`,
  }));

  const assignments = (assignmentsResult.data ?? []) as unknown as AssessmentAssignmentRow[];
  const assignmentIds = assignments.map((assignment) => assignment.id);
  const { data: attemptRows } = assignmentIds.length
    ? await supabase
        .from("assessment_attempts")
        .select("assignment_id, score_percent, submitted_at")
        .in("assignment_id", assignmentIds)
        .order("submitted_at", { ascending: false })
    : { data: [] };
  const latestAssessmentScore = new Map<string, number>();
  for (const attempt of attemptRows ?? []) {
    const assignmentId = String(attempt.assignment_id);
    if (!latestAssessmentScore.has(assignmentId)) {
      latestAssessmentScore.set(assignmentId, Number(attempt.score_percent));
    }
  }
  const assessmentWork: WorkRow[] = assignments.map((assignment) => {
    const assessment = Array.isArray(assignment.assessments)
      ? assignment.assessments[0]
      : assignment.assessments;
    return {
      kind: "assessment",
      id: assignment.id,
      refId: assignment.assessment_id,
      title: assessment?.title ?? "Untitled assessment",
      status: assignment.status,
      percent: null,
      score: latestAssessmentScore.get(assignment.id) ?? null,
      dueDate: assignment.due_date,
      completedAt: assignment.completed_at,
      overdue:
        !ASSESSMENT_DONE_STATUSES.has(assignment.status) &&
        !!assignment.due_date &&
        new Date(assignment.due_date).getTime() < now,
      href: `/assessments/${assignment.assessment_id}`,
    };
  });

  const pathEnrollments = pathEnrollmentsResult.data ?? [];
  const pathIds = [...new Set(pathEnrollments.map((e) => e.enrollable_id as string))];
  const { data: pathRows } = pathIds.length
    ? await supabase.from("learning_paths").select("id, title").in("id", pathIds)
    : { data: [] };
  const pathTitle = new Map((pathRows ?? []).map((p) => [p.id as string, p.title as string]));

  const pathWork: WorkRow[] = await Promise.all(
    pathEnrollments.map(async (enrollment) => {
      const pathId = enrollment.enrollable_id as string;
      const progress = await computePathProgress(supabase, { orgId, userId, pathId });
      return {
        kind: "learning_path" as const,
        id: enrollment.id as string,
        refId: pathId,
        title: pathTitle.get(pathId) ?? "Untitled learning path",
        status: enrollment.status as string,
        percent: progress.percent,
        score: null,
        dueDate: (enrollment.due_date as string) ?? null,
        completedAt: (enrollment.completed_at as string) ?? null,
        overdue:
          enrollment.status !== "completed" &&
          !!enrollment.due_date &&
          new Date(enrollment.due_date as string).getTime() < now,
        href: `/paths/${pathId}`,
      };
    })
  );

  return [...courseWork, ...assessmentWork, ...pathWork].sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    const aDone = isDone(a);
    const bDone = isDone(b);
    if (aDone !== bDone) return aDone ? 1 : -1;
    return (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999");
  });
}

export function isDone(row: WorkRow): boolean {
  return row.kind === "assessment" ? ASSESSMENT_DONE_STATUSES.has(row.status) : row.status === "completed";
}
