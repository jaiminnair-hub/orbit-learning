import { withAuth } from "@/lib/api/with-auth";
import { errorResponse, successResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";
import { buildAssessmentItem } from "@/lib/assessments/build-item";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withAuth<Ctx>(async (_request, { session, params }) => {
  const { id } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase.from("assessment_questions")
    .select("id, sequence, points, question_bank_items(id, item, explanation)")
    .eq("org_id", session.orgId).eq("assessment_id", id).order("sequence");
  if (error) return errorResponse("QUERY_FAILED", error.message, 500);
  return successResponse({ questions: data ?? [] });
}, { minRole: "org_admin" });

export const POST = withAuth<Ctx>(async (request, { session, params }) => {
  if (!session.orgId) return errorResponse("NO_ORG", "You must belong to an organization.", 409);
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return errorResponse("INVALID_INPUT", "Invalid request body.", 400);

  const points = Number((body as Record<string, unknown>).points ?? 1);
  const externalId = typeof (body as Record<string, unknown>).externalId === "string" ? ((body as Record<string, unknown>).externalId as string).trim() || null : null;
  const learningObjective = typeof (body as Record<string, unknown>).learningObjective === "string" ? ((body as Record<string, unknown>).learningObjective as string).trim() || null : null;
  const skillCode = typeof (body as Record<string, unknown>).skillCode === "string" ? ((body as Record<string, unknown>).skillCode as string).trim() || null : null;
  const rawDifficulty = (body as Record<string, unknown>).difficulty;
  const difficulty = typeof rawDifficulty === "string" && ["foundation", "working", "advanced"].includes(rawDifficulty) ? rawDifficulty : null;
  const rawTags = (body as Record<string, unknown>).tags;
  const tags = Array.isArray(rawTags) ? rawTags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0).map((tag) => tag.trim()) : [];

  if (!Number.isInteger(points) || points < 1 || points > 100) return errorResponse("INVALID_INPUT", "Points must be between 1 and 100.", 400);

  const supabase = await createClient();
  const { data: assessment } = await supabase.from("assessments").select("id, status").eq("id", id).eq("org_id", session.orgId).single();
  if (!assessment) return errorResponse("NOT_FOUND", "Assessment not found.", 404);
  if (assessment.status !== "draft") return errorResponse("NOT_EDITABLE", "Only draft assessments can be changed.", 409);

  const questionId = crypto.randomUUID();
  const built = buildAssessmentItem(questionId, body as Record<string, unknown>);
  if ("error" in built) return errorResponse("INVALID_INPUT", built.error, 400);

  const { data: question, error: questionError } = await supabase.from("question_bank_items").insert({
    id: questionId, org_id: session.orgId, item: built.item, created_by: session.userId,
    external_id: externalId, learning_objective: learningObjective, skill_code: skillCode, difficulty, tags,
  }).select("id, item").single();
  if (questionError) return errorResponse("CREATE_FAILED", questionError.message, 500);

  const { count } = await supabase.from("assessment_questions").select("id", { count: "exact", head: true }).eq("assessment_id", id);
  const { error: linkError } = await supabase.from("assessment_questions").insert({
    org_id: session.orgId, assessment_id: id, question_id: question.id, sequence: count ?? 0, points,
  });
  if (linkError) return errorResponse("LINK_FAILED", linkError.message, 500);
  return successResponse({ question: { ...question, points, sequence: count ?? 0 } }, 201);
}, { minRole: "org_admin" });
