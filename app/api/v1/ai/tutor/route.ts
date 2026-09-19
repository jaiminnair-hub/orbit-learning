import { withAuth } from "@/lib/api/with-auth";
import { errorResponse, successResponse } from "@/lib/api/response";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiGenerateLimiter } from "@/lib/ratelimit";
import { AiGatewayError } from "@/lib/ai/types";
import { EmbeddingError } from "@/lib/ai/embeddings";
import {
  answerTutorQuestion,
  MAX_TUTOR_QUESTION_LENGTH,
  MIN_TUTOR_QUESTION_LENGTH,
  TutorError,
  type TutorContext,
} from "@/lib/ai/tutor";

export const maxDuration = 120;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface PublishedContextRow {
  course_id: string;
  course_title: string;
  module_title: string | null;
  lesson_title: string | null;
  learning_object_id: string;
  learning_object_title: string;
}

/** One independent learner question in, one published-course-grounded answer out. */
export const POST = withAuth(
  async (request, { session }) => {
    if (!session.orgId) {
      return errorResponse("NO_ORGANIZATION", "Join an organization before using Orbit Guide.", 403);
    }

    const body = await request.json().catch(() => null);
    const question = typeof body?.question === "string" ? body.question.trim() : "";
    if (question.length < MIN_TUTOR_QUESTION_LENGTH || question.length > MAX_TUTOR_QUESTION_LENGTH) {
      return errorResponse(
        "INVALID_INPUT",
        `Question must be between ${MIN_TUTOR_QUESTION_LENGTH} and ${MAX_TUTOR_QUESTION_LENGTH.toLocaleString()} characters.`,
        400
      );
    }

    try {
      const admin = createAdminClient();
      let context: TutorContext | undefined;
      if (body?.context != null) {
        const courseId = typeof body.context.courseId === "string" ? body.context.courseId : "";
        const learningObjectId = typeof body.context.learningObjectId === "string" ? body.context.learningObjectId : null;
        const pageTitle = typeof body.context.pageTitle === "string" ? body.context.pageTitle.trim().slice(0, 240) : null;
        if (!UUID.test(courseId) || (learningObjectId && !UUID.test(learningObjectId))) {
          return errorResponse("INVALID_CONTEXT", "Course context is invalid.", 400);
        }

        // The service-role client is necessary for the private Tutor index,
        // so context is independently reconstructed from the published-source
        // RPC instead of trusting course/lesson names supplied by the browser.
        const sourceResult = await admin.rpc("ai_tutor_published_sources", { match_org_id: session.orgId });
        if (sourceResult.error) {
          return errorResponse("TUTOR_CONTEXT_FAILED", "Could not verify this course context.", 503);
        }
        const rows = (sourceResult.data ?? []) as PublishedContextRow[];
        const match = rows.find(
          (row) => row.course_id === courseId && (!learningObjectId || row.learning_object_id === learningObjectId)
        );
        if (!match) {
          return errorResponse("CONTEXT_NOT_AVAILABLE", "This published course context is not available to Orbit Guide.", 404);
        }
        context = {
          courseId: match.course_id,
          courseTitle: match.course_title,
          learningObjectId: learningObjectId ?? null,
          learningObjectTitle: learningObjectId ? match.learning_object_title : null,
          moduleTitle: match.module_title,
          lessonTitle: match.lesson_title,
          pageTitle,
        };
      }

      const answer = await answerTutorQuestion(admin, {
        orgId: session.orgId,
        userId: session.userId,
        question,
        context,
      });
      return successResponse(answer);
    } catch (error) {
      if (error instanceof TutorError) {
        const status = error.code === "NOT_CONFIGURED" ? 422 : error.code === "UNSAFE_RESPONSE" ? 502 : 503;
        return errorResponse(`TUTOR_${error.code}`, error.message, status);
      }
      if (error instanceof EmbeddingError) {
        return errorResponse(`EMBEDDING_${error.code}`, error.message, error.code === "NOT_CONFIGURED" ? 422 : 502);
      }
      if (error instanceof AiGatewayError) {
        const status = error.code === "BUDGET_EXCEEDED" ? 402 : error.code === "NO_PROVIDER_CONFIGURED" ? 422 : 502;
        return errorResponse(`AI_${error.code}`, error.message, status);
      }
      const message = error instanceof Error ? error.message : "Orbit Guide could not answer this question.";
      return errorResponse("TUTOR_FAILED", message, 500);
    }
  },
  { rateLimit: aiGenerateLimiter }
);
