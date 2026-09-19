import { describe, expect, it } from "vitest";
import { namespaceIds } from "@/lib/ai/full-course-builder";

/**
 * Regression test for a real bug found by a live end-to-end production
 * run (2026-09-04): each page/section's blocks and quiz items come from
 * its own independent AI call, prompted only for uniqueness *within that
 * one response* — the model has no visibility into ids other calls
 * produced. Real output reproduced exactly this: 'intro-text' as a block
 * id on two different pages, 'q1'/'q1a' as an item/choice id in two
 * different section checkpoints — lib/spec/validate.ts correctly rejected
 * the assembled course as a DUPLICATE_ID error, and no course was ever
 * saved. namespaceIds() is the fix: a deterministic, model-independent
 * rename pass applied per page/section coordinate during assembly.
 */
describe("namespaceIds", () => {
  it("prefixes a block's own id", () => {
    const block = { id: "intro-text", type: "text", richText: {} };
    expect(namespaceIds(block, "s0p0-")).toEqual({ id: "s0p0-intro-text", type: "text", richText: {} });
  });

  it("prefixes nested part ids alongside the parent's own id — the real 'q1'/'q1a' shape", () => {
    const quizItem = {
      id: "q1",
      kind: "multipleChoice",
      prompt: "Which is correct?",
      choices: [
        { id: "q1a", text: "Yes", correct: true },
        { id: "q1b", text: "No", correct: false },
      ],
    };
    expect(namespaceIds(quizItem, "s0i-")).toEqual({
      id: "s0i-q1",
      kind: "multipleChoice",
      prompt: "Which is correct?",
      choices: [
        { id: "s0i-q1a", text: "Yes", correct: true },
        { id: "s0i-q1b", text: "No", correct: false },
      ],
    });
  });

  it("makes two independently-generated responses that both used 'intro-text' distinct once namespaced", () => {
    const page0Blocks = [{ id: "intro-text", type: "text" }];
    const page1Blocks = [{ id: "intro-text", type: "text" }]; // a second, independent AI call reused the same natural name

    const renamed0 = namespaceIds(page0Blocks, "s0p0-");
    const renamed1 = namespaceIds(page1Blocks, "s0p1-");

    expect(renamed0[0].id).not.toBe(renamed1[0].id);
    expect(renamed0[0].id).toBe("s0p0-intro-text");
    expect(renamed1[0].id).toBe("s0p1-intro-text");
  });

  it("leaves non-id fields, arrays and primitives untouched", () => {
    const value = { title: "A page", count: 3, tags: ["a", "b"], nested: { label: "keep me" } };
    expect(namespaceIds(value, "x-")).toEqual(value);
  });

  it("passes through null/undefined unchanged", () => {
    expect(namespaceIds(null, "x-")).toBeNull();
    expect(namespaceIds(undefined, "x-")).toBeUndefined();
  });
});
