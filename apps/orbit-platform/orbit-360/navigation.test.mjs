// Structural regression checks for the orbit-360 static site. These assert
// the invariants that actually broke in practice (2026-09-02): inline
// styles the site's CSP silently blocks, relative links that resolve
// differently depending on which URL a page is served at, links to a
// non-canonical Vercel alias instead of the real domain, and dangling
// local asset references. Deliberately NOT copy/content assertions --
// those are brittle and don't catch the bug classes that matter here.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const orbitDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(orbitDir, "..");
const htmlFiles = readdirSync(orbitDir).filter((f) => f.endsWith(".html"));

assert.ok(htmlFiles.length > 5, "expected to find the orbit-360 HTML pages");

for (const file of htmlFiles) {
  const html = readFileSync(path.join(orbitDir, file), "utf8");

  assert.doesNotMatch(
    html,
    /\sstyle="/,
    `${file}: inline style="" attribute -- the site's CSP (style-src, no unsafe-inline) blocks these silently`
  );

  assert.doesNotMatch(
    html,
    /\son[a-z]+="/i,
    `${file}: inline event handler (on*="") -- blocked by CSP script-src`
  );

  assert.doesNotMatch(
    html,
    /href="\.\.?\//,
    `${file}: relative "./" or "../" link -- resolves differently depending on whether the page is served at / or /orbit-360/, use an absolute path`
  );

  assert.doesNotMatch(
    html,
    /your-team/,
    `${file}: links to the non-canonical Vercel project alias instead of the real production domain`
  );

  const localRefs = [...html.matchAll(/(?:href|src)="([^"]*)"/g)]
    .map((m) => m[1])
    .filter((ref) => ref && !/^(https?:|mailto:|#|\/orbit-360\/|\/outputs\/|\/$)/.test(ref))
    .map((ref) => ref.split("?")[0].split("#")[0])
    .filter(Boolean);

  for (const ref of localRefs) {
    const resolved = path.join(orbitDir, ref);
    assert.ok(existsSync(resolved), `${file}: references "${ref}", which does not exist in orbit-360/`);
  }
}

// vercel.json: every local rewrite/redirect destination should point at a
// file that actually exists, so a route doesn't silently 404.
const vercel = JSON.parse(readFileSync(path.join(repoRoot, "vercel.json"), "utf8"));
for (const rule of [...(vercel.rewrites ?? []), ...(vercel.redirects ?? [])]) {
  if (!rule.destination.startsWith("/") || rule.destination.startsWith("//")) continue;
  if (rule.destination.includes(":")) continue; // dynamic segment, e.g. /:path*
  const destPath = rule.destination.split("?")[0];
  if (destPath === "/") continue; // handled by its own rewrite
  const resolved = path.join(repoRoot, destPath);
  assert.ok(existsSync(resolved), `vercel.json: ${rule.source} -> ${rule.destination}, which does not exist`);
}

console.log(`Orbit 360 structural checks: passed (${htmlFiles.length} pages)`);
