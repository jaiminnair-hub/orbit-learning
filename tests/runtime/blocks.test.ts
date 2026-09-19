import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { LeafBlockType as LeafBlock } from "@/lib/spec";
import { SPEC_SCHEMA_VERSION } from "@/lib/spec";
import { initRuntimeState } from "@/lib/runtime/engine";
import type { RuntimeState } from "@/lib/runtime/types";
import { renderBlock, renderRichText, type BlockRenderCtx } from "@/components/runtime/block-renderers";
import { assetUrlCacheForTests } from "@/lib/runtime/use-asset-url";

// Renderer-output tests for the closed 24-type block set — proves markup
// correctness (content, structure, accessibility attributes, visibility
// gating), not interactivity: click/trigger *dispatch* correctness is
// already fully covered by the pure lib/runtime/engine.test.ts suite, so
// these only assert that a renderer surfaces the right thing for a given
// (block, state), per the approved step 5 plan's "given a block + state,
// correct output".
//
// Uses react-dom/server (already a dependency; no new test infra) rather
// than a DOM-testing library, since static markup is enough to prove
// output correctness without adding jsdom + @testing-library to a project
// that has never needed either.

function paragraph(text: string) {
  return { blocks: [{ kind: "paragraph" as const, spans: [{ text }] }] };
}

function baseState(): RuntimeState {
  return initRuntimeState({
    specSchemaVersion: SPEC_SCHEMA_VERSION,
    meta: { title: "t", locale: "en" },
    sections: [],
  });
}

function ctxFor(state: RuntimeState, overrides?: Partial<BlockRenderCtx>): BlockRenderCtx {
  return {
    state,
    onEvent: () => {},
    onSubmitQuiz: () => {},
    ...overrides,
  };
}

function html(block: LeafBlock, state = baseState()) {
  return renderToStaticMarkup(renderBlock(block, ctxFor(state)) as React.ReactElement);
}

describe("renderRichText", () => {
  it("renders paragraphs and groups consecutive bullet items into a real <ul>", () => {
    const rt = {
      blocks: [
        { kind: "paragraph" as const, spans: [{ text: "Intro" }] },
        { kind: "bulletItem" as const, spans: [{ text: "One" }] },
        { kind: "bulletItem" as const, spans: [{ text: "Two" }] },
      ],
    };
    const out = renderToStaticMarkup(renderRichText(rt) as React.ReactElement);
    expect(out).toContain("Intro");
    expect(out).toMatch(/^<p>/);
    expect(out).toMatch(/<ul><li>.*One.*<\/li><li>.*Two.*<\/li><\/ul>/);
  });

  it("applies bold/italic marks and renders a link with target and rel", () => {
    const rt = {
      blocks: [
        {
          kind: "paragraph" as const,
          spans: [
            { text: "bold", marks: ["bold" as const] },
            { text: "click", link: { href: "https://example.test", newTab: true } },
          ],
        },
      ],
    };
    const out = renderToStaticMarkup(renderRichText(rt) as React.ReactElement);
    expect(out).toContain("<strong>bold</strong>");
    expect(out).toContain('href="https://example.test"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
  });
});

describe("content block renderers", () => {
  it("text renders its rich text content", () => {
    const out = html({ id: "b1", type: "text", content: paragraph("Hello world") });
    expect(out).toContain("Hello world");
  });

  it("heading maps its level to a real heading element", () => {
    const out = html({ id: "b1", type: "heading", text: "Section Title", level: 3 });
    expect(out).toBe("<h3>Section Title</h3>");
  });

  it("list renders ordered vs unordered per the ordered flag", () => {
    const ordered = html({ id: "b1", type: "list", ordered: true, items: [paragraph("a"), paragraph("b")] });
    expect(ordered).toMatch(/^<ol>/);
    const unordered = html({ id: "b2", type: "list", items: [paragraph("a")] });
    expect(unordered).toMatch(/^<ul>/);
  });

  it("statement includes its emphasis label", () => {
    const out = html({ id: "b1", type: "statement", content: paragraph("Careful"), emphasis: "warning" });
    expect(out).toContain("WARNING");
    expect(out).toContain("Careful");
  });
});

describe("visibility gating", () => {
  it("a block marked initiallyHidden renders nothing by default", () => {
    const block: LeafBlock = { id: "b1", type: "text", content: paragraph("secret"), initiallyHidden: true };
    expect(renderBlock(block, ctxFor(baseState()))).toBeNull();
  });

  it("a showBlock override on state makes an initiallyHidden block render", () => {
    const state = baseState();
    state.visibleBlocks.b1 = true;
    const block: LeafBlock = { id: "b1", type: "text", content: paragraph("secret"), initiallyHidden: true };
    const out = renderToStaticMarkup(renderBlock(block, ctxFor(state)) as React.ReactElement);
    expect(out).toContain("secret");
  });

  it("a visible-by-default block hidden via state override renders nothing", () => {
    const state = baseState();
    state.visibleBlocks.b1 = false;
    const block: LeafBlock = { id: "b1", type: "text", content: paragraph("visible by default") };
    expect(renderBlock(block, ctxFor(state))).toBeNull();
  });
});

describe("accessibility surfacing", () => {
  it("image alt text reaches the rendered <img>", () => {
    const assetId = "11111111-1111-1111-1111-111111111111";
    assetUrlCacheForTests.set(assetId, "https://example.test/signed.png");
    const block: LeafBlock = { id: "b1", type: "image", assetId, a11y: { altText: "A safety diagram" } };
    const out = html(block);
    expect(out).toContain('alt="A safety diagram"');
    expect(out).toContain('src="https://example.test/signed.png"');
  });
});

describe("assessment renderers", () => {
  it("quiz renders every item's prompt and choice text", () => {
    const block: LeafBlock = {
      id: "quiz1",
      type: "quiz",
      title: "Check",
      items: [
        {
          id: "q1",
          kind: "multipleChoice",
          prompt: paragraph("2+2?"),
          choices: [
            { id: "a", text: paragraph("3") },
            { id: "b", text: paragraph("4"), correct: true },
          ],
        },
      ],
    };
    const out = html(block);
    expect(out).toContain("Check");
    expect(out).toContain("2+2?");
    expect(out).toContain("3");
    expect(out).toContain("4");
    expect(out).toContain("Submit");
  });

  it("shows the scored result once an attempt exists in state", () => {
    const state = baseState();
    state.quizAttempts.quiz1 = { answers: {}, scorePercent: 80, passed: true, submittedAt: new Date().toISOString() };
    const block: LeafBlock = {
      id: "quiz1",
      type: "quiz",
      items: [{ id: "q1", kind: "trueFalse", prompt: paragraph("x"), answer: true }],
    };
    const out = html(block, state);
    expect(out).toContain("80%");
    expect(out).toContain("Passed");
  });
});

describe("continue block gating", () => {
  it("is disabled while its required blocks are not yet complete", () => {
    const block: LeafBlock = { id: "c1", type: "continue", requiresBlockIds: ["quiz1"] };
    const out = html(block);
    expect(out).toContain("disabled");
  });

  it("is enabled once its required blocks are complete", () => {
    const state = baseState();
    state.completedBlocks.push("quiz1");
    const block: LeafBlock = { id: "c1", type: "continue", requiresBlockIds: ["quiz1"] };
    const out = html(block, state);
    expect(out).not.toContain("disabled");
  });
});

describe("scenario branching renderer", () => {
  it("renders the first step's message and its choices", () => {
    const block: LeafBlock = {
      id: "s1",
      type: "scenario",
      steps: [
        {
          id: "step1",
          message: paragraph("What do you do?"),
          choices: [{ id: "c1", text: paragraph("Run") }],
        },
      ],
    };
    const out = html(block);
    expect(out).toContain("What do you do?");
    expect(out).toContain("Run");
  });
});
