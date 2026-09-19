import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards the one thing docs/SCORM_CONTENT_ISOLATION_ARCHITECTURE.md
 * explicitly accepted as a risk: apps/scorm-content/lib/ holds hand-made
 * copies of three pure files from the main app (adapter.ts, cmi.ts,
 * bridge-token.ts), because sharing them via an npm workspace was judged
 * more structural change than an MVP needed. That trade only stays safe
 * if the copies can't silently drift — this test is the automated half
 * of that promise; docs/SHARED_SCORM_LOGIC.md is the proposal for
 * removing the need for it entirely.
 *
 * Compares *behavior-bearing code*, not prose: each copy legitimately
 * carries an extra "COPY — source of truth is ..." doc-comment paragraph
 * pointing back here, and that's fine — a docs-only difference must not
 * fail this test, only a code difference should. So every comment is
 * stripped from both files before comparing, which also means a future
 * source-of-truth edit that only touches comments won't need this test
 * touched either.
 */

const ROOT = path.join(__dirname, "..", "..");

const PAIRS = [
  ["lib/scorm/adapter.ts", "apps/scorm-content/lib/adapter.ts"],
  ["lib/scorm/cmi.ts", "apps/scorm-content/lib/cmi.ts"],
  ["lib/scorm/bridge-token.ts", "apps/scorm-content/lib/bridge-token.ts"],
] as const;

/**
 * Strips `/* ... *\/` and `// ...` comments, then collapses whitespace,
 * so two files that differ only in documentation compare as identical.
 * None of these three files contain a string literal with "//" or "/*"
 * in it (verified by reading them) — the one case that would make a
 * regex-based stripper unsafe.
 */
function stripCommentsAndWhitespace(source: string): string {
  const noBlockComments = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const noLineComments = noBlockComments.replace(/\/\/.*$/gm, "");
  return noLineComments
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

describe("content-origin copies stay in sync with their source of truth", () => {
  it.each(PAIRS)("%s and %s are behaviorally identical", (sourcePath, copyPath) => {
    const source = readFileSync(path.join(ROOT, sourcePath), "utf-8");
    const copy = readFileSync(path.join(ROOT, copyPath), "utf-8");

    const normalizedSource = stripCommentsAndWhitespace(source);
    const normalizedCopy = stripCommentsAndWhitespace(copy);

    expect(
      normalizedCopy,
      `${copyPath} has drifted from ${sourcePath} — sync the code (comments may differ, e.g. the "COPY" notice) and rerun this test.`
    ).toBe(normalizedSource);
  });

  it("every copy still carries its source-of-truth pointer comment", () => {
    for (const [sourcePath, copyPath] of PAIRS) {
      const copy = readFileSync(path.join(ROOT, copyPath), "utf-8");
      expect(copy, `${copyPath} should point back to ${sourcePath}`).toMatch(
        /COPY — source of truth is/
      );
    }
  });
});
