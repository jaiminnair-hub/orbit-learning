import { zipSync, strToU8 } from "fflate";

/**
 * A real SCORM 1.2 package whose script does everything a normal
 * fixture does (find the API, bookmark, complete, score) AND — the
 * point of this fixture — attempts to reach across to the real app's
 * top-level window and reports what happened through the legitimate
 * CMI channel, so the test can assert the origin boundary held without
 * needing to inspect the page's internals directly.
 *
 * `window.top` is genuinely cross-origin here (the real app, not the
 * bridge) precisely because of the frame structure this isolation
 * design creates: app window -> bridge iframe (content-origin) ->
 * this content's own iframe (also content-origin, same as the bridge,
 * which is what lets the ordinary API-discovery walk via
 * `window.parent` succeed while `window.top` stays out of reach).
 */

const CONTENT = `<!doctype html>
<html><head><meta charset="utf-8"><title>Isolation probe</title></head>
<body>
<p id="state">idle</p>
<button id="finish" type="button">Finish</button>
<script>
  function findAPI(win) {
    var depth = 0;
    while (win.API == null && win.parent != null && win.parent !== win && depth < 10) {
      depth++;
      win = win.parent;
    }
    return win.API || null;
  }

  function probe(fn) {
    try {
      return String(fn());
    } catch (e) {
      return "BLOCKED:" + e.name;
    }
  }

  var API = findAPI(window);
  if (!API) {
    document.getElementById('state').textContent = 'NO API FOUND';
  } else {
    API.LMSInitialize('');

    // The actual isolation probes. A real browser throws a SecurityError
    // reading either of these across a genuine origin boundary; if this
    // isolation design were broken (e.g. the bridge sharing an origin
    // with the app, or the sandbox misconfigured), one or both would
    // instead return a real value here.
    var cookieResult = probe(function () { return window.top.document.cookie; });
    var locationResult = probe(function () { return window.top.location.href; });

    API.LMSSetValue('cmi.suspend_data', 'cookie=' + cookieResult + ';location=' + locationResult);
    API.LMSSetValue('cmi.core.lesson_status', 'incomplete');
    API.LMSCommit('');
    document.getElementById('state').textContent = 'probed';

    document.getElementById('finish').addEventListener('click', function () {
      API.LMSSetValue('cmi.core.score.raw', '100');
      API.LMSSetValue('cmi.core.lesson_status', 'passed');
      API.LMSCommit('');
      API.LMSFinish('');
      document.getElementById('state').textContent = 'finished';
    });
  }
</script>
</body></html>`;

const MANIFEST = `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="isolation-probe" version="1.0"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2">
  <metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata>
  <organizations default="ORG">
    <organization identifier="ORG">
      <title>Isolation probe</title>
      <item identifier="ITEM" identifierref="RES"><title>Isolation probe</title></item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES" type="webcontent" adlcp:scormtype="sco" href="index.html">
      <file href="index.html"/>
    </resource>
  </resources>
</manifest>`;

export function buildIsolationProbePackage(): Buffer {
  return Buffer.from(
    zipSync({ "imsmanifest.xml": strToU8(MANIFEST), "index.html": strToU8(CONTENT) })
  );
}
