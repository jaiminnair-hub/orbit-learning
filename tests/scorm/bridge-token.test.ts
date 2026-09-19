import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mintBridgeToken, verifyBridgeToken, BridgeTokenError } from "@/lib/scorm/bridge-token";

/** Signs a payload the same way the module itself does, so a test can
 * construct a validly-*signed* but wrong-*shaped* token — the only way
 * to actually exercise the shape check rather than fail earlier on the
 * signature check. */
function signRaw(payload: unknown): string {
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", process.env.SCORM_BRIDGE_TOKEN_SECRET!)
    .update(payloadB64)
    .digest("base64url");
  return `${payloadB64}.${signature}`;
}

/**
 * The entire authorization surface the SCORM content-isolation bridge
 * relies on (docs/SCORM_CONTENT_ISOLATION_ARCHITECTURE.md) — the content
 * origin holds no Supabase credential, so a bug here is a bug in the
 * whole boundary, not one feature of it.
 */

const ORIGINAL_SECRET = process.env.SCORM_BRIDGE_TOKEN_SECRET;

beforeEach(() => {
  process.env.SCORM_BRIDGE_TOKEN_SECRET = "test-secret-do-not-use-in-prod";
});

afterEach(() => {
  process.env.SCORM_BRIDGE_TOKEN_SECRET = ORIGINAL_SECRET;
});

const claims = {
  packageId: "pkg-1",
  orgId: "org-1",
  userId: "user-1",
  userName: "Ada Lovelace",
  scormVersion: "1.2" as const,
  entryPoint: "index.html",
};

describe("mint + verify round trip", () => {
  it("verifies a freshly minted token and recovers the exact claims", () => {
    const token = mintBridgeToken(claims);
    const payload = verifyBridgeToken(token);
    expect(payload).not.toBeNull();
    expect(payload).toMatchObject(claims);
    expect(payload!.exp).toBeGreaterThan(Date.now());
  });

  it("rejects a token past its expiry", () => {
    const token = mintBridgeToken(claims, -1);
    expect(verifyBridgeToken(token)).toBeNull();
  });

  it("respects a custom TTL", () => {
    const token = mintBridgeToken(claims, 10_000);
    const payload = verifyBridgeToken(token)!;
    expect(payload.exp).toBeLessThanOrEqual(Date.now() + 10_000);
    expect(payload.exp).toBeGreaterThan(Date.now() + 9_000);
  });
});

describe("tamper resistance", () => {
  it("rejects a token signed with a different secret", () => {
    const token = mintBridgeToken(claims);
    process.env.SCORM_BRIDGE_TOKEN_SECRET = "a-different-secret";
    expect(verifyBridgeToken(token)).toBeNull();
  });

  it("rejects a token whose payload was edited after signing", () => {
    const token = mintBridgeToken(claims);
    const [payloadB64, signature] = token.split(".");
    const forged = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
    forged.orgId = "someone-elses-org";
    const forgedB64 = Buffer.from(JSON.stringify(forged)).toString("base64url");
    expect(verifyBridgeToken(`${forgedB64}.${signature}`)).toBeNull();
  });

  it("rejects a signature of the wrong length rather than throwing", () => {
    const token = mintBridgeToken(claims);
    const [payloadB64] = token.split(".");
    expect(verifyBridgeToken(`${payloadB64}.short`)).toBeNull();
  });

  it("rejects malformed input without throwing", () => {
    expect(verifyBridgeToken("")).toBeNull();
    expect(verifyBridgeToken("not-a-token")).toBeNull();
    expect(verifyBridgeToken("a.b.c")).toBeNull();
    expect(verifyBridgeToken("bm90LWpzb24=.somesignature")).toBeNull();
  });

  it("rejects a validly-signed payload missing a required claim", () => {
    const token = signRaw({ packageId: "pkg-1", orgId: "org-1", exp: Date.now() + 60_000 }); // no userId
    expect(verifyBridgeToken(token)).toBeNull();
  });

  it("rejects a scormVersion outside the two real values", () => {
    const token = signRaw({ ...claims, scormVersion: "1.0", exp: Date.now() + 60_000 });
    expect(verifyBridgeToken(token)).toBeNull();
  });
});

describe("misconfiguration", () => {
  it("throws, rather than silently minting an unsigned token, when the secret is missing", () => {
    delete process.env.SCORM_BRIDGE_TOKEN_SECRET;
    expect(() => mintBridgeToken(claims)).toThrow(BridgeTokenError);
  });
});
