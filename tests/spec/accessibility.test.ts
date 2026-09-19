import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SPEC_SCHEMA_VERSION, validateCourseSpec, type CourseSpecType } from "@/lib/spec";
import { accessibilitySummary, checkAccessibility, contrastRatio, relativeLuminance } from "@/lib/spec/accessibility";

/**
 * The gate's contract, stated as tests: an accessibility error blocks
 * publishing, never saving; the strictness is the course's declared profile;
 * and a rule that only *suspects* a problem never blocks.
 */

const ASSET = randomUUID();

function specWith(blocks: unknown[], extra: Partial<CourseSpecType> = {}): CourseSpecType {
  return {
    specSchemaVersion: SPEC_SCHEMA_VERSION,
    meta: { title: "A11y fixture", locale: "en" },
    sections: [{ id: "s1", title: "S1", pages: [{ id: "p1", title: "P1", blocks: blocks as never }] }],
    ...extra,
  } as CourseSpecType;
}

const HEADING = { id: "h1", type: "heading", text: "A heading", level: 1 };

function codes(spec: CourseSpecType) {
  return checkAccessibility(spec).map((f) => f.code);
}

function finding(spec: CourseSpecType, code: string) {
  return checkAccessibility(spec).find((f) => f.code === code);
}

// ----------------------------------------------------------- alt text

describe("alt text (WCAG 1.1.1, Level A)", () => {
  it("blocks publishing when an image has none", () => {
    const f = finding(specWith([HEADING, { id: "i1", type: "image", assetId: ASSET }]), "ALT_TEXT_MISSING");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("error");
    expect(f!.kind).toBe("accessibility");
  });

  it("accepts an image explicitly marked decorative", () => {
    expect(
      codes(specWith([HEADING, { id: "i1", type: "image", assetId: ASSET, a11y: { decorative: true } }]))
    ).not.toContain("ALT_TEXT_MISSING");
  });

  it("accepts an image with alt text", () => {
    expect(
      codes(specWith([HEADING, { id: "i1", type: "image", assetId: ASSET, a11y: { altText: "A fire exit sign" } }]))
    ).not.toContain("ALT_TEXT_MISSING");
  });

  it("checks each gallery image individually, not the block as a whole", () => {
    const spec = specWith([
      HEADING,
      {
        id: "g1",
        type: "imageGallery",
        images: [
          { id: "a", assetId: ASSET, altText: "Described" },
          { id: "b", assetId: ASSET },
        ],
      },
    ]);
    const found = checkAccessibility(spec).filter((f) => f.code === "ALT_TEXT_MISSING");
    expect(found).toHaveLength(1);
    expect(found[0].path).toContain("/images/1");
  });

  it("covers labelled graphics and hotspots, not just plain images", () => {
    for (const type of ["labeledGraphic", "hotspot"] as const) {
      const block =
        type === "labeledGraphic"
          ? { id: "b", type, assetId: ASSET, markers: [{ id: "m", xPercent: 1, yPercent: 1, label: "M" }] }
          : {
              id: "b",
              type,
              assetId: ASSET,
              hotspots: [{ id: "h", shape: "rect", xPercent: 1, yPercent: 1, widthPercent: 1, heightPercent: 1, label: "H" }],
            };
      expect(codes(specWith([HEADING, block])), type).toContain("ALT_TEXT_MISSING");
    }
  });
});

// ------------------------------------------------------------ captions

describe("captions (WCAG 1.2.2, Level A)", () => {
  it("blocks video with neither captions nor a transcript", () => {
    const f = finding(specWith([HEADING, { id: "v1", type: "video", assetId: ASSET }]), "CAPTIONS_MISSING");
    expect(f?.severity).toBe("error");
  });

  it("accepts either captions or a transcript", () => {
    for (const key of ["captionAssetId", "transcriptAssetId"]) {
      expect(
        codes(specWith([HEADING, { id: "v1", type: "video", assetId: ASSET, a11y: { [key]: randomUUID() } }])),
        key
      ).not.toContain("CAPTIONS_MISSING");
    }
  });
});

// ------------------------------------------------------------- profile

describe("the accessibility profile decides strictness", () => {
  const withImage = (profile?: string) =>
    specWith([HEADING, { id: "i1", type: "image", assetId: ASSET }], {
      meta: { title: "T", locale: "en", ...(profile ? { accessibilityProfile: profile } : {}) },
    } as Partial<CourseSpecType>);

  it("enforces by default when the course declares nothing", () => {
    expect(finding(withImage(), "ALT_TEXT_MISSING")!.severity).toBe("error");
  });

  it("still enforces Level A rules under the 'wcag-2.2-a' profile", () => {
    expect(finding(withImage("wcag-2.2-a"), "ALT_TEXT_MISSING")!.severity).toBe("error");
  });

  it("reports without blocking under the 'none' profile", () => {
    const f = finding(withImage("none"), "ALT_TEXT_MISSING");
    // Still reported — opting out of the gate is not opting out of being told.
    expect(f).toBeDefined();
    expect(f!.severity).toBe("info");
  });

  it("downgrades AA-only rules under the 'wcag-2.2-a' profile", () => {
    const theme = { colors: { background: "#ffffff", text: "#c0c0c0" } };
    const aa = specWith([HEADING], { theme } as Partial<CourseSpecType>);
    const a = specWith([HEADING], {
      theme,
      meta: { title: "T", locale: "en", accessibilityProfile: "wcag-2.2-a" },
    } as Partial<CourseSpecType>);

    expect(finding(aa, "CONTRAST_INSUFFICIENT")!.severity).toBe("error");
    expect(finding(a, "CONTRAST_INSUFFICIENT")!.severity).toBe("warning");
  });
});

// ------------------------------------------------------------ contrast

describe("contrast maths (WCAG 2.x)", () => {
  it("computes the reference extremes correctly", () => {
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
    // Black on white is the maximum ratio, 21:1.
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 2);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });

  it("accepts shorthand hex and a leading hash either way", () => {
    expect(contrastRatio("000", "fff")).toBeCloseTo(21, 2);
    expect(contrastRatio("#000", "#FFF")).toBeCloseTo(21, 2);
  });

  it("returns null for a named design token rather than guessing", () => {
    // Theme colours may be token names the spec cannot resolve. Reporting a
    // confident number for one would be worse than reporting nothing.
    expect(contrastRatio("primary", "#ffffff")).toBeNull();
    expect(relativeLuminance("surface")).toBeNull();
  });

  it("flags text below 4.5:1 and accepts text above it", () => {
    const fail = specWith([HEADING], { theme: { colors: { background: "#ffffff", text: "#bbbbbb" } } } as Partial<CourseSpecType>);
    const pass = specWith([HEADING], { theme: { colors: { background: "#ffffff", text: "#333333" } } } as Partial<CourseSpecType>);
    expect(codes(fail)).toContain("CONTRAST_INSUFFICIENT");
    expect(codes(pass)).not.toContain("CONTRAST_INSUFFICIENT");
  });

  it("says nothing when the theme declares no background to compare against", () => {
    expect(codes(specWith([HEADING], { theme: { colors: { text: "#000000" } } } as Partial<CourseSpecType>))).not.toContain(
      "CONTRAST_INSUFFICIENT"
    );
  });
});

// ------------------------------------------------- heuristics stay warnings

describe("rules that suspect rather than prove never block", () => {
  it("warns on a skipped heading level", () => {
    const f = finding(
      specWith([
        { id: "h1", type: "heading", text: "One", level: 1 },
        { id: "h2", type: "heading", text: "Three", level: 3 },
      ]),
      "HEADING_LEVEL_SKIPPED"
    );
    expect(f?.severity).toBe("warning");
  });

  it("does not warn when heading levels descend one at a time", () => {
    expect(
      codes(
        specWith([
          { id: "h1", type: "heading", text: "One", level: 1 },
          { id: "h2", type: "heading", text: "Two", level: 2 },
          { id: "h3", type: "heading", text: "Three", level: 3 },
        ])
      )
    ).not.toContain("HEADING_LEVEL_SKIPPED");
  });

  it("warns on link text that describes nothing out of context", () => {
    const spec = specWith([
      HEADING,
      {
        id: "t1",
        type: "text",
        content: {
          blocks: [{ kind: "paragraph", spans: [{ text: "click here", link: { href: "https://example.test" } }] }],
        },
      },
    ]);
    expect(finding(spec, "LINK_TEXT_NOT_DESCRIPTIVE")?.severity).toBe("warning");
  });

  it("accepts descriptive link text", () => {
    const spec = specWith([
      HEADING,
      {
        id: "t1",
        type: "text",
        content: {
          blocks: [
            { kind: "paragraph", spans: [{ text: "the fire safety policy", link: { href: "https://example.test" } }] },
          ],
        },
      },
    ]);
    expect(codes(spec)).not.toContain("LINK_TEXT_NOT_DESCRIPTIVE");
  });

  it("warns on a bare URL used as link text", () => {
    const spec = specWith([
      HEADING,
      {
        id: "t1",
        type: "text",
        content: {
          blocks: [
            { kind: "paragraph", spans: [{ text: "https://example.test/a/b", link: { href: "https://example.test/a/b" } }] },
          ],
        },
      },
    ]);
    expect(codes(spec)).toContain("LINK_TEXT_NOT_DESCRIPTIVE");
  });

  it("warns when a page has content but no heading", () => {
    const spec = specWith([
      { id: "t1", type: "text", content: { blocks: [{ kind: "paragraph", spans: [{ text: "Body only." }] }] } },
    ]);
    expect(finding(spec, "PAGE_HEADING_MISSING")?.severity).toBe("warning");
  });

  it("warns when only some blocks set an explicit reading order", () => {
    const spec = specWith([
      { ...HEADING, a11y: { readingOrder: 1 } },
      { id: "t1", type: "text", content: { blocks: [{ kind: "paragraph", spans: [{ text: "No order set." }] }] } },
    ]);
    expect(finding(spec, "READING_ORDER_PARTIAL")?.severity).toBe("warning");
  });

  it("warns on an embed still carrying its placeholder title", () => {
    const spec = specWith([
      HEADING,
      { id: "e1", type: "embed", provider: "youtube", resourceId: "abc", title: "Embedded media" },
    ]);
    expect(finding(spec, "EMBED_TITLE_GENERIC")?.severity).toBe("warning");
  });
});

// ------------------------------------------------------- broken content

describe("unusable content blocks regardless of heuristics", () => {
  it("blocks an answer option with no text", () => {
    const spec = specWith([
      HEADING,
      {
        id: "q1",
        type: "quiz",
        items: [
          {
            id: "i1",
            kind: "multipleChoice",
            prompt: { blocks: [{ kind: "paragraph", spans: [{ text: "Pick one" }] }] },
            choices: [
              { id: "a", text: { blocks: [{ kind: "paragraph", spans: [{ text: "Right" }] }] }, correct: true },
              { id: "b", text: { blocks: [{ kind: "paragraph", spans: [{ text: "" }] }] } },
            ],
          },
        ],
      },
    ]);
    expect(finding(spec, "CHOICE_TEXT_EMPTY")?.severity).toBe("error");
  });
});

// ------------------------------------------------------------- the gate

describe("the publish gate", () => {
  it("reports accessibility errors through the main validator", () => {
    const report = validateCourseSpec(specWith([HEADING, { id: "i1", type: "image", assetId: ASSET }]));
    // `valid` is what the publish route gates on.
    expect(report.valid).toBe(false);
    expect(report.findings.some((f) => f.kind === "accessibility" && f.severity === "error")).toBe(true);
  });

  it("leaves a clean course publishable", () => {
    const report = validateCourseSpec(
      specWith([HEADING, { id: "i1", type: "image", assetId: ASSET, a11y: { altText: "A fire exit sign" } }])
    );
    expect(report.valid).toBe(true);
  });

  it("does not block a course that opted out of the profile", () => {
    const report = validateCourseSpec(
      specWith([HEADING, { id: "i1", type: "image", assetId: ASSET }], {
        meta: { title: "T", locale: "en", accessibilityProfile: "none" },
      } as Partial<CourseSpecType>)
    );
    expect(report.valid).toBe(true);
  });

  it("summarises for the editor panel", () => {
    const report = validateCourseSpec(specWith([{ id: "i1", type: "image", assetId: ASSET }]));
    const summary = accessibilitySummary(report.findings);
    expect(summary.passes).toBe(false);
    expect(summary.errorCount).toBeGreaterThan(0);
    // The heading warning rides along without blocking.
    expect(summary.warningCount).toBeGreaterThan(0);
    expect(summary.findings.every((f) => f.kind === "accessibility")).toBe(true);
  });

  it("findings carry the addressing the editor needs to deep-link", () => {
    const f = finding(specWith([HEADING, { id: "img-99", type: "image", assetId: ASSET }]), "ALT_TEXT_MISSING")!;
    expect(f.pageId).toBe("p1");
    expect(f.sectionId).toBe("s1");
    expect(f.blockId).toBe("img-99");
    expect(f.path).toContain("/sections/0/pages/0/blocks/1");
  });
});
