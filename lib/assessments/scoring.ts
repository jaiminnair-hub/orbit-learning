import type { AssessmentItem } from "@/lib/spec";

/**
 * Scores a standalone assessment attempt against the real AssessmentItem
 * shape (lib/spec/items.ts) — the same shape Phase 3's authored-course
 * quiz blocks use, unified 2026-09-03 (see
 * supabase/migrations/20260903090000_question_bank_assessment_items.sql).
 *
 * Answers are keyed by choice/step *id*, never positional index — index
 * would break the moment `shuffle: true` reorders choices for a learner.
 */

export type ScoringItem = { id: string; item: AssessmentItem; points: number };

export interface ScoringResult {
  earnedPoints: number;
  totalPoints: number;
  scorePercent: number;
}

function normalizeFillBlank(value: string, item: Extract<AssessmentItem, { kind: "fillBlank" }>): string {
  const trimmed = item.trimWhitespace === false ? value : value.trim();
  return item.caseSensitive ? trimmed : trimmed.toLowerCase();
}

/**
 * Returns a fraction in [0, 1] of the item's points earned — 1 or 0 for
 * every kind except multipleResponse with partialCredit enabled, which can
 * land anywhere in between.
 */
function scoreItem(item: AssessmentItem, answer: unknown): number {
  switch (item.kind) {
    case "multipleChoice": {
      const correctId = item.choices.find((c) => c.correct)?.id;
      return typeof answer === "string" && answer === correctId ? 1 : 0;
    }

    case "multipleResponse": {
      const correctIds = new Set(item.choices.filter((c) => c.correct).map((c) => c.id));
      const allIds = new Set(item.choices.map((c) => c.id));
      if (!Array.isArray(answer)) return 0;
      const given = new Set(answer.filter((v): v is string => typeof v === "string" && allIds.has(v)));

      const exactMatch = given.size === correctIds.size && [...correctIds].every((id) => given.has(id));
      if (exactMatch) return 1;
      if (!item.partialCredit || correctIds.size === 0) return 0;

      let correctSelected = 0;
      let incorrectSelected = 0;
      for (const id of given) {
        if (correctIds.has(id)) correctSelected++;
        else incorrectSelected++;
      }
      return Math.max(0, (correctSelected - incorrectSelected) / correctIds.size);
    }

    case "trueFalse":
      return typeof answer === "boolean" && answer === item.answer ? 1 : 0;

    case "fillBlank": {
      if (typeof answer !== "string") return 0;
      const candidate = normalizeFillBlank(answer, item);
      return item.acceptedAnswers.some((accepted) => normalizeFillBlank(accepted, item) === candidate) ? 1 : 0;
    }

    case "sequencing": {
      if (!Array.isArray(answer)) return 0;
      const correctOrder = item.steps.map((s) => s.id);
      if (answer.length !== correctOrder.length) return 0;
      return answer.every((id, i) => id === correctOrder[i]) ? 1 : 0;
    }
  }
}

export function scoreAssessment(items: ScoringItem[], answers: Record<string, unknown>): ScoringResult {
  const totalPoints = items.reduce((sum, q) => sum + q.points, 0);
  const earnedPoints = items.reduce((sum, q) => sum + scoreItem(q.item, answers[q.id]) * q.points, 0);
  return {
    earnedPoints: Math.round(earnedPoints * 100) / 100,
    totalPoints,
    scorePercent: totalPoints === 0 ? 0 : Math.round((earnedPoints / totalPoints) * 10000) / 100,
  };
}
