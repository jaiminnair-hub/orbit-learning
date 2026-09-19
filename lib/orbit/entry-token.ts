import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signs and verifies the short-lived token that authorizes the Orbit ->
 * LMS entry bridge (docs/ORBIT_LMS_INTEGRATION_PLAN.md §5). Mirrors
 * lib/scorm/bridge-token.ts's proven shape — plain HMAC via node:crypto,
 * not a JWT library, for the same reason: the payload is small and
 * fixed-shape, and the only two parties that ever read it (Orbit
 * Foundation, this app) hold the same secret.
 *
 * This token authorizes something more consequential than the SCORM
 * bridge does — a real one-time sign-in link for the mapped user — so it
 * carries standard anti-replay claims (iss/aud/jti) on top of exp, and
 * verification alone is not the full guard: the caller (app/api/orbit/
 * entry/route.ts) must also record the jti in orbit_entry_token_uses
 * before doing anything else, since uniqueness there, not this function,
 * is what makes a replay fail atomically.
 */

const ISSUER = "orbit-foundation";
const AUDIENCE = "lms";

export interface EntryTokenPayload {
  iss: typeof ISSUER;
  aud: typeof AUDIENCE;
  /** Unique per token; the replay guard's key. */
  jti: string;
  /** Unix ms issued-at. */
  iat: number;
  /** Unix ms expiry. */
  exp: number;
  orbitUserId: string;
  orbitOrgId: string;
  email: string;
  /** Orbit's lms product role_key (e.g. "learner", "content_author") — looked up in orbit_role_map, never trusted as an LMS role directly. */
  orbitProductRoleKey: string;
}

export class EntryTokenError extends Error {}

function getSecret(): string {
  const secret = process.env.ORBIT_ENTRY_TOKEN_SECRET;
  if (!secret) {
    throw new EntryTokenError(
      "ORBIT_ENTRY_TOKEN_SECRET is not configured — the Orbit entry bridge cannot mint or verify tokens without it."
    );
  }
  return secret;
}

function sign(payloadB64: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

const DEFAULT_TTL_MS = 2 * 60 * 1000;

export function mintEntryToken(
  claims: Omit<EntryTokenPayload, "iss" | "aud" | "iat" | "exp">,
  ttlMs: number = DEFAULT_TTL_MS
): string {
  const now = Date.now();
  const payload: EntryTokenPayload = {
    ...claims,
    iss: ISSUER,
    aud: AUDIENCE,
    iat: now,
    exp: now + ttlMs,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = sign(payloadB64, getSecret());
  return `${payloadB64}.${signature}`;
}

/**
 * Returns the verified payload, or null for anything wrong with the
 * token — expired, tampered, malformed, wrong issuer/audience, or signed
 * with a different secret. Never throws on a bad token: a bad token is an
 * ordinary, expected outcome (a stale or forged request), not a server
 * error. Throws only when the secret itself isn't configured.
 *
 * Deliberately does NOT check jti uniqueness — that requires a database
 * round trip and belongs to the caller, which must insert the jti into
 * orbit_entry_token_uses (and reject on conflict) before doing anything
 * else with a token this function accepts.
 */
export function verifyEntryToken(token: string): EntryTokenPayload | null {
  const secret = getSecret();
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, signature] = parts;

  const expected = sign(payloadB64, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload: EntryTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (
    payload.iss !== ISSUER ||
    payload.aud !== AUDIENCE ||
    typeof payload.jti !== "string" ||
    typeof payload.iat !== "number" ||
    typeof payload.exp !== "number" ||
    typeof payload.orbitUserId !== "string" ||
    typeof payload.orbitOrgId !== "string" ||
    typeof payload.email !== "string" ||
    typeof payload.orbitProductRoleKey !== "string"
  ) {
    return null;
  }

  if (payload.exp < Date.now()) return null;

  return payload;
}
