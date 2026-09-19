import type { CSSProperties } from "react";
import type { CourseSpecType as CourseSpec, LeafBlockType as LeafBlock, PageType as Page, RichText, TimelineTrack } from "@/lib/spec";
import { canvasBackgroundStyle, canvasFrameStyle, positionStyle } from "@/lib/runtime/canvas";

/**
 * Spec → static HTML, for export packages.
 *
 * This is the *export* renderer, and it is deliberately a different thing from
 * the runtime interpreter in `lib/runtime/`. The interpreter is React, runs in
 * our app, and talks to our API for state. An exported package runs inside
 * somebody else's LMS with no network access to us at all — so everything it
 * needs has to be inert HTML plus one self-contained script.
 *
 * Promoted here from `spikes/export-conformance/render.ts`, which handled
 * three block types because that was all its fixture used. This covers the
 * whole closed set, because step 9 packages *authored* courses, and an author
 * who inserts a flashcard block and gets a blank page in their LMS has been
 * failed silently.
 *
 * Blocks whose behaviour genuinely cannot survive the trip are rendered as
 * their content rather than dropped — a scenario becomes its readable steps,
 * a hotspot becomes its labelled list. Losing interactivity is honest;
 * losing the content is not.
 *
 * Canvas positioning and entrance/exit/emphasis animation (Phase 3B) are the
 * one exception to "deliberately a different thing from lib/runtime/" — their
 * *math* (lib/runtime/canvas.ts's positionStyle/canvasFrameStyle, unlike the
 * interpreter) is pure and framework-independent, so it's imported directly
 * here rather than re-derived. What still can't be shared is the animation
 * *clock*: lib/runtime/animation.ts's computeBlockAnimationState has to run
 * as vanilla JS inside the exported package (see contentScript() below),
 * since there is no bundler in this pipeline to ship real TS/React into a
 * SCORM zip. That's a real, disclosed duplication of a ~20-line formula, not
 * an oversight — a future change to computeBlockAnimationState needs its
 * twin here updated too. Cue points firing trigger *actions* (showBlock,
 * setVariable, ...) still do not survive export — that needs the trigger
 * engine, a separate and much larger gap this does not touch. Appearing/
 * disappearing on schedule and playing an animation preset don't depend on
 * triggers, only on elapsed time, so those do work.
 */

export interface RenderedPage {
  id: string;
  title: string;
  bodyHtml: string;
}

export interface RenderedCourse {
  title: string;
  description: string;
  pages: RenderedPage[];
  /** Shared navigation + quiz script, identical across every package format. */
  contentScript: string;
  /** Quiz block ids present, so the packager knows whether to report a score. */
  quizBlockIds: string[];
  /** Content asset ids the package must carry. Resolved by the caller. */
  assetIds: string[];
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function richText(rt: RichText | undefined): string {
  if (!rt) return "";
  const out: string[] = [];
  let i = 0;
  while (i < rt.blocks.length) {
    const b = rt.blocks[i];
    if (b.kind === "bulletItem" || b.kind === "numberItem") {
      const tag = b.kind === "bulletItem" ? "ul" : "ol";
      const items: string[] = [];
      while (i < rt.blocks.length && rt.blocks[i].kind === b.kind) {
        items.push(`<li>${spans(rt.blocks[i].spans)}</li>`);
        i++;
      }
      out.push(`<${tag}>${items.join("")}</${tag}>`);
      continue;
    }
    const tag = b.kind === "quote" ? "blockquote" : b.kind === "codeBlock" ? "pre" : "p";
    out.push(`<${tag}>${spans(b.spans)}</${tag}>`);
    i++;
  }
  return out.join("\n");
}

function spans(list: RichText["blocks"][number]["spans"]): string {
  return list
    .map((s) => {
      let html = escapeHtml(s.text);
      for (const mark of s.marks ?? []) {
        const tag = { bold: "strong", italic: "em", underline: "u", strikethrough: "s", code: "code", subscript: "sub", superscript: "sup" }[mark];
        if (tag) html = `<${tag}>${html}</${tag}>`;
      }
      if (s.link) {
        const target = s.link.newTab ? ' target="_blank" rel="noopener noreferrer"' : "";
        html = `<a href="${escapeHtml(s.link.href)}"${target}>${html}</a>`;
      }
      return html;
    })
    .join("");
}

/** Assets are packaged under `assets/<id>` and referenced relatively. */
function assetSrc(assetId: string): string {
  return `assets/${escapeHtml(assetId)}`;
}

/** CSS properties whose numeric value has no unit — everything else numeric gets `px`. */
const UNITLESS_STYLE_PROPS = new Set(["zIndex", "opacity"]);

/**
 * Converts the plain objects `lib/runtime/canvas.ts` returns into an inline
 * `style="..."` attribute value. Deliberately narrow rather than a generic
 * CSSProperties-to-string library: exactly three call sites (positionStyle,
 * canvasFrameStyle, canvasBackgroundStyle) feed this, and their property set
 * is small and known.
 */
function styleToAttr(style: CSSProperties): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(style)) {
    if (value === undefined || value === null) continue;
    const cssValue = typeof value === "number" && !UNITLESS_STYLE_PROPS.has(key) ? `${value}px` : String(value);
    parts.push(`${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}: ${cssValue}`);
  }
  return escapeHtml(parts.join("; "));
}

interface Ctx {
  assetIds: Set<string>;
  quizBlockIds: string[];
}

function renderBlock(block: LeafBlock, ctx: Ctx): string {
  switch (block.type) {
    case "heading": {
      const level = Math.min(6, Math.max(1, block.level ?? 2));
      return `<h${level}>${escapeHtml(block.text)}</h${level}>`;
    }
    case "text":
      return `<div class="blk text">${richText(block.content)}</div>`;
    case "list": {
      const tag = block.ordered ? "ol" : "ul";
      return `<${tag} class="blk">${block.items.map((i) => `<li>${richText(i)}</li>`).join("")}</${tag}>`;
    }
    case "quote":
      return `<blockquote class="blk">${richText(block.content)}${
        block.attribution ? `<footer>— ${escapeHtml(block.attribution)}</footer>` : ""
      }</blockquote>`;
    case "statement":
      return `<div class="blk callout ${escapeHtml(block.emphasis ?? "note")}">${
        block.emphasis ? `<strong>${escapeHtml(block.emphasis.toUpperCase())}</strong>` : ""
      }${richText(block.content)}</div>`;
    case "divider":
      return block.style === "space" ? `<div class="spacer-md"></div>` : `<hr class="blk">`;
    case "spacer":
      return `<div class="spacer-${escapeHtml(block.size ?? "medium")}"></div>`;

    case "image": {
      ctx.assetIds.add(block.assetId);
      const alt = escapeHtml(block.a11y?.altText ?? "");
      return `<figure class="blk"><img src="${assetSrc(block.assetId)}" alt="${alt}">${
        block.caption ? `<figcaption>${richText(block.caption)}</figcaption>` : ""
      }</figure>`;
    }
    case "imageGallery": {
      const items = block.images.map((img) => {
        ctx.assetIds.add(img.assetId);
        return `<figure><img src="${assetSrc(img.assetId)}" alt="${escapeHtml(img.altText ?? "")}">${
          img.caption ? `<figcaption>${richText(img.caption)}</figcaption>` : ""
        }</figure>`;
      });
      return `<div class="blk gallery">${items.join("")}</div>`;
    }
    case "video": {
      ctx.assetIds.add(block.assetId);
      return `<video class="blk" controls${block.autoplay ? " autoplay muted" : ""} src="${assetSrc(block.assetId)}"></video>`;
    }
    case "audio": {
      ctx.assetIds.add(block.assetId);
      return `<audio class="blk" controls src="${assetSrc(block.assetId)}"></audio>`;
    }
    case "embed": {
      const src = {
        youtube: `https://www.youtube.com/embed/${block.resourceId}`,
        vimeo: `https://player.vimeo.com/video/${block.resourceId}`,
        genially: `https://view.genially.com/${block.resourceId}`,
        googleSlides: `https://docs.google.com/presentation/d/${block.resourceId}/embed`,
        codepen: `https://codepen.io/embed/${block.resourceId}`,
      }[block.provider];
      // Same sandbox as the live runtime's EmbedBlockView
      // (components/runtime/block-renderers.tsx) — no allow-top-navigation,
      // no allow-modals, defense-in-depth on top of the fixed-origin map above.
      return `<div class="blk embed"><iframe src="${escapeHtml(src)}" title="${escapeHtml(block.title)}" allowfullscreen sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"></iframe></div>`;
    }

    case "accordion":
      return `<div class="blk">${block.items
        .map((i) => `<details><summary>${escapeHtml(i.title)}</summary>${richText(i.content)}</details>`)
        .join("")}</div>`;

    case "tabs":
      // Rendered as labelled sections rather than scripted tabs: an exported
      // package should degrade to readable content, not to a widget that
      // depends on a script the host LMS might sanitise.
      return `<div class="blk tabs">${block.tabs
        .map((t) => `<section><h4>${escapeHtml(t.label)}</h4>${richText(t.content)}</section>`)
        .join("")}</div>`;

    case "flashcards":
      return `<div class="blk">${block.cards
        .map((c) => `<details class="card"><summary>${richText(c.front)}</summary>${richText(c.back)}</details>`)
        .join("")}</div>`;

    case "labeledGraphic": {
      ctx.assetIds.add(block.assetId);
      return `<figure class="blk"><img src="${assetSrc(block.assetId)}" alt="${escapeHtml(block.a11y?.altText ?? "")}">
        <ol class="markers">${block.markers
          .map((m) => `<li><strong>${escapeHtml(m.label)}</strong>${richText(m.content)}</li>`)
          .join("")}</ol></figure>`;
    }
    case "hotspot": {
      ctx.assetIds.add(block.assetId);
      return `<figure class="blk"><img src="${assetSrc(block.assetId)}" alt="${escapeHtml(block.a11y?.altText ?? "")}">
        <ol class="markers">${block.hotspots
          .map((h) => `<li><strong>${escapeHtml(h.label)}</strong>${richText(h.content)}</li>`)
          .join("")}</ol></figure>`;
    }

    case "process":
      return `<ol class="blk process">${block.steps
        .map((s) => `<li><strong>${escapeHtml(s.title)}</strong>${richText(s.content)}</li>`)
        .join("")}</ol>`;

    case "sorting":
      // The answer key is the content here — without drag-and-drop the useful
      // thing is showing which card belongs where.
      return `<div class="blk">${block.categories
        .map(
          (c) =>
            `<section><h4>${escapeHtml(c.label)}</h4><ul>${block.cards
              .filter((card) => card.categoryId === c.id)
              .map((card) => `<li>${richText(card.text)}</li>`)
              .join("")}</ul></section>`
        )
        .join("")}</div>`;

    case "scenario":
      return `<div class="blk scenario">${block.setting ? richText(block.setting) : ""}${block.steps
        .map(
          (s) =>
            `<div class="step">${s.speaker ? `<strong>${escapeHtml(s.speaker)}</strong>` : ""}${richText(s.message)}
              ${
                (s.choices ?? []).length
                  ? `<ul>${(s.choices ?? [])
                      .map(
                        (c) =>
                          `<li>${richText(c.text)}${c.preferred ? " <em>(preferred)</em>" : ""}${
                            c.feedback ? `<div class="fb">${richText(c.feedback)}</div>` : ""
                          }</li>`
                      )
                      .join("")}</ul>`
                  : ""
              }</div>`
        )
        .join("")}</div>`;

    case "knowledgeCheck":
    case "quiz":
      ctx.quizBlockIds.push(block.id);
      return renderQuiz(block);

    case "continue":
      // Navigation is the shell's job in an export; a second control would
      // desynchronise from the package's own next/previous.
      return "";

    case "component":
      return `<div class="blk">${block.overrides?.title ? `<h4>${escapeHtml(block.overrides.title)}</h4>` : ""}${richText(
        block.overrides?.text
      )}</div>`;

    default: {
      const exhaustive: never = block;
      void exhaustive;
      return "";
    }
  }
}

function renderQuiz(block: Extract<LeafBlock, { type: "quiz" | "knowledgeCheck" }>): string {
  const passing = block.type === "quiz" ? (block.passingScorePercent ?? 100) : 100;
  const items = block.items
    .map((item, i) => {
      const head = `<p class="q"><b>${i + 1}.</b> ${richText(item.prompt)}</p>`;
      const name = escapeHtml(`${block.id}__${item.id}`);
      switch (item.kind) {
        case "multipleChoice":
        case "multipleResponse": {
          const type = item.kind === "multipleChoice" ? "radio" : "checkbox";
          return `${head}<div class="opts">${item.choices
            .map(
              (c) =>
                `<label><input type="${type}" name="${name}" value="${escapeHtml(c.id)}" data-correct="${
                  c.correct ? "1" : "0"
                }"> ${richText(c.text)}</label>`
            )
            .join("")}</div>`;
        }
        case "trueFalse":
          return `${head}<div class="opts">
            <label><input type="radio" name="${name}" value="true" data-correct="${item.answer ? "1" : "0"}"> True</label>
            <label><input type="radio" name="${name}" value="false" data-correct="${item.answer ? "0" : "1"}"> False</label>
          </div>`;
        case "fillBlank":
          return `${head}<div class="opts"><input type="text" name="${name}" data-accept="${escapeHtml(
            JSON.stringify(item.acceptedAnswers)
          )}" data-cs="${item.caseSensitive ? "1" : "0"}"></div>`;
        case "sequencing":
          // Ordering without drag-and-drop: the learner numbers the steps.
          return `${head}<ol class="opts seq" data-order="${escapeHtml(JSON.stringify(item.steps.map((s) => s.id)))}">${item.steps
            .map(
              (s) =>
                `<li><input type="number" min="1" max="${item.steps.length}" name="${name}" data-step="${escapeHtml(
                  s.id
                )}"> ${richText(s.text)}</li>`
            )
            .join("")}</ol>`;
        default:
          return head;
      }
    })
    .join("");

  return `<div class="blk quiz" data-quiz="${escapeHtml(block.id)}" data-pass="${passing}">
    ${"title" in block && block.title ? `<h3>${escapeHtml(block.title)}</h3>` : ""}
    ${items}
    <button type="button" class="submit-quiz">Submit</button>
    <p class="quiz-result" hidden></p>
  </div>`;
}

/**
 * Wraps a block's HTML with whatever Phase 3B timing/position data it
 * carries. A block with neither is returned untouched — most courses have
 * no canvas layout and no animation, and should cost this nothing.
 */
function wrapBlock(html: string, blockId: string, track: TimelineTrack | undefined, autoplay: boolean, positionAttr: string | undefined): string {
  if (!track && !positionAttr) return html;
  const attrs = [
    `class="anim-block"`,
    `data-block-id="${escapeHtml(blockId)}"`,
    track ? `data-track='${escapeHtml(JSON.stringify(track))}'` : "",
    track && autoplay ? `data-autoplay="1"` : "",
    positionAttr ? `style="${positionAttr}"` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return `<div ${attrs}>${html}</div>`;
}

function renderPage(page: Page, ctx: Ctx): RenderedPage {
  const layout = page.layout?.mode === "canvas" ? page.layout : undefined;
  const autoplay = !!page.timeline?.autoplay;
  const trackFor = (blockId: string) => page.timeline?.tracks?.find((t) => t.blockId === blockId);

  const rendered = page.blocks
    .map((b) => ({ block: b as LeafBlock, html: renderBlock(b as LeafBlock, ctx) }))
    .filter((r) => r.html);

  if (!layout) {
    const body = rendered.map((r) => wrapBlock(r.html, r.block.id, trackFor(r.block.id), autoplay, undefined)).join("\n");
    return { id: page.id, title: page.title, bodyHtml: body };
  }

  // Canvas layout: positioned blocks render absolutely inside a frame sized
  // per the design viewport; a block with no position falls back to the
  // plain flow list below it — the same split RuntimeCoursePlayer.tsx makes,
  // and what validate.ts's POSITION_MISSING_ON_CANVAS warning documents.
  const positioned = rendered.filter((r) => r.block.position);
  const unpositioned = rendered.filter((r) => !r.block.position);

  if (layout.background?.imageAssetId) ctx.assetIds.add(layout.background.imageAssetId);
  const backgroundImageUrl = layout.background?.imageAssetId ? assetSrc(layout.background.imageAssetId) : undefined;
  const frameStyle = styleToAttr({ ...canvasFrameStyle(layout), ...canvasBackgroundStyle(layout, backgroundImageUrl) });

  const frameHtml = `<div class="canvas-frame" style="${frameStyle}">${positioned
    .map((r) => wrapBlock(r.html, r.block.id, trackFor(r.block.id), autoplay, styleToAttr(positionStyle(r.block.position!, layout))))
    .join("\n")}</div>`;
  const flowHtml = unpositioned.map((r) => wrapBlock(r.html, r.block.id, trackFor(r.block.id), autoplay, undefined)).join("\n");

  return { id: page.id, title: page.title, bodyHtml: `${frameHtml}\n${flowHtml}` };
}

export function renderCourse(spec: CourseSpec): RenderedCourse {
  const ctx: Ctx = { assetIds: new Set(), quizBlockIds: [] };
  const pages: RenderedPage[] = [];

  for (const section of spec.sections) {
    for (const page of section.pages) {
      if (page.hiddenFromMenu) continue; // reachable only by triggers, which do not survive export
      pages.push(renderPage(page, ctx));
    }
  }

  return {
    title: spec.meta.title,
    description: spec.meta.description ? stripTags(richText(spec.meta.description)) : "",
    pages,
    contentScript: contentScript(pages.length, spec.completion?.rule ?? "allPagesVisited"),
    quizBlockIds: ctx.quizBlockIds,
    assetIds: [...ctx.assetIds],
  };
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Entrance/exit/emphasis animation keyframes — a copy of app/globals.css's
 * "Phase 3B, Track 1 step 2" block. Copied rather than shared because an
 * exported package can't import our stylesheet; each of the four packagers
 * appends this into their own `<style>` block. Kept unconditional (not
 * pruned to only the presets a course actually uses) since it's a small,
 * fixed, closed set — simpler than tracking which nine of twenty-three are
 * referenced for negligible size savings.
 */
export const ANIMATION_KEYFRAMES_CSS = `
@keyframes orbit-rt-entrance-fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes orbit-rt-entrance-wipe { from { clip-path: inset(0 100% 0 0) } to { clip-path: inset(0 0 0 0) } }
@keyframes orbit-rt-entrance-slideFromLeft { from { opacity: 0; transform: translateX(-2.5rem) } to { opacity: 1; transform: none } }
@keyframes orbit-rt-entrance-slideFromRight { from { opacity: 0; transform: translateX(2.5rem) } to { opacity: 1; transform: none } }
@keyframes orbit-rt-entrance-slideFromTop { from { opacity: 0; transform: translateY(-2.5rem) } to { opacity: 1; transform: none } }
@keyframes orbit-rt-entrance-slideFromBottom { from { opacity: 0; transform: translateY(2.5rem) } to { opacity: 1; transform: none } }
@keyframes orbit-rt-entrance-zoomIn { from { opacity: 0; transform: scale(.6) } to { opacity: 1; transform: none } }
@keyframes orbit-rt-entrance-grow { from { transform: scale(0) } to { transform: none } }
@keyframes orbit-rt-entrance-spin { from { opacity: 0; transform: rotate(-180deg) scale(.7) } to { opacity: 1; transform: none } }
@keyframes orbit-rt-exit-fade { from { opacity: 1 } to { opacity: 0 } }
@keyframes orbit-rt-exit-wipe { from { clip-path: inset(0 0 0 0) } to { clip-path: inset(0 0 0 100%) } }
@keyframes orbit-rt-exit-slideToLeft { from { opacity: 1; transform: none } to { opacity: 0; transform: translateX(-2.5rem) } }
@keyframes orbit-rt-exit-slideToRight { from { opacity: 1; transform: none } to { opacity: 0; transform: translateX(2.5rem) } }
@keyframes orbit-rt-exit-slideToTop { from { opacity: 1; transform: none } to { opacity: 0; transform: translateY(-2.5rem) } }
@keyframes orbit-rt-exit-slideToBottom { from { opacity: 1; transform: none } to { opacity: 0; transform: translateY(2.5rem) } }
@keyframes orbit-rt-exit-zoomOut { from { opacity: 1; transform: none } to { opacity: 0; transform: scale(.6) } }
@keyframes orbit-rt-exit-shrink { from { transform: none } to { transform: scale(0) } }
@keyframes orbit-rt-exit-spin { from { opacity: 1; transform: none } to { opacity: 0; transform: rotate(180deg) scale(.7) } }
@keyframes orbit-rt-emphasis-pulse { 0%,100% { transform: scale(1) } 50% { transform: scale(1.06) } }
@keyframes orbit-rt-emphasis-shake { 0%,100% { transform: translateX(0) } 20% { transform: translateX(-.4rem) } 40% { transform: translateX(.4rem) } 60% { transform: translateX(-.25rem) } 80% { transform: translateX(.25rem) } }
@keyframes orbit-rt-emphasis-flash { 0%,100% { opacity: 1 } 50% { opacity: .25 } }
@keyframes orbit-rt-emphasis-bounce { 0%,100% { transform: translateY(0) } 30% { transform: translateY(-.65rem) } 50% { transform: translateY(0) } 70% { transform: translateY(-.25rem) } }
@keyframes orbit-rt-emphasis-colorShift { 0%,100% { filter: none } 50% { filter: hue-rotate(40deg) saturate(1.5) } }
@media (prefers-reduced-motion: reduce) {
  .anim-block[style*="animation-name"] { animation-duration: 1ms !important; animation-iteration-count: 1 !important; }
}
`;

/**
 * The one script an exported package carries.
 *
 * Scores every quiz on the page and dispatches a `course:complete`
 * CustomEvent (`detail: { scorePercent, passed, viaQuiz }`) that whatever
 * tracking adapter the packager wrapped around it listens for — what lets
 * SCORM 2004 and cmi5 share identical content and differ only in how they
 * report. Self-contained by necessity: no imports, no fetch, no dependency
 * on anything outside the zip.
 *
 * Corrected 2026-08-24: this previously called `window.__courseTrack.*`
 * methods that neither adapter ever defined — both only ever listened for
 * `course:complete`. The mismatch meant no package built through the real
 * publishing pipeline (as opposed to the hand-authored step-3 spike fixture,
 * which used the event correctly) ever actually reported a score, caught
 * only once a pipeline-built package was run through SCORM Cloud for real.
 *
 * Corrected 2026-08-30: `course:complete` only ever fired from a quiz
 * Submit click — the *only* completion path this script had, regardless of
 * the course's own `completion.rule`. A course using `allPagesVisited` (the
 * schema's own default — lib/spec/course-spec.ts, matching the in-app
 * runtime's `isCourseCompleteNow`) could never report completion in an
 * exported package at all, silently, because nothing here ever read that
 * rule. Caught the same way as the fix above: a pipeline-built, non-quiz
 * course run through SCORM Cloud for real (2026-09-03) got stuck at
 * `Initialized` in both formats. Now tracks page visits and, for every rule
 * except `passedQuiz`, fires completion (no pass/fail — there is no
 * assessment to grade) once every page has been shown at least once, the
 * same condition `isCourseCompleteNow`'s `allPagesVisited`/`allBlocksComplete`
 * /`manual` branches converge on for genuinely static, non-interactive
 * exported content.
 */
function contentScript(pageCount: number, completionRule: string): string {
  return `
(function () {
  var scores = {};
  var completionRule = ${JSON.stringify(completionRule)};
  var pageCount = ${JSON.stringify(pageCount)};
  var visited = { 0: true }; // page 0 is shown by default
  var completionFired = false;

  function checkPageCompletion() {
    if (completionFired || completionRule === 'passedQuiz') return;
    if (Object.keys(visited).length < pageCount) return;
    completionFired = true;
    document.dispatchEvent(new CustomEvent('course:complete', { detail: { scorePercent: null, passed: null, viaQuiz: false } }));
  }

  function scoreQuiz(root) {
    var items = {};
    root.querySelectorAll('input[name]').forEach(function (input) {
      (items[input.name] = items[input.name] || []).push(input);
    });

    var total = 0, earned = 0;
    Object.keys(items).forEach(function (name) {
      total++;
      var inputs = items[name];
      var first = inputs[0];

      if (first.type === 'text') {
        var accept = JSON.parse(first.getAttribute('data-accept') || '[]');
        var cs = first.getAttribute('data-cs') === '1';
        var given = cs ? first.value.trim() : first.value.trim().toLowerCase();
        var ok = accept.some(function (a) { return (cs ? a : a.toLowerCase()) === given; });
        if (ok) earned++;
        return;
      }

      if (first.type === 'number') {
        var order = JSON.parse(first.closest('.seq').getAttribute('data-order') || '[]');
        var correct = inputs.every(function (inp) {
          return order.indexOf(inp.getAttribute('data-step')) === (parseInt(inp.value, 10) - 1);
        });
        if (correct) earned++;
        return;
      }

      var allRight = inputs.every(function (inp) {
        var shouldBe = inp.getAttribute('data-correct') === '1';
        return inp.checked === shouldBe;
      });
      if (allRight) earned++;
    });

    return total ? Math.round((earned / total) * 100) : 0;
  }

  // Entrance/exit/emphasis animation clock -- a vanilla-JS twin of
  // lib/runtime/animation.ts's computeBlockAnimationState. Cue points firing
  // trigger actions still don't survive export (that needs the interaction
  // engine); this only reproduces the elapsed-time-driven half: appearing/
  // disappearing on schedule and playing an animation preset.
  function animWindowMs(anim) {
    var cycles = anim.repeat === 0 ? Infinity : (anim.repeat || 0) + 1;
    return cycles === Infinity ? Infinity : anim.durationMs * cycles;
  }

  function computeAnimState(track, elapsedMs) {
    var appearAtMs = (track && track.appearAtMs) || 0;
    var disappearAtMs = track && track.disappearAtMs;
    if (elapsedMs < appearAtMs) return { visible: false };
    if (disappearAtMs !== undefined && elapsedMs >= disappearAtMs) return { visible: false };

    var animations = ((track && track.animations) || []).filter(function (a) { return a.kind !== 'motion'; });
    var exitedForGood = animations.some(function (a) { return a.kind === 'exit' && elapsedMs >= a.startMs + animWindowMs(a); });
    if (exitedForGood) return { visible: false };

    var active;
    animations.forEach(function (a) {
      var elapsedInAnim = elapsedMs - a.startMs;
      if (elapsedInAnim >= 0 && elapsedInAnim < animWindowMs(a)) active = a;
    });
    return { visible: true, active: active };
  }

  var EASING_CSS = { linear: 'linear', easeIn: 'cubic-bezier(.42,0,1,1)', easeOut: 'cubic-bezier(0,0,.58,1)', easeInOut: 'cubic-bezier(.42,0,.58,1)', spring: 'cubic-bezier(.34,1.56,.64,1)', bounce: 'cubic-bezier(.68,-.55,.265,1.55)' };

  function applyAnimStyle(el, active) {
    if (!active) { el.style.animationName = ''; return; }
    var cycles = active.repeat === 0 ? Infinity : (active.repeat || 0) + 1;
    el.style.animationName = 'orbit-rt-' + active.kind + '-' + active.preset;
    el.style.animationDuration = active.durationMs + 'ms';
    el.style.animationTimingFunction = EASING_CSS[active.easing || 'easeInOut'];
    el.style.animationIterationCount = cycles === Infinity ? 'infinite' : String(cycles);
    el.style.animationFillMode = 'forwards';
    el.style.animationPlayState = 'running';
  }

  function startBlockClock(el) {
    if (el._orbitClock) return;
    var track = JSON.parse(el.getAttribute('data-track') || '{}');
    var start = Date.now();
    var tick = function () {
      var state = computeAnimState(track, Date.now() - start);
      if (!state.visible) { el.style.display = 'none'; return; }
      el.style.display = '';
      applyAnimStyle(el, state.active);
    };
    tick();
    el._orbitClock = setInterval(tick, 200);
  }

  function stopBlockClock(el) {
    if (el._orbitClock) { clearInterval(el._orbitClock); el._orbitClock = null; }
  }

  function startTimelines(root) {
    root.querySelectorAll('.anim-block[data-autoplay="1"]').forEach(startBlockClock);
  }

  function stopTimelines(root) {
    root.querySelectorAll('.anim-block').forEach(stopBlockClock);
  }

  document.addEventListener('click', function (e) {
    var link = e.target.closest('nav a[data-page]');
    if (link) {
      e.preventDefault();
      var target = link.getAttribute('data-page');
      document.querySelectorAll('.course-page').forEach(function (section) {
        var willShow = section.getAttribute('data-page') === target;
        if (!willShow) stopTimelines(section);
        section.hidden = !willShow;
      });
      var shown = document.querySelector('.course-page[data-page="' + target + '"]');
      if (shown) startTimelines(shown);
      visited[target] = true;
      checkPageCompletion();
      return;
    }

    var btn = e.target.closest('.submit-quiz');
    if (!btn) return;
    var quiz = btn.closest('.quiz');
    var pct = scoreQuiz(quiz);
    var pass = pct >= Number(quiz.getAttribute('data-pass') || 100);
    scores[quiz.getAttribute('data-quiz')] = { pct: pct, pass: pass };

    var out = quiz.querySelector('.quiz-result');
    out.hidden = false;
    out.textContent = 'Score: ' + pct + '% — ' + (pass ? 'Passed' : 'Not yet passed');

    var all = Object.keys(scores).map(function (k) { return scores[k]; });
    var avg = Math.round(all.reduce(function (s, x) { return s + x.pct; }, 0) / all.length);
    var allPassed = all.every(function (x) { return x.pass; });

    document.dispatchEvent(new CustomEvent('course:complete', { detail: { scorePercent: avg, passed: allPassed, viaQuiz: true } }));
  });

  var initialPage = document.querySelector('.course-page:not([hidden])');
  if (initialPage) startTimelines(initialPage);

  checkPageCompletion(); // a one-page course is already complete on load
})();
`;
}
