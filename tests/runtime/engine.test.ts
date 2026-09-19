import { describe, expect, it } from "vitest";
import type { CourseSpecType as CourseSpec } from "@/lib/spec";
import { SPEC_SCHEMA_VERSION, validateCourseSpec } from "@/lib/spec";
import { enterPage, fireBlockEvent, firePageEvent, firstPageId, initRuntimeState, submitQuiz } from "@/lib/runtime/engine";
import { fromPersisted, toPersisted } from "@/lib/runtime/types";
import { fixtureSpec } from "../../spikes/export-conformance/fixture";

// Pure interpreter tests — no DB, no network, no React. Exercises
// lib/runtime/engine.ts directly against hand-built specs plus the real
// fixture from the step 3 export-conformance spike, per the approved step
// 5 plan's "engine unit tests" and "end-to-end fixture test".

function paragraph(text: string) {
  return { blocks: [{ kind: "paragraph" as const, spans: [{ text }] }] };
}

describe("initRuntimeState", () => {
  it("seeds variables from their declared initial values, and sensible defaults otherwise", () => {
    const spec: CourseSpec = {
      specSchemaVersion: SPEC_SCHEMA_VERSION,
      meta: { title: "t", locale: "en" },
      variables: [
        { id: "score", name: "Score", type: "number", scope: "course", initial: 5 },
        { id: "name", name: "Name", type: "text", scope: "course" },
        { id: "flag", name: "Flag", type: "boolean", scope: "course" },
      ],
      sections: [],
    };
    const state = initRuntimeState(spec);
    expect(state.variables).toEqual({ score: 5, name: "", flag: false });
    expect(state.currentPageId).toBeNull();
    expect(state.completedAt).toBeNull();
  });
});

describe("paging and triggers", () => {
  const spec: CourseSpec = {
    specSchemaVersion: SPEC_SCHEMA_VERSION,
    meta: { title: "Two pages", locale: "en" },
    completion: { rule: "allPagesVisited" },
    sections: [
      {
        id: "s1",
        title: "Section 1",
        pages: [
          {
            id: "p1",
            title: "Page 1",
            blocks: [
              { id: "b1", type: "text", content: paragraph("hello") },
              {
                id: "continue1",
                type: "continue",
                triggers: [{ id: "t1", when: "click", actions: [{ kind: "navigate", target: { kind: "next" } }] }],
              },
            ],
          },
          { id: "p2", title: "Page 2", blocks: [{ id: "b2", type: "text", content: paragraph("world") }] },
        ],
      },
    ],
  };

  it("firstPageId finds the first page in document order", () => {
    expect(firstPageId(spec)).toBe("p1");
  });

  it("enterPage marks the page visited and records it as current", () => {
    const { state } = enterPage(spec, initRuntimeState(spec), "p1");
    expect(state.currentPageId).toBe("p1");
    expect(state.visitedPages).toEqual(["p1"]);
  });

  it("a click trigger with a navigate:next action advances to the next page", () => {
    const { state: afterEnter } = enterPage(spec, initRuntimeState(spec), "p1");
    const { state: afterClick, effects } = fireBlockEvent(spec, afterEnter, "continue1", "click");
    expect(afterClick.currentPageId).toBe("p2");
    expect(afterClick.visitedPages).toEqual(["p1", "p2"]);
    expect(effects.navigatedTo).toBe("p2");
  });

  it("emits a 'progressed' xapi effect on every page transition", () => {
    const { effects } = enterPage(spec, initRuntimeState(spec), "p1");
    expect(effects.xapi).toContainEqual({ verb: "progressed", objectId: "p1" });
  });

  it("completes the course once every page has been visited (allPagesVisited)", () => {
    let state = initRuntimeState(spec);
    ({ state } = enterPage(spec, state, "p1"));
    expect(state.completedAt).toBeNull();
    const { state: afterSecond, effects } = enterPage(spec, state, "p2");
    expect(afterSecond.completedAt).not.toBeNull();
    expect(effects.courseCompleted).toBe(true);
    expect(effects.xapi.some((e) => e.verb === "completed")).toBe(true);
  });

  it("does not re-fire completion statements once already completed", () => {
    let state = initRuntimeState(spec);
    ({ state } = enterPage(spec, state, "p1"));
    ({ state } = enterPage(spec, state, "p2"));
    const firstCompletedAt = state.completedAt;
    const { state: again, effects } = enterPage(spec, state, "p1");
    expect(again.completedAt).toBe(firstCompletedAt);
    expect(effects.courseCompleted).toBeUndefined();
  });
});

describe("timeline: cue points and timelineComplete", () => {
  // The page-elapsed clock itself lives in RuntimeCoursePlayer.tsx (a React
  // component, verified separately in a real browser) — what's unit-testable
  // here is the pure dispatch firePageEvent gives it: given a cue/timeline
  // event has occurred, does the right page-level trigger actually run.
  const spec: CourseSpec = {
    specSchemaVersion: SPEC_SCHEMA_VERSION,
    meta: { title: "Timeline page", locale: "en" },
    sections: [
      {
        id: "s1",
        title: "Section 1",
        pages: [
          {
            id: "p1",
            title: "Page 1",
            blocks: [{ id: "b1", type: "text", content: paragraph("hello") }],
            timeline: { durationMs: 10_000, cuePoints: [{ id: "cue1", name: "Reveal", atMs: 3000 }] },
            triggers: [
              { id: "t-cue", when: "timelineCue", onId: "cue1", actions: [{ kind: "showBlock", blockId: "b1" }] },
              { id: "t-done", when: "timelineComplete", actions: [{ kind: "markComplete" }] },
            ],
          },
        ],
      },
    ],
  };

  it("fires the trigger matching the cue point's id, not other cues or events", () => {
    const { state: entered } = enterPage(spec, initRuntimeState(spec), "p1");
    const { state: afterCue } = firePageEvent(spec, entered, "timelineCue", "cue1");
    expect(afterCue.visibleBlocks.b1).toBe(true);
  });

  it("does not fire when the cue id does not match", () => {
    const { state: entered } = enterPage(spec, initRuntimeState(spec), "p1");
    const { state: afterOther } = firePageEvent(spec, entered, "timelineCue", "some-other-cue");
    expect(afterOther.visibleBlocks.b1).toBeUndefined();
  });

  it("timelineComplete has no onId, matching pageEnter/pageExit's shape", () => {
    const { state: entered } = enterPage(spec, initRuntimeState(spec), "p1");
    const { state: afterComplete } = firePageEvent(spec, entered, "timelineComplete");
    expect(afterComplete.manuallyCompleted).toBe(true);
  });

  it("playTimeline/pauseTimeline actions signal effects.timelineControl for the player to react to", () => {
    const specWithControls: CourseSpec = {
      ...spec,
      sections: [
        {
          id: "s1",
          title: "Section 1",
          pages: [
            {
              id: "p1",
              title: "Page 1",
              blocks: [
                {
                  id: "playBtn",
                  type: "continue",
                  triggers: [{ id: "t-play", when: "click", actions: [{ kind: "playTimeline" }] }],
                },
                {
                  id: "pauseBtn",
                  type: "continue",
                  triggers: [{ id: "t-pause", when: "click", actions: [{ kind: "pauseTimeline" }] }],
                },
              ],
              timeline: { durationMs: 10_000, autoplay: false },
            },
          ],
        },
      ],
    };
    const { state: entered } = enterPage(specWithControls, initRuntimeState(specWithControls), "p1");
    const { effects: playEffects } = fireBlockEvent(specWithControls, entered, "playBtn", "click");
    expect(playEffects.timelineControl).toBe("play");
    const { effects: pauseEffects } = fireBlockEvent(specWithControls, entered, "pauseBtn", "click");
    expect(pauseEffects.timelineControl).toBe("pause");
  });
});

describe("conditions and variable actions", () => {
  const spec: CourseSpec = {
    specSchemaVersion: SPEC_SCHEMA_VERSION,
    meta: { title: "Conditions", locale: "en" },
    variables: [{ id: "count", name: "Count", type: "number", scope: "course", initial: 0 }],
    sections: [
      {
        id: "s1",
        title: "S1",
        pages: [
          {
            id: "p1",
            title: "P1",
            blocks: [
              {
                id: "inc",
                type: "continue",
                label: "Increment",
                triggers: [{ id: "t1", when: "click", actions: [{ kind: "setVariable", variableId: "count", operation: "add", value: 1 }] }],
              },
              {
                id: "reveal",
                type: "text",
                content: paragraph("revealed"),
                initiallyHidden: true,
                triggers: [
                  {
                    id: "t2",
                    when: "click",
                    condition: { all: [{ kind: "variable", variableId: "count", operator: "greaterThanOrEqual", value: 3 }] },
                    actions: [{ kind: "showBlock", blockId: "reveal" }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  it("setVariable with operation 'add' accumulates across repeated events", () => {
    let state = initRuntimeState(spec);
    ({ state } = enterPage(spec, state, "p1"));
    ({ state } = fireBlockEvent(spec, state, "inc", "click"));
    ({ state } = fireBlockEvent(spec, state, "inc", "click"));
    expect(state.variables.count).toBe(2);
  });

  it("a trigger whose condition fails does not apply its actions", () => {
    let state = initRuntimeState(spec);
    ({ state } = enterPage(spec, state, "p1"));
    ({ state } = fireBlockEvent(spec, state, "inc", "click")); // count=1
    ({ state } = fireBlockEvent(spec, state, "reveal", "click")); // condition needs >=3, fails
    expect(state.visibleBlocks.reveal).toBeUndefined();
  });

  it("a trigger whose condition passes applies its actions", () => {
    let state = initRuntimeState(spec);
    ({ state } = enterPage(spec, state, "p1"));
    for (let i = 0; i < 3; i++) ({ state } = fireBlockEvent(spec, state, "inc", "click"));
    expect(state.variables.count).toBe(3);
    ({ state } = fireBlockEvent(spec, state, "reveal", "click"));
    expect(state.visibleBlocks.reveal).toBe(true);
  });
});

describe("quiz scoring via submitQuiz", () => {
  const spec: CourseSpec = {
    specSchemaVersion: SPEC_SCHEMA_VERSION,
    meta: { title: "Quiz", locale: "en" },
    completion: { rule: "passedQuiz", quizBlockId: "quiz1" },
    sections: [
      {
        id: "s1",
        title: "S1",
        pages: [
          {
            id: "p1",
            title: "P1",
            blocks: [
              {
                id: "quiz1",
                type: "quiz",
                passingScorePercent: 80,
                items: [
                  {
                    id: "mc1",
                    kind: "multipleChoice",
                    prompt: paragraph("2+2?"),
                    choices: [
                      { id: "a", text: paragraph("3") },
                      { id: "b", text: paragraph("4"), correct: true },
                    ],
                  },
                  {
                    id: "tf1",
                    kind: "trueFalse",
                    prompt: paragraph("Sky is blue"),
                    answer: true,
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  it("scores a fully-correct submission at 100% and marks it passed", () => {
    let state = initRuntimeState(spec);
    ({ state } = enterPage(spec, state, "p1"));
    const { state: after, effects } = submitQuiz(spec, state, "quiz1", { mc1: "b", tf1: true });
    expect(after.quizAttempts.quiz1.scorePercent).toBe(100);
    expect(after.quizAttempts.quiz1.passed).toBe(true);
    expect(effects.xapi.some((e) => e.verb === "answered" && e.result?.success === true)).toBe(true);
  });

  it("scores a half-correct submission at 50% and marks it not passed, without completing the course", () => {
    let state = initRuntimeState(spec);
    ({ state } = enterPage(spec, state, "p1"));
    const { state: after, effects } = submitQuiz(spec, state, "quiz1", { mc1: "a", tf1: true });
    expect(after.quizAttempts.quiz1.scorePercent).toBe(50);
    expect(after.quizAttempts.quiz1.passed).toBe(false);
    expect(after.completedAt).toBeNull();
    expect(effects.courseCompleted).toBeUndefined();
  });

  it("a passing submission completes the course and emits completed+passed", () => {
    let state = initRuntimeState(spec);
    ({ state } = enterPage(spec, state, "p1"));
    const { state: after, effects } = submitQuiz(spec, state, "quiz1", { mc1: "b", tf1: true });
    expect(after.completedAt).not.toBeNull();
    expect(effects.xapi.map((e) => e.verb)).toEqual(expect.arrayContaining(["answered", "completed", "passed"]));
  });
});

describe("persistence round-trip", () => {
  it("toPersisted/fromPersisted preserves every field of a non-trivial state", () => {
    const spec: CourseSpec = {
      specSchemaVersion: SPEC_SCHEMA_VERSION,
      meta: { title: "t", locale: "en" },
      variables: [{ id: "v", name: "V", type: "number", scope: "course", initial: 1 }],
      sections: [{ id: "s1", title: "S1", pages: [{ id: "p1", title: "P1", blocks: [{ id: "b1", type: "text", content: paragraph("x") }] }] }],
    };
    let state = initRuntimeState(spec);
    ({ state } = enterPage(spec, state, "p1"));
    state.variables.v = 42;
    state.blockCurrentStateId.b1 = "custom-state";
    state.completedBlocks.push("b1");

    const row = { ...toPersisted(state), completed_at: null };
    const restored = fromPersisted(row);

    expect(restored.currentPageId).toBe(state.currentPageId);
    expect(restored.variables).toEqual(state.variables);
    expect(restored.blockCurrentStateId).toEqual(state.blockCurrentStateId);
    expect(restored.visitedPages).toEqual(state.visitedPages);
    expect(restored.completedBlocks).toEqual(state.completedBlocks);
  });

  it("resume state stays addressed to the spec version it was saved under, even if the page id no longer exists in a hypothetical newer spec", () => {
    // The version-scoping guarantee itself lives in the DB unique key
    // (org_id, user_id, course_specification_id, spec_version) — this proves
    // the engine side doesn't silently repair a currentPageId that no
    // longer resolves, which is the failure mode that guarantee exists to
    // prevent.
    const oldSpec: CourseSpec = {
      specSchemaVersion: SPEC_SCHEMA_VERSION,
      meta: { title: "t", locale: "en" },
      sections: [{ id: "s1", title: "S1", pages: [{ id: "removed-page", title: "Removed", blocks: [] }] }],
    };
    const newSpec: CourseSpec = {
      specSchemaVersion: SPEC_SCHEMA_VERSION,
      meta: { title: "t", locale: "en" },
      sections: [{ id: "s1", title: "S1", pages: [{ id: "new-page", title: "New", blocks: [] }] }],
    };
    const { state } = enterPage(oldSpec, initRuntimeState(oldSpec), "removed-page");
    const row = { ...toPersisted(state), completed_at: null };
    const restored = fromPersisted(row);
    // Resolving this state against a spec that no longer has the page
    // returns null rather than guessing at a substitute page — the caller
    // (component) is expected to treat this as "start over", exactly what
    // the version-scoped DB key already forces for a real republish.
    const page = newSpec.sections[0].pages.find((p) => p.id === restored.currentPageId);
    expect(page).toBeUndefined();
  });
});

describe("the real step 3 fixture spec, played end to end", () => {
  it("validates cleanly against the schema (sanity check before interpreting it)", () => {
    expect(validateCourseSpec(fixtureSpec).valid).toBe(true);
  });

  it("walking welcome -> check -> a passing quiz submission completes the course, matching its declared 80% threshold", () => {
    let state = initRuntimeState(fixtureSpec);
    ({ state } = enterPage(fixtureSpec, state, "welcome"));
    expect(state.currentPageId).toBe("welcome");

    ({ state } = enterPage(fixtureSpec, state, "check"));
    expect(state.currentPageId).toBe("check");

    // 4 of 5 correct = 80%, exactly the fixture's own documented pass boundary.
    const { state: after, effects } = submitQuiz(fixtureSpec, state, "fire-quiz", {
      q1: "q1a",
      q2: "q2b",
      q3: "q3b",
      q4: "q4b",
      q5: "q5b", // wrong — correct is q5a
    });
    expect(after.quizAttempts["fire-quiz"].scorePercent).toBe(80);
    expect(after.quizAttempts["fire-quiz"].passed).toBe(true);
    expect(after.completedAt).not.toBeNull();
    expect(effects.xapi.map((e) => e.verb)).toEqual(expect.arrayContaining(["completed", "passed"]));
  });

  it("a 60% submission (3 of 5) does not meet the fixture's 80% threshold and does not complete the course", () => {
    let state = initRuntimeState(fixtureSpec);
    ({ state } = enterPage(fixtureSpec, state, "welcome"));
    ({ state } = enterPage(fixtureSpec, state, "check"));
    const { state: after } = submitQuiz(fixtureSpec, state, "fire-quiz", {
      q1: "q1a",
      q2: "q2b",
      q3: "q3b",
      q4: "q4a", // wrong
      q5: "q5b", // wrong
    });
    expect(after.quizAttempts["fire-quiz"].scorePercent).toBe(60);
    expect(after.quizAttempts["fire-quiz"].passed).toBe(false);
    expect(after.completedAt).toBeNull();
  });
});
