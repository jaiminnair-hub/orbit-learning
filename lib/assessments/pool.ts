/**
 * Question pooling and randomization for a standalone assessment attempt.
 *
 * Two independent knobs, deliberately not one: `poolSize` decides WHICH
 * questions are drawn from the assessment's full linked bank (a random
 * subset, different per attempt, when the bank is bigger than the pool);
 * `randomize` decides the PRESENTATION ORDER of whatever was drawn. A pool
 * smaller than the bank without randomize keeps the author's authored
 * `sequence` order among the drawn subset — randomize is what shuffles it.
 *
 * `rng` defaults to `Math.random` and exists only so tests can inject a
 * deterministic sequence rather than asserting on real randomness.
 */
export function selectAttemptQuestions(
  orderedIds: string[],
  poolSize: number | null,
  randomize: boolean,
  rng: () => number = Math.random
): string[] {
  function shuffle<T>(items: T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  let selected: string[];
  if (poolSize != null && poolSize < orderedIds.length) {
    // Random sample without replacement, preserving the original relative
    // (authored `sequence`) order among the drawn subset — shuffling that
    // subset further, if requested, happens as its own separate step below.
    const indices = orderedIds.map((_, i) => i);
    const shuffledIndices = shuffle(indices);
    const chosen = new Set(shuffledIndices.slice(0, poolSize));
    selected = orderedIds.filter((_, i) => chosen.has(i));
  } else {
    selected = [...orderedIds];
  }

  return randomize ? shuffle(selected) : selected;
}
