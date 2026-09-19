import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssessmentItem } from "@/lib/spec";
import { selectAttemptQuestions } from "./pool";

/**
 * Begins or resumes a timed/pooled attempt — the one place that decides
 * which questions a learner sees this time and, when a time limit is set,
 * when their clock started. Shared by the runner page (server component,
 * on load) and `POST /api/v1/assessments/[id]/start` (a thin route wrapping
 * this for a real "Start assessment →" click, and for tests) so there is
 * exactly one code path that can begin an attempt — the same discipline
 * `lib/lms/enrollment.ts` uses for enrollment.
 *
 * Always takes the admin client: `assessment_assignments` has no update
 * policy for the learner's own session client, matching every other
 * mutation on this table (see submit/route.ts).
 */

export interface AttemptQuestion {
  id: string;
  item: AssessmentItem;
  points: number;
}

export type StartAttemptResult =
  | { ok: true; assignmentId: string; questions: AttemptQuestion[]; startedAt: string; timeLimitMinutes: number | null; attemptsRemaining: number }
  | { ok: false; reason: "NOT_ASSIGNED" | "NOT_AVAILABLE" | "NO_QUESTIONS" | "ATTEMPTS_EXHAUSTED" };

function toQuestions(
  ids: string[],
  links: { points: number; question_bank_items: { id: string; item: AssessmentItem } | { id: string; item: AssessmentItem }[] }[]
): AttemptQuestion[] {
  const byId = new Map(
    links.map((l) => {
      const row = (Array.isArray(l.question_bank_items) ? l.question_bank_items[0] : l.question_bank_items) as {
        id: string;
        item: AssessmentItem;
      };
      return [row.id, { id: row.id, item: row.item, points: l.points }];
    })
  );
  return ids.map((id) => byId.get(id)).filter((q): q is AttemptQuestion => !!q);
}

export async function startOrResumeAttempt(
  admin: SupabaseClient,
  params: { orgId: string; userId: string; assessmentId: string }
): Promise<StartAttemptResult> {
  const { data: assessment } = await admin
    .from("assessments")
    .select("id, status, max_attempts, time_limit_minutes, question_pool_size, randomize_questions")
    .eq("id", params.assessmentId)
    .eq("org_id", params.orgId)
    .single();
  if (!assessment || assessment.status !== "published") return { ok: false, reason: "NOT_AVAILABLE" };

  const { data: assignment } = await admin
    .from("assessment_assignments")
    .select("id, current_attempt_started_at, current_attempt_question_ids")
    .eq("assessment_id", params.assessmentId)
    .eq("org_id", params.orgId)
    .eq("user_id", params.userId)
    .single();
  if (!assignment) return { ok: false, reason: "NOT_ASSIGNED" };

  const { count: priorAttempts } = await admin
    .from("assessment_attempts")
    .select("id", { count: "exact", head: true })
    .eq("assignment_id", assignment.id);
  const attemptsRemaining = assessment.max_attempts - (priorAttempts ?? 0);

  // Resuming an attempt already in progress (e.g. the page was refreshed
  // mid-attempt): return the exact same drawn set and the original start
  // time, never re-draw or restart the clock.
  if (assignment.current_attempt_question_ids && assignment.current_attempt_started_at) {
    const ids = assignment.current_attempt_question_ids as string[];
    const { data: links } = await admin
      .from("assessment_questions")
      .select("points, question_bank_items(id, item)")
      .eq("assessment_id", params.assessmentId)
      .in("question_id", ids);
    return {
      ok: true,
      assignmentId: assignment.id,
      questions: toQuestions(ids, links ?? []),
      startedAt: assignment.current_attempt_started_at,
      timeLimitMinutes: assessment.time_limit_minutes,
      attemptsRemaining,
    };
  }

  if (attemptsRemaining <= 0) return { ok: false, reason: "ATTEMPTS_EXHAUSTED" };

  const { data: allLinks } = await admin
    .from("assessment_questions")
    .select("points, question_id, question_bank_items(id, item)")
    .eq("assessment_id", params.assessmentId)
    .order("sequence");
  if (!allLinks?.length) return { ok: false, reason: "NO_QUESTIONS" };

  const orderedIds = allLinks.map((l) => l.question_id as string);
  const selectedIds = selectAttemptQuestions(orderedIds, assessment.question_pool_size, assessment.randomize_questions);
  const startedAt = new Date().toISOString();

  await admin
    .from("assessment_assignments")
    .update({ current_attempt_started_at: startedAt, current_attempt_question_ids: selectedIds })
    .eq("id", assignment.id);

  return {
    ok: true,
    assignmentId: assignment.id,
    questions: toQuestions(selectedIds, allLinks),
    startedAt,
    timeLimitMinutes: assessment.time_limit_minutes,
    attemptsRemaining,
  };
}

/** How long past the stated limit a late-but-in-flight submission (client
 * countdown hit zero, auto-submit fired, request is still in transit) is
 * still honored — real elapsed time, not a courtesy extension of the exam
 * itself. A submission arriving after this is treated as abandoned, not
 * scored, and the attempt is not consumed. */
export const TIME_LIMIT_GRACE_MS = 2 * 60 * 1000;

/** Pulled out of submit/route.ts so the real enforcement rule is directly
 * unit-testable rather than only reachable through a live HTTP round trip. */
export function isAttemptExpired(startedAt: string, timeLimitMinutes: number): boolean {
  const elapsedMs = Date.now() - new Date(startedAt).getTime();
  return elapsedMs > timeLimitMinutes * 60_000 + TIME_LIMIT_GRACE_MS;
}

/** Clears the in-progress-attempt state so the next attempt (if any) draws
 * a fresh pool and a fresh clock. Called after every real disposition of an
 * attempt: recorded (pass or fail) or expired. */
export async function clearAttemptState(admin: SupabaseClient, assignmentId: string): Promise<void> {
  await admin
    .from("assessment_assignments")
    .update({ current_attempt_started_at: null, current_attempt_question_ids: null })
    .eq("id", assignmentId);
}
