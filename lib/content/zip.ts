import { unzipSync } from "fflate";

// Shared zip-bomb-bounded extraction, factored out of lib/content/scorm.ts
// (2026-09-03) so the xAPI/Tin Can ingest path (lib/content/tincan.ts)
// gets the same defense without duplicating it. See scorm.ts's original
// header comment for the full security rationale — unchanged here, just
// relocated.

export const MAX_ENTRY_COUNT = 5_000;
export const MAX_ENTRY_BYTES = 200 * 1024 * 1024; // 200MB, per file
export const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024; // 2GB, aggregate

export class PackageTooLargeError extends Error {}

export interface ExtractedFile {
  path: string;
  bytes: Uint8Array;
}

export interface ExtractLimits {
  maxEntryCount?: number;
  maxEntryBytes?: number;
  maxTotalBytes?: number;
}

/**
 * Unzips with bounds checked before each entry decompresses, keyed on the
 * zip's own (attacker-supplied) declared size. Returns the raw unzipped
 * map — callers apply their own manifest-file lookup and root-prefix
 * stripping (SCORM's imsmanifest.xml and Tin Can's tincan.xml differ only
 * in which filename they look for and what they parse out of it).
 */
export function safeUnzip(
  zipBytes: Uint8Array,
  limits: ExtractLimits = {}
): Record<string, Uint8Array> {
  const maxEntryCount = limits.maxEntryCount ?? MAX_ENTRY_COUNT;
  const maxEntryBytes = limits.maxEntryBytes ?? MAX_ENTRY_BYTES;
  const maxTotalBytes = limits.maxTotalBytes ?? MAX_TOTAL_BYTES;

  let entryCount = 0;
  let runningTotal = 0;

  return unzipSync(zipBytes, {
    filter(file) {
      entryCount++;
      if (entryCount > maxEntryCount) {
        throw new PackageTooLargeError(`Package has more than ${maxEntryCount} files.`);
      }
      if (file.originalSize > maxEntryBytes) {
        throw new PackageTooLargeError(
          `"${file.name}" exceeds the ${Math.round(maxEntryBytes / 1024 / 1024)}MB per-file limit.`
        );
      }
      runningTotal += file.originalSize;
      if (runningTotal > maxTotalBytes) {
        throw new PackageTooLargeError(
          `Package exceeds the ${Math.round(maxTotalBytes / 1024 / 1024)}MB total size limit.`
        );
      }
      return true;
    },
  });
}

/**
 * Given the unzipped map and the key of the manifest file found somewhere
 * inside it, returns every other file with paths made relative to the
 * manifest's own directory, rejecting any path-traversal attempt. Shared
 * by both SCORM (imsmanifest.xml) and Tin Can (tincan.xml) extraction —
 * see lib/content/scorm.ts's extractPackage for why this check exists
 * (found in the 2026-08-21 security review's follow-up).
 */
export function filesRelativeToManifest(
  unzipped: Record<string, Uint8Array>,
  manifestKey: string
): ExtractedFile[] {
  const rootPrefix = manifestKey.slice(
    0,
    manifestKey.length - manifestKey.split("/").pop()!.length
  );

  const files: ExtractedFile[] = [];
  for (const [key, bytes] of Object.entries(unzipped)) {
    if (key.endsWith("/")) continue; // directory entry
    if (rootPrefix && !key.startsWith(rootPrefix)) continue;
    const relative = rootPrefix ? key.slice(rootPrefix.length) : key;
    if (!relative) continue;

    if (relative.includes("..") || relative.startsWith("/")) {
      throw new Error(`Package contains an unsafe file path: "${relative}"`);
    }

    files.push({ path: relative, bytes });
  }
  return files;
}

const MIME_BY_EXT: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  mp3: "audio/mpeg",
  pdf: "application/pdf",
  woff: "font/woff",
  woff2: "font/woff2",
};

// Serving .html with a correct, non-downgraded Content-Type is the exact
// mechanism that broke on an earlier project's host — validated as working here
// in the Cloudflare spike, and preserved deliberately.
export function contentTypeFor(path: string): string {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}
