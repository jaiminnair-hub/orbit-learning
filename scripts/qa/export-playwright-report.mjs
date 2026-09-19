import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { zipSync, strToU8 } from "fflate";

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) throw new Error("Usage: node scripts/qa/export-playwright-report.mjs <playwright.json> <report.xlsx>");

const report = JSON.parse(await readFile(inputPath, "utf8"));
const rows = [];
function collect(suites, parents = []) {
  for (const suite of suites ?? []) {
    const trail = suite.title ? [...parents, suite.title] : parents;
    for (const spec of suite.specs ?? []) {
      const result = spec.tests?.at(-1)?.results?.at(-1);
      const raw = result?.status ?? spec.tests?.at(-1)?.status ?? "skipped";
      const status = raw === "passed" ? "PASS" : raw === "failed" || raw === "timedOut" ? "FAIL" : "BLOCKED";
      const title = spec.title;
      rows.push({
        id: `QA-${String(rows.length + 1).padStart(3, "0")}`,
        agent: title.includes("[Admin]") ? "Admin Test Agent" : "Learner Test Agent",
        product: title.match(/\[(Platform Control|Orbit Learning|360 Feedback|Competencies|Orbit Growth)\]/)?.[1] ?? "Orbit",
        test: title.replace(/^\[(Admin|Learner)\]\[[^\]]+\]\s*/, ""),
        status,
        evidence: result?.error?.message ?? (status === "PASS" ? "Playwright browser evidence captured in the run output." : spec.tests?.at(-1)?.annotations?.at(-1)?.description ?? "Not executed: prerequisite is intentionally missing."),
        duration: Math.round((result?.duration ?? 0) / 1000),
        suite: trail.join(" / "),
      });
    }
    collect(suite.suites, trail);
  }
}
collect(report.suites);

const escape = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const cell = (ref, value, style = 0) => `<c r="${ref}" t="inlineStr" s="${style}"><is><t>${escape(value)}</t></is></c>`;
function sheetXml(data) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${data.map((row, i) => `<row r="${i + 1}">${row.map((value, j) => cell(`${String.fromCharCode(65 + j)}${i + 1}`, value, i === 0 ? 1 : 0)).join("")}</row>`).join("")}</sheetData><cols>${data[0].map((_, i) => `<col min="${i + 1}" max="${i + 1}" width="${i === 4 ? 16 : i === 5 ? 58 : 28}" customWidth="1"/>`).join("")}</cols></worksheet>`;
}

const total = rows.length;
const passed = rows.filter((row) => row.status === "PASS").length;
const failed = rows.filter((row) => row.status === "FAIL").length;
const blocked = rows.filter((row) => row.status === "BLOCKED").length;
const summary = [["Orbit QA Automation Report", ""], ["Run date", new Date().toISOString()], ["Scope", "Disposable local QA environment; synthetic identities and data only"], ["Total cases", total], ["Passed", passed], ["Failed", failed], ["Blocked / not yet provisioned", blocked], ["Pass rate", total ? `${Math.round((passed / total) * 100)}%` : "0%"]];
const cases = [["Case ID", "Test agent", "Product", "Test case", "Result", "Evidence / blocker", "Duration (seconds)", "Suite"], ...rows.map((row) => [row.id, row.agent, row.product, row.test, row.status, row.evidence, row.duration, row.suite])];
const files = {
  "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`),
  "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
  "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Summary" sheetId="1" r:id="rId1"/><sheet name="Test Cases" sheetId="2" r:id="rId2"/></sheets></workbook>`),
  "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
  "xl/styles.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Aptos"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Aptos"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF28154D"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf fontId="0" fillId="0" borderId="0" xfId="0"/><xf fontId="1" fillId="1" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs></styleSheet>`),
  "xl/worksheets/sheet1.xml": strToU8(sheetXml(summary)), "xl/worksheets/sheet2.xml": strToU8(sheetXml(cases)),
};
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, zipSync(files, { level: 6 }));
console.log(`Excel QA report written to ${outputPath}`);
