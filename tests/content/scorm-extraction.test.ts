import { zipSync, strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import {
  extractPackage,
  parseManifest,
  contentTypeFor,
  ScormPackageTooLargeError,
} from "@/lib/content/scorm";
import { MAX_ENTRY_COUNT } from "@/lib/content/zip";

/**
 * lib/content/scorm.ts had no test coverage before the 2026-08-21
 * security review. These tests cover two things: the manifest/MIME
 * parsing that was already load-bearing and untested, and the
 * decompression caps added by that review — a package uploaded by an
 * org_admin (a customer role, not platform staff) must not be able to
 * exhaust server memory via a small crafted zip.
 */

const MANIFEST_12 = `<?xml version="1.0"?>
<manifest><metadata><schemaversion>1.2</schemaversion></metadata>
<organizations default="ORG"><organization identifier="ORG"><title>Fire safety</title>
<item identifierref="RES"/></organization></organizations>
<resources><resource identifier="RES" href="index.html"><file href="index.html"/></resource></resources>
</manifest>`;

function packageZip(files: Record<string, Uint8Array>): Uint8Array {
  return zipSync({ "imsmanifest.xml": strToU8(MANIFEST_12), ...files });
}

describe("parseManifest", () => {
  it("reads title, version, and entry point from a real manifest shape", () => {
    const m = parseManifest(MANIFEST_12);
    expect(m).toEqual({ scormVersion: "1.2", title: "Fire safety", entryPoint: "index.html" });
  });

  it("discriminates 2004 by schema version", () => {
    const m = parseManifest(MANIFEST_12.replace("1.2</schemaversion>", "2004 3rd Edition</schemaversion>"));
    expect(m.scormVersion).toBe("2004");
  });

  it("falls back to a generic title when none is present", () => {
    const m = parseManifest(
      `<manifest><resources><resource href="x.html"/></resources></manifest>`
    );
    expect(m.title).toBe("Untitled SCORM package");
  });

  it("throws when no resource href can be found at all", () => {
    expect(() => parseManifest("<manifest></manifest>")).toThrow(/resource href/);
  });
});

describe("contentTypeFor", () => {
  it("serves html with an explicit, non-downgraded charset", () => {
    expect(contentTypeFor("index.html")).toBe("text/html; charset=utf-8");
  });

  it("falls back to application/octet-stream for an unknown extension", () => {
    expect(contentTypeFor("data.bin")).toBe("application/octet-stream");
  });
});

describe("extractPackage", () => {
  it("extracts a normal small package unchanged", () => {
    const zip = packageZip({ "index.html": strToU8("<h1>hi</h1>") });
    const { manifest, files } = extractPackage(zip);
    expect(manifest.entryPoint).toBe("index.html");
    expect(files.map((f) => f.path).sort()).toEqual(["imsmanifest.xml", "index.html"]);
  });

  it("strips a manifest subdirectory prefix from every extracted path", () => {
    const zip = zipSync({
      "package/imsmanifest.xml": strToU8(MANIFEST_12),
      "package/index.html": strToU8("hi"),
      "package/assets/img.png": strToU8("fake-png-bytes"),
    });
    const { files } = extractPackage(zip);
    expect(files.map((f) => f.path).sort()).toEqual([
      "assets/img.png",
      "imsmanifest.xml",
      "index.html",
    ]);
  });

  it("rejects a package with more than the file-count cap", () => {
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i < MAX_ENTRY_COUNT + 1; i++) {
      files[`f${i}.txt`] = strToU8("x");
    }
    expect(() => extractPackage(packageZip(files))).toThrow(ScormPackageTooLargeError);
  });

  it("rejects a single entry over the per-file cap", () => {
    // Limits are overridable so this can exercise a real-sized entry
    // against a tiny cap, rather than needing an actual 200MB+ fixture
    // to test the production default.
    const zip = packageZip({ "huge.bin": strToU8("x".repeat(1024)) });
    expect(() => extractPackage(zip, { maxEntryBytes: 512 })).toThrow(ScormPackageTooLargeError);
  });

  it("rejects a package whose aggregate size exceeds the total cap even if no single file does", () => {
    const zip = packageZip({
      "a.bin": strToU8("x".repeat(400)),
      "b.bin": strToU8("x".repeat(400)),
      "c.bin": strToU8("x".repeat(400)),
    });
    expect(() => extractPackage(zip, { maxTotalBytes: 1000 })).toThrow(ScormPackageTooLargeError);
  });

  it("still requires a real imsmanifest.xml", () => {
    const zip = zipSync({ "index.html": strToU8("hi") });
    expect(() => extractPackage(zip)).toThrow(/imsmanifest\.xml/);
  });

  describe("path safety", () => {
    // The caller (app/api/v1/content/scorm/route.ts) builds a Storage
    // key directly from each entry's path — `${extractedPrefix}/${path}`.
    // A zip entry's own name is attacker-supplied, so an entry crafted
    // to climb out of that prefix has to be rejected here, at the one
    // place every caller goes through, not re-checked ad hoc by whoever
    // calls extractPackage next.
    it("rejects an entry name containing a parent-directory traversal", () => {
      const zip = packageZip({ "../../other-org/evil.html": strToU8("gotcha") });
      expect(() => extractPackage(zip)).toThrow(/unsafe file path/);
    });

    it("rejects a traversal attempt buried inside a nested path", () => {
      const zip = packageZip({ "assets/../../escape.html": strToU8("gotcha") });
      expect(() => extractPackage(zip)).toThrow(/unsafe file path/);
    });

    it("rejects an absolute path", () => {
      const zip = packageZip({ "/etc/passwd": strToU8("gotcha") });
      expect(() => extractPackage(zip)).toThrow(/unsafe file path/);
    });

    it("still accepts ordinary nested paths that merely contain dots", () => {
      const zip = packageZip({ "assets/v1.2/logo.min.png": strToU8("fake-png") });
      const { files } = extractPackage(zip);
      expect(files.map((f) => f.path)).toContain("assets/v1.2/logo.min.png");
    });
  });
});
