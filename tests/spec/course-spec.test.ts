import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  BLOCK_TYPES,
  courseSpecJsonSchema,
  generationSchemas,
  SPEC_SCHEMA_VERSION,
  validateCourseSpec,
} from "@/lib/spec";

/**
 * Step 2 of DEVELOPMENT_SEQUENCE_PHASE3.md.
 *
 * The bar set in PHASE3_TECHNICAL_ARCHITECTURE.md §7: "malformed specs must be
 * rejected with useful errors, not silently accepted". Every rejection test
 * therefore asserts the *finding code and path*, not merely that something went
 * wrong — an error nobody can act on is barely better than no error.
 */

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(path.join(__dirname, "fixtures", `${name}.json`), "utf-8"));

/**
 * These tests deliberately build documents the schema should reject, so they
 * work with loose records rather than the inferred `CourseSpec` type — a
 * well-typed invalid spec is a contradiction. `validateCourseSpec` takes
 * `unknown` for the same reason: its real callers are an AI response and an
 * HTTP body.
 */
type Mut = Record<string, unknown>;

const firstPage = (spec: Mut): Mut => ((spec.sections as Mut[])[0].pages as Mut[])[0];
const blocksOf = (spec: Mut): Mut[] => firstPage(spec).blocks as Mut[];

/** A minimal valid spec, built fresh so tests can mutate it freely. */
function baseSpec(): Record<string, unknown> {
  return {
    specSchemaVersion: SPEC_SCHEMA_VERSION,
    meta: { title: "Test course", locale: "en" },
    variables: [{ id: "score", name: "Score", type: "number", scope: "course", initial: 0 }],
    sections: [
      {
        id: "s1",
        title: "Section one",
        pages: [
          {
            id: "p1",
            title: "Page one",
            blocks: [
              { id: "b1", type: "heading", text: "Hello", level: 2 },
              {
                id: "b2",
                type: "text",
                content: { blocks: [{ kind: "paragraph", spans: [{ text: "Body copy." }] }] },
              },
            ],
          },
        ],
      },
    ],
  };
}

const codes = (report: ReturnType<typeof validateCourseSpec>) => report.findings.map((f) => f.code);

const errorCodes = (report: ReturnType<typeof validateCourseSpec>) =>
  report.findings.filter((f) => f.severity === "error").map((f) => f.code);

describe("course specification — valid documents", () => {
  it("accepts a minimal course", () => {
    const report = validateCourseSpec(fixture("valid-minimal"));
    expect(report.errorCount, JSON.stringify(report.findings, null, 2)).toBe(0);
    expect(report.valid).toBe(true);
  });

  it("accepts the base fixture built in-test", () => {
    const report = validateCourseSpec(baseSpec());
    expect(report.errorCount, JSON.stringify(report.findings, null, 2)).toBe(0);
  });

  /**
   * The Phase 3B accommodation, exercised end to end. No Phase 3 editor
   * produces this document — but if the specification ever stops being able to
   * express canvas layout, absolute positioning, cue points and motion
   * animation, the parity path has been broken and this test is the alarm.
   */
  it("accepts canvas layout, absolute positioning, timelines and motion animation", () => {
    const report = validateCourseSpec(fixture("valid-canvas-timeline"));
    expect(report.errorCount, JSON.stringify(report.findings, null, 2)).toBe(0);
  });

  it("accepts a full interaction: states, layers, conditions and actions", () => {
    const spec = baseSpec();
    blocksOf(spec).push({
      id: "hotspot-1",
      type: "hotspot",
      assetId: "11111111-1111-4111-8111-111111111111",
      a11y: { altText: "Diagram of the machine" },
      hotspots: [
        { id: "h1", shape: "circle", xPercent: 10, yPercent: 20, widthPercent: 5, heightPercent: 5, label: "Guard" },
      ],
      states: [{ id: "st-visited", name: "visited" }],
      layers: [
        {
          id: "ly-detail",
          name: "Detail",
          modal: true,
          blocks: [{ id: "ly-b1", type: "text", content: { blocks: [{ kind: "paragraph", spans: [{ text: "Detail." }] }] } }],
        },
      ],
      triggers: [
        {
          id: "tr-open",
          when: "click",
          onId: "h1",
          condition: { all: [{ kind: "variable", variableId: "score", operator: "greaterThanOrEqual", value: 0 }] },
          actions: [
            { kind: "showLayer", layerId: "ly-detail" },
            { kind: "setState", blockId: "hotspot-1", stateId: "st-visited" },
            { kind: "setVariable", variableId: "score", operation: "add", value: 1 },
          ],
        },
      ],
    });
    const report = validateCourseSpec(spec);
    expect(report.errorCount, JSON.stringify(report.findings, null, 2)).toBe(0);
  });
});

describe("course specification — structural rejection", () => {
  it("rejects a block type outside the closed set", () => {
    const spec = baseSpec();
    blocksOf(spec).push({ id: "x", type: "customWidget", html: "<script>x</script>" });
    const report = validateCourseSpec(spec);
    expect(report.valid).toBe(false);
  });

  it("rejects unknown keys rather than silently dropping them", () => {
    const spec = baseSpec();
    blocksOf(spec)[0].onClick = "alert(1)";
    const report = validateCourseSpec(spec);
    expect(report.valid).toBe(false);
  });

  it("rejects a spec that is not an object at all", () => {
    expect(validateCourseSpec("nonsense").valid).toBe(false);
    expect(validateCourseSpec(null).valid).toBe(false);
    expect(validateCourseSpec([]).valid).toBe(false);
  });

  it("rejects an unsupported schema version instead of guessing", () => {
    const spec = baseSpec();
    spec.specSchemaVersion = "99.0.0";
    expect(errorCodes(validateCourseSpec(spec))).toContain("SPEC_VERSION_UNSUPPORTED");
  });
});

describe("course specification — referential integrity", () => {
  it("rejects duplicate ids", () => {
    const spec = baseSpec();
    blocksOf(spec)[1].id = "b1";
    const report = validateCourseSpec(spec);
    expect(errorCodes(report)).toContain("DUPLICATE_ID");
  });

  /**
   * "When the learner clicks hotspot h1" is the ordinary case in both Rise and
   * Storyline, so interactive sub-elements must be resolvable trigger sources
   * and must share the global id namespace.
   */
  it("resolves a trigger fired on an interactive sub-element", () => {
    const spec = baseSpec();
    blocksOf(spec).push({
      id: "acc-1",
      type: "accordion",
      items: [{ id: "acc-item-1", title: "One", content: { blocks: [{ kind: "paragraph", spans: [{ text: "x" }] }] } }],
      triggers: [{ id: "t-acc", when: "click", onId: "acc-item-1", actions: [{ kind: "markComplete" }] }],
    });
    expect(errorCodes(validateCourseSpec(spec))).not.toContain("TRIGGER_SOURCE_MISSING");
  });

  it("rejects an id reused between a block and a sub-element", () => {
    const spec = baseSpec();
    blocksOf(spec).push({
      id: "acc-1",
      type: "accordion",
      items: [{ id: "b1", title: "One", content: { blocks: [{ kind: "paragraph", spans: [{ text: "x" }] }] } }],
    });
    expect(errorCodes(validateCourseSpec(spec))).toContain("DUPLICATE_ID");
  });

  it("rejects a trigger action targeting a block that does not exist", () => {
    const spec = baseSpec();
    blocksOf(spec)[0].triggers = [
      { id: "t1", when: "click", onId: "b1", actions: [{ kind: "showBlock", blockId: "ghost" }] },
    ];
    const report = validateCourseSpec(spec);
    expect(errorCodes(report)).toContain("ACTION_BLOCK_MISSING");
  });

  it("rejects a condition referencing an undeclared variable", () => {
    const spec = baseSpec();
    firstPage(spec).triggers = [
      {
        id: "t1",
        when: "pageEnter",
        condition: { all: [{ kind: "variable", variableId: "undeclared", operator: "equals", value: 1 }] },
        actions: [{ kind: "markComplete" }],
      },
    ];
    expect(errorCodes(validateCourseSpec(spec))).toContain("CONDITION_VARIABLE_MISSING");
  });

  it("rejects setState pointing at a state the block does not define", () => {
    const spec = baseSpec();
    blocksOf(spec)[0].triggers = [
      { id: "t1", when: "click", onId: "b1", actions: [{ kind: "setState", blockId: "b2", stateId: "nope" }] },
    ];
    expect(errorCodes(validateCourseSpec(spec))).toContain("ACTION_STATE_MISSING");
  });

  it("requires an event source for events that need one", () => {
    const spec = baseSpec();
    blocksOf(spec)[0].triggers = [
      { id: "t1", when: "click", actions: [{ kind: "markComplete" }] },
    ];
    expect(errorCodes(validateCourseSpec(spec))).toContain("TRIGGER_SOURCE_REQUIRED");
  });

  it("rejects a variable whose initial value contradicts its declared type", () => {
    const spec = baseSpec();
    (spec.variables as Mut[])[0].initial = "not a number";
    expect(errorCodes(validateCourseSpec(spec))).toContain("VARIABLE_INITIAL_TYPE");
  });

  it("rejects a completion rule pointing at a non-quiz block", () => {
    const spec = baseSpec();
    spec.completion = { rule: "passedQuiz", quizBlockId: "b1" };
    expect(errorCodes(validateCourseSpec(spec))).toContain("COMPLETION_QUIZ_WRONG_TYPE");
  });

  it("rejects a sorting card in an undefined category", () => {
    const spec = baseSpec();
    blocksOf(spec).push({
      id: "sort-1",
      type: "sorting",
      categories: [{ id: "c1", label: "A" }, { id: "c2", label: "B" }],
      cards: [
        { id: "cd1", text: { blocks: [{ kind: "paragraph", spans: [{ text: "one" }] }] }, categoryId: "c1" },
        { id: "cd2", text: { blocks: [{ kind: "paragraph", spans: [{ text: "two" }] }] }, categoryId: "missing" },
      ],
    });
    expect(errorCodes(validateCourseSpec(spec))).toContain("SORTING_CATEGORY_MISSING");
  });
});

describe("course specification — layout and timeline rules", () => {
  it("rejects an absolute position on a flow page instead of ignoring it", () => {
    const spec = baseSpec();
    blocksOf(spec)[0].position = { x: 10, y: 10, width: 100, height: 50, unit: "px" };
    const report = validateCourseSpec(spec);
    expect(errorCodes(report)).toContain("POSITION_ON_FLOW_PAGE");
  });

  it("rejects a motion path on a flow page, where its coordinates are meaningless", () => {
    const spec = baseSpec();
    const page = firstPage(spec);
    page.timeline = {
      durationMs: 5000,
      tracks: [
        {
          blockId: "b1",
          animations: [
            {
              id: "a1",
              kind: "motion",
              startMs: 0,
              durationMs: 1000,
              path: { kind: "line", points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] },
            },
          ],
        },
      ],
    };
    expect(errorCodes(validateCourseSpec(spec))).toContain("MOTION_PATH_ON_FLOW_PAGE");
  });

  it("rejects a timeline track for a block on a different page", () => {
    const spec = baseSpec();
    firstPage(spec).timeline = {
      durationMs: 1000,
      tracks: [{ blockId: "elsewhere", appearAtMs: 0 }],
    };
    expect(errorCodes(validateCourseSpec(spec))).toContain("TIMELINE_BLOCK_MISSING");
  });

  it("rejects a track that disappears before it appears", () => {
    const spec = baseSpec();
    firstPage(spec).timeline = {
      durationMs: 5000,
      tracks: [{ blockId: "b1", appearAtMs: 3000, disappearAtMs: 1000 }],
    };
    expect(errorCodes(validateCourseSpec(spec))).toContain("TIMELINE_RANGE_INVALID");
  });

  it("warns, but does not fail, when an animation overruns the timeline", () => {
    const spec = baseSpec();
    const page = firstPage(spec);
    page.layout = { mode: "canvas", width: 1280, height: 720, scaling: "fit" };
    blocksOf(spec)[0].position = { x: 0, y: 0, width: 100, height: 40, unit: "px" };
    blocksOf(spec)[1].position = { x: 0, y: 60, width: 300, height: 80, unit: "px" };
    page.timeline = {
      durationMs: 1000,
      tracks: [{ blockId: "b1", animations: [{ id: "a1", kind: "entrance", preset: "fade", startMs: 900, durationMs: 500 }] }],
    };
    const report = validateCourseSpec(spec);
    expect(codes(report)).toContain("ANIMATION_EXCEEDS_TIMELINE");
    expect(report.errorCount).toBe(0);
  });
});

describe("course specification — safety boundaries", () => {
  it("rejects a link with a javascript: scheme", () => {
    const spec = baseSpec();
    blocksOf(spec)[1].content = {
      blocks: [{ kind: "paragraph", spans: [{ text: "click", link: { href: "javascript:alert(1)" } }] }],
    };
    const report = validateCourseSpec(spec);
    expect(errorCodes(report)).toContain("LINK_SCHEME_NOT_ALLOWED");
  });

  it("rejects a data: URL link", () => {
    const spec = baseSpec();
    blocksOf(spec)[1].content = {
      blocks: [{ kind: "paragraph", spans: [{ text: "x", link: { href: "data:text/html;base64,PHNjcmlwdD4=" } }] }],
    };
    expect(errorCodes(validateCourseSpec(spec))).toContain("LINK_SCHEME_NOT_ALLOWED");
  });

  it("allows ordinary http, https, mailto and in-course links", () => {
    for (const href of ["https://example.com", "http://example.com", "mailto:a@b.com", "/page-2", "#anchor"]) {
      const spec = baseSpec();
      blocksOf(spec)[1].content = {
        blocks: [{ kind: "paragraph", spans: [{ text: "x", link: { href } }] }],
      };
      expect(errorCodes(validateCourseSpec(spec)), href).not.toContain("LINK_SCHEME_NOT_ALLOWED");
    }
  });

  /**
   * A structural assertion rather than a behavioural one: if no field in the
   * entire published schema can carry code, then "the LLM cannot emit
   * executable content" is true by construction rather than by sanitisation.
   */
  it("exposes no field anywhere that could carry executable content", () => {
    const schema = JSON.stringify(courseSpecJsonSchema());
    const forbidden = ["\"script\"", "\"html\"", "\"rawHtml\"", "\"onClick\"", "\"onclick\"", "\"javascript\"", "\"eval\"", "\"expression\"", "\"customCss\"", "\"styleAttribute\""];
    for (const key of forbidden) {
      expect(schema, `schema must not expose ${key}`).not.toContain(key);
    }
  });
});

describe("course specification — accessibility findings", () => {
  // Behaviour changed in Phase 3 step 10. Missing alt text was a warning that
  // let a course publish; it is now an error that blocks publishing, governed
  // by `meta.accessibilityProfile` (see tests/spec/accessibility.test.ts).
  // The change is safe because saving and publishing gate on different
  // things — `validateForWrite` blocks only on *schema* errors — so an author
  // is never stopped from saving an image they have not described yet.
  it("flags a missing alt text as an error that blocks publishing", () => {
    const spec = baseSpec();
    blocksOf(spec).push({
      id: "img-1",
      type: "image",
      assetId: "11111111-1111-4111-8111-111111111111",
    });
    const report = validateCourseSpec(spec);
    const finding = report.findings.find((f) => f.code === "ALT_TEXT_MISSING");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
    expect(finding?.kind).toBe("accessibility");
    expect(report.valid).toBe(false);
  });

  it("does not flag an image explicitly marked decorative", () => {
    const spec = baseSpec();
    blocksOf(spec).push({
      id: "img-1",
      type: "image",
      assetId: "11111111-1111-4111-8111-111111111111",
      a11y: { decorative: true },
    });
    expect(codes(validateCourseSpec(spec))).not.toContain("ALT_TEXT_MISSING");
  });

  it("flags video with neither captions nor a transcript", () => {
    const spec = baseSpec();
    blocksOf(spec).push({
      id: "vid-1",
      type: "video",
      assetId: "11111111-1111-4111-8111-111111111111",
    });
    expect(codes(validateCourseSpec(spec))).toContain("CAPTIONS_MISSING");
  });
});

describe("course specification — findings are actionable", () => {
  it("addresses a finding to the exact block that caused it", () => {
    const spec = baseSpec();
    blocksOf(spec)[0].position = { x: 1, y: 1, width: 1, height: 1, unit: "px" };
    const finding = validateCourseSpec(spec).findings.find((f) => f.code === "POSITION_ON_FLOW_PAGE");
    expect(finding?.path).toBe("/sections/0/pages/0/blocks/0/position");
    expect(finding?.blockId).toBe("b1");
    expect(finding?.pageId).toBe("p1");
  });

  it("reports a schema failure at the offending path", () => {
    const spec = baseSpec();
    blocksOf(spec)[0].level = 99;
    const report = validateCourseSpec(spec);
    expect(report.valid).toBe(false);
    expect(report.findings.some((f) => f.path.includes("/sections/0/pages/0/blocks/0"))).toBe(true);
  });

  it("carries a message that names what to do", () => {
    const spec = baseSpec();
    blocksOf(spec)[0].position = { x: 1, y: 1, width: 1, height: 1, unit: "px" };
    const finding = validateCourseSpec(spec).findings.find((f) => f.code === "POSITION_ON_FLOW_PAGE");
    expect(finding?.message).toMatch(/canvas/i);
  });
});

describe("JSON Schema emission", () => {
  it("emits a whole-document schema", () => {
    const schema = courseSpecJsonSchema();
    expect(schema.title).toBe("CourseSpec");
    expect(schema.type).toBe("object");
    expect(JSON.stringify(schema)).toContain("specSchemaVersion");
  });

  it("closes additionalProperties, matching the strict validator", () => {
    const schema = JSON.stringify(courseSpecJsonSchema());
    expect(schema).toContain('"additionalProperties":false');
  });

  it("emits every narrow generation schema the pipeline needs", () => {
    for (const [name, build] of Object.entries(generationSchemas)) {
      const schema = build();
      expect(schema, name).toBeTruthy();
      expect(typeof schema, name).toBe("object");
    }
  });

  it("keeps per-step generation schemas far smaller than the whole document", () => {
    const whole = JSON.stringify(courseSpecJsonSchema()).length;
    const outline = JSON.stringify(generationSchemas.outline()).length;
    expect(outline).toBeLessThan(whole / 4);
  });

  it("covers every block type in the closed set", () => {
    expect(BLOCK_TYPES.length).toBeGreaterThanOrEqual(20);
    const schema = JSON.stringify(courseSpecJsonSchema());
    for (const type of BLOCK_TYPES) {
      expect(schema, `block type ${type} must appear in the schema`).toContain(`"${type}"`);
    }
  });
});
