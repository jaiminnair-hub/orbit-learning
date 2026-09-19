import { ANIMATION_KEYFRAMES_CSS } from "./render";
import { buildZip } from "./zip";

/**
 * SCORM 1.2 package builder — the deferred format named in
 * `lib/publishing/build.ts`'s `UNIMPLEMENTED_FORMATS` since Phase 3 shipped
 * with only SCORM 2004 and cmi5 proven in SCORM Cloud. Mirrors
 * `scorm2004.ts` structurally (same options shape, same shared page-HTML
 * shell and CSS) — the two formats differ in exactly the two places SCORM
 * 1.2 is actually a different standard: the manifest schema, and the RTE
 * adapter's API surface and CMI data model.
 *
 * The load-bearing difference in the CMI model: 2004 splits completion and
 * success into two fields (`cmi.completion_status` / `cmi.success_status`).
 * 1.2 has only one, `cmi.core.lesson_status`, so a course with no quiz
 * reports "completed" and a course with a quiz reports "passed"/"failed"
 * directly — there is no 1.2-native way to say "visited, but no pass/fail
 * verdict exists" the way 2004's unset success_status can.
 */

export interface ScormPage {
  id: string;
  title: string;
  bodyHtml: string;
}

export interface BuildScorm12Options {
  title: string;
  identifier: string;
  pages: ScormPage[];
  contentScript: string;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function manifest(opts: BuildScorm12Options): string {
  const t = escapeXml(opts.title);
  return `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<manifest identifier="${escapeXml(opts.identifier)}" version="1"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsproject.org/xsd/imscp_rootv1p1p2 imscp_rootv1p1p2.xsd
                      http://www.adlnet.org/xsd/adlcp_rootv1p2 adlcp_rootv1p2.xsd">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>1.2</schemaversion>
  </metadata>
  <organizations default="ORG-1">
    <organization identifier="ORG-1">
      <title>${t}</title>
      <item identifier="ITEM-1" identifierref="RES-1">
        <title>${t}</title>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES-1" type="webcontent" adlcp:scormtype="sco" href="index.html">
      <file href="index.html"/>
      <file href="content.js"/>
      <file href="scorm-api.js"/>
    </resource>
  </resources>
</manifest>
`;
}

/**
 * The SCORM 1.2 RTE adapter. Same API-discovery walk as the 2004 adapter,
 * but the global is `API` (not `API_1484_11`) and every call is the
 * `LMS`-prefixed 1.2 method name — a genuinely different API surface, not a
 * renamed one, which is why this is a separate file rather than a shared
 * helper with a flag.
 */
const SCORM_API_JS = `(function (global) {
  function findAPI(win) {
    var attempts = 0;
    while (win.API == null && win.parent != null && win.parent !== win) {
      attempts += 1;
      if (attempts > 500) return null;
      win = win.parent;
    }
    return win.API || null;
  }
  function getAPI() {
    var api = findAPI(window);
    if (!api && window.opener) api = findAPI(window.opener);
    return api;
  }

  var API = getAPI();
  var initialized = false;

  function init() {
    if (!API) {
      console.warn("SCORM 1.2 API adapter not found (API) - not running inside an LMS frame");
      return;
    }
    var ok = API.LMSInitialize("");
    initialized = ok === "true" || ok === true;
    if (!initialized) console.warn("LMSInitialize() failed:", API.LMSGetLastError && API.LMSGetLastError());
  }

  // 1.2 has one status field, not two: a course with no quiz (passed ===
  // null) reports "completed" directly, since there is no separate
  // completion/success distinction to preserve the way 2004's unset
  // success_status can.
  function reportResult(scorePercent, passed, completed) {
    if (!API || !initialized) return;
    var status = passed === null ? (completed ? "completed" : "incomplete") : passed ? "passed" : "failed";
    API.LMSSetValue("cmi.core.lesson_status", status);
    if (passed !== null) {
      API.LMSSetValue("cmi.core.score.raw", String(scorePercent));
      API.LMSSetValue("cmi.core.score.min", "0");
      API.LMSSetValue("cmi.core.score.max", "100");
    }
    API.LMSCommit("");
  }

  function terminate() {
    if (!API || !initialized) return;
    API.LMSFinish("");
  }

  window.addEventListener("load", init);
  window.addEventListener("beforeunload", terminate);
  document.addEventListener("course:complete", function (e) {
    var d = e.detail || {};
    reportResult(d.scorePercent, d.passed, true);
  });
})(window);
`;

function pageHtml(opts: BuildScorm12Options): string {
  const nav = opts.pages
    .map((p, i) => `<li><a href="#" data-page="${i}">${escapeXml(p.title)}</a></li>`)
    .join("\n      ");
  const sections = opts.pages
    .map((p, i) => `<section class="course-page" data-page="${i}" ${i === 0 ? "" : "hidden"}>${p.bodyHtml}</section>`)
    .join("\n    ");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeXml(opts.title)}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 640px; margin: 0 auto; padding: 24px; color: #2a2724; background: #faf9f6; }
  nav ul { display: flex; gap: 12px; list-style: none; padding: 0; margin: 0 0 24px; border-bottom: 1px solid #ddd; padding-bottom: 12px; }
  nav a { color: #b3552f; text-decoration: none; font-size: 0.9rem; }
  .choice { display: block; margin: 8px 0; }
  button { font: inherit; padding: 8px 16px; border-radius: 4px; border: 1px solid #b3552f; background: #b3552f; color: #fff; cursor: pointer; }
  #result { margin-top: 16px; padding: 12px; border-radius: 4px; }
  #result.pass { background: #e6f4ea; }
  #result.fail { background: #fbe9e7; }
${ANIMATION_KEYFRAMES_CSS}</style>
</head>
<body>
  <nav><ul>
      ${nav}
  </ul></nav>
  <main id="course-root">
    ${sections}
  </main>
  <script src="scorm-api.js"></script>
  <script src="content.js"></script>
</body>
</html>
`;
}

export function buildScorm12Package(opts: BuildScorm12Options): Uint8Array {
  return buildZip({
    "imsmanifest.xml": manifest(opts),
    "index.html": pageHtml(opts),
    "content.js": opts.contentScript,
    "scorm-api.js": SCORM_API_JS,
  });
}
