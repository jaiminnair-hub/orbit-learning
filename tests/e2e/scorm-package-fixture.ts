import { zipSync, strToU8 } from "fflate";

/**
 * Builds real SCORM packages — genuine zips with a genuine
 * imsmanifest.xml and content that talks to the API the way shipped
 * courseware does: walk the frame chain, Initialize, bookmark, report a
 * score, complete, Commit, Finish.
 *
 * Built rather than committed as a binary so the exact API conversation
 * under test is readable in the diff. A fixture whose behaviour you
 * cannot see is a fixture that can drift out from under the assertions.
 */

const FINDER_12 = `
  function findAPI(win) {
    var depth = 0;
    while (win.API == null && win.parent != null && win.parent !== win && depth < 10) {
      depth++;
      win = win.parent;
    }
    return win.API || null;
  }
`;

const FINDER_2004 = `
  function findAPI(win) {
    var depth = 0;
    while (win.API_1484_11 == null && win.parent != null && win.parent !== win && depth < 10) {
      depth++;
      win = win.parent;
    }
    return win.API_1484_11 || null;
  }
`;

function content12(): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Fire safety</title></head>
<body>
<h1>Fire safety</h1>
<p id="entry">entry: unknown</p>
<p id="state">idle</p>
<button id="finish" type="button">Finish course</button>
<script>
${FINDER_12}
var API = findAPI(window);
if (!API) {
  document.getElementById('state').textContent = 'NO API FOUND';
} else {
  API.LMSInitialize('');
  document.getElementById('entry').textContent = 'entry: ' + API.LMSGetValue('cmi.core.entry');
  API.LMSSetValue('cmi.core.lesson_status', 'incomplete');
  API.LMSSetValue('cmi.core.lesson_location', 'page-2');
  API.LMSSetValue('cmi.suspend_data', 'visited=1,2');
  API.LMSCommit('');
  document.getElementById('state').textContent = 'initialized';

  document.getElementById('finish').addEventListener('click', function () {
    API.LMSSetValue('cmi.core.score.raw', '82');
    API.LMSSetValue('cmi.core.score.min', '0');
    API.LMSSetValue('cmi.core.score.max', '100');
    API.LMSSetValue('cmi.core.session_time', '0000:04:10.00');
    API.LMSSetValue('cmi.core.lesson_status', 'passed');
    API.LMSCommit('');
    API.LMSFinish('');
    document.getElementById('state').textContent = 'finished';
  });
}
</script>
</body></html>`;
}

function content2004(): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Data protection</title></head>
<body>
<h1>Data protection</h1>
<p id="entry">entry: unknown</p>
<p id="state">idle</p>
<button id="finish" type="button">Finish course</button>
<script>
${FINDER_2004}
var API = findAPI(window);
if (!API) {
  document.getElementById('state').textContent = 'NO API FOUND';
} else {
  API.Initialize('');
  document.getElementById('entry').textContent = 'entry: ' + API.GetValue('cmi.entry');
  API.SetValue('cmi.completion_status', 'incomplete');
  API.SetValue('cmi.location', 'slide-3');
  API.Commit('');
  document.getElementById('state').textContent = 'initialized';

  document.getElementById('finish').addEventListener('click', function () {
    API.SetValue('cmi.score.scaled', '0.9');
    API.SetValue('cmi.session_time', 'PT0H3M20S');
    API.SetValue('cmi.completion_status', 'completed');
    API.SetValue('cmi.success_status', 'passed');
    API.Commit('');
    API.Terminate('');
    document.getElementById('state').textContent = 'finished';
  });
}
</script>
</body></html>`;
}

function manifest12(title: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="fixture-12" version="1.0"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>1.2</schemaversion>
  </metadata>
  <organizations default="ORG">
    <organization identifier="ORG">
      <title>${title}</title>
      <item identifier="ITEM" identifierref="RES">
        <title>${title}</title>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES" type="webcontent" adlcp:scormtype="sco" href="index.html">
      <file href="index.html"/>
    </resource>
  </resources>
</manifest>`;
}

function manifest2004(title: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="fixture-2004" version="1.0"
  xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>2004 4th Edition</schemaversion>
  </metadata>
  <organizations default="ORG">
    <organization identifier="ORG">
      <title>${title}</title>
      <item identifier="ITEM" identifierref="RES">
        <title>${title}</title>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES" type="webcontent" adlcp:scormType="sco" href="index.html">
      <file href="index.html"/>
    </resource>
  </resources>
</manifest>`;
}

export function buildScormPackage(version: "1.2" | "2004", title = "Fixture course"): Buffer {
  const files: Record<string, Uint8Array> =
    version === "1.2"
      ? {
          "imsmanifest.xml": strToU8(manifest12(title)),
          "index.html": strToU8(content12()),
        }
      : {
          "imsmanifest.xml": strToU8(manifest2004(title)),
          "index.html": strToU8(content2004()),
        };

  return Buffer.from(zipSync(files));
}
