import { createAdminClient } from "@/lib/supabase/admin";
import { verifyLaunchToken, tokenFromAuthHeader } from "@/lib/xapi/launch-token";
import { xapiLrsLimiter } from "@/lib/ratelimit";

// The xAPI State Resource — real authoring-tool exports (Storyline's Tin
// Can publish in particular) use this to persist suspend-data/bookmark
// position, not a statement. Without it, packages that depend on the
// State API to resume would appear to work (statements still post fine)
// but silently restart from the beginning every relaunch. See
// docs/XAPI_INGEST_ARCHITECTURE.md and the migration
// (20260903070000_xapi_packages.sql) for xapi_activity_state's shape.
//
// Same authentication as .../statements/route.ts: a launch-token Basic
// credential, no Supabase session. Every document is scoped to the
// caller's own (package, registration) — this credential can never read
// or overwrite another learner's state.

const XAPI_VERSION_HEADER = "X-Experience-API-Version";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Experience-API-Version, If-Match, If-None-Match",
  "Access-Control-Expose-Headers": "X-Experience-API-Version",
};

function xapiError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", [XAPI_VERSION_HEADER]: "1.0.3", ...CORS_HEADERS },
  });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

interface Auth {
  packageId: string;
  orgId: string;
  userId: string;
  registration: string;
}

function authenticate(request: Request): Auth | null {
  const token = tokenFromAuthHeader(request.headers.get("authorization"));
  if (!token) return null;
  return verifyLaunchToken(token);
}

// activityId/registration are read from the query string per the xAPI
// State Resource spec, but never trusted for authorization: registration
// always comes from the verified token, never the query string, so a
// package can't address another attempt's state by guessing its
// registration id in the URL.
export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth) return xapiError(401, "Invalid or expired launch credential.");

  const url = new URL(request.url);
  const activityId = url.searchParams.get("activityId");
  const stateId = url.searchParams.get("stateId");
  if (!activityId) return xapiError(400, "activityId is required.");

  const admin = createAdminClient();

  if (!stateId) {
    // List form: every stateId stored for this activity + registration.
    const { data, error } = await admin
      .from("xapi_activity_state")
      .select("state_id")
      .eq("xapi_package_id", auth.packageId)
      .eq("registration", auth.registration)
      .eq("activity_id", activityId);
    if (error) return xapiError(500, error.message);
    return new Response(JSON.stringify((data ?? []).map((r) => r.state_id)), {
      status: 200,
      headers: { "Content-Type": "application/json", [XAPI_VERSION_HEADER]: "1.0.3", ...CORS_HEADERS },
    });
  }

  const { data, error } = await admin
    .from("xapi_activity_state")
    .select("content, content_type, updated_at")
    .eq("xapi_package_id", auth.packageId)
    .eq("registration", auth.registration)
    .eq("activity_id", activityId)
    .eq("state_id", stateId)
    .maybeSingle();

  if (error) return xapiError(500, error.message);
  if (!data) return new Response(null, { status: 404, headers: CORS_HEADERS });

  return new Response(data.content, {
    status: 200,
    headers: {
      "Content-Type": data.content_type,
      "Last-Modified": data.updated_at,
      [XAPI_VERSION_HEADER]: "1.0.3",
      ...CORS_HEADERS,
    },
  });
}

async function upsertState(auth: Auth, request: Request): Promise<Response> {
  const limited = await xapiLrsLimiter.limit(auth.registration);
  if (!limited.success) return xapiError(429, "Too many requests.");

  const url = new URL(request.url);
  const activityId = url.searchParams.get("activityId");
  const stateId = url.searchParams.get("stateId");
  if (!activityId || !stateId) return xapiError(400, "activityId and stateId are required.");

  const content = await request.text();
  const contentType = request.headers.get("content-type") || "application/octet-stream";

  const admin = createAdminClient();
  const { error } = await admin.from("xapi_activity_state").upsert(
    {
      org_id: auth.orgId,
      xapi_package_id: auth.packageId,
      registration: auth.registration,
      activity_id: activityId,
      state_id: stateId,
      content,
      content_type: contentType,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "xapi_package_id,registration,activity_id,state_id" }
  );

  if (error) return xapiError(500, error.message);
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

// PUT replaces the document; POST is the spec's "merge" form for JSON
// documents. Real content overwhelmingly calls PUT with a full document
// each save, so treating POST identically (a full replace) is a
// deliberate, documented simplification rather than implementing the
// JSON-merge-patch semantics the spec allows for POST — no ingested
// package exercised so far relies on partial merge.
export async function PUT(request: Request) {
  const auth = authenticate(request);
  if (!auth) return xapiError(401, "Invalid or expired launch credential.");
  return upsertState(auth, request);
}

export async function POST(request: Request) {
  const auth = authenticate(request);
  if (!auth) return xapiError(401, "Invalid or expired launch credential.");
  return upsertState(auth, request);
}

export async function DELETE(request: Request) {
  const auth = authenticate(request);
  if (!auth) return xapiError(401, "Invalid or expired launch credential.");

  const url = new URL(request.url);
  const activityId = url.searchParams.get("activityId");
  const stateId = url.searchParams.get("stateId");
  if (!activityId) return xapiError(400, "activityId is required.");

  const admin = createAdminClient();
  let query = admin
    .from("xapi_activity_state")
    .delete()
    .eq("xapi_package_id", auth.packageId)
    .eq("registration", auth.registration)
    .eq("activity_id", activityId);
  if (stateId) query = query.eq("state_id", stateId);

  const { error } = await query;
  if (error) return xapiError(500, error.message);
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
