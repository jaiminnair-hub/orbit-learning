import { ANIMATION_KEYFRAMES_CSS } from "./render";
import { buildZip } from "./zip";

/**
 * SCORM 2004 3rd Edition package builder.
 *
 * Phase 3 step 3 (Export conformance spike, DEVELOPMENT_SEQUENCE_PHASE3.md):
 * proves a course specification can be packaged as a real, conformant SCORM
 * 2004 SCO — manifest, content, and a genuine Run-Time Environment (RTE) API
 * adapter, not a stub. Reused as-is by step 9 (Publishing pipeline) once
 * generated content replaces the hand-written fixture — this is production
 * packaging logic, not throwaway spike code.
 *
 * Single-SCO package: one imsmanifest.xml resource, internal page navigation
 * handled client-side. Multi-SCO sequencing is out of scope for a
 * conformance proof and not something the spec model (single completion
 * rule per course) currently expresses.
 */

export interface ScormPage {
  id: string;
  title: string;
  bodyHtml: string;
}

export interface BuildScorm2004Options {
  /** Used as both the manifest's organization title and the HTML <title>. */
  title: string;
  /** Reverse-DNS-ish identifier; SCORM manifests conventionally use one. */
  identifier: string;
  pages: ScormPage[];
  /** Shared page/quiz interaction script — see spikes/export-conformance/render.ts. */
  contentScript: string;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function manifest(opts: BuildScorm2004Options): string {
  const t = escapeXml(opts.title);
  return `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<manifest identifier="${escapeXml(opts.identifier)}" version="1"
  xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3"
  xmlns:adlseq="http://www.adlnet.org/xsd/adlseq_v1p3"
  xmlns:adlnav="http://www.adlnet.org/xsd/adlnav_v1p3"
  xmlns:imsss="http://www.imsglobal.org/xsd/imsss"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsglobal.org/xsd/imscp_v1p1 imscp_v1p1.xsd
                      http://www.adlnet.org/xsd/adlcp_v1p3 adlcp_v1p3.xsd
                      http://www.adlnet.org/xsd/adlseq_v1p3 adlseq_v1p3.xsd
                      http://www.adlnet.org/xsd/adlnav_v1p3 adlnav_v1p3.xsd
                      http://www.imsglobal.org/xsd/imsss imsss_v1p0.xsd">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>2004 3rd Edition</schemaversion>
  </metadata>
  <organizations default="ORG-1">
    <organization identifier="ORG-1">
      <title>${t}</title>
      <item identifier="ITEM-1" identifierref="RES-1">
        <title>${t}</title>
        <adlcp:completionThreshold>1.0</adlcp:completionThreshold>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES-1" type="webcontent" adlcp:scormType="sco" href="index.html">
      <file href="index.html"/>
      <file href="content.js"/>
      <file href="scorm-api.js"/>
    </resource>
  </resources>
</manifest>
`;
}

/**
 * The SCORM 2004 RTE adapter. Standard API-discovery algorithm (walk up
 * parent/opener frames looking for `API_1484_11`, ADL's documented pattern),
 * then a real Initialize -> SetValue* -> Commit -> Terminate lifecycle.
 * Listens for the shared content script's `course:complete` CustomEvent so
 * this file is the only thing that differs from the cmi5 package's tracking
 * adapter — everything else is identical content.
 */
const SCORM_API_JS = `(function (global) {
  function findAPI(win) {
    var attempts = 0;
    while (win.API_1484_11 == null && win.parent != null && win.parent !== win) {
      attempts += 1;
      if (attempts > 500) return null;
      win = win.parent;
    }
    return win.API_1484_11 || null;
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
      console.warn("SCORM 2004 API adapter not found (API_1484_11) - not running inside an LMS frame");
      return;
    }
    var ok = API.Initialize("");
    initialized = ok === "true" || ok === true;
    if (!initialized) console.warn("SCORM Initialize() failed:", API.GetLastError && API.GetLastError());
  }

  // passed === null means completion fired from page-visit tracking, not a
  // quiz (see lib/export/render.ts's 2026-08-30 fix) - cmi.success_status
  // and cmi.score are left unset (their SCORM-default "unknown"/not-set
  // state) rather than reporting an invented pass and a 0% score for a
  // course with no assessment.
  function reportResult(scorePercent, passed, completed) {
    if (!API || !initialized) return;
    API.SetValue("cmi.completion_status", completed ? "completed" : "incomplete");
    if (passed !== null) {
      API.SetValue("cmi.success_status", passed ? "passed" : "failed");
      var scaled = Math.max(0, Math.min(1, scorePercent / 100));
      API.SetValue("cmi.score.scaled", String(scaled));
      API.SetValue("cmi.score.raw", String(scorePercent));
      API.SetValue("cmi.score.min", "0");
      API.SetValue("cmi.score.max", "100");
    }
    API.Commit("");
  }

  function terminate() {
    if (!API || !initialized) return;
    API.Terminate("");
  }

  window.addEventListener("load", init);
  window.addEventListener("beforeunload", terminate);
  document.addEventListener("course:complete", function (e) {
    var d = e.detail || {};
    reportResult(d.scorePercent, d.passed, true);
  });
})(window);
`;

function pageHtml(opts: BuildScorm2004Options): string {
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

export function buildScorm2004Package(opts: BuildScorm2004Options): Uint8Array {
  return buildZip({
    "imsmanifest.xml": manifest(opts),
    "index.html": pageHtml(opts),
    "content.js": opts.contentScript,
    "scorm-api.js": SCORM_API_JS,
  });
}
