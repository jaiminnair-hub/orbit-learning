// Pure, side-effect-free logic for the mint-lms-entry-token function,
// split out of index.ts so it can be unit-tested without Deno.serve()
// binding a port on import. See token.test.ts.

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function signPayload(payloadB64: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64));
  return toBase64Url(new Uint8Array(signature));
}

// Highest-privilege-first: if a person somehow holds more than one lms
// product-role assignment (e.g. both l_and_d_admin and learner), the token
// reports the most privileged one, matching the principle already used
// throughout this integration (never under-report real access, never
// over-grant). A single-role holder — including content_author, which the
// LMS's own orbit_role_map blocks — is reported exactly as held; this
// function's job is to report the truth, not to pre-apply the LMS's
// mapping decision.
export const ROLE_PRIORITY = ["l_and_d_admin", "learning_manager", "instructor", "learner", "content_author"];

export function pickBestRole(roleKeys: string[]): string {
  for (const key of ROLE_PRIORITY) {
    if (roleKeys.includes(key)) return key;
  }
  return roleKeys[0];
}

export interface EntryTokenPayload {
  iss: "orbit-foundation";
  aud: "lms";
  jti: string;
  iat: number;
  exp: number;
  orbitUserId: string;
  orbitOrgId: string;
  email: string;
  orbitProductRoleKey: string;
}

// Byte-for-byte the same shape and signing procedure as lib/orbit/entry-token.ts's
// mintEntryToken() on the LMS side: base64url the JSON payload first, then
// HMAC-SHA256 that base64url *string's* UTF-8 bytes, then base64url the
// signature — the LMS's verifyEntryToken() must reproduce this exactly.
export async function mintEntryToken(
  claims: Omit<EntryTokenPayload, "iss" | "aud" | "iat" | "exp">,
  secret: string,
  ttlMs = 2 * 60 * 1000
): Promise<string> {
  const now = Date.now();
  const payload: EntryTokenPayload = {
    ...claims,
    iss: "orbit-foundation",
    aud: "lms",
    iat: now,
    exp: now + ttlMs,
  };
  const payloadB64 = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await signPayload(payloadB64, secret);
  return `${payloadB64}.${signature}`;
}
