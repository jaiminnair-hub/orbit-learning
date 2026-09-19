import { describe, expect, it } from "vitest";
import { scoreAssessment, type ScoringItem } from "@/lib/assessments/scoring";
import type { AssessmentItem } from "@/lib/spec";

function mc(id: string, correctId: string): AssessmentItem {
  return {
    id,
    kind: "multipleChoice",
    prompt: { blocks: [{ kind: "paragraph", spans: [{ text: "?" }] }] },
    choices: [
      { id: "a", text: { blocks: [{ kind: "paragraph", spans: [{ text: "A" }] }] }, correct: correctId === "a" },
      { id: "b", text: { blocks: [{ kind: "paragraph", spans: [{ text: "B" }] }] }, correct: correctId === "b" },
    ],
  };
}

describe("scoreAssessment — multipleChoice (weighted, by choice id not index)", () => {
  const items: ScoringItem[] = [
    { id: "q1", item: mc("q1", "b"), points: 1 },
    { id: "q2", item: mc("q2", "a"), points: 3 },
  ];

  it("scores weighted answers without trusting client-provided scores", () => {
    expect(scoreAssessment(items, { q1: "b", q2: "b" })).toEqual({
      earnedPoints: 1, totalPoints: 4, scorePercent: 25,
    });
  });

  it("returns a precise full score for correct answers", () => {
    expect(scoreAssessment(items, { q1: "b", q2: "a" }).scorePercent).toBe(100);
  });
});

describe("scoreAssessment — multipleResponse", () => {
  const item: AssessmentItem = {
    id: "q1",
    kind: "multipleResponse",
    prompt: { blocks: [{ kind: "paragraph", spans: [{ text: "?" }] }] },
    choices: [
      { id: "a", text: { blocks: [{ kind: "paragraph", spans: [{ text: "A" }] }] }, correct: true },
      { id: "b", text: { blocks: [{ kind: "paragraph", spans: [{ text: "B" }] }] }, correct: true },
      { id: "c", text: { blocks: [{ kind: "paragraph", spans: [{ text: "C" }] }] }, correct: false },
    ],
    partialCredit: true,
  };

  it("awards full credit for an exact set match", () => {
    expect(scoreAssessment([{ id: "q1", item, points: 10 }], { q1: ["a", "b"] }).scorePercent).toBe(100);
  });

  it("awards partial credit: correct minus incorrect over total correct", () => {
    // 1 correct (a) selected, 1 incorrect (c) selected: (1 - 1) / 2 = 0
    expect(scoreAssessment([{ id: "q1", item, points: 10 }], { q1: ["a", "c"] }).scorePercent).toBe(0);
    // 1 of 2 correct selected, nothing incorrect: 1/2 = 50%
    expect(scoreAssessment([{ id: "q1", item, points: 10 }], { q1: ["a"] }).scorePercent).toBe(50);
  });

  it("gives zero credit with no partial credit and an inexact match", () => {
    const strict = { ...item, partialCredit: false };
    expect(scoreAssessment([{ id: "q1", item: strict, points: 10 }], { q1: ["a"] }).scorePercent).toBe(0);
  });
});

describe("scoreAssessment — trueFalse", () => {
  const item: AssessmentItem = {
    id: "q1", kind: "trueFalse", prompt: { blocks: [{ kind: "paragraph", spans: [{ text: "?" }] }] }, answer: true,
  };
  it("scores true/false by boolean equality", () => {
    expect(scoreAssessment([{ id: "q1", item, points: 5 }], { q1: true }).scorePercent).toBe(100);
    expect(scoreAssessment([{ id: "q1", item, points: 5 }], { q1: false }).scorePercent).toBe(0);
  });
});

describe("scoreAssessment — fillBlank", () => {
  const caseInsensitiveTrimmed: AssessmentItem = {
    id: "q1", kind: "fillBlank", prompt: { blocks: [{ kind: "paragraph", spans: [{ text: "?" }] }] },
    acceptedAnswers: ["Paris"], caseSensitive: false, trimWhitespace: true,
  };
  it("is case-insensitive and trims whitespace by default behavior", () => {
    expect(scoreAssessment([{ id: "q1", item: caseInsensitiveTrimmed, points: 1 }], { q1: "  paris  " }).scorePercent).toBe(100);
  });

  const caseSensitive: AssessmentItem = { ...caseInsensitiveTrimmed, caseSensitive: true };
  it("respects caseSensitive: true", () => {
    expect(scoreAssessment([{ id: "q1", item: caseSensitive, points: 1 }], { q1: "paris" }).scorePercent).toBe(0);
    expect(scoreAssessment([{ id: "q1", item: caseSensitive, points: 1 }], { q1: "Paris" }).scorePercent).toBe(100);
  });

  const noTrim: AssessmentItem = { ...caseInsensitiveTrimmed, trimWhitespace: false };
  it("respects trimWhitespace: false", () => {
    expect(scoreAssessment([{ id: "q1", item: noTrim, points: 1 }], { q1: " Paris" }).scorePercent).toBe(0);
  });
});

describe("scoreAssessment — sequencing", () => {
  const item: AssessmentItem = {
    id: "q1", kind: "sequencing", prompt: { blocks: [{ kind: "paragraph", spans: [{ text: "?" }] }] },
    steps: [
      { id: "s1", text: { blocks: [{ kind: "paragraph", spans: [{ text: "First" }] }] } },
      { id: "s2", text: { blocks: [{ kind: "paragraph", spans: [{ text: "Second" }] }] } },
      { id: "s3", text: { blocks: [{ kind: "paragraph", spans: [{ text: "Third" }] }] } },
    ],
  };
  it("requires the exact authored order", () => {
    expect(scoreAssessment([{ id: "q1", item, points: 1 }], { q1: ["s1", "s2", "s3"] }).scorePercent).toBe(100);
    expect(scoreAssessment([{ id: "q1", item, points: 1 }], { q1: ["s2", "s1", "s3"] }).scorePercent).toBe(0);
  });
});
