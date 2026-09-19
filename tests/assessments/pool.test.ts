import { describe, expect, it } from "vitest";
import { selectAttemptQuestions } from "@/lib/assessments/pool";

// A deterministic "shuffle" for assertions: reverses on each shuffle pass
// rather than truly randomizing, so results are reproducible without
// asserting on real randomness. selectAttemptQuestions calls rng() once per
// swap in a Fisher-Yates pass; a constant rng of 0 always swaps position i
// with position 0, which is enough to prove shuffling actually ran without
// needing to model true randomness.
const NO_SHUFFLE = () => 0;

describe("selectAttemptQuestions", () => {
  const ids = ["q1", "q2", "q3", "q4", "q5"];

  it("returns every question, in order, when no pool size or randomization is set", () => {
    expect(selectAttemptQuestions(ids, null, false)).toEqual(ids);
  });

  it("keeps every question when the pool size is not smaller than the bank", () => {
    expect(selectAttemptQuestions(ids, 5, false)).toEqual(ids);
    expect(selectAttemptQuestions(ids, 10, false)).toEqual(ids);
  });

  it("draws exactly poolSize questions, all real ids, no duplicates", () => {
    const selected = selectAttemptQuestions(ids, 2, false);
    expect(selected).toHaveLength(2);
    expect(new Set(selected).size).toBe(2);
    for (const id of selected) expect(ids).toContain(id);
  });

  it("preserves the bank's relative order for a drawn pool when randomize is off", () => {
    // With a pool smaller than the bank but randomize:false, whichever
    // subset is drawn must come back in the same relative order as `ids`.
    for (let i = 0; i < 20; i++) {
      const selected = selectAttemptQuestions(ids, 3, false);
      const indices = selected.map((id) => ids.indexOf(id));
      expect(indices).toEqual([...indices].sort((a, b) => a - b));
    }
  });

  it("shuffles the full set when randomize is on and pooling is off", () => {
    const selected = selectAttemptQuestions(ids, null, true, NO_SHUFFLE);
    expect(selected).toHaveLength(5);
    expect(new Set(selected)).toEqual(new Set(ids));
    expect(selected).not.toEqual(ids); // the deterministic rng must have actually reordered it
  });

  it("both draws a pool and shuffles it when both are set", () => {
    const selected = selectAttemptQuestions(ids, 3, true, NO_SHUFFLE);
    expect(selected).toHaveLength(3);
    for (const id of selected) expect(ids).toContain(id);
  });

  it("handles an empty bank", () => {
    expect(selectAttemptQuestions([], 3, true)).toEqual([]);
  });

  it("is deterministic given the same injected rng", () => {
    const rng = () => 0.42;
    expect(selectAttemptQuestions(ids, 3, true, rng)).toEqual(selectAttemptQuestions(ids, 3, true, rng));
  });
});
