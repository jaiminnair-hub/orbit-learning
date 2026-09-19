import { extractText, getDocumentProxy } from "unpdf";
import mammoth from "mammoth";
import { unzipSync, strFromU8 } from "fflate";
import { Agent } from "undici";

/**
 * Document text extraction — Phase 3 step 8's "Extract text" stage
 * (docs/PHASE3_AI_ARCHITECTURE.md §5). Pure functions: bytes or a URL in,
 * plain text out. No AI, no database — the generation pipeline
 * (lib/ai/full-course-builder.ts) treats the result exactly like pasted
 * text, so nothing downstream needs to know or care which source kind
 * produced it.
 *
 * `unpdf` and `mammoth` are the two libraries named in the original
 * architecture doc — the doc's own note that extraction was "already
 * proven on Cloudflare Workers" no longer matters now that this platform
 * runs on Vercel, but the library choice itself still holds.
 */

export class ExtractionError extends Error {
  constructor(
    message: string,
    readonly code: "EMPTY_RESULT" | "PARSE_FAILED" | "UNSUPPORTED" | "FETCH_FAILED" | "BLOCKED_URL" | "TOO_LARGE"
  ) {
    super(message);
    this.name = "ExtractionError";
  }
}

export interface ExtractionResult {
  text: string;
  /** Non-fatal notes (e.g. a slide/page that produced no text) — surfaced to the author, not the model. */
  warnings: string[];
}

/** Caps how much extracted text a single source can hand to the generation pipeline. */
const MAX_EXTRACTED_CHARS = 200_000;

function clamp(text: string, warnings: string[]): ExtractionResult {
  const trimmed = text.replace(/\s+/g, " ").replace(/ *\n */g, "\n").trim();
  if (!trimmed) throw new ExtractionError("No readable text was found in this document.", "EMPTY_RESULT");
  if (trimmed.length > MAX_EXTRACTED_CHARS) {
    warnings.push(`The document's text was truncated to ${MAX_EXTRACTED_CHARS.toLocaleString()} characters.`);
    return { text: trimmed.slice(0, MAX_EXTRACTED_CHARS), warnings };
  }
  return { text: trimmed, warnings };
}

export async function extractFromPdf(bytes: Uint8Array): Promise<ExtractionResult> {
  let text: string;
  try {
    const pdf = await getDocumentProxy(bytes);
    const result = await extractText(pdf, { mergePages: true });
    text = result.text;
  } catch (error) {
    throw new ExtractionError(
      `Could not read this PDF: ${error instanceof Error ? error.message : String(error)}`,
      "PARSE_FAILED"
    );
  }
  return clamp(text, []);
}

export async function extractFromDocx(bytes: Uint8Array): Promise<ExtractionResult> {
  let text: string;
  const warnings: string[] = [];
  try {
    // `Buffer.from` — mammoth's Node build reads a Buffer, not a bare Uint8Array.
    const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    text = result.value;
    for (const message of result.messages) {
      if (message.type === "warning") warnings.push(message.message);
    }
  } catch (error) {
    throw new ExtractionError(
      `Could not read this Word document: ${error instanceof Error ? error.message : String(error)}`,
      "PARSE_FAILED"
    );
  }
  return clamp(text, warnings);
}

const XML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeXmlEntities(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (match, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1] === "x" || entity[1] === "X" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return XML_ENTITIES[entity] ?? match;
  });
}

/**
 * PPTX is a zip of per-slide XML (DrawingML). No dedicated library is named
 * in the architecture doc — "PPT... extraction [is] new" — so this hand-rolls
 * the minimum needed (unzip, pull `<a:t>` text runs per slide) using `fflate`,
 * already a dependency (lib/export's zip building), rather than adding a new
 * one for what is a small, well-defined format slice.
 */
export async function extractFromPptx(bytes: Uint8Array): Promise<ExtractionResult> {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch (error) {
    throw new ExtractionError(
      `Could not read this PowerPoint file: ${error instanceof Error ? error.message : String(error)}`,
      "PARSE_FAILED"
    );
  }

  const slidePaths = Object.keys(entries)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .sort((a, b) => {
      const numA = Number(a.match(/slide(\d+)\.xml$/)![1]);
      const numB = Number(b.match(/slide(\d+)\.xml$/)![1]);
      return numA - numB;
    });

  if (slidePaths.length === 0) {
    throw new ExtractionError("This file does not look like a valid PowerPoint presentation.", "PARSE_FAILED");
  }

  const warnings: string[] = [];
  const slideTexts: string[] = [];
  slidePaths.forEach((path, index) => {
    const xml = strFromU8(entries[path]);
    // <a:t> wraps one run of visible text in DrawingML; every real text box
    // on a slide is made of these, regardless of shape/placeholder type.
    const runs = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => decodeXmlEntities(m[1]));
    const slideText = runs.join(" ").trim();
    if (slideText) slideTexts.push(slideText);
    else warnings.push(`Slide ${index + 1} had no extractable text.`);
  });

  return clamp(slideTexts.join("\n\n"), warnings);
}

// ---------------------------------------------------------------- URL

const PRIVATE_IPV4_RANGES: Array<[number, number]> = [
  [ip4("0.0.0.0"), ip4("0.255.255.255")],
  [ip4("10.0.0.0"), ip4("10.255.255.255")],
  [ip4("100.64.0.0"), ip4("100.127.255.255")], // carrier-grade NAT
  [ip4("127.0.0.0"), ip4("127.255.255.255")],
  [ip4("169.254.0.0"), ip4("169.254.255.255")], // link-local, includes cloud metadata (169.254.169.254)
  [ip4("172.16.0.0"), ip4("172.31.255.255")],
  [ip4("192.0.0.0"), ip4("192.0.0.255")],
  [ip4("192.168.0.0"), ip4("192.168.255.255")],
  [ip4("198.18.0.0"), ip4("198.19.255.255")],
  [ip4("224.0.0.0"), ip4("255.255.255.255")], // multicast/reserved
];

function ip4(addr: string): number {
  const parts = addr.split(".").map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isPrivateIPv4(addr: string): boolean {
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(addr)) return false;
  const n = ip4(addr);
  return PRIVATE_IPV4_RANGES.some(([lo, hi]) => n >= lo && n <= hi);
}

function isPrivateIPv6(addr: string): boolean {
  const a = addr.toLowerCase();
  return a === "::1" || a.startsWith("fc") || a.startsWith("fd") || a.startsWith("fe8") || a.startsWith("fe9") ||
    a.startsWith("fea") || a.startsWith("feb") || a === "::" || a.startsWith("::ffff:127.");
}

function assertHttpScheme(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ExtractionError("That is not a valid URL.", "BLOCKED_URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ExtractionError("Only http:// and https:// URLs are supported.", "BLOCKED_URL");
  }
  return url;
}

/**
 * SSRF guard for author-supplied URLs: resolves `hostname` and rejects it if
 * any answer is a private/internal/metadata address.
 *
 * An org_admin choosing a URL to summarise is an internal, elevated actor
 * (per this platform's role model), but "elevated" is not "trusted with
 * server-side request forgery" — a URL is still attacker-shaped input if the
 * account is compromised, and a cloud metadata endpoint or an internal
 * service is exactly the kind of target this exists to block.
 */
async function resolveSafeAddress(hostname: string): Promise<{ address: string; family: 4 | 6 }> {
  const { lookup } = await import("node:dns/promises");
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new ExtractionError("Could not resolve that URL's address.", "BLOCKED_URL");
  }
  if (addresses.length === 0) {
    throw new ExtractionError("Could not resolve that URL's address.", "BLOCKED_URL");
  }
  for (const { address, family } of addresses) {
    const blocked = family === 4 ? isPrivateIPv4(address) : isPrivateIPv6(address);
    if (blocked) {
      throw new ExtractionError("That URL resolves to a private or internal address and cannot be fetched.", "BLOCKED_URL");
    }
  }
  const first = addresses[0];
  return { address: first.address, family: first.family === 6 ? 6 : 4 };
}

/**
 * Fetches with the DNS answer pinned to the address just validated —
 * closing the classic gap in resolve-then-fetch SSRF guards, where a
 * second lookup made at connection time (attacker-controlled DNS, TTL 0)
 * could answer with a different, private address than the one just
 * checked. `dispatcher` is an undici/Node-fetch extension, not a standard
 * fetch option — recognised by the real runtime, and irrelevant to tests
 * that mock `global.fetch` directly (the mock never looks at it).
 */
function fetchPinned(url: URL, address: string, family: 4 | 6, signal: AbortSignal): Promise<Response> {
  const dispatcher = new Agent({
    connect: {
      lookup: (_hostname, _options, callback) => {
        callback(null, address, family);
      },
    },
  });
  return fetch(url, {
    signal,
    redirect: "manual",
    headers: { "User-Agent": "OrbitLearning-AICourseBuilder/1.0" },
    dispatcher,
  } as RequestInit);
}

const FETCH_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_REDIRECTS = 5;

export async function extractFromUrl(rawUrl: string): Promise<ExtractionResult> {
  let url = assertHttpScheme(rawUrl);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    let hop = 0;
    for (;;) {
      const { address, family } = await resolveSafeAddress(url.hostname);
      let hopResponse: Response;
      try {
        hopResponse = await fetchPinned(url, address, family, controller.signal);
      } catch (error) {
        throw new ExtractionError(
          `Could not fetch that URL: ${error instanceof Error ? error.message : String(error)}`,
          "FETCH_FAILED"
        );
      }
      const location = hopResponse.headers.get("location");
      if (hopResponse.status >= 300 && hopResponse.status < 400 && location) {
        hop += 1;
        if (hop > MAX_REDIRECTS) {
          throw new ExtractionError("That URL redirected too many times.", "FETCH_FAILED");
        }
        // Re-validated from scratch on every hop — the redirect target is
        // just as attacker-shaped as the original input.
        url = assertHttpScheme(new URL(location, url).toString());
        continue;
      }
      response = hopResponse;
      break;
    }
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new ExtractionError(`The URL returned an error (HTTP ${response.status}).`, "FETCH_FAILED");
  }

  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (contentLength > MAX_RESPONSE_BYTES) {
    throw new ExtractionError("That page is too large to extract from.", "TOO_LARGE");
  }

  const html = await response.text();
  if (html.length > MAX_RESPONSE_BYTES) {
    throw new ExtractionError("That page is too large to extract from.", "TOO_LARGE");
  }

  return clamp(htmlToPlainText(html), []);
}

/**
 * Deliberately simple, not a full readability algorithm: strips script/style
 * blocks, then all remaining tags, then decodes entities. Good enough for
 * typical article-style pages; a page that is mostly navigation chrome will
 * extract that chrome too, same as any non-semantic HTML-to-text pass would.
 */
function htmlToPlainText(html: string): string {
  const withoutNoise = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const withoutTags = withoutNoise.replace(/<\/?(p|div|br|li|h[1-6]|tr)[^>]*>/gi, "\n").replace(/<[^>]+>/g, " ");
  return decodeXmlEntities(withoutTags).replace(/&nbsp;/gi, " ");
}
