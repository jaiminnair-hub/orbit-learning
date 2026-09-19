import { describe, expect, it, vi } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { extractFromPdf, extractFromDocx, extractFromPptx, extractFromUrl } from "@/lib/authoring/extract";

/**
 * Every fixture here is a real, minimal, valid file of its format —
 * constructed at test time rather than checked in as a binary, so there is
 * nothing to keep in sync and no opaque binary in the diff. PDF.js and
 * mammoth both parse these as the real formats they are; this is not a
 * mocked extraction path.
 */

// A hand-built minimal one-page PDF with real byte-accurate xref offsets —
// PDF.js can often recover from an approximate one, but computing them
// properly means this test exercises the same path a well-formed real PDF
// would, not PDF.js's fallback recovery parser.
function buildMinimalPdf(text: string): Uint8Array {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 300 200] /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    null as unknown as string, // stream object built below, needs its own length
  ];

  const stream = `BT /F1 18 Tf 10 150 Td (${text.replace(/[()\\]/g, "\\$&")}) Tj ET`;
  objects[4] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;

  let body = "%PDF-1.4\n";
  const offsets: number[] = [0];
  objects.forEach((obj, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });

  const xrefStart = body.length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return new TextEncoder().encode(body + xref + trailer);
}

function buildMinimalDocx(text: string): Uint8Array {
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>${text}</w:t></w:r></w:p>
  </w:body>
</w:document>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  return zipSync({
    "[Content_Types].xml": strToU8(contentTypes),
    "_rels/.rels": strToU8(rels),
    "word/document.xml": strToU8(documentXml),
  });
}

function buildMinimalPptx(slideTexts: string[]): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  slideTexts.forEach((text, i) => {
    const slideXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>`;
    files[`ppt/slides/slide${i + 1}.xml`] = strToU8(slideXml);
  });
  return zipSync(files);
}

describe("extractFromPdf", () => {
  it("extracts real text from a real minimal PDF", async () => {
    const bytes = buildMinimalPdf("Hello PDF World");
    const result = await extractFromPdf(bytes);
    expect(result.text).toContain("Hello PDF World");
  });

  it("rejects bytes that are not a PDF at all", async () => {
    await expect(extractFromPdf(new TextEncoder().encode("not a pdf"))).rejects.toMatchObject({
      code: "PARSE_FAILED",
    });
  });
});

describe("extractFromDocx", () => {
  it("extracts real text from a real minimal docx", async () => {
    const bytes = buildMinimalDocx("Hello DOCX World");
    const result = await extractFromDocx(bytes);
    expect(result.text).toContain("Hello DOCX World");
  });

  it("rejects bytes that are not a docx at all", async () => {
    await expect(extractFromDocx(new TextEncoder().encode("not a docx"))).rejects.toMatchObject({
      code: "PARSE_FAILED",
    });
  });
});

describe("extractFromPptx", () => {
  it("extracts and joins text across multiple real slides, in order", async () => {
    const bytes = buildMinimalPptx(["First slide content", "Second slide content", "Third slide content"]);
    const result = await extractFromPptx(bytes);
    expect(result.text.indexOf("First slide")).toBeLessThan(result.text.indexOf("Second slide"));
    expect(result.text.indexOf("Second slide")).toBeLessThan(result.text.indexOf("Third slide"));
  });

  it("decodes XML entities in slide text", async () => {
    const bytes = buildMinimalPptx(["Fire &amp; Safety &lt;training&gt;"]);
    const result = await extractFromPptx(bytes);
    expect(result.text).toContain("Fire & Safety <training>");
  });

  it("warns on an empty slide rather than silently dropping it", async () => {
    const bytes = buildMinimalPptx(["Real content", ""]);
    const result = await extractFromPptx(bytes);
    expect(result.warnings.some((w) => w.includes("Slide 2"))).toBe(true);
  });

  it("rejects a zip with no slides", async () => {
    const bytes = zipSync({ "readme.txt": strToU8("not a presentation") });
    await expect(extractFromPptx(bytes)).rejects.toMatchObject({ code: "PARSE_FAILED" });
  });
});

describe("extractFromUrl — SSRF guard", () => {
  it("rejects a non-http(s) scheme", async () => {
    await expect(extractFromUrl("file:///etc/passwd")).rejects.toMatchObject({ code: "BLOCKED_URL" });
  });

  it("rejects an obviously malformed URL", async () => {
    await expect(extractFromUrl("not a url")).rejects.toMatchObject({ code: "BLOCKED_URL" });
  });

  it("rejects a loopback address", async () => {
    await expect(extractFromUrl("http://127.0.0.1/secret")).rejects.toMatchObject({ code: "BLOCKED_URL" });
  });

  it("rejects the cloud metadata address", async () => {
    await expect(extractFromUrl("http://169.254.169.254/latest/meta-data/")).rejects.toMatchObject({
      code: "BLOCKED_URL",
    });
  });

  it("rejects a private RFC1918 address", async () => {
    await expect(extractFromUrl("http://10.0.0.5/internal")).rejects.toMatchObject({ code: "BLOCKED_URL" });
    await expect(extractFromUrl("http://192.168.1.1/router")).rejects.toMatchObject({ code: "BLOCKED_URL" });
  });

  it("rejects localhost by name (resolves to loopback)", async () => {
    await expect(extractFromUrl("http://localhost:3000/admin")).rejects.toMatchObject({ code: "BLOCKED_URL" });
  });
});

describe("extractFromUrl — a public-looking address", () => {
  it("fetches, strips HTML, and decodes entities", async () => {
    const html =
      "<html><head><script>evil()</script><style>.x{color:red}</style></head>" +
      "<body><h1>Fire Safety</h1><p>Know your exits &amp; assembly point.</p></body></html>";
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(html, { status: 200, headers: { "content-type": "text/html" } })
    );

    // A real public IP (documentation range, per RFC 5737 — not a real host,
    // but not privately-routable either, so it passes the guard and only the
    // mocked fetch below actually "serves" anything).
    const result = await extractFromUrl("http://203.0.113.10/article");

    expect(result.text).toContain("Fire Safety");
    expect(result.text).toContain("Know your exits & assembly point.");
    expect(result.text).not.toContain("evil()");
    fetchMock.mockRestore();
  });
});
