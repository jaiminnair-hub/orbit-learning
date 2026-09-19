import {
  safeUnzip,
  filesRelativeToManifest,
  contentTypeFor,
  type ExtractedFile,
  type ExtractLimits,
  PackageTooLargeError,
} from "./zip";

// SCORM package handling. Uses fflate (via lib/content/zip.ts) rather than
// a Node-native zip library because this has to run on Cloudflare Workers
// — the same constraint that drove the unpdf/mammoth choices in the
// original Cloudflare validation spike
// (docs/CLOUDFLARE_VALIDATION_RESULTS.md).
//
// Security note (2026-08-21 SCORM security review): a package is
// uploaded by an org_admin — a customer-controlled role, not platform
// staff — and extraction runs synchronously inside a request handler.
// The zip-bomb bounds and path-traversal check this relies on live in
// lib/content/zip.ts (factored out 2026-09-03 so the Tin Can/xAPI ingest
// path shares the same defense instead of reimplementing it) — see that
// file for the full rationale, unchanged here, just relocated.

export { PackageTooLargeError as ScormPackageTooLargeError, contentTypeFor };
export type { ExtractedFile };

export interface ScormManifest {
  scormVersion: "1.2" | "2004";
  title: string;
  entryPoint: string;
}

// Minimal, dependency-free XML value extraction. A full XML parser is
// deliberately avoided: imsmanifest.xml is machine-generated and we need
// exactly three values from it. Anything more elaborate is a Phase 3+
// concern if real-world packages demand it.
function matchFirst(xml: string, pattern: RegExp): string | null {
  const m = xml.match(pattern);
  return m ? m[1].trim() : null;
}

export function parseManifest(xml: string): ScormManifest {
  // <schemaversion> is the reliable discriminator: SCORM 1.2 packages say
  // "1.2", 2004 packages say "CAM 1.3" / "2004 3rd Edition" etc.
  const schemaVersion = matchFirst(xml, /<schemaversion>([^<]*)<\/schemaversion>/i) ?? "";
  const scormVersion: "1.2" | "2004" = schemaVersion.includes("1.2") ? "1.2" : "2004";

  const title =
    matchFirst(xml, /<title>([^<]*)<\/title>/i) ??
    matchFirst(xml, /<organization[^>]*>[\s\S]*?<title>([^<]*)<\/title>/i) ??
    "Untitled SCORM package";

  // The entry point is the href of the resource the default organization
  // points at. Falling back to the first resource href covers packages
  // whose organization block omits an explicit identifierref.
  const entryPoint =
    matchFirst(xml, /<resource[^>]*\bhref="([^"]+)"/i) ??
    matchFirst(xml, /<file[^>]*\bhref="([^"]+)"/i);

  if (!entryPoint) {
    throw new Error("imsmanifest.xml has no resource href — cannot determine entry point");
  }

  return { scormVersion, title, entryPoint };
}

export function extractPackage(
  zipBytes: Uint8Array,
  limits: ExtractLimits = {}
): {
  manifest: ScormManifest;
  files: ExtractedFile[];
} {
  const unzipped = safeUnzip(zipBytes, limits);

  const manifestKey = Object.keys(unzipped).find((k) =>
    k.toLowerCase().endsWith("imsmanifest.xml")
  );
  if (!manifestKey) {
    throw new Error("Not a SCORM package: imsmanifest.xml not found at any level");
  }

  const manifest = parseManifest(new TextDecoder().decode(unzipped[manifestKey]));
  const files = filesRelativeToManifest(unzipped, manifestKey);

  return { manifest, files };
}
