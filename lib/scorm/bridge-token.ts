import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signs and verifies the short-lived token that authorizes the SCORM
 * content-isolation bridge (docs/SCORM_CONTENT_ISOLATION_ARCHITECTURE.md)
 * to serve one specific package to one specific viewer.
 *
 * Deliberately plain HMAC via Node's built-in `crypto`, not a JWT
 * library: the payload is small and fixed-shape, the only two parties
 * that ever read it are this app and the content-origin deployment (both
 * hold the same secret), and a hand-rolled JWT dependency would buy
 * nothing a raw signed-and-encoded JSON blob doesn't already give here.
 *
 * The content origin holds no Supabase credential at all — this token,
 * plus the separate CONTENT_BRIDGE_SECRET on the server-to-server byte
 * request, is the entire authorization surface on that side.
 */

export interface BridgeTokenPayload {
  packageId: string;
  orgId: string;
  userId: string;
  userName: string;
  scormVersion: "1.2" | "2004";
  entryPoint: string;
  /** Unix ms expiry. */
  exp: number;
}

export class BridgeTokenError extends Error {}

function getSecret(): string {
  const secret = process.env.SCORM_BRIDGE_TOKEN_SECRET;
  if (!secret) {
    throw new BridgeTokenError(
      "SCORM_BRIDGE_TOKEN_SECRET is not configured — the content-isolation bridge cannot mint or verify tokens without it."
    );
  }
  return secret;
}

function sign(payloadB64: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

// Baked into every isolated-player asset URL for the whole session (the
// token lives in the URL path itself, not a refreshable cookie or
// header — see docs/SCORM_CONTENT_ISOLATION_ARCHITECTURE.md), so it has
// to outlive a real course, not just the initial page load. 5 minutes
// (the original value) meant every asset requested after the first few
// minutes of a real, narrated multi-slide package 404'd - confirmed
// 2026-08-24 against a real ~20-slide package with audio, which
// legitimately takes longer than that to get through.
const DEFAULT_TTL_MS = 4 * 60 * 60 * 1000;

export function mintBridgeToken(
  claims: Omit<BridgeTokenPayload, "exp">,
  ttlMs: number = DEFAULT_TTL_MS
): string {
  const payload: BridgeTokenPayload = { ...claims, exp: Date.now() + ttlMs };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = sign(payloadB64, getSecret());
  return `${payloadB64}.${signature}`;
}

/**
 * Returns the verified payload, or null for anything wrong with the
 * token — expired, tampered, malformed, or signed with a different
 * secret. Never throws on a bad token: a bad token is an ordinary,
 * expected outcome (a stale link, a replay attempt), not a server error.
 * It throws only when the secret itself isn't configured, since that's
 * a deployment mistake the caller needs to know about immediately.
 */
export function verifyBridgeToken(token: string): BridgeTokenPayload | null {
  const secret = getSecret();
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, signature] = parts;

  const expected = sign(payloadB64, secret);
  // Equal-length check before timingSafeEqual: it throws on a length
  // mismatch rather than returning false, and a mismatched length is
  // itself just an invalid token, not a crash.
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload: BridgeTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (
    typeof payload.packageId !== "string" ||
    typeof payload.orgId !== "string" ||
    typeof payload.userId !== "string" ||
    typeof payload.userName !== "string" ||
    (payload.scormVersion !== "1.2" && payload.scormVersion !== "2004") ||
    typeof payload.entryPoint !== "string" ||
    typeof payload.exp !== "number"
  ) {
    return null;
  }

  if (payload.exp < Date.now()) return null;

  return payload;
}
