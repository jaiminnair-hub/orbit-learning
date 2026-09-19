import { createAdminClient } from "@/lib/supabase/admin";
import { verifyLaunchToken, tokenFromAuthHeader } from "@/lib/xapi/launch-token";
import { xapiLrsLimiter } from "@/lib/ratelimit";
import { encodeCursor, decodeCursor } from "@/lib/xapi/cursor";

// The real LRS statements endpoint an ingested xAPI/Tin Can package's own
// JavaScript POSTs/PUTs to — the `endpoint` launch parameter
// (app/api/v1/content/xapi/[id]/launch/route.ts) points straight at this
// route. See docs/XAPI_INGEST_ARCHITECTURE.md for the full scope: this
// implements the Statement Resource (POST/PUT/GET) closely enough for
// real authoring-tool output to track completion, deliberately not the
// full xAPI conformance surface (no statement voiding, no complex GET
// filtering beyond registration, no Agent/Activity Profile — only the
// State Resource alongside this, in .../activities/state/route.ts,
// because real exports commonly need it for suspend-data).
//
// Not behind withAuth: the caller is a third-party package's JS running
// with no Supabase session, authenticated instead by the signed launch
// token riding in a real `Authorization: Basic` header (see
// lib/xapi/launch-token.ts for why Basic rather than a custom scheme —
// it's the wire format real xAPI content actually sends verbatim).

const XAPI_VERSION_HEADER = "X-Experience-API-Version";
const COMPLETION_VERBS: Record<string, "completed" | "passed" | "failed"> = {
  "http://adlnet.gov/expapi/verbs/completed": "completed",
  "http://adlnet.gov/expapi/verbs/passed": "passed",
  "http://adlnet.gov/expapi/verbs/failed": "failed",
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Experience-API-Version, If-Match, If-None-Match",
  "Access-Control-Expose-Headers": "X-Experience-API-Version",
};

function xapiJson(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      [XAPI_VERSION_HEADER]: "1.0.3",
      ...CORS_HEADERS,
      ...extraHeaders,
    },
  });
}

function xapiError(status: number, message: string) {
  return xapiJson({ error: message }, status);
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
  const payload = verifyLaunchToken(token);
  if (!payload) return null;
  return payload;
}

interface IncomingStatement {
  id?: unknown;
  verb?: { id?: unknown } & Record<string, unknown>;
  object?: unknown;
  result?: { success?: unknown; score?: { raw?: unknown; scaled?: unknown } } & Record<string, unknown>;
  context?: Record<string, unknown>;
  timestamp?: unknown;
}

async function persistStatements(auth: Auth, raw: IncomingStatement[]): Promise<string[]> {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const ids: string[] = [];
  const rows: Array<Record<string, unknown>> = [];

  for (const s of raw) {
    const id = typeof s.id === "string" ? s.id : crypto.randomUUID();
    ids.push(id);
    rows.push({
      id,
      org_id: auth.orgId,
      // Actor is never taken from the statement body — the package could
      // claim to be anyone. It's always the identity baked into the
      // verified launch token, the same stance the native runtime's
      // xapi_statements writer already takes for its own session actor.
      actor: { objectType: "Agent", account: { name: auth.userId } },
      verb: s.verb ?? null,
      object: s.object ?? null,
      result: s.result ?? null,
      context: s.context ?? null,
      timestamp: typeof s.timestamp === "string" ? s.timestamp : now,
      source: "external",
      registration: auth.registration,
    });
  }

  const { error } = await admin.from("xapi_statements").insert(rows);
  if (error) throw new Error(error.message);

  // Derive xapi_progress from whichever completion-shaped verb showed up
  // in this batch — last one wins if a batch somehow carries more than
  // one, which real content never does in a single call.
  for (const s of raw) {
    const verbId = typeof s.verb?.id === "string" ? s.verb.id : null;
    const status = verbId ? COMPLETION_VERBS[verbId] : undefined;
    if (!status) continue;

    const scoreRaw =
      typeof s.result?.score?.raw === "number"
        ? s.result.score.raw
        : typeof s.result?.score?.scaled === "number"
          ? s.result.score.scaled * 100
          : null;

    await admin
      .from("xapi_progress")
      .update({ lesson_status: status, score_raw: scoreRaw, completed_at: now })
      .eq("user_id", auth.userId)
      .eq("xapi_package_id", auth.packageId)
      .eq("registration", auth.registration);
  }

  return ids;
}

export async function POST(request: Request) {
  const auth = authenticate(request);
  if (!auth) return xapiError(401, "Invalid or expired launch credential.");

  const limited = await xapiLrsLimiter.limit(auth.registration);
  if (!limited.success) return xapiError(429, "Too many requests.");

  const body = await request.json().catch(() => null);
  if (body === null) return xapiError(400, "Request body must be valid JSON.");
  const raw: IncomingStatement[] = Array.isArray(body) ? body : [body];
  if (raw.length === 0) return xapiError(400, "At least one statement is required.");

  try {
    const ids = await persistStatements(auth, raw);
    return xapiJson(ids, 200);
  } catch (err) {
    return xapiError(500, err instanceof Error ? err.message : "Could not store statement(s).");
  }
}

// The xAPI spec's PUT form: exactly one statement, its id given as the
// `statementId` query parameter rather than in the body. Real content
// uses this when it generates the statement id itself (client-side, for
// offline queuing) rather than letting the LRS assign one via POST.
export async function PUT(request: Request) {
  const auth = authenticate(request);
  if (!auth) return xapiError(401, "Invalid or expired launch credential.");

  const limited = await xapiLrsLimiter.limit(auth.registration);
  if (!limited.success) return xapiError(429, "Too many requests.");

  const statementId = new URL(request.url).searchParams.get("statementId");
  if (!statementId) return xapiError(400, "PUT requires a statementId query parameter.");

  const body = await request.json().catch(() => null);
  if (body === null) return xapiError(400, "Request body must be valid JSON.");

  try {
    await persistStatements(auth, [{ ...body, id: statementId }]);
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  } catch (err) {
    return xapiError(500, err instanceof Error ? err.message : "Could not store statement.");
  }
}

// GET always stays scoped to the caller's own registration — this
// credential never gets to read another learner's statements, whatever
// filters are applied on top (a broader, org-wide query needs a real
// Supabase session instead: see GET /api/v1/reports/xapi-statements).
// Real content essentially never calls this (it's the reporting side of
// the API), but a conformant client can, so it supports the query params
// such a client actually sends: verb, activity, since, until, limit,
// ascending, and a real `more` continuation token (opaque, keyset-based
// on stored_at+id rather than OFFSET, so it stays correct under
// concurrent inserts between pages).
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 100;

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth) return xapiError(401, "Invalid or expired launch credential.");

  const url = new URL(request.url);
  const verb = url.searchParams.get("verb");
  const activity = url.searchParams.get("activity");
  const since = url.searchParams.get("since");
  const until = url.searchParams.get("until");
  const ascending = url.searchParams.get("ascending") === "true";
  const cursorParam = url.searchParams.get("more");
  const limit = Math.min(Number(url.searchParams.get("limit")) || DEFAULT_LIMIT, MAX_LIMIT);

  const admin = createAdminClient();
  let query = admin
    .from("xapi_statements")
    .select("id, actor, verb, object, result, context, timestamp, stored_at")
    .eq("org_id", auth.orgId)
    .eq("registration", auth.registration);

  if (verb) query = query.eq("verb->>id", verb);
  if (activity) query = query.eq("object->>id", activity);
  if (since) query = query.gte("timestamp", since);
  if (until) query = query.lte("timestamp", until);

  const cursor = cursorParam ? decodeCursor(cursorParam) : null;
  if (cursor) {
    // Keyset pagination on the same (stored_at, id) order the results are
    // returned in — strictly-less/greater-than the last row's position,
    // not an offset, so a statement inserted mid-pagination can't shift
    // later pages.
    if (ascending) query = query.or(`stored_at.gt.${cursor.storedAt},and(stored_at.eq.${cursor.storedAt},id.gt.${cursor.id})`);
    else query = query.or(`stored_at.lt.${cursor.storedAt},and(stored_at.eq.${cursor.storedAt},id.lt.${cursor.id})`);
  }

  query = query.order("stored_at", { ascending }).order("id", { ascending }).limit(limit);

  const { data, error } = await query;
  if (error) return xapiError(500, error.message);

  const statements = data ?? [];
  const last = statements[statements.length - 1];
  const more = last && statements.length === limit
    ? `/api/v1/xapi-lrs/statements?${new URLSearchParams({
        ...(verb ? { verb } : {}),
        ...(activity ? { activity } : {}),
        ...(since ? { since } : {}),
        ...(until ? { until } : {}),
        ascending: String(ascending),
        limit: String(limit),
        more: encodeCursor(last.stored_at, last.id),
      })}`
    : "";

  return xapiJson({ statements, more });
}
