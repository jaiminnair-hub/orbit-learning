// Orbit -> LMS entry bridge: the real authorization boundary for the
// "Open Learning" product tile. See docs/ORBIT_LMS_INTEGRATION_PLAN.md on
// the LMS side (lib/orbit/entry-token.ts, app/api/orbit/entry/route.ts) —
// this function mints exactly the token payload that route verifies.
//
// Everything the caller's browser sends is a hint, never a fact. The org
// id in the request body is used only to short-circuit an obviously wrong
// request; the user, their active organization, their entitlement, and
// their role are all re-derived here from the caller's own JWT and the
// database, independently of any client-side check already run in
// orbit-console.js (that check is UI/UX only).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { mintEntryToken, pickBestRole } from "./token.ts";

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

  // RLS-scoped as the caller — every query below runs under their own
  // identity, never a service role, so this cannot be tricked into acting
  // on someone else's behalf.
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

  // The real active organization, derived server-side — never the
  // organizationId a client might send in the request body. That value,
  // if present, is not read at all below.
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
