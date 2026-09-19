import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signs and verifies the short-lived credential that authorizes an
 * ingested xAPI/Tin Can package's own JavaScript to POST/PUT statements
 * and state documents to our LRS endpoint (docs/XAPI_INGEST_ARCHITECTURE.md).
 *
 * Deliberately the same shape as lib/scorm/bridge-token.ts's HMAC
 * pattern, proven live since 2026-08-24 for the SCORM content-isolation
 * bridge — this is the same problem (a third-party origin needs to prove
 * "I am package P, launched for user U in org O" without ever holding a
 * real Supabase session) applied to a different transport. The
 * difference from bridge-token.ts: this credential rides in a real HTTP
 * `Authorization: Basic` header (the wire format real xAPI content
 * actually sends, taken verbatim from the launch URL's `auth` parameter —
 * see the Tin Can/xAPI Launch convention), not a URL path segment.
 *
 * The content origin (wherever the package's launch page is served from)
 * never sees the signing secret — only the opaque, already-signed
 * Authorization header value baked into its launch URL.
 */

export interface LaunchTokenPayload {
  packageId: string;
  orgId: string;
  userId: string;
  /** Minted once per (user, package) attempt — see xapi_progress. */
  registration: string;
  /** Unix ms expiry. */
  exp: number;
}

export class LaunchTokenError extends Error {}

function getSecret(): string {
  const secret = process.env.XAPI_LRS_TOKEN_SECRET;
  if (!secret) {
    throw new LaunchTokenError(
      "XAPI_LRS_TOKEN_SECRET is not configured — the xAPI LRS endpoint cannot mint or verify launch credentials without it."
    );
  }
  return secret;
}

function sign(payloadB64: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

// A course can legitimately stay open for hours (same rationale as the
// SCORM bridge token's 4-hour TTL, raised from an initial 5 minutes after
// a real ~20-slide narrated package outlived it) — matched here so xAPI
// content gets the same headroom.
const DEFAULT_TTL_MS = 4 * 60 * 60 * 1000;

export function mintLaunchToken(
  claims: Omit<LaunchTokenPayload, "exp">,
  ttlMs: number = DEFAULT_TTL_MS
): string {
  const payload: LaunchTokenPayload = { ...claims, exp: Date.now() + ttlMs };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = sign(payloadB64, getSecret());
  return `${payloadB64}.${signature}`;
}

/**
 * Formats a minted token as a real `Authorization: Basic ...` header
 * value — what actually goes in the launch URL's `auth` query parameter,
 * and what content sends verbatim on every LRS request. The token is
 * carried as the Basic "username" with an empty password; nothing reads
 * it as a literal username anywhere, it's just valid wire format for an
 * opaque credential.
 */
export function launchTokenToAuthHeader(token: string): string {
  return `Basic ${Buffer.from(`${token}:`).toString("base64")}`;
}

/**
 * Inverse of launchTokenToAuthHeader — recovers the signed token from a
 * real `Authorization` header value, or null if it isn't a well-formed
 * Basic header at all (a malformed header is an ordinary bad-request
 * outcome, not a server error).
 */
export function tokenFromAuthHeader(header: string | null): string | null {
  if (!header || !header.startsWith("Basic ")) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(header.slice("Basic ".length), "base64").toString("utf8");
  } catch {
    return null;
  }
  const colon = decoded.lastIndexOf(":");
  if (colon === -1) return null;
  return decoded.slice(0, colon);
}

/**
 * Returns the verified payload, or null for anything wrong with the
 * token — expired, tampered, malformed, or signed with a different
 * secret. Never throws on a bad token, same rationale as
 * verifyBridgeToken: a bad token is an expected outcome (stale link,
 * replay attempt), not a server error. Throws only when the secret
 * itself isn't configured.
 */
export function verifyLaunchToken(token: string): LaunchTokenPayload | null {
  const secret = getSecret();
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, signature] = parts;

  const expected = sign(payloadB64, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload: LaunchTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (
    typeof payload.packageId !== "string" ||
    typeof payload.orgId !== "string" ||
    typeof payload.userId !== "string" ||
    typeof payload.registration !== "string" ||
    typeof payload.exp !== "number"
  ) {
    return null;
  }

  if (payload.exp < Date.now()) return null;

  return payload;
}
