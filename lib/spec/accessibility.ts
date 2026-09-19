import type { Block, Layer } from "./blocks";
import type { CourseSpec, Page } from "./course-spec";
import { pointer, type Finding, type FindingSeverity } from "./findings";
import type { RichText } from "./primitives";

/**
 * The accessibility pass — Phase 3 step 10.
 *
 * Separate from `validate.ts`'s semantic pass because it answers a different
 * question. Semantic validation asks "will this course run?"; this asks "can
 * everyone use it?" — and unlike the semantic rules, an organisation is
 * allowed to decide how strictly it wants these enforced.
 *
 * **How enforcement is decided.** `spec.meta.accessibilityProfile` is the
 * control, and it already existed in the schema for exactly this. A course
 * that declares nothing is held to **WCAG 2.2 AA**: enforcing by default is
 * the defensible stance for a platform selling into HR, and an author who
 * genuinely cannot meet it can say so explicitly rather than silently.
 *
 * **What "error" costs an author.** Accessibility errors block *publishing*,
 * not *saving* — `validateForWrite` gates writes on schema errors alone. So
 * an author inserting an image is never prevented from saving their work;
 * they are prevented from shipping it without alt text. That distinction is
 * deliberate: a gate that fired on every keystroke would be turned off within
 * a week.
 *
 * Each rule names the WCAG success criterion it comes from, so the severity
 * choices can be argued with rather than taken on trust.
 */

export type AccessibilityProfile = "wcag-2.2-aa" | "wcag-2.2-a" | "none";

/** Unset means AA. Enforcing by default; opting down is explicit. */
export function resolveProfile(spec: CourseSpec): AccessibilityProfile {
  return spec.meta.accessibilityProfile ?? "wcag-2.2-aa";
}

/**
 * Severity for a rule under a given profile.
 *
 * `level` is the WCAG conformance level the rule derives from. A Level A rule
 * is an error under both A and AA; a Level AA rule is an error only under AA.
 * `heuristic` marks rules that detect a likely problem rather than a definite
 * one — those stay warnings whatever the profile, because a gate that blocks
 * on a guess teaches authors to distrust it.
 */
function severityFor(
  profile: AccessibilityProfile,
  level: "A" | "AA",
  heuristic = false
): FindingSeverity {
  if (profile === "none") return "info";
  if (heuristic) return "warning";
  if (level === "A") return "error";
  return profile === "wcag-2.2-aa" ? "error" : "warning";
}

type AnyBlock = Block | Layer["blocks"][number];

function eachBlock(page: Page): Array<{ block: AnyBlock; path: string }> {
  const out: Array<{ block: AnyBlock; path: string }> = [];
  page.blocks.forEach((block, bi) => {
    out.push({ block, path: pointer("blocks", bi) });
    ((block as Block).layers ?? []).forEach((layer, li) => {
      layer.blocks.forEach((lb, lbi) => {
        out.push({ block: lb, path: pointer("blocks", bi, "layers", li, "blocks", lbi) });
      });
    });
  });
  return out;
}

function plainText(rt: RichText | undefined): string {
  if (!rt) return "";
  return rt.blocks.map((b) => b.spans.map((s) => s.text).join("")).join(" ").trim();
}

// ------------------------------------------------------------- contrast

/** sRGB hex → relative luminance, per WCAG 2.x. */
export function relativeLuminance(hex: string): number | null {
  const parsed = parseHex(hex);
  if (!parsed) return null;
  const [r, g, b] = parsed.map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1–21. Null when either colour is not a hex value. */
export function contrastRatio(foreground: string, background: string): number | null {
  const fg = relativeLuminance(foreground);
  const bg = relativeLuminance(background);
  if (fg === null || bg === null) return null;
  const lighter = Math.max(fg, bg);
  const darker = Math.min(fg, bg);
  return (lighter + 0.05) / (darker + 0.05);
}

function parseHex(value: string): [number, number, number] | null {
  const hex = value.trim().replace(/^#/, "");
  // Theme colours may be named design tokens rather than hex — those cannot
  // be resolved here, and guessing at them would produce confident nonsense.
  if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$|^[0-9a-fA-F]{8}$/.test(hex)) return null;
  const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex.slice(0, 6);
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

// ---------------------------------------------------------------- rules

/** Link text that tells a screen-reader user nothing out of context. */
const VAGUE_LINK_TEXT = new Set([
  "click here",
  "here",
  "read more",
  "more",
  "link",
  "this link",
  "learn more",
  "click",
  "download",
]);

export function checkAccessibility(spec: CourseSpec): Finding[] {
  const profile = resolveProfile(spec);
  const findings: Finding[] = [];

  const add = (f: Omit<Finding, "kind">) => findings.push({ kind: "accessibility", ...f });

  checkTheme(spec, profile, add);

  spec.sections.forEach((section, si) => {
    section.pages.forEach((page, pi) => {
      const pagePath = `${pointer("sections", si)}${pointer("pages", pi)}`;
      checkPage(page, pagePath, section.id, profile, add);
    });
  });

  return findings;
}

type Add = (f: Omit<Finding, "kind">) => void;

function checkTheme(spec: CourseSpec, profile: AccessibilityProfile, add: Add) {
  const colors = spec.theme?.colors;
  if (!colors?.background) return;

  // 1.4.3 Contrast (Minimum), Level AA: 4.5:1 for normal text.
  const pairs: Array<[string, string | undefined, string]> = [
    ["text", colors.text, "body text"],
    ["muted", colors.muted, "muted text"],
  ];

  for (const [key, value, label] of pairs) {
    if (!value) continue;
    const ratio = contrastRatio(value, colors.background);
    // Null means one side is a named token, not a hex value — unresolvable
    // here, and reporting a guess would be worse than reporting nothing.
    if (ratio === null) continue;
    if (ratio < 4.5) {
      add({
        code: "CONTRAST_INSUFFICIENT",
        severity: severityFor(profile, "AA"),
        message: `Theme ${label} (${value}) has a contrast ratio of ${ratio.toFixed(2)}:1 against the background (${colors.background}). WCAG 2.2 AA requires at least 4.5:1 for normal text.`,
        path: pointer("theme", "colors", key),
      });
    }
  }
}

function checkPage(
  page: Page,
  pagePath: string,
  sectionId: string,
  profile: AccessibilityProfile,
  add: Add
) {
  let previousHeadingLevel: number | null = null;
  let sawHeading = false;
  let contentBlocks = 0;
  let withReadingOrder = 0;
  let totalBlocks = 0;

  for (const { block, path } of eachBlock(page)) {
    const fullPath = `${pagePath}${path}`;
    const where = { path: fullPath, sectionId, pageId: page.id, blockId: block.id };

    totalBlocks++;
    if (block.a11y?.readingOrder !== undefined) withReadingOrder++;
    if (block.type !== "divider" && block.type !== "spacer") contentBlocks++;

    // --- 1.1.1 Non-text Content, Level A
    const needsAlt =
      block.type === "image" || block.type === "labeledGraphic" || block.type === "hotspot";
    if (needsAlt && !block.a11y?.altText && !block.a11y?.decorative) {
      add({
        code: "ALT_TEXT_MISSING",
        severity: severityFor(profile, "A"),
        message: `${describe(block.type)} has no alt text. Describe it for screen-reader users, or mark it decorative if it carries no meaning.`,
        ...where,
      });
    }

    if (block.type === "imageGallery") {
      block.images.forEach((image, ii) => {
        if (!image.altText) {
          add({
            code: "ALT_TEXT_MISSING",
            severity: severityFor(profile, "A"),
            message: `Gallery image ${ii + 1} has no alt text.`,
            ...where,
            path: `${fullPath}${pointer("images", ii)}`,
          });
        }
      });
    }

    // --- 1.2.2 Captions (Prerecorded), Level A
    if (
      (block.type === "video" || block.type === "audio") &&
      !block.a11y?.captionAssetId &&
      !block.a11y?.transcriptAssetId
    ) {
      add({
        code: "CAPTIONS_MISSING",
        severity: severityFor(profile, "A"),
        message: `${describe(block.type)} has neither captions nor a transcript. Add one so the content is available without audio.`,
        ...where,
      });
    }

    // --- 1.3.1 Info and Relationships, Level A — heading order is a strong
    // signal but skipping a level is not automatically a failure, so it warns.
    if (block.type === "heading") {
      const level = block.level ?? 2;
      sawHeading = true;
      if (previousHeadingLevel !== null && level > previousHeadingLevel + 1) {
        add({
          code: "HEADING_LEVEL_SKIPPED",
          severity: severityFor(profile, "A", true),
          message: `Heading jumps from level ${previousHeadingLevel} to ${level}. Screen-reader users navigate by heading structure, so skipping a level hides the relationship between sections.`,
          ...where,
        });
      }
      previousHeadingLevel = level;
    }

    // --- 2.4.4 Link Purpose (In Context), Level A — heuristic.
    for (const { text, linkPath } of linksIn(block, fullPath)) {
      const normalised = text.trim().toLowerCase().replace(/[.!?]+$/, "");
      if (!normalised || VAGUE_LINK_TEXT.has(normalised) || /^https?:\/\//.test(normalised)) {
        add({
          code: "LINK_TEXT_NOT_DESCRIPTIVE",
          severity: severityFor(profile, "A", true),
          message: normalised
            ? `Link text "${text.slice(0, 40)}" does not describe where it goes. Screen-reader users often browse links out of context.`
            : "A link has no text.",
          ...where,
          path: linkPath,
        });
      }
    }

    // --- 4.1.2 Name, Role, Value, Level A — an embed's title is its
    // accessible name, and the editor's placeholder is not one.
    if (block.type === "embed") {
      const title = block.title.trim();
      if (!title || title.toLowerCase() === "embedded media") {
        add({
          code: "EMBED_TITLE_GENERIC",
          severity: severityFor(profile, "A", true),
          message: "This embed still has its placeholder title. The title is what a screen reader announces for the frame.",
          ...where,
        });
      }
    }

    // --- Broken content rather than a WCAG criterion: an unlabelled answer
    // is unusable by anyone, and unanswerable by a screen-reader user.
    if (block.type === "quiz" || block.type === "knowledgeCheck") {
      block.items.forEach((item, ii) => {
        if ("choices" in item) {
          item.choices.forEach((choice, ci) => {
            if (!plainText(choice.text)) {
              add({
                code: "CHOICE_TEXT_EMPTY",
                severity: severityFor(profile, "A"),
                message: `Question ${ii + 1} has an answer option with no text.`,
                ...where,
                path: `${fullPath}${pointer("items", ii, "choices", ci)}`,
              });
            }
          });
        }
      });
    }
  }

  // --- 2.4.6 Headings and Labels, Level AA
  if (contentBlocks > 0 && !sawHeading) {
    add({
      code: "PAGE_HEADING_MISSING",
      severity: severityFor(profile, "AA", true),
      message: `Page "${page.title}" has content but no heading block. A heading gives screen-reader users a way to orient themselves on the page.`,
      path: pagePath,
      sectionId,
      pageId: page.id,
    });
  }

  // --- 1.3.2 Meaningful Sequence, Level A. Partial reading order is worse
  // than none: the blocks without it fall back to document order, so the two
  // interleave unpredictably.
  if (withReadingOrder > 0 && withReadingOrder < totalBlocks) {
    add({
      code: "READING_ORDER_PARTIAL",
      severity: severityFor(profile, "A", true),
      message: `${withReadingOrder} of ${totalBlocks} blocks on "${page.title}" set an explicit reading order. Set it on all of them or none — a partial order interleaves unpredictably with document order.`,
      path: pagePath,
      sectionId,
      pageId: page.id,
    });
  }
}

function describe(type: string): string {
  return (
    {
      image: "This image",
      imageGallery: "This gallery",
      labeledGraphic: "This labelled graphic",
      hotspot: "This hotspot image",
      video: "This video",
      audio: "This audio",
    }[type] ?? "This block"
  );
}

/** Every link in a block's rich-text fields, with its path. */
function linksIn(block: AnyBlock, blockPath: string): Array<{ text: string; linkPath: string }> {
  const out: Array<{ text: string; linkPath: string }> = [];

  const scan = (rt: RichText | undefined, fieldPath: string) => {
    if (!rt) return;
    rt.blocks.forEach((rtBlock, bi) => {
      rtBlock.spans.forEach((span, si) => {
        if (span.link) {
          out.push({ text: span.text, linkPath: `${fieldPath}${pointer("blocks", bi, "spans", si)}` });
        }
      });
    });
  };

  switch (block.type) {
    case "text":
    case "quote":
    case "statement":
      scan(block.content, `${blockPath}/content`);
      break;
    case "list":
      block.items.forEach((item, i) => scan(item, `${blockPath}${pointer("items", i)}`));
      break;
    case "accordion":
      block.items.forEach((item, i) => scan(item.content, `${blockPath}${pointer("items", i, "content")}`));
      break;
    case "tabs":
      block.tabs.forEach((tab, i) => scan(tab.content, `${blockPath}${pointer("tabs", i, "content")}`));
      break;
    default:
      break;
  }

  return out;
}

/** Convenience for the editor's accessibility panel and the publish gate. */
export function accessibilitySummary(findings: Finding[]) {
  const a11y = findings.filter((f) => f.kind === "accessibility");
  return {
    findings: a11y,
    errorCount: a11y.filter((f) => f.severity === "error").length,
    warningCount: a11y.filter((f) => f.severity === "warning").length,
    /** True when nothing accessibility-related blocks a publish. */
    passes: a11y.every((f) => f.severity !== "error"),
  };
}
