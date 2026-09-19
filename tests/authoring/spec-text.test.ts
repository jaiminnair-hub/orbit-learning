import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SPEC_SCHEMA_VERSION, type CourseSpecType } from "@/lib/spec";
import { specSearchText } from "@/lib/authoring/spec-text";
import { createBlock, INSERTABLE_TYPES } from "@/lib/authoring/block-factory";

/**
 * The block-tree walk that Phase 3 step 4 deferred until code existed which
 * already parsed the tree. What matters here is coverage — a block type the
 * walk forgets is a course that silently cannot be found by its own content.
 */

function specWith(blocks: unknown[], extra: Partial<CourseSpecType> = {}): CourseSpecType {
  return {
    specSchemaVersion: SPEC_SCHEMA_VERSION,
    meta: { title: "Search fixture", locale: "en" },
    sections: [{ id: "s1", title: "Section one", pages: [{ id: "p1", title: "Page one", blocks: blocks as never }] }],
    ...extra,
  } as CourseSpecType;
}

describe("structure text", () => {
  it("includes the course, section and page titles", () => {
    const text = specSearchText(specWith([]));
    expect(text).toContain("Search fixture");
    expect(text).toContain("Section one");
    expect(text).toContain("Page one");
  });

  it("includes the course description and learning objectives", () => {
    const spec = specWith([], {
      meta: {
        title: "T",
        locale: "en",
        description: { blocks: [{ kind: "paragraph", spans: [{ text: "Extinguisher handling" }] }] },
      },
      objectives: [{ id: "o1", text: "Evacuate a building safely" }],
    } as Partial<CourseSpecType>);
    const text = specSearchText(spec);
    expect(text).toContain("Extinguisher handling");
    expect(text).toContain("Evacuate a building safely");
  });

  it("collapses whitespace so the stored text stays compact", () => {
    const text = specSearchText(specWith([{ id: "h", type: "heading", text: "  spaced   out  ", level: 2 }]));
    expect(text).not.toMatch(/\s{2,}/);
    expect(text).toContain("spaced out");
  });
});

describe("block coverage", () => {
  // The regression that matters: a new block type added to the editor but
  // forgotten here produces a course findable only by its title.
  it.each(INSERTABLE_TYPES)("'%s' contributes its authored text", (type) => {
    const block = createBlock(type);
    const text = specSearchText(specWith([block]));

    if (type === "divider" || type === "spacer") {
      // Genuinely textless — nothing to contribute, and that is correct.
      return;
    }
    // Every other insertable block ships with real placeholder copy, so its
    // text must appear somewhere beyond the structural titles.
    const structureOnly = specSearchText(specWith([]));
    expect(text.length, `${type} added no searchable text`).toBeGreaterThan(structureOnly.length);
  });

  it("reaches text nested inside accordions, tabs and scenarios", () => {
    expect(specSearchText(specWith([createBlock("accordion")]))).toContain("First section");
    expect(specSearchText(specWith([createBlock("tabs")]))).toContain("Tab one");
    expect(specSearchText(specWith([createBlock("scenario")]))).toContain("What would you do in this situation?");
  });

  it("reaches quiz prompts and answer options", () => {
    const text = specSearchText(specWith([createBlock("quiz")]));
    expect(text).toContain("Ask your question here.");
    expect(text).toContain("The correct answer");
  });

  it("reaches blocks inside layers, not just top-level ones", () => {
    const spec = specWith([
      {
        id: "b1",
        type: "heading",
        text: "Top level",
        level: 2,
        layers: [
          {
            id: "l1",
            name: "Feedback layer",
            blocks: [{ id: "l1b", type: "text", content: { blocks: [{ kind: "paragraph", spans: [{ text: "Buried in a layer" }] }] } }],
          },
        ],
      },
    ]);
    const text = specSearchText(spec);
    expect(text).toContain("Feedback layer");
    expect(text).toContain("Buried in a layer");
  });
});

describe("what is deliberately excluded", () => {
  it("indexes alt text, because it describes real content", () => {
    const spec = specWith([
      { id: "i1", type: "image", assetId: randomUUID(), a11y: { altText: "A fire extinguisher cabinet" } },
    ]);
    expect(specSearchText(spec)).toContain("A fire extinguisher cabinet");
  });

  it("does not index author notes, which no learner can see", () => {
    const spec = specWith([
      {
        id: "q1",
        type: "quiz",
        items: [
          {
            id: "i1",
            kind: "trueFalse",
            prompt: { blocks: [{ kind: "paragraph", spans: [{ text: "Visible prompt" }] }] },
            authorNote: "SECRETNOTE internal reviewer comment",
            answer: true,
          },
        ],
      },
    ]);
    const text = specSearchText(spec);
    expect(text).toContain("Visible prompt");
    expect(text).not.toContain("SECRETNOTE");
  });

  it("does not index ids, asset references or block types", () => {
    const assetId = randomUUID();
    const spec = specWith([{ id: "distinctive-block-id", type: "image", assetId, a11y: { altText: "Alt" } }]);
    const text = specSearchText(spec);
    expect(text).not.toContain("distinctive-block-id");
    expect(text).not.toContain(assetId);
  });

  it("caps runaway output so a large course cannot break saving", () => {
    const huge = "word ".repeat(200_000);
    const spec = specWith([{ id: "t", type: "text", content: { blocks: [{ kind: "paragraph", spans: [{ text: huge }] }] } }]);
    expect(specSearchText(spec).length).toBeLessThanOrEqual(500_000);
  });
});
