import { withAuth } from "@/lib/api/with-auth";
import { errorResponse, successResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";
import { aiGenerateLimiter } from "@/lib/ratelimit";
import {
  generateAssessmentQuestions,
  isQuestionGeneratorConfigured,
  MAX_COUNT,
  MAX_SOURCE_TEXT_LENGTH,
  MIN_COUNT,
  MIN_SOURCE_TEXT_LENGTH,
} from "@/lib/ai/question-generator";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Generates real question-bank items from pasted source text and saves them
 * straight into this assessment's bank — a single bounded `item_generation`
 * call (unlike the multi-step Full AI Course Builder), so this runs
 * synchronously within the request rather than as a tracked job, the same
 * way the manual "add a question" POST already does.
 */
export const POST = withAuth<Ctx>(
  async (request, { session, params }) => {
    if (!session.orgId) return errorResponse("NO_ORG", "You must belong to an organization.", 409);
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const sourceText = typeof body?.sourceText === "string" ? body.sourceText.trim() : "";
    const count = Number(body?.count ?? 5);

    if (sourceText.length < MIN_SOURCE_TEXT_LENGTH) {
      return errorResponse("INVALID_INPUT", `Paste at least ${MIN_SOURCE_TEXT_LENGTH} characters of source material to generate from.`, 400);
    }
    if (sourceText.length > MAX_SOURCE_TEXT_LENGTH) {
      return errorResponse("INVALID_INPUT", `Source material is limited to ${MAX_SOURCE_TEXT_LENGTH.toLocaleString()} characters.`, 400);
    }
    if (!Number.isInteger(count) || count < MIN_COUNT || count > MAX_COUNT) {
      return errorResponse("INVALID_INPUT", `Question count must be a whole number between ${MIN_COUNT} and ${MAX_COUNT}.`, 400);
    }
    if (!isQuestionGeneratorConfigured()) {
      return errorResponse(
        "AI_NOT_CONFIGURED",
        "AI generation is not configured for this platform. Add a provider (e.g. ANTHROPIC_API_KEY) to enable this.",
        422
      );
    }

    const supabase = await createClient();
    const { data: assessment } = await supabase.from("assessments").select("id, status").eq("id", id).eq("org_id", session.orgId).single();
    if (!assessment) return errorResponse("NOT_FOUND", "Assessment not found.", 404);
    if (assessment.status !== "draft") return errorResponse("NOT_EDITABLE", "Only draft assessments can be changed.", 409);

    let generated;
    try {
      generated = await generateAssessmentQuestions({ orgId: session.orgId, userId: session.userId, sourceText, count });
    } catch (error) {
      return errorResponse("GENERATION_FAILED", error instanceof Error ? error.message : "Could not generate questions.", 502);
    }

    const { count: existingCount } = await supabase.from("assessment_questions").select("id", { count: "exact", head: true }).eq("assessment_id", id);
    let sequence = existingCount ?? 0;
    const created: { id: string; item: unknown }[] = [];
    const failed: string[] = [];

    // Inserted one at a time, not batched: a partial generation (some items
    // saved, one rejected) is more useful to an author reviewing a draft
    // than an all-or-nothing rollback discarding otherwise-good questions
    // over one bad one — the same stance the Excel importer already takes.
    for (const item of generated.items) {
      // question_bank_items.id is a real uuid primary key; the model's own
      // generated id is a short slug (correct for a course-spec's internal
      // block ids, meaningless as a table key). Mint a fresh one and
      // overwrite the item's top-level id to match, exactly like the manual
      // add-question route already does via buildAssessmentItem(id, body) —
      // a real bug this route had until a local verification run caught it:
      // every generated question failed to save with "invalid input syntax
      // for type uuid".
      const questionId = crypto.randomUUID();
      const { data: question, error: questionError } = await supabase.from("question_bank_items").insert({
        id: questionId, org_id: session.orgId, item: { ...item, id: questionId }, created_by: session.userId,
      }).select("id, item").single();
      if (questionError) { failed.push(questionError.message); continue; }

      const { error: linkError } = await supabase.from("assessment_questions").insert({
        org_id: session.orgId, assessment_id: id, question_id: question.id, sequence, points: 1,
      });
      if (linkError) { failed.push(linkError.message); continue; }
      created.push(question);
      sequence++;
    }

    return successResponse({
      created,
      requested: count,
      failedCount: failed.length,
      provider: generated.provider,
      model: generated.model,
    }, 201);
  },
  { minRole: "org_admin", rateLimit: aiGenerateLimiter }
);
