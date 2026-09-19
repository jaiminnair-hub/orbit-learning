import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CourseSpec, SPEC_SCHEMA_VERSION, validateCourseSpec } from "@/lib/spec";
import {
  ASSET_BACKED_TYPES,
  createAssetBlock,
  createBlankSpec,
  createBlock,
  createEmbedBlock,
  createPage,
  createSection,
  INSERTABLE_TYPES,
} from "@/lib/authoring/block-factory";

// The editor must never be able to create content its own validator
// rejects. These tests put every insertable block through the real schema
// rather than trusting the factory's shape by inspection.

// A real UUID, not a hand-typed one: AssetRef is z.uuid(), which checks the
// version and variant nibbles, so "1111...1111" is rejected as malformed.
const ASSET_ID = randomUUID();

function specContaining(blocks: unknown[]) {
  return {
    specSchemaVersion: SPEC_SCHEMA_VERSION,
    meta: { title: "Factory fixture", locale: "en" },
    sections: [{ id: "s1", title: "S1", pages: [{ id: "p1", title: "P1", blocks }] }],
  };
}

describe("createBlankSpec", () => {
  it("produces a specification that validates with no errors", () => {
    const report = validateCourseSpec(createBlankSpec("My New Course", SPEC_SCHEMA_VERSION));
    expect(report.valid, JSON.stringify(report.findings)).toBe(true);
  });

  it("starts with one section and one page, so the editor opens on something", () => {
    const spec = CourseSpec.parse(createBlankSpec("X", SPEC_SCHEMA_VERSION));
    expect(spec.sections).toHaveLength(1);
    expect(spec.sections[0].pages).toHaveLength(1);
    expect(spec.sections[0].pages[0].blocks.length).toBeGreaterThan(0);
  });
});

describe("createBlock", () => {
  it.each(INSERTABLE_TYPES)("'%s' validates against the real schema when inserted", (type) => {
    const report = validateCourseSpec(specContaining([createBlock(type)]));
    const schemaErrors = report.findings.filter((f) => f.kind === "schema" && f.severity === "error");
    expect(schemaErrors, JSON.stringify(schemaErrors)).toHaveLength(0);
  });

  it.each(INSERTABLE_TYPES)("'%s' gets a unique id on every insert", (type) => {
    const a = createBlock(type);
    const b = createBlock(type);
    expect(a.id).not.toBe(b.id);
  });

  it("gives a quiz a real, answerable question rather than an empty shell", () => {
    const block = createBlock("quiz");
    if (block.type !== "quiz") throw new Error("expected a quiz block");
    expect(block.items.length).toBeGreaterThan(0);
    const item = block.items[0];
    if (item.kind !== "multipleChoice") throw new Error("expected a multiple-choice item");
    // Exactly one correct choice — the validator rejects anything else.
    expect(item.choices.filter((c) => c.correct)).toHaveLength(1);
  });

  it("gives a sorting activity cards that reference categories it actually defines", () => {
    const block = createBlock("sorting");
    if (block.type !== "sorting") throw new Error("expected a sorting block");
    const categoryIds = new Set(block.categories.map((c) => c.id));
    for (const card of block.cards) expect(categoryIds.has(card.categoryId)).toBe(true);
  });
});

describe("createAssetBlock", () => {
  it.each(ASSET_BACKED_TYPES)("'%s' validates once given an asset", (type) => {
    const report = validateCourseSpec(specContaining([createAssetBlock(type, ASSET_ID)]));
    const schemaErrors = report.findings.filter((f) => f.kind === "schema" && f.severity === "error");
    expect(schemaErrors, JSON.stringify(schemaErrors)).toHaveLength(0);
  });

  it("leaves alt text empty rather than inventing it, so the accessibility gate can ask", () => {
    const block = createAssetBlock("image", ASSET_ID);
    expect(block.a11y?.altText).toBe("");
  });
});

describe("createEmbedBlock", () => {
  it("validates once the provider resource id is supplied", () => {
    const report = validateCourseSpec(specContaining([createEmbedBlock("youtube", "abc123", "A video")]));
    const schemaErrors = report.findings.filter((f) => f.kind === "schema" && f.severity === "error");
    expect(schemaErrors, JSON.stringify(schemaErrors)).toHaveLength(0);
  });

  it("is not offered as a blind insert, because an empty resourceId is a schema error", () => {
    expect(INSERTABLE_TYPES as readonly string[]).not.toContain("embed");
    const invalid = validateCourseSpec(
      specContaining([{ id: "e1", type: "embed", provider: "youtube", resourceId: "", title: "x" }])
    );
    expect(invalid.valid).toBe(false);
  });
});

describe("createSection / createPage", () => {
  it("a new section carries a page, and both validate inside a spec", () => {
    const spec = createBlankSpec("Structure", SPEC_SCHEMA_VERSION);
    spec.sections.push(createSection("Section 2"));
    spec.sections[0].pages.push(createPage("Page 2"));
    const report = validateCourseSpec(spec);
    // An empty page is a warning (PAGE_EMPTY), never an error.
    expect(report.findings.filter((f) => f.severity === "error")).toHaveLength(0);
  });
});
