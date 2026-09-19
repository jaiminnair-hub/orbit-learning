/**
 * Opaque keyset-pagination cursor shared by both xAPI statement query
 * surfaces (the launch-token-authenticated Statement Resource and the
 * org-admin-facing reports endpoint) — encodes a (stored_at, id) position
 * rather than an offset, so a page fetched mid-pagination can't be shifted
 * by statements inserted between requests.
 */
export function encodeCursor(storedAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ storedAt, id })).toString("base64url");
}

export function decodeCursor(token: string): { storedAt: string; id: string } | null {
  try {
    const parsed = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
    if (typeof parsed.storedAt === "string" && typeof parsed.id === "string") return parsed;
  } catch {
    // Malformed/foreign token — treated as no cursor rather than a hard error.
  }
  return null;
}
