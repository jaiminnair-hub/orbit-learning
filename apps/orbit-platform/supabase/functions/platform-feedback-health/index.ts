// Orbit Foundation -> LMS platform-health bridge: the real authorization
// boundary for Platform Control's 360 rollup panel. There is no Foundation
// user session on this request -- the caller is the LMS server itself, not
// a signed-in browser -- so this is gated by a shared bridge secret
// (`PLATFORM_HEALTH_BRIDGE_SECRET`, set as this function's own secret, not
// an LMS-controlled value), then reads via the service role and calls
// `platform_feedback_health()` (see the migration of the same name), which
// returns only banded aggregate counts. No subject/rater identity, no
// ratings, no comments, no per-cycle or per-rater-group breakdown ever
// leaves this function.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BRIDGE_SECRET = Deno.env.get("PLATFORM_HEALTH_BRIDGE_SECRET")?.trim();

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "x-bridge-secret, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

// Manual constant-time compare -- avoids a timing side-channel on the
// bridge secret without pulling in another dependency for one comparison.
function timingSafeEqual(a: string, b: string): boolean {
  const bytesA = new TextEncoder().encode(a);
  const bytesB = new TextEncoder().encode(b);
  if (bytesA.length !== bytesB.length) return false;
  let diff = 0;
  for (let i = 0; i < bytesA.length; i++) diff |= bytesA[i] ^ bytesB[i];
  return diff === 0;
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (request.method !== "GET") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }
  if (!BRIDGE_SECRET) {
    return jsonResponse({ error: "Platform health bridge is not configured." }, 500);
  }

  const provided = request.headers.get("x-bridge-secret") || "";
  if (!provided || !timingSafeEqual(provided, BRIDGE_SECRET)) {
    return jsonResponse({ error: "Unauthorized." }, 401);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data, error } = await supabase.rpc("platform_feedback_health");
  if (error) {
    console.error("platform_feedback_health failed", error);
    return jsonResponse({ error: "Could not compute platform feedback health." }, 500);
  }

  return jsonResponse(data, 200);
});
