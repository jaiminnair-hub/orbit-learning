import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = path.resolve("artifacts/qa");
const json = path.join(outputDir, `orbit-qa-${timestamp}.json`);
const xlsx = path.join(outputDir, `orbit-qa-${timestamp}.xlsx`);
mkdirSync(outputDir, { recursive: true });

let testExitCode = 0;
let playwrightJson = "";
try {
  playwrightJson = execFileSync(process.execPath, ["node_modules/@playwright/test/cli.js", "test", "--config=playwright.qa.config.ts", "--reporter=json"], { stdio: ["ignore", "pipe", "inherit"], encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
} catch (error) {
  testExitCode = error.status ?? 1;
  if (!error.stdout) throw error;
  playwrightJson = error.stdout;
}
writeFileSync(json, playwrightJson);
execFileSync("node", ["scripts/qa/export-playwright-report.mjs", json, xlsx], { stdio: "inherit" });
process.exitCode = testExitCode;
