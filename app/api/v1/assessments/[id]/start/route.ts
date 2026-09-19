import { withAuth } from "@/lib/api/with-auth";
import { errorResponse, successResponse } from "@/lib/api/response";
import { createAdminClient } from "@/lib/supabase/admin";
import { startOrResumeAttempt } from "@/lib/assessments/attempt";

type Ctx = { params: Promise<{ id: string }> };

const REASON_STATUS = {
  NOT_ASSIGNED: 404,
  NOT_AVAILABLE: 409,
  NO_QUESTIONS: 409,
  ATTEMPTS_EXHAUSTED: 409,
} as const;

const REASON_MESSAGE = {
  NOT_ASSIGNED: "This assessment is not assigned to you.",
  NOT_AVAILABLE: "This assessment is not available.",
  NO_QUESTIONS: "This assessment has no questions.",
  ATTEMPTS_EXHAUSTED: "No attempts remain for this assessment.",
} as const;

/**
 * Begins a real attempt — the moment a question pool is drawn and, if the
 * assessment has a time limit, the clock starts. Idempotent while an
 * attempt is already in progress: a re-call (page refresh) resumes the
 * same drawn set and the original start time rather than restarting.
 */
export const POST = withAuth<Ctx>(async (_request, { session, params }) => {
  if (!session.orgId) return errorResponse("NO_ORG", "You must belong to an organization.", 409);
  const { id } = await params;

  const admin = createAdminClient();
  const result = await startOrResumeAttempt(admin, { orgId: session.orgId, userId: session.userId, assessmentId: id });

  if (!result.ok) {
    return errorResponse(result.reason, REASON_MESSAGE[result.reason], REASON_STATUS[result.reason]);
  }

  return successResponse({
    questions: result.questions,
    startedAt: result.startedAt,
    timeLimitMinutes: result.timeLimitMinutes,
    attemptsRemaining: result.attemptsRemaining,
  });
});
