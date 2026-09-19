import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SPEC_SCHEMA_VERSION, validateCourseSpec, type CourseSpecType } from "@/lib/spec";
import { renderCourse } from "@/lib/export/render";
import {
  ASSET_BACKED_TYPES,
  createAssetBlock,
  createBlock,
  createEmbedBlock,
  INSERTABLE_TYPES,
} from "@/lib/authoring/block-factory";

/**
 * The claim under test: anything the *editor* can produce, the *exporter* can
 * render. Step 3's spike renderer covered three block types because that was
 * all its fixture used; step 9 packages authored courses, so a block an author
 * can insert and the exporter silently drops is a real defect.
 */

const ASSET_ID = randomUUID();

function specWith(blocks: unknown[]): CourseSpecType {
  return {
    specSchemaVersion: SPEC_SCHEMA_VERSION,
    meta: { title: "Export fixture", locale: "en" },
    sections: [{ id: "s1", title: "S1", pages: [{ id: "p1", title: "P1", blocks: blocks as never }] }],
  } as CourseSpecType;
}

describe("every editor-insertable block survives export", () => {
  it.each(INSERTABLE_TYPES)("'%s' renders to non-empty HTML", (type) => {
    const block = createBlock(type);
    const rendered = renderCourse(specWith([block]));
    const html = rendered.pages[0].bodyHtml;

    if (type === "continue") {
      // Navigation is the package shell's job — a second control would fight
      // the package's own next/previous. Documented, not accidental.
      expect(html).toBe("");
      return;
    }
    expect(html.length, `${type} produced no HTML`).toBeGreaterThan(0);
  });

  it.each(ASSET_BACKED_TYPES)("'%s' renders and registers its asset for packaging", (type) => {
    const rendered = renderCourse(specWith([createAssetBlock(type, ASSET_ID)]));
    expect(rendered.pages[0].bodyHtml.length).toBeGreaterThan(0);
    // Without this the zip would reference a file it never carried.
    expect(rendered.assetIds).toContain(ASSET_ID);
  });

  it("embed renders its provider iframe", () => {
    const rendered = renderCourse(specWith([createEmbedBlock("youtube", "abc123", "A video")]));
    expect(rendered.pages[0].bodyHtml).toContain("youtube.com/embed/abc123");
  });
});

describe("content fidelity", () => {
  it("carries heading text through at the authored level", () => {
    const rendered = renderCourse(specWith([{ id: "h", type: "heading", text: "Fire safety", level: 3 }]));
    expect(rendered.pages[0].bodyHtml).toContain("<h3>Fire safety</h3>");
  });

  it("escapes authored text rather than emitting it as markup", () => {
    const rendered = renderCourse(
      specWith([{ id: "h", type: "heading", text: "<script>alert(1)</script>", level: 2 }])
    );
    const html = rendered.pages[0].bodyHtml;
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("groups consecutive bullet spans into a real list", () => {
    const rendered = renderCourse(
      specWith([
        {
          id: "t",
          type: "text",
          content: {
            blocks: [
              { kind: "bulletItem", spans: [{ text: "One" }] },
              { kind: "bulletItem", spans: [{ text: "Two" }] },
            ],
          },
        },
      ])
    );
    expect(rendered.pages[0].bodyHtml).toMatch(/<ul><li>One<\/li><li>Two<\/li><\/ul>/);
  });

  it("preserves inline marks and links", () => {
    const rendered = renderCourse(
      specWith([
        {
          id: "t",
          type: "text",
          content: {
            blocks: [
              {
                kind: "paragraph",
                spans: [
                  { text: "bold", marks: ["bold"] },
                  { text: "link", link: { href: "https://example.test", newTab: true } },
                ],
              },
            ],
          },
        },
      ])
    );
    const html = rendered.pages[0].bodyHtml;
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain('href="https://example.test"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("renders a scenario's steps and choices as readable content", () => {
    // Branching cannot survive a static export; the content must.
    const rendered = renderCourse(specWith([createBlock("scenario")]));
    const html = rendered.pages[0].bodyHtml;
    expect(html).toContain("What would you do in this situation?");
    expect(html).toContain("The preferred response");
  });

  it("renders a sorting activity as its answer key", () => {
    const rendered = renderCourse(specWith([createBlock("sorting")]));
    const html = rendered.pages[0].bodyHtml;
    expect(html).toContain("Category A");
    expect(html).toContain("Belongs in A");
  });
});

describe("quizzes", () => {
  it("reports which quiz blocks the package must track", () => {
    const quiz = createBlock("quiz");
    const rendered = renderCourse(specWith([quiz]));
    expect(rendered.quizBlockIds).toEqual([quiz.id]);
  });

  it("marks the correct choice so the package can score offline", () => {
    const rendered = renderCourse(specWith([createBlock("quiz")]));
    const html = rendered.pages[0].bodyHtml;
    expect(html).toContain('data-correct="1"');
    expect(html).toContain('data-correct="0"');
    expect(html).toContain("submit-quiz");
  });

  it("carries the authored passing score onto the quiz element", () => {
    const rendered = renderCourse(
      specWith([
        {
          id: "q",
          type: "quiz",
          passingScorePercent: 80,
          items: [{ id: "i1", kind: "trueFalse", prompt: { blocks: [{ kind: "paragraph", spans: [{ text: "?" }] }] }, answer: true }],
        },
      ])
    );
    expect(rendered.pages[0].bodyHtml).toContain('data-pass="80"');
  });

  it("emits a self-contained script with no imports or network calls", () => {
    const { contentScript } = renderCourse(specWith([createBlock("quiz")]));
    expect(contentScript).toContain("course:complete");
    // An exported package runs inside another LMS with no route back to us.
    expect(contentScript).not.toMatch(/\bimport\b|\brequire\(|\bfetch\(/);
  });
});

describe("course structure", () => {
  it("renders every visible page in document order", () => {
    const spec: CourseSpecType = {
      specSchemaVersion: SPEC_SCHEMA_VERSION,
      meta: { title: "Two sections", locale: "en" },
      sections: [
        { id: "s1", title: "One", pages: [{ id: "p1", title: "First", blocks: [] }] },
        { id: "s2", title: "Two", pages: [{ id: "p2", title: "Second", blocks: [] }] },
      ],
    } as CourseSpecType;
    const rendered = renderCourse(spec);
    expect(rendered.pages.map((p) => p.id)).toEqual(["p1", "p2"]);
  });

  it("omits pages reachable only by triggers, which do not survive export", () => {
    const spec: CourseSpecType = {
      specSchemaVersion: SPEC_SCHEMA_VERSION,
      meta: { title: "Hidden", locale: "en" },
      sections: [
        {
          id: "s1",
          title: "One",
          pages: [
            { id: "p1", title: "Visible", blocks: [] },
            { id: "p2", title: "Hidden", blocks: [], hiddenFromMenu: true },
          ],
        },
      ],
    } as CourseSpecType;
    expect(renderCourse(spec).pages.map((p) => p.id)).toEqual(["p1"]);
  });
});

describe("Phase 3B: canvas positioning and animation survive export", () => {
  it("leaves a plain block with neither a position nor an animation track untouched", () => {
    // No wrapper div at all — the common case (no canvas, no animation)
    // must cost nothing and must not regress the plain block HTML above.
    const rendered = renderCourse(specWith([{ id: "h", type: "heading", text: "Plain", level: 2 }]));
    expect(rendered.pages[0].bodyHtml).toBe("<h2>Plain</h2>");
  });

  it("wraps a positioned block in a canvas frame with an inline percent-based position", () => {
    const spec = {
      specSchemaVersion: SPEC_SCHEMA_VERSION,
      meta: { title: "Canvas", locale: "en" },
      sections: [
        {
          id: "s1",
          title: "S1",
          pages: [
            {
              id: "p1",
              title: "P1",
              layout: { mode: "canvas", width: 1280, height: 720, scaling: "fit" },
              blocks: [
                { id: "h", type: "heading", text: "Positioned", level: 2, position: { x: 640, y: 360, width: 320, height: 180, unit: "px" } },
              ],
            },
          ],
        },
      ],
    } as CourseSpecType;

    const html = renderCourse(spec).pages[0].bodyHtml;
    expect(html).toContain('class="canvas-frame"');
    expect(html).toContain("aspect-ratio: 1280 / 720");
    // 640/1280 = 50%, 360/720 = 50%, 320/1280 = 25%, 180/720 = 25%.
    expect(html).toContain("left: 50%");
    expect(html).toContain("top: 50%");
    expect(html).toContain("width: 25%");
    expect(html).toContain("height: 25%");
    expect(html).toContain("<h2>Positioned</h2>");
  });

  it("falls an unpositioned block on a canvas page back to plain flow, after the frame", () => {
    const spec = {
      specSchemaVersion: SPEC_SCHEMA_VERSION,
      meta: { title: "Canvas", locale: "en" },
      sections: [
        {
          id: "s1",
          title: "S1",
          pages: [
            {
              id: "p1",
              title: "P1",
              layout: { mode: "canvas", width: 1280, height: 720, scaling: "fit" },
              blocks: [{ id: "h", type: "heading", text: "Unpositioned", level: 2 }],
            },
          ],
        },
      ],
    } as CourseSpecType;

    const html = renderCourse(spec).pages[0].bodyHtml;
    const frameIndex = html.indexOf('class="canvas-frame"');
    const blockIndex = html.indexOf("Unpositioned");
    expect(frameIndex).toBeGreaterThanOrEqual(0);
    expect(blockIndex).toBeGreaterThan(frameIndex);
    // No track and no position -> wrapBlock leaves it as plain, unwrapped HTML.
    expect(html.trim().endsWith("<h2>Unpositioned</h2>")).toBe(true);
  });

  it("registers a canvas background image for packaging", () => {
    const spec = {
      specSchemaVersion: SPEC_SCHEMA_VERSION,
      meta: { title: "Canvas", locale: "en" },
      sections: [
        {
          id: "s1",
          title: "S1",
          pages: [
            {
              id: "p1",
              title: "P1",
              layout: { mode: "canvas", width: 1280, height: 720, scaling: "fit", background: { imageAssetId: ASSET_ID } },
              blocks: [],
            },
          ],
        },
      ],
    } as CourseSpecType;

    const rendered = renderCourse(spec);
    expect(rendered.assetIds).toContain(ASSET_ID);
    expect(rendered.pages[0].bodyHtml).toContain(`assets/${ASSET_ID}`);
  });

  it("wraps an animated block with its timeline track as data, only autoplaying when the page timeline does", () => {
    const track = { blockId: "h", animations: [{ id: "a1", kind: "entrance", preset: "fade", startMs: 0, durationMs: 500 }] };
    const spec = {
      specSchemaVersion: SPEC_SCHEMA_VERSION,
      meta: { title: "Animated", locale: "en" },
      sections: [
        {
          id: "s1",
          title: "S1",
          pages: [
            {
              id: "p1",
              title: "P1",
              timeline: { durationMs: 5000, autoplay: true, tracks: [track] },
              blocks: [{ id: "h", type: "heading", text: "Fades in", level: 2 }],
            },
          ],
        },
      ],
    } as CourseSpecType;

    const html = renderCourse(spec).pages[0].bodyHtml;
    expect(html).toContain('class="anim-block"');
    expect(html).toContain('data-block-id="h"');
    expect(html).toContain('data-autoplay="1"');
    expect(html).toContain("&quot;preset&quot;:&quot;fade&quot;");
  });

  it("omits data-autoplay when the page timeline does not autoplay", () => {
    const track = { blockId: "h", animations: [{ id: "a1", kind: "entrance", preset: "fade", startMs: 0, durationMs: 500 }] };
    const spec = {
      specSchemaVersion: SPEC_SCHEMA_VERSION,
      meta: { title: "Animated", locale: "en" },
      sections: [
        {
          id: "s1",
          title: "S1",
          pages: [
            {
              id: "p1",
              title: "P1",
              timeline: { durationMs: 5000, autoplay: false, tracks: [track] },
              blocks: [{ id: "h", type: "heading", text: "Fades in", level: 2 }],
            },
          ],
        },
      ],
    } as CourseSpecType;

    const html = renderCourse(spec).pages[0].bodyHtml;
    expect(html).toContain('class="anim-block"');
    expect(html).not.toContain("data-autoplay");
  });

  it("carries the animation keyframes and reduced-motion rule into every packager's stylesheet", async () => {
    const { ANIMATION_KEYFRAMES_CSS } = await import("@/lib/export/render");
    expect(ANIMATION_KEYFRAMES_CSS).toContain("@keyframes orbit-rt-entrance-fade");
    expect(ANIMATION_KEYFRAMES_CSS).toContain("@keyframes orbit-rt-emphasis-colorShift");
    expect(ANIMATION_KEYFRAMES_CSS).toContain("prefers-reduced-motion");
  });
});

describe("the fixture proven in SCORM Cloud still renders", () => {
  it("renders the step 3 conformance fixture through the full renderer", async () => {
    const { fixtureSpec } = await import("../../spikes/export-conformance/fixture");
    expect(validateCourseSpec(fixtureSpec).valid).toBe(true);

    const rendered = renderCourse(fixtureSpec);
    expect(rendered.pages).toHaveLength(2);
    expect(rendered.quizBlockIds).toEqual(["fire-quiz"]);
    // The five authored questions must all reach the package.
    const optionCount = (rendered.pages[1].bodyHtml.match(/data-correct=/g) ?? []).length;
    expect(optionCount).toBe(15);
  });
});
