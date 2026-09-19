import { strToU8, zipSync } from "fflate";

// fflate rather than a Node-native zip library, same reasoning as
// lib/content/scorm.ts's unzipSync choice: this has to run on Cloudflare
// Workers (step 9, Publishing pipeline, runs packaging as a job).

export type ZipInput = Record<string, Uint8Array | string>;

export function buildZip(files: ZipInput): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(files)) {
    entries[path] = typeof content === "string" ? strToU8(content) : content;
  }
  return zipSync(entries, { level: 6 });
}
