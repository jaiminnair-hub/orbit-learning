import type { CourseSpecType } from "../../lib/spec";

/**
 * A deliberately minimal spec -> HTML renderer, scoped to exactly the block
 * types this fixture uses (heading, text, quiz/multipleChoice). This is NOT
 * Phase 3 step 5's runtime interpreter — that step reads all 24 block types,
 * canvas/timeline layout, triggers/variables/states, and is explicitly
 * listed as XL scope. This renderer exists only to prove that one real spec
 * document can drive both a SCORM 2004 package and a cmi5 package with
 * identical content and different tracking adapters (lib/export/scorm2004.ts,
 * lib/export/cmi5.ts) — the actual claim step 3 needs to prove.
 */

export interface RenderedPage {
  id: string;
  title: string;
  bodyHtml: string;
}

export interface RenderedCourse {
  title: string;
  pages: RenderedPage[];
  /** Shared quiz/nav interaction script; identical across both packages. */
  contentScript: string;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderRichText(rt: { blocks: { kind: string; spans: { text: string }[] }[] }): string {
  return rt.blocks
    .map((b) => `<p>${b.spans.map((s) => escapeHtml(s.text)).join("")}</p>`)
    .join("\n");
}

export function renderCourse(spec: CourseSpecType): RenderedCourse {
  const quizChoicesById: Record<string, { id: string; text: string; correct: boolean }[]> = {};
  const pages: RenderedPage[] = [];

  for (const section of spec.sections) {
    for (const page of section.pages) {
      const parts: string[] = [`<h2>${escapeHtml(page.title)}</h2>`];
      for (const block of page.blocks) {
        if (block.type === "heading") {
          parts.push(`<h${block.level ?? 2}>${escapeHtml(block.text)}</h${block.level ?? 2}>`);
        } else if (block.type === "text") {
          parts.push(renderRichText(block.content));
        } else if (block.type === "quiz") {
          parts.push(`<form id="quiz-${block.id}" data-quiz="${block.id}" data-passing="${block.passingScorePercent ?? 100}">`);
          parts.push(`<h3>${escapeHtml(block.title ?? "Knowledge Check")}</h3>`);
          for (const item of block.items) {
            if (item.kind !== "multipleChoice") continue; // fixture only uses multipleChoice
            const promptHtml = renderRichText(item.prompt);
            parts.push(`<fieldset data-item="${item.id}"><legend>${promptHtml}</legend>`);
            for (const choice of item.choices) {
              const choiceHtml = renderRichText(choice.text);
              parts.push(
                `<label class="choice"><input type="radio" name="${item.id}" value="${choice.id}"> ${choiceHtml}</label>`,
              );
            }
            parts.push(`</fieldset>`);
            quizChoicesById[item.id] = item.choices.map((c) => ({ id: c.id, text: "", correct: c.correct === true }));
          }
          parts.push(`<button type="submit">Submit answers</button>`);
          parts.push(`<div id="result-${block.id}"></div>`);
          parts.push(`</form>`);
        }
        // Other block types are out of scope for this fixture/renderer by design.
      }
      pages.push({ id: page.id, title: page.title, bodyHtml: parts.join("\n") });
    }
  }

  const answerKey = JSON.stringify(quizChoicesById);
  const contentScript = `(function () {
  var answerKey = ${answerKey};

  // Page navigation
  var pages = document.querySelectorAll(".course-page");
  document.querySelectorAll("nav a[data-page]").forEach(function (a) {
    a.addEventListener("click", function (e) {
      e.preventDefault();
      var idx = a.getAttribute("data-page");
      pages.forEach(function (p) { p.hidden = p.getAttribute("data-page") !== idx; });
    });
  });

  // Quiz scoring
  document.querySelectorAll("form[data-quiz]").forEach(function (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var fieldsets = form.querySelectorAll("fieldset[data-item]");
      var correctCount = 0;
      fieldsets.forEach(function (fs) {
        var itemId = fs.getAttribute("data-item");
        var selected = form.querySelector('input[name="' + itemId + '"]:checked');
        var key = answerKey[itemId];
        if (selected && key) {
          var chosen = key.find(function (c) { return c.id === selected.value; });
          if (chosen && chosen.correct) correctCount += 1;
        }
      });
      var total = fieldsets.length;
      var scorePercent = total > 0 ? Math.round((correctCount / total) * 100) : 0;
      var passing = Number(form.getAttribute("data-passing")) || 100;
      var passed = scorePercent >= passing;
      var resultEl = document.getElementById("result-" + form.getAttribute("data-quiz"));
      if (resultEl) {
        resultEl.className = passed ? "pass" : "fail";
        resultEl.textContent = "Score: " + scorePercent + "% (" + correctCount + "/" + total + ") - " + (passed ? "Passed" : "Failed");
      }
      document.dispatchEvent(new CustomEvent("course:complete", { detail: { scorePercent: scorePercent, passed: passed } }));
    });
  });
})();
`;

  return { title: spec.meta.title, pages, contentScript };
}
