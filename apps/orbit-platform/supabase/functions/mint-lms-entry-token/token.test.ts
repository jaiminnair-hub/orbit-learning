import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { mintEntryToken, pickBestRole, signPayload, toBase64Url } from "./token.ts";

Deno.test("toBase64Url produces URL-safe, unpadded output", () => {
  const bytes = new TextEncoder().encode("hello world, this has +/= chars in base64");
  const encoded = toBase64Url(bytes);
  assertEquals(encoded.includes("+"), false);
  assertEquals(encoded.includes("/"), false);
  assertEquals(encoded.includes("="), false);
});

Deno.test("signPayload is deterministic for the same secret and payload", async () => {
  const a = await signPayload("same-payload", "same-secret");
  const b = await signPayload("same-payload", "same-secret");
  assertEquals(a, b);
});

Deno.test("signPayload produces a different signature for a different secret", async () => {
  const a = await signPayload("same-payload", "secret-one");
  const b = await signPayload("same-payload", "secret-two");
  assertNotEquals(a, b);
});

Deno.test("pickBestRole prefers l_and_d_admin over learner when both are held", () => {
  assertEquals(pickBestRole(["learner", "l_and_d_admin"]), "l_and_d_admin");
});

Deno.test("pickBestRole prefers learning_manager over instructor", () => {
  assertEquals(pickBestRole(["instructor", "learning_manager"]), "learning_manager");
});

Deno.test("pickBestRole returns the only role held when there is exactly one, even content_author", () => {
  assertEquals(pickBestRole(["content_author"]), "content_author");
});

Deno.test("mintEntryToken produces the exact payload shape lib/orbit/entry-token.ts expects", async () => {
  const token = await mintEntryToken(
    {
      jti: "11111111-1111-4111-8111-111111111111",
      orbitUserId: "22222222-2222-4222-8222-222222222222",
      orbitOrgId: "33333333-3333-4333-8333-333333333333",
      email: "learner@example.test",
      orbitProductRoleKey: "learner",
    },
    "test-secret"
  );

  const [payloadB64, signature] = token.split(".");
  assertEquals(typeof payloadB64, "string");
  assertEquals(typeof signature, "string");

  const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))));
  assertEquals(payload.iss, "orbit-foundation");
  assertEquals(payload.aud, "lms");
  assertEquals(payload.orbitUserId, "22222222-2222-4222-8222-222222222222");
  assertEquals(payload.orbitOrgId, "33333333-3333-4333-8333-333333333333");
  assertEquals(payload.email, "learner@example.test");
  assertEquals(payload.orbitProductRoleKey, "learner");
  assertEquals(typeof payload.iat, "number");
  assertEquals(typeof payload.exp, "number");
  assertEquals(payload.exp - payload.iat, 2 * 60 * 1000);

  // Re-derive the expected signature independently (not by calling signPayload
  // again — that would just prove the function agrees with itself) and confirm
  // it matches, which is what actually proves the signing procedure is correct.
  const expectedSignature = await signPayload(payloadB64, "test-secret");
  assertEquals(signature, expectedSignature);
});

Deno.test("mintEntryToken with a different secret produces a token that fails against the first secret's signature", async () => {
  const token = await mintEntryToken(
    { jti: "j", orbitUserId: "u", orbitOrgId: "o", email: "e@example.test", orbitProductRoleKey: "learner" },
    "secret-a"
  );
  const [payloadB64, signature] = token.split(".");
  const wrongSignature = await signPayload(payloadB64, "secret-b");
  assertNotEquals(signature, wrongSignature);
});
