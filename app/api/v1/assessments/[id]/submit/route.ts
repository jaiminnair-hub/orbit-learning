import { withAuth } from "@/lib/api/with-auth";
import { errorResponse, successResponse } from "@/lib/api/response";
import { scoreAssessment, type ScoringItem } from "@/lib/assessments/scoring";
import { clearAttemptState, isAttemptExpired } from "@/lib/assessments/attempt";
import { issueCertificate } from "@/lib/certificates/issue";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { AssessmentItem } from "@/lib/spec";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withAuth<Ctx>(async (request, { session, params }) => {
  if (!session.orgId) return errorResponse("NO_ORG", "You must belong to an organization.", 409);
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const answers = body?.answers && typeof body.answers === "object" && !Array.isArray(body.answers) ? body.answers as Record<string, unknown> : null;
  if (!answers) return errorResponse("INVALID_INPUT", "Answers are required.", 400);

  const supabase = await createClient();
  const { data: assignment } = await supabase.from("assessment_assignments")
    .select("id, status, current_attempt_started_at, current_attempt_question_ids")
    .eq("org_id", session.orgId).eq("assessment_id", id).eq("user_id", session.userId).single();
  if (!assignment) return errorResponse("NOT_ASSIGNED", "This assessment is not assigned to you.", 404);

  const admin = createAdminClient();
  const { data: assessment } = await admin.from("assessments")
    .select("id, title, status, pass_percent, max_attempts, time_limit_minutes").eq("id", id).eq("org_id", session.orgId).single();
  if (!assessment || assessment.status !== "published") return errorResponse("NOT_AVAILABLE", "This assessment is not available.", 409);

  // A real time limit is enforced against the clock this attempt actually
  // started at (set by startOrResumeAttempt), never a client-supplied
  // duration — the grace window covers a client auto-submit that was fired
  // exactly at zero but is still in flight, not a courtesy extension.
  if (assessment.time_limit_minutes && assignment.current_attempt_started_at) {
    if (isAttemptExpired(assignment.current_attempt_started_at, assessment.time_limit_minutes)) {
      await clearAttemptState(admin, assignment.id);
      return errorResponse(
        "TIME_EXPIRED",
        `Time limit exceeded — you had ${assessment.time_limit_minutes} minute${assessment.time_limit_minutes === 1 ? "" : "s"}. Start a new attempt.`,
        409
      );
    }
  }

  const { count: priorAttempts } = await admin.from("assessment_attempts")
    .select("id", { count: "exact", head: true }).eq("assignment_id", assignment.id);
  if ((priorAttempts ?? 0) >= assessment.max_attempts) return errorResponse("ATTEMPTS_EXHAUSTED", "No attempts remain for this assessment.", 409);

  // Score only the questions actually presented for this attempt (the
  // pool/order startOrResumeAttempt persisted) — falling back to every
  // linked question when no attempt state exists, for an assignment whose
  // attempt was started before this feature shipped, or an assessment with
  // no pooling configured at all (current_attempt_question_ids never
  // narrows what's linked in that case).
  const presentedIds = assignment.current_attempt_question_ids as string[] | null;
  let linksQuery = admin.from("assessment_questions")
    .select("points, question_bank_items(id, item)").eq("assessment_id", id).order("sequence");
  if (presentedIds?.length) linksQuery = linksQuery.in("question_id", presentedIds);
  const { data: links, error: linksError } = await linksQuery;
  if (linksError || !links?.length) return errorResponse("NO_QUESTIONS", "This assessment has no questions.", 409);
  const scoringItems: ScoringItem[] = links.map((link) => {
    const row = link.question_bank_items as unknown as { id: string; item: AssessmentItem };
    return { id: row.id, item: row.item, points: link.points };
  });
  const result = scoreAssessment(scoringItems, answers);
  const passed = result.scorePercent >= assessment.pass_percent;
  const attemptNumber = (priorAttempts ?? 0) + 1;
  const { error: attemptError } = await admin.from("assessment_attempts").insert({
    org_id: session.orgId, assessment_id: id, assignment_id: assignment.id, user_id: session.userId,
    attempt_number: attemptNumber, answers, score_percent: result.scorePercent, passed,
  });
  if (attemptError) return errorResponse("SUBMIT_FAILED", attemptError.message, 500);
  // Clears the drawn pool/clock in the same call — the next attempt (if
  // any) starts fresh via startOrResumeAttempt, never reuses this one's.
  await admin.from("assessment_assignments").update({
    status: passed ? "passed" : "submitted", completed_at: new Date().toISOString(),
    current_attempt_started_at: null, current_attempt_question_ids: null,
  }).eq("id", assignment.id);

  let certificateId: string | null = null;
  if (passed) {
    const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", session.userId).single();
    certificateId = await issueCertificate({
      orgId: session.orgId,
      userId: session.userId,
      sourceType: "assessment",
      sourceId: id,
      title: assessment.title,
      recipientName: profile?.full_name?.trim() || session.email,
      scorePercent: result.scorePercent,
    });
  }

  return successResponse({ ...result, passed, passPercent: assessment.pass_percent, attemptsRemaining: assessment.max_attempts - attemptNumber, certificateId });
});
