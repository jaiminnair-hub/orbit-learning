import { strFromU8, unzipSync } from "fflate";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { SPEC_SCHEMA_VERSION, type CourseSpecType } from "@/lib/spec";
import { renderCourse } from "@/lib/export/render";
import { buildScorm2004Package } from "@/lib/export/scorm2004";
import { createBlock } from "@/lib/authoring/block-factory";

/**
 * Two real bugs caught during SCORM Cloud validation of a pipeline-built
 * package (2026-08-24), neither of them visible from asserting on the
 * generated source text alone — both needed a real DOM and a real click:
 *
 * 1. The nav links carry data-page attributes, but the shared content
 *    script never wired a click handler to them — "Check your
 *    understanding" did nothing in a real learner's browser.
 * 2. The quiz-submit handler called window.__courseTrack.* methods that
 *    neither format's API adapter ever defined — both only listen for a
 *    "course:complete" CustomEvent — so no pipeline-built package had ever
 *    actually reported a score to a real LMS.
 *
 * A fresh JSDOM instance per test avoids the two adapters' click listeners
 * (registered on `document` by the executed script, not scoped to a test)
 * leaking across tests the way a single shared environment would.
 */

function twoPageSpec(): CourseSpecType {
  return {
    specSchemaVersion: SPEC_SCHEMA_VERSION,
    meta: { title: "Nav fixture", locale: "en" },
    sections: [
      {
        id: "s1",
        title: "S1",
        pages: [
          { id: "p1", title: "Introduction", blocks: [{ id: "h", type: "heading", text: "Intro", level: 2 }] },
          { id: "p2", title: "Check your understanding", blocks: [createBlock("quiz")] },
        ],
      },
    ],
  } as CourseSpecType;
}

function loadPackage() {
  const rendered = renderCourse(twoPageSpec());
  const zip = buildScorm2004Package({
    title: rendered.title,
    identifier: "com.test.nav",
    pages: rendered.pages,
    contentScript: rendered.contentScript,
  });
  const files = unzipSync(zip);
  const html = strFromU8(files["index.html"]);
  const contentJs = strFromU8(files["content.js"]);

  const dom = new JSDOM(html, { runScripts: "outside-only" });
  dom.window.eval(contentJs);
  return dom.window.document;
}

describe("exported package page navigation", () => {
  it("shows only the first page before any click", () => {
    const document = loadPackage();
    const sections = document.querySelectorAll(".course-page");
    expect(sections).toHaveLength(2);
    expect((sections[0] as HTMLElement).hidden).toBe(false);
    expect((sections[1] as HTMLElement).hidden).toBe(true);
  });

  it("clicking a nav link switches the visible page", () => {
    const document = loadPackage();
    const link = document.querySelector('nav a[data-page="1"]') as HTMLAnchorElement;
    link.click();

    const page0 = document.querySelector('.course-page[data-page="0"]') as HTMLElement;
    const page1 = document.querySelector('.course-page[data-page="1"]') as HTMLElement;
    expect(page1.hidden).toBe(false);
    expect(page0.hidden).toBe(true);
  });

  it("round-trips back to the first page", () => {
    const document = loadPackage();
    (document.querySelector('nav a[data-page="1"]') as HTMLAnchorElement).click();
    (document.querySelector('nav a[data-page="0"]') as HTMLAnchorElement).click();

    const page0 = document.querySelector('.course-page[data-page="0"]') as HTMLElement;
    const page1 = document.querySelector('.course-page[data-page="1"]') as HTMLElement;
    expect(page0.hidden).toBe(false);
    expect(page1.hidden).toBe(true);
  });

  it("does not interfere with quiz submission on the same click listener", () => {
    const document = loadPackage();
    (document.querySelector('nav a[data-page="1"]') as HTMLAnchorElement).click();

    const submit = document.querySelector(".submit-quiz") as HTMLButtonElement;
    submit.click();

    const result = document.querySelector(".quiz-result") as HTMLElement;
    expect(result.hidden).toBe(false);
    expect(result.textContent).toMatch(/Score: \d+%/);
  });
});

describe("exported package quiz-completion tracking handoff", () => {
  it("dispatches course:complete with the quiz result on submit", () => {
    const document = loadPackage();
    (document.querySelector('nav a[data-page="1"]') as HTMLAnchorElement).click();

    const received: Array<{ scorePercent: number; passed: boolean }> = [];
    document.addEventListener("course:complete", (e) => {
      received.push((e as CustomEvent).detail);
    });

    (document.querySelector(".submit-quiz") as HTMLButtonElement).click();

    expect(received).toHaveLength(1);
    expect(typeof received[0].scorePercent).toBe("number");
    expect(typeof received[0].passed).toBe("boolean");
  });
});
