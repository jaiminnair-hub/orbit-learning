import { generationZodSchemas, type AssessmentItem } from "@/lib/spec";
import { generateStructured, isRealProviderConfigured } from "./gateway";

/**
 * AI Question Generator — reuses `item_generation`'s existing schema and
 * gateway call verbatim (the same one `full-course-builder.ts` uses to
 * write in-content knowledge checks): `generationZodSchemas.items` already
 * produces `AssessmentItem[]`, which is exactly what `question_bank_items`
 * has stored since the 2026-09-03 item-shape unification. No new schema,
 * no new AI abstraction — a differently-scoped instruction over the same
 * primitive, same as every other Phase 3/4 generation feature.
 */

export const MIN_SOURCE_TEXT_LENGTH = 40;
export const MAX_SOURCE_TEXT_LENGTH = 20_000;
export const MIN_COUNT = 1;
export const MAX_COUNT = 20;

export function isQuestionGeneratorConfigured(): boolean {
  return isRealProviderConfigured("item_generation");
}

const INSTRUCTION =
  "The <source_material> is JSON with `sourceText` (the material to test) and `count` (how many questions to " +
  "write). Write exactly `count` scored questions grounded strictly in sourceText — do not invent facts absent " +
  "from it. Vary the kind across multipleChoice, multipleResponse, trueFalse and fillBlank as fits the material " +
  "rather than defaulting to one kind throughout. Every id must be a short lowercase slug, unique within your " +
  "response.";

export interface GeneratedQuestions {
  items: AssessmentItem[];
  provider: string;
  model: string;
}

export async function generateAssessmentQuestions(params: {
  orgId: string;
  userId: string;
  sourceText: string;
  count: number;
}): Promise<GeneratedQuestions> {
  const result = await generateStructured({
    profile: "item_generation",
    schema: generationZodSchemas.items,
    instruction: INSTRUCTION,
    source: JSON.stringify({ sourceText: params.sourceText, count: params.count }),
    orgId: params.orgId,
    userId: params.userId,
    feature: "assessments.question_generator",
  });
  return { items: result.data.items, provider: result.meta.provider, model: result.meta.model };
}
