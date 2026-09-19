import { withAuth } from "@/lib/api/with-auth";
import { errorResponse, successResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";

export const GET = withAuth(async (_request, { session }) => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("assessments")
    .select("id, title, description, status, pass_percent, max_attempts, time_limit_minutes, question_pool_size, randomize_questions, created_at")
    .eq("org_id", session.orgId)
    .order("created_at", { ascending: false });
  if (error) return errorResponse("QUERY_FAILED", error.message, 500);
  return successResponse({ assessments: data ?? [] });
}, { minRole: "org_admin" });

export const POST = withAuth(async (request, { session }) => {
  if (!session.orgId) return errorResponse("NO_ORG", "You must belong to an organization.", 409);
  const body = await request.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const description = typeof body?.description === "string" ? body.description.trim() || null : null;
  const passPercent = Number(body?.passPercent ?? 80);
  const maxAttempts = Number(body?.maxAttempts ?? 2);
  // All three optional: null/absent keeps existing behaviour exactly (no
  // clock, every linked question, authored order) — this is additive, not
  // a new required decision for every assessment.
  const timeLimitMinutes = body?.timeLimitMinutes === "" || body?.timeLimitMinutes == null ? null : Number(body.timeLimitMinutes);
  const questionPoolSize = body?.questionPoolSize === "" || body?.questionPoolSize == null ? null : Number(body.questionPoolSize);
  const randomizeQuestions = body?.randomizeQuestions === true;
  if (!title) return errorResponse("INVALID_INPUT", "An assessment title is required.", 400);
  if (!Number.isInteger(passPercent) || passPercent < 1 || passPercent > 100) return errorResponse("INVALID_INPUT", "Pass score must be between 1 and 100.", 400);
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) return errorResponse("INVALID_INPUT", "Attempts must be between 1 and 10.", 400);
  if (timeLimitMinutes !== null && (!Number.isInteger(timeLimitMinutes) || timeLimitMinutes < 1)) return errorResponse("INVALID_INPUT", "Time limit must be a whole number of minutes, at least 1.", 400);
  if (questionPoolSize !== null && (!Number.isInteger(questionPoolSize) || questionPoolSize < 1)) return errorResponse("INVALID_INPUT", "Question pool size must be a whole number, at least 1.", 400);
  const supabase = await createClient();
  const { data, error } = await supabase.from("assessments").insert({
    org_id: session.orgId, title, description, pass_percent: passPercent, max_attempts: maxAttempts,
    time_limit_minutes: timeLimitMinutes, question_pool_size: questionPoolSize, randomize_questions: randomizeQuestions,
    created_by: session.userId,
  }).select("id, title, description, status, pass_percent, max_attempts, time_limit_minutes, question_pool_size, randomize_questions, created_at").single();
  if (error) return errorResponse("CREATE_FAILED", error.message, 500);
  return successResponse({ assessment: data }, 201);
}, { minRole: "org_admin" });
