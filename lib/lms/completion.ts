import type { SupabaseClient } from "@supabase/supabase-js";
import { learningObjectIdsForCourses, percentComplete } from "./course-objects";

/**
 * Building completion rows — one per enrolment, enriched with how far the
 * learner actually got.
 *
 * Shared by the manager's report and the learner's own dashboard so the
 * two can never disagree about what "60% complete" means. RLS decides
 * what each caller is allowed to see; this function only decides how the
 * numbers are computed.
 */

interface ProgressRow {
  user_id: string;
  learning_object_id: string;
  status: string;
  score: number | null;
  time_spent_sec: number | null;
  completed_at: string | null;
}

export interface CompletionRow {
  enrollmentId: string;
  userId: string;
  learnerName: string;
  learnerEmail: string;
  courseId: string;
  courseTitle: string;
  status: string;
  percent: number;
  objectsTotal: number;
  objectsCompleted: number;
  score: number | null;
  timeSpentSec: number;
  lastActivityAt: string | null;
  enrolledAt: string;
  dueDate: string | null;
  completedAt: string | null;
  overdue: boolean;
}

export interface CompletionSummary {
  total: number;
  completed: number;
  inProgress: number;
  notStarted: number;
  overdue: number;
  averagePercent: number;
}

export interface CompletionFilters {
  courseId?: string | null;
  status?: string | null;
  /** Restrict to one learner — the dashboard's own view. */
  userId?: string | null;
}

export function emptySummary(): CompletionSummary {
  return { total: 0, completed: 0, inProgress: 0, notStarted: 0, overdue: 0, averagePercent: 0 };
}

export function summarize(rows: CompletionRow[]): CompletionSummary {
  return {
    total: rows.length,
    completed: rows.filter((r) => r.status === "completed").length,
    inProgress: rows.filter((r) => r.status === "in_progress").length,
    notStarted: rows.filter((r) => r.status === "enrolled").length,
    overdue: rows.filter((r) => r.overdue).length,
    averagePercent: rows.length
      ? Math.round(rows.reduce((sum, r) => sum + r.percent, 0) / rows.length)
      : 0,
  };
}

export async function buildCompletionRows(
  supabase: SupabaseClient,
  orgId: string,
  filters: CompletionFilters = {}
): Promise<CompletionRow[]> {
  let query = supabase
    .from("enrollments")
    .select("id, user_id, enrollable_id, status, enrolled_at, due_date, completed_at")
    .eq("org_id", orgId)
    .eq("enrollable_type", "course");

  if (filters.courseId) query = query.eq("enrollable_id", filters.courseId);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.userId) query = query.eq("user_id", filters.userId);

  const { data: enrollments } = await query.order("enrolled_at", { ascending: false });
  if (!enrollments?.length) return [];

  const courseIds = [...new Set(enrollments.map((e) => e.enrollable_id as string))];
  const userIds = [...new Set(enrollments.map((e) => e.user_id as string))];

  const [{ data: courses }, { data: people }, objectsByCourse] = await Promise.all([
    supabase.from("courses").select("id, title").in("id", courseIds),
    supabase.from("profiles").select("id, full_name, email").in("id", userIds),
    learningObjectIdsForCourses(supabase, courseIds),
  ]);

  const courseTitle = new Map((courses ?? []).map((c) => [c.id as string, c.title as string]));
  const person = new Map((people ?? []).map((p) => [p.id as string, p]));

  // One progress query for every learner in the report rather than one per
  // row: a 200-person report would otherwise be 200 round trips.
  const allObjectIds = [...new Set([...objectsByCourse.values()].flat())];
  const progressRows: ProgressRow[] = allObjectIds.length
    ? ((
        await supabase
          .from("progress")
          .select("user_id, learning_object_id, status, score, time_spent_sec, completed_at")
          .eq("org_id", orgId)
          .in("user_id", userIds)
          .in("learning_object_id", allObjectIds)
      ).data ?? [])
    : [];

  const byUser = new Map<string, ProgressRow[]>();
  for (const row of progressRows) {
    if (!byUser.has(row.user_id)) byUser.set(row.user_id, []);
    byUser.get(row.user_id)!.push(row);
  }

  const now = Date.now();

  return enrollments.map((e) => {
    const objectIds = new Set(objectsByCourse.get(e.enrollable_id as string) ?? []);
    const mine = (byUser.get(e.user_id as string) ?? []).filter((p) =>
      objectIds.has(p.learning_object_id)
    );
    const completed = mine.filter((p) => p.status === "completed");

    const scores = completed
      .map((p) => (typeof p.score === "number" ? p.score : null))
      .filter((s): s is number => s != null);

    const lastActivity = mine
      .map((p) => p.completed_at)
      .filter((d): d is string => !!d)
      .sort()
      .at(-1);

    const profile = person.get(e.user_id as string);

    return {
      enrollmentId: e.id as string,
      userId: e.user_id as string,
      learnerName: (profile?.full_name as string) ?? (profile?.email as string) ?? "Unknown",
      learnerEmail: (profile?.email as string) ?? "",
      courseId: e.enrollable_id as string,
      courseTitle: courseTitle.get(e.enrollable_id as string) ?? "Unknown course",
      status: e.status as string,
      percent: percentComplete(objectIds.size, completed.length),
      objectsTotal: objectIds.size,
      objectsCompleted: completed.length,
      // Averaged across scored objects; null when nothing scored, which is
      // different from scoring zero and must not display as 0%.
      score: scores.length
        ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100
        : null,
      timeSpentSec: mine.reduce((sum, p) => sum + (p.time_spent_sec ?? 0), 0),
      lastActivityAt: lastActivity ?? null,
      enrolledAt: e.enrolled_at as string,
      dueDate: (e.due_date as string) ?? null,
      completedAt: (e.completed_at as string) ?? null,
      overdue:
        e.status !== "completed" && !!e.due_date && new Date(e.due_date as string).getTime() < now,
    };
  });
}
