import { AssessmentItem } from "@/lib/spec";
import { plainToRichText } from "./rich-text";

/**
 * Turns the assessment authoring form's plain-string POST body into a real
 * AssessmentItem, then validates it against the actual spec schema
 * (lib/spec/items.ts) — the whole point of unifying onto this shape is
 * reusing that validator instead of hand-rolling a second one.
 *
 * Returns { item } on success or { error } with a message safe to show an
 * author — never throws, so the route can turn a bad request into a plain
 * 400 rather than a 500.
 */

interface RawChoice {
  text?: unknown;
  correct?: unknown;
}

export function buildAssessmentItem(
  id: string,
  body: Record<string, unknown>
): { item: AssessmentItem } | { error: string } {
  const kind = typeof body.kind === "string" ? body.kind : "";
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) return { error: "A question prompt is required." };

  let candidate: unknown;

  switch (kind) {
    case "multipleChoice":
    case "multipleResponse": {
      const rawChoices = Array.isArray(body.choices) ? (body.choices as RawChoice[]) : [];
      const choices = rawChoices
        .filter((c) => typeof c.text === "string" && c.text.trim())
        .map((c) => ({
          id: crypto.randomUUID(),
          text: plainToRichText((c.text as string).trim()),
          correct: c.correct === true,
        }));
      if (choices.length < 2) return { error: "Provide at least 2 answer choices." };
      if (!choices.some((c) => c.correct)) return { error: "Mark at least one choice as correct." };
      if (kind === "multipleChoice" && choices.filter((c) => c.correct).length > 1) {
        return { error: "Multiple choice allows exactly one correct answer — use multiple response for more than one." };
      }
      candidate = {
        id,
        kind,
        prompt: plainToRichText(prompt),
        choices,
        shuffle: body.shuffle === true,
        ...(kind === "multipleResponse" ? { partialCredit: body.partialCredit === true } : {}),
      };
      break;
    }

    case "trueFalse": {
      if (typeof body.answer !== "boolean") return { error: "Choose True or False as the correct answer." };
      candidate = { id, kind, prompt: plainToRichText(prompt), answer: body.answer };
      break;
    }

    case "fillBlank": {
      const raw = Array.isArray(body.acceptedAnswers) ? (body.acceptedAnswers as unknown[]) : [];
      const acceptedAnswers = raw.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim());
      if (!acceptedAnswers.length) return { error: "Provide at least one accepted answer." };
      candidate = {
        id,
        kind,
        prompt: plainToRichText(prompt),
        acceptedAnswers,
        caseSensitive: body.caseSensitive === true,
        trimWhitespace: body.trimWhitespace !== false,
      };
      break;
    }

    case "sequencing": {
      const raw = Array.isArray(body.steps) ? (body.steps as unknown[]) : [];
      const steps = raw
        .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
        .map((v) => ({ id: crypto.randomUUID(), text: plainToRichText(v.trim()) }));
      if (steps.length < 2) return { error: "Provide at least 2 steps, in the correct order." };
      candidate = { id, kind, prompt: plainToRichText(prompt), steps };
      break;
    }

    default:
      return { error: "Choose a question type." };
  }

  const parsed = AssessmentItem.safeParse(candidate);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "This question is not valid." };
  }
  return { item: parsed.data };
}
