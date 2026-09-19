import { safeUnzip, filesRelativeToManifest, type ExtractedFile, type ExtractLimits } from "./zip";

// xAPI (Tin Can) package ingest — added 2026-09-03 alongside the AICC
// removal (docs/MASTER_FEATURE_MATRIX.md). Mirrors lib/content/scorm.ts's
// shape deliberately: same zip-bomb-bounded extraction (lib/content/zip.ts),
// same "read three things out of a machine-generated manifest with regex,
// not a full XML parser" stance — tincan.xml is exactly as
// machine-generated as imsmanifest.xml, and the tag set this needs from it
// is smaller.
//
// What's structurally different from SCORM: a Tin Can package has no CMI
// runtime API to discover — it launches into a page that POSTs xAPI
// statements straight to an LRS endpoint over HTTP, using launch
// parameters (endpoint/auth/actor/registration/activity_id) the LMS
// appends to the launch URL. See docs/XAPI_INGEST_ARCHITECTURE.md for the
// full launch and LRS design.

export interface TincanManifest {
  title: string;
  /** The activity IRI this package launches as — its <activity id="...">. */
  activityId: string;
  /** Path, relative to the package root, of the launch page. */
  launch: string;
}

function matchFirst(xml: string, pattern: RegExp): string | null {
  const m = xml.match(pattern);
  return m ? m[1].trim() : null;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function parseTincanManifest(xml: string): TincanManifest {
  // A tincan.xml can declare multiple <activity> blocks (one per
  // launchable unit); the top-level launchable course is the first one
  // that actually carries a <launch> element — real authoring-tool output
  // (Storyline, Rise, Adapt) puts exactly one.
  const activityBlockMatch = xml.match(/<activity\s[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/activity>/i);
  if (!activityBlockMatch) {
    throw new Error("tincan.xml has no <activity> block — cannot determine what to launch");
  }
  const [, activityId, activityBody] = activityBlockMatch;

  const launch = matchFirst(activityBody, /<launch[^>]*>([^<]*)<\/launch>/i);
  if (!launch) {
    throw new Error("tincan.xml's <activity> has no <launch> element — cannot determine entry point");
  }

  const title =
    matchFirst(activityBody, /<name[^>]*>([^<]*)<\/name>/i) ?? "Untitled xAPI package";

  return {
    title: decodeXmlEntities(title),
    activityId,
    launch: decodeXmlEntities(launch),
  };
}

export function extractTincanPackage(
  zipBytes: Uint8Array,
  limits: ExtractLimits = {}
): {
  manifest: TincanManifest;
  files: ExtractedFile[];
} {
  const unzipped = safeUnzip(zipBytes, limits);

  const manifestKey = Object.keys(unzipped).find((k) => k.toLowerCase().endsWith("tincan.xml"));
  if (!manifestKey) {
    throw new Error("Not a Tin Can package: tincan.xml not found at any level");
  }

  const manifest = parseTincanManifest(new TextDecoder().decode(unzipped[manifestKey]));
  const files = filesRelativeToManifest(unzipped, manifestKey);

  return { manifest, files };
}
