import { ANIMATION_KEYFRAMES_CSS } from "./render";
import { buildZip } from "./zip";

/**
 * cmi5 package builder — see scorm2004.ts's header for the shared context
 * (Phase 3 step 3, reused by step 9). cmi5 packages an xAPI-tracked
 * Assignable Unit (AU): a `cmi5.xml` course structure instead of an
 * imsmanifest, and statements sent directly to the LRS the LMS hands the AU
 * at launch, instead of a SCORM RTE API object.
 */

export interface Cmi5Page {
  id: string;
  title: string;
  bodyHtml: string;
}

export interface BuildCmi5Options {
  title: string;
  description: string;
  /** IRIs — cmi5 course/AU ids are URIs, not arbitrary strings. */
  courseId: string;
  auId: string;
  pages: Cmi5Page[];
  contentScript: string;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function courseStructure(opts: BuildCmi5Options): string {
  const t = escapeXml(opts.title);
  const d = escapeXml(opts.description);
  return `<?xml version="1.0" encoding="UTF-8"?>
<courseStructure xmlns="https://w3id.org/xapi/profiles/cmi5/v1/CourseStructure.xsd">
  <course id="${escapeXml(opts.courseId)}">
    <title><langstring lang="en">${t}</langstring></title>
    <description><langstring lang="en">${d}</langstring></description>
  </course>
  <au id="${escapeXml(opts.auId)}" moveOn="CompletedOrPassed">
    <title><langstring lang="en">${t}</langstring></title>
    <description><langstring lang="en">${d}</langstring></description>
    <url>index.html</url>
  </au>
</courseStructure>
`;
}

/**
 * The cmi5 tracking adapter: parses the launch query-string parameters cmi5
 * mandates (`fetch`, `endpoint`, `actor`, `registration`, `activityId`),
 * exchanges the fetch URL for an auth token, then sends real xAPI statements
 * (Initialized at launch; Completed + Passed/Failed on the shared content
 * script's `course:complete` event; Terminated on unload) to
 * `${endpoint}statements` — the same event contract scorm-api.js listens
 * for, so the content and quiz logic is byte-identical between packages.
 */
function cmi5Js(courseId: string, publisherAuId: string): string {
  // Baked in at build time (JSON.stringify'd below, so each is a safely-
  // escaped JS string literal). The launch query string's `activityId` is
  // the LMS's OWN generated id for the AU - never the "Publisher Activity"
  // (the AU's original id as authored in cmi5.xml's <au id="...">, distinct
  // from the LMS's id for the same AU). Confirmed against a real SCORM Cloud
  // run, 2026-08-20: sending grouping with only the course, no publisher AU
  // id, was rejected with 403 "grouping does not contain Publisher Activity"
  // - per https://risc-inc.com/cmi5-publisher-id/, the Publisher Activity is
  // exactly the course-structure-authored id, which is `auId` at build time
  // (this package's own opts.auId, the same value written into cmi5.xml).
  return `(function (global) {
  var COURSE_ID = ${JSON.stringify(courseId)};
  var PUBLISHER_AU_ID = ${JSON.stringify(publisherAuId)};
  // On-page debug panel: this package's whole point is to prove tracking
  // works inside a real third-party LMS, where the browser console usually
  // isn't open. Every step logs here, visibly, instead of only to
  // console.warn on failure.
  var logEl = null;
  function ready(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }
  // Fixed at 140px, not a viewport fraction: a real SCORM Cloud run on
  // 2026-08-20 showed a 35vh panel covering the quiz's own Submit button on
  // a normal-height window. Body gets matching padding-bottom so page
  // content is never actually hidden behind it, and a toggle lets it be
  // collapsed to a single line entirely once it's served its purpose.
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
    logEl.id = "cmi5-debug";
    logEl.setAttribute(
      "style",
      "position:fixed;bottom:0;left:0;right:0;height:" + PANEL_HEIGHT + "px;overflow:auto;" +
        "background:#1a1a1a;color:#8ee08e;font:11px/1.4 monospace;padding:8px 10px;" +
        "z-index:99999;white-space:pre-wrap;border-top:2px solid #444;box-sizing:border-box;",
    );
    logEl.textContent = "[cmi5] debug panel ready\\n";
    document.body.appendChild(logEl);
    log("script loaded, document.readyState=" + document.readyState);
  });
  function log(msg) {
    var line = "[cmi5 " + new Date().toISOString().slice(11, 19) + "] " + msg;
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
  var activityId = launch.activityId || null;
  // The LMS's own session id, carried as a "session" query parameter on the
  // fetch URL it hands us at launch (confirmed against a real SCORM Cloud
  // launch, 2026-08-20: a self-generated session id was rejected with
  // "session id does not match request context" - the LRS expects its own
  // session echoed back, not one the AU invents).
  var sessionIdFromFetch = null;
  try { sessionIdFromFetch = launch.fetch ? new URL(launch.fetch).searchParams.get("session") : null; } catch (e) { /* fall through to a generated id */ }
  var sessionId = sessionIdFromFetch || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + "-" + Math.random());
  var authToken = null;
  var startedAt = Date.now();

  function uuid() {
    return crypto.randomUUID ? crypto.randomUUID() : sessionId + "-" + Math.random();
  }

  function isoDuration(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    return "PT" + s + "S";
  }

  // hasResult: true for any statement whose result carries "success" or
  // "completion" (Completed, Passed, Failed) - the cmi5 spec requires those,
  // and ONLY those, to also declare the "moveon" category. Confirmed against
  // a real SCORM Cloud run, 2026-08-20: sending Completed with only the base
  // cmi5 category (no moveon) was rejected with 403 "moveon Activity
  // required in context.contextActivities.category". Initialized carries no
  // result, so it correctly omits this - per the reference examples at
  // https://aicc.github.io/CMI-5_Spec_Current/samples/scenarios/.
  function baseStatement(verbId, verbDisplay, hasResult) {
    var category = [{ id: "https://w3id.org/xapi/cmi5/context/categories/cmi5" }];
    if (hasResult) category.push({ id: "https://w3id.org/xapi/cmi5/context/categories/moveon" });
    return {
      id: uuid(),
      actor: actor,
      verb: { id: verbId, display: { "en-US": verbDisplay } },
      // definition.type included deliberately: a real SCORM Cloud run on
      // 2026-08-20 returned a 500 NullPointerException sending this
      // statement without it - the LRS's cmi5 statement handling appears to
      // dereference the activity definition unconditionally.
      object: { id: activityId, objectType: "Activity", definition: { type: "http://adlnet.gov/expapi/activities/lesson" } },
      context: {
        registration: registration,
        contextActivities: {
          category: category,
          // Both the parent course AND this AU's own Publisher Activity
          // (its cmi5.xml-authored id, distinct from the LMS-generated
          // activityId used as this statement's object.id) are required -
          // confirmed against two real, distinct SCORM Cloud error messages.
          grouping: [
            { id: COURSE_ID, objectType: "Activity" },
            { id: PUBLISHER_AU_ID, objectType: "Activity" },
          ],
        },
        extensions: { "https://w3id.org/xapi/cmi5/context/extensions/sessionid": sessionId },
      },
      timestamp: new Date().toISOString(),
    };
  }

  // The cmi5 spec mandates the AU retrieve the learner's "cmi5LearnerPreferences"
  // document from the xAPI Agent Profile API on startup, before Initialized.
  // Confirmed against a real SCORM Cloud run, 2026-08-20: omitting this step
  // entirely got Initialized itself rejected with 403 "The AU must retrieve
  // Learner Preferences document from the Agent Profile". A 404 here is the
  // normal, expected case for a learner with no saved preferences yet - not
  // an error, per the spec (https://github.com/AICC/CMI-5_Spec_Current).
  function fetchLearnerPreferences() {
    var url = endpoint + "agents/profile?profileId=cmi5LearnerPreferences&agent=" + encodeURIComponent(JSON.stringify(actor));
    log("fetching learner preferences (cmi5 spec requirement) -> GET " + url);
    return fetch(url, {
      headers: {
        "Authorization": "Basic " + authToken,
        "X-Experience-API-Version": "1.0.3",
      },
    })
      .then(function (res) {
        if (res.status === 404) {
          log("learner preferences: none saved yet (404) - normal for a new learner");
          return;
        }
        return res.text().then(function (body) {
          log((res.ok ? "OK " : "FAIL ") + res.status + " fetching learner preferences" + (body ? " - " + body.slice(0, 200) : ""));
        });
      })
      .catch(function (err) {
        log("ERROR fetching learner preferences - " + (err && err.message ? err.message : String(err)));
      });
  }

  function send(statement, label) {
    if (!endpoint || !authToken) {
      log("SKIP sending " + label + " - endpoint or authToken missing (endpoint=" + endpoint + ", haveToken=" + !!authToken + ")");
      return Promise.resolve();
    }
    var body = JSON.stringify(statement);
    log("sending " + label + " -> POST " + endpoint + "statements");
    log(label + " body: " + body);
    return fetch(endpoint + "statements", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Basic " + authToken,
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
    log("launch params: fetch=" + (launch.fetch ? "present" : "MISSING") +
      " endpoint=" + (endpoint || "MISSING") +
      " actor=" + (actor ? "parsed ok" : "MISSING/UNPARSEABLE (raw=" + launch.actor + ")") +
      " activityId=" + (activityId || "MISSING") +
      " registration=" + (registration || "MISSING"));
    log("session id: " + sessionId + (sessionIdFromFetch ? " (from LMS fetch URL)" : " (self-generated - no 'session' param on fetch URL)"));
    if (!launch.fetch || !endpoint || !actor || !activityId) {
      log("ABORT - missing required cmi5 launch parameter(s); not proceeding");
      return Promise.resolve();
    }
    log("fetching auth token from " + launch.fetch + " (POST, per cmi5 spec)");
    return fetch(launch.fetch, { method: "POST" })
      .then(function (r) {
        log("auth-token endpoint responded " + r.status);
        return r.text();
      })
      .then(function (text) {
        var j;
        try { j = JSON.parse(text); } catch (e) {
          log("auth-token response was not JSON: " + text.slice(0, 200));
          throw e;
        }
        authToken = j["auth-token"];
        log("auth token " + (authToken ? "received (" + authToken.length + " chars)" : "MISSING from response: " + text.slice(0, 200)));
        return fetchLearnerPreferences();
      })
      .then(function () {
        return send(baseStatement("http://adlnet.gov/expapi/verbs/initialized", "initialized"), "Initialized");
      })
      .catch(function (err) {
        log("ABORT - fetch/auth failed: " + (err && err.message ? err.message : String(err)));
      });
  }

  // passed === null means completion fired from page-visit tracking, not a
  // quiz (see lib/export/render.ts's 2026-08-30 fix) - there is no
  // assessment to grade, so only Completed is meaningful; sending
  // Passed/Failed with an invented score would misreport an ungraded course
  // as scored.
  function reportResult(scorePercent, passed, completed) {
    log("course:complete received - score=" + scorePercent + "% passed=" + passed);
    var duration = isoDuration(Date.now() - startedAt);
    if (completed) {
      var completedStmt = baseStatement("http://adlnet.gov/expapi/verbs/completed", "completed", true);
      completedStmt.result = { completion: true, duration: duration };
      send(completedStmt, "Completed");
    }
    if (passed === null) return;
    var scaled = Math.max(0, Math.min(1, scorePercent / 100));
    var verbId = passed ? "http://adlnet.gov/expapi/verbs/passed" : "http://adlnet.gov/expapi/verbs/failed";
    var stmt = baseStatement(verbId, passed ? "passed" : "failed", true);
    // No "completion" here deliberately: a real SCORM Cloud run on
    // 2026-08-20 rejected it with 403 "result.completion not allowed" on a
    // Passed/Failed statement - completion is signalled only by the separate
    // Completed statement above, confirmed against the reference examples.
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

function pageHtml(opts: BuildCmi5Options): string {
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
  <script src="cmi5.js"></script>
  <script src="content.js"></script>
</body>
</html>
`;
}

export function buildCmi5Package(opts: BuildCmi5Options): Uint8Array {
  return buildZip({
    "cmi5.xml": courseStructure(opts),
    "index.html": pageHtml(opts),
    "content.js": opts.contentScript,
    "cmi5.js": cmi5Js(opts.courseId, opts.auId),
  });
}
