import { ANIMATION_KEYFRAMES_CSS } from "./render";
import { buildZip } from "./zip";

/**
 * xAPI (Tin Can) package builder — the last unimplemented format in
 * `lib/publishing/build.ts`'s `UNIMPLEMENTED_FORMATS`. See cmi5.ts's header
 * for the shared context (Phase 3 step 3, reused by step 9).
 *
 * This is the export counterpart of `lib/content/tincan.ts` (xAPI *ingest*,
 * shipped 2026-09-03): a `tincan.xml` manifest per the real Tin Can Launch
 * convention, not an imsmanifest or cmi5.xml. The one genuine difference
 * from cmi5's tracking adapter: cmi5 launch parameters carry a `fetch` URL
 * the AU must POST to first to exchange for an auth token; plain Tin Can
 * Launch hands the ready-to-use `Authorization` header value directly as
 * the `auth` query parameter (see docs/XAPI_INGEST_ARCHITECTURE.md and
 * `lib/xapi/launch-token.ts`'s `launchTokenToAuthHeader`, which is exactly
 * what our own ingest launch route puts there) — so there is no token
 * exchange step here at all, just five launch parameters read directly off
 * the URL: `endpoint`, `auth`, `actor`, `registration`, `activity_id`.
 */

export interface XapiPage {
  id: string;
  title: string;
  bodyHtml: string;
}

export interface BuildXapiOptions {
  title: string;
  description: string;
  /** IRI — Tin Can activity ids are URIs, not arbitrary strings. */
  activityId: string;
  pages: XapiPage[];
  contentScript: string;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function tincanManifest(opts: BuildXapiOptions): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<tincan xmlns="http://projecttincan.com/tincan.xsd">
  <activities>
    <activity id="${escapeXml(opts.activityId)}" type="http://adlnet.gov/expapi/activities/course">
      <name>${escapeXml(opts.title)}</name>
      <description lang="en-US">${escapeXml(opts.description)}</description>
      <launch lang="en-US">index.html</launch>
    </activity>
  </activities>
</tincan>
`;
}

/**
 * Reads the five real Tin Can Launch parameters directly off the launch
 * URL and sends real xAPI statements (Initialized at launch; Completed +
 * Passed/Failed on the shared content script's `course:complete` event;
 * Terminated on unload) to `${endpoint}statements` — the same event
 * contract cmi5.js and scorm-api.js listen for, so the content and quiz
 * logic is byte-identical across every export format.
 */
function xapiJs(fallbackActivityId: string): string {
  return `(function (global) {
  var FALLBACK_ACTIVITY_ID = ${JSON.stringify(fallbackActivityId)};
  // On-page debug panel — same rationale as cmi5.js: this package's whole
  // point is to prove tracking works inside a real third-party LMS/LRS,
  // where the browser console usually isn't open.
  var logEl = null;
  function ready(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }
  var PANEL_HEIGHT = 140;
  ready(function () {
    document.body.style.paddingBottom = PANEL_HEIGHT + "px";

    var toggle = document.createElement("button");
    toggle.textContent = "Hide debug log";
    toggle.setAttribute(
      "style",
      "position:fixed;bottom:" + PANEL_HEIGHT + "px;right:0;z-index:100000;" +
        "font:11px monospace;padding:3px 8px;background:#333;color:#8ee08e;border:1px solid #444;border-bottom:none;cursor:pointer;",
    );
    var collapsed = false;
    toggle.addEventListener("click", function () {
      collapsed = !collapsed;
      logEl.style.display = collapsed ? "none" : "block";
      document.body.style.paddingBottom = collapsed ? "0" : PANEL_HEIGHT + "px";
      toggle.style.bottom = collapsed ? "0" : PANEL_HEIGHT + "px";
      toggle.textContent = collapsed ? "Show debug log" : "Hide debug log";
    });
    document.body.appendChild(toggle);

    logEl = document.createElement("div");
    logEl.id = "xapi-debug";
    logEl.setAttribute(
      "style",
      "position:fixed;bottom:0;left:0;right:0;height:" + PANEL_HEIGHT + "px;overflow:auto;" +
        "background:#1a1a1a;color:#8ee08e;font:11px/1.4 monospace;padding:8px 10px;" +
        "z-index:99999;white-space:pre-wrap;border-top:2px solid #444;box-sizing:border-box;",
    );
    logEl.textContent = "[xapi] debug panel ready\\n";
    document.body.appendChild(logEl);
    log("script loaded, document.readyState=" + document.readyState);
  });
  function log(msg) {
    var line = "[xapi " + new Date().toISOString().slice(11, 19) + "] " + msg;
    if (logEl) logEl.textContent += line + "\\n";
    else console.log(line);
    if (logEl) logEl.scrollTop = logEl.scrollHeight;
  }

  function params() {
    var p = {};
    location.search.replace(/^\\?/, "").split("&").forEach(function (kv) {
      if (!kv) return;
      var i = kv.indexOf("=");
      var k = decodeURIComponent(i === -1 ? kv : kv.slice(0, i));
      var v = decodeURIComponent(i === -1 ? "" : kv.slice(i + 1));
      p[k] = v;
    });
    return p;
  }

  var launch = params();
  var actor = null;
  try { actor = JSON.parse(launch.actor); } catch (e) { /* logged in init() via missing-actor check */ }
  var endpoint = launch.endpoint ? launch.endpoint.replace(/\\/?$/, "/") : null;
  var registration = launch.registration || null;
  var activityId = launch.activity_id || FALLBACK_ACTIVITY_ID;
  // Already a ready-to-use Authorization header value (real Tin Can Launch
  // convention) — no fetch/token-exchange step, unlike cmi5.
  var authHeader = launch.auth || null;
  var startedAt = Date.now();

  function uuid() {
    return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + "-" + Math.random();
  }

  function isoDuration(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    return "PT" + s + "S";
  }

  function baseStatement(verbId, verbDisplay) {
    var stmt = {
      id: uuid(),
      actor: actor,
      verb: { id: verbId, display: { "en-US": verbDisplay } },
      object: { id: activityId, objectType: "Activity", definition: { type: "http://adlnet.gov/expapi/activities/course" } },
      timestamp: new Date().toISOString(),
    };
    if (registration) stmt.context = { registration: registration };
    return stmt;
  }

  function send(statement, label) {
    if (!endpoint || !authHeader) {
      log("SKIP sending " + label + " - endpoint or auth missing (endpoint=" + endpoint + ", haveAuth=" + !!authHeader + ")");
      return Promise.resolve();
    }
    var body = JSON.stringify(statement);
    log("sending " + label + " -> POST " + endpoint + "statements");
    log(label + " body: " + body);
    return fetch(endpoint + "statements", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": authHeader,
        "X-Experience-API-Version": "1.0.3",
      },
      body: body,
    })
      .then(function (res) {
        return res.text().then(function (body) {
          log((res.ok ? "OK " : "FAIL ") + res.status + " sending " + label + (body ? " - " + body.slice(0, 200) : ""));
          return res;
        });
      })
      .catch(function (err) {
        log("ERROR sending " + label + " - " + (err && err.message ? err.message : String(err)));
      });
  }

  function init() {
    log("launch params: endpoint=" + (endpoint || "MISSING") +
      " actor=" + (actor ? "parsed ok" : "MISSING/UNPARSEABLE (raw=" + launch.actor + ")") +
      " activityId=" + (activityId || "MISSING") +
      " registration=" + (registration || "none") +
      " auth=" + (authHeader ? "present" : "MISSING"));
    if (!endpoint || !actor || !authHeader) {
      log("ABORT - missing required launch parameter(s); not proceeding");
      return;
    }
    send(baseStatement("http://adlnet.gov/expapi/verbs/initialized", "initialized"), "Initialized");
  }

  // passed === null means completion fired from page-visit tracking, not a
  // quiz (see lib/export/render.ts) - only Completed is meaningful then.
  function reportResult(scorePercent, passed, completed) {
    log("course:complete received - score=" + scorePercent + "% passed=" + passed);
    var duration = isoDuration(Date.now() - startedAt);
    if (completed) {
      var completedStmt = baseStatement("http://adlnet.gov/expapi/verbs/completed", "completed");
      completedStmt.result = { completion: true, duration: duration };
      send(completedStmt, "Completed");
    }
    if (passed === null) return;
    var scaled = Math.max(0, Math.min(1, scorePercent / 100));
    var verbId = passed ? "http://adlnet.gov/expapi/verbs/passed" : "http://adlnet.gov/expapi/verbs/failed";
    var stmt = baseStatement(verbId, passed ? "passed" : "failed");
    stmt.result = {
      success: passed,
      score: { scaled: scaled, raw: scorePercent, min: 0, max: 100 },
      duration: duration,
    };
    send(stmt, passed ? "Passed" : "Failed");
  }

  function terminate() {
    log("terminating session");
    var stmt = baseStatement("http://adlnet.gov/expapi/verbs/terminated", "terminated");
    stmt.result = { duration: isoDuration(Date.now() - startedAt) };
    send(stmt, "Terminated");
  }

  ready(init);
  window.addEventListener("beforeunload", terminate);
  document.addEventListener("course:complete", function (e) {
    var d = e.detail || {};
    reportResult(d.scorePercent, d.passed, true);
  });
})(window);
`;
}

function pageHtml(opts: BuildXapiOptions): string {
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
  <script src="xapi.js"></script>
  <script src="content.js"></script>
</body>
</html>
`;
}

export function buildXapiPackage(opts: BuildXapiOptions): Uint8Array {
  return buildZip({
    "tincan.xml": tincanManifest(opts),
    "index.html": pageHtml(opts),
    "content.js": opts.contentScript,
    "xapi.js": xapiJs(opts.activityId),
  });
}
