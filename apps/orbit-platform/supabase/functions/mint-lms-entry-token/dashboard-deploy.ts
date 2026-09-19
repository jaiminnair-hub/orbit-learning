// Single-file merge of index.ts + token.ts, for pasting directly into the
// Supabase Dashboard's Edge Function editor (which deploys via the browser
// session, bypassing the currently-broken CLI/API-token path).
//
// This is byte-for-byte the same logic as index.ts + token.ts in this same
// folder — those two files remain the canonical, tested source (see
// token.test.ts) for whenever normal `supabase functions deploy` works
// again. Keep both versions in sync if either changes.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const ENTRY_TOKEN_SECRET = Deno.env.get("ORBIT_ENTRY_TOKEN_SECRET");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signPayload(payloadB64: string, secret: string): Promise<string> {
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

const ROLE_PRIORITY = ["l_and_d_admin", "learning_manager", "instructor", "learner", "content_author"];

function pickBestRole(roleKeys: string[]): string {
  for (const key of ROLE_PRIORITY) {
    if (roleKeys.includes(key)) return key;
  }
  return roleKeys[0];
}

interface EntryTokenPayload {
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

async function mintEntryToken(
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

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }
  if (!ENTRY_TOKEN_SECRET) {
    return jsonResponse({ error: "Entry bridge is not configured." }, 500);
  }

  const authHeader = request.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse({ error: "Sign in is required." }, 401);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) {
    return jsonResponse({ error: "Sign in is required." }, 401);
  }
  const user = userData.user;
  if (!user.email) {
    return jsonResponse({ error: "Your Orbit account has no email on file." }, 400);
  }

  const { data: activeOrgId, error: orgError } = await supabase.rpc("current_organization_id");
  if (orgError || !activeOrgId) {
    return jsonResponse({ error: "No active Orbit organization." }, 403);
  }

  const { data: entitlementRows, error: entitlementError } = await supabase
    .from("organization_product_entitlements")
    .select("status")
    .eq("organization_id", activeOrgId)
    .eq("product_key", "lms")
    .in("status", ["trial", "active"]);
  if (entitlementError || !entitlementRows?.length) {
    return jsonResponse({ error: "This organization does not have Learning enabled." }, 403);
  }

  const nowIso = new Date().toISOString();
  const { data: roleRows, error: roleError } = await supabase
    .from("product_role_assignments")
    .select("role_key, expires_at")
    .eq("organization_id", activeOrgId)
    .eq("user_id", user.id)
    .eq("product_key", "lms")
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`);
  if (roleError || !roleRows?.length) {
    return jsonResponse({ error: "You don't have a Learning role in this organization." }, 403);
  }

  const orbitProductRoleKey = pickBestRole(roleRows.map((row: { role_key: string }) => row.role_key));

  const token = await mintEntryToken(
    { jti: crypto.randomUUID(), orbitUserId: user.id, orbitOrgId: activeOrgId, email: user.email, orbitProductRoleKey },
    ENTRY_TOKEN_SECRET
  );

  return jsonResponse({ token }, 200);
});
