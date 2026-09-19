import { withAuth } from "@/lib/api/with-auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";

const MAX_STATEMENTS_PER_REQUEST = 25;

interface IncomingStatement {
  id?: unknown;
  verb?: unknown;
  object?: unknown;
  result?: unknown;
  context?: { registration?: unknown } & Record<string, unknown>;
  timestamp?: unknown;
}

// Emits xAPI statements from the runtime — docs/PHASE3_API_EVENTS.md §5/§7.2.
// No minRole: the native player runs as the learner, so any authenticated
// org member may emit their own statements — exactly what
// xapi_statements_insert's RLS policy already allows. This route adds no
// looser access, it just gives the runtime a stable place to POST to and
// validates the statement shape before it reaches the table.
export const POST = withAuth(async (request, { session }) => {
  const body = await request.json().catch(() => null);
  const raw: unknown[] = Array.isArray(body?.statements) ? body.statements : body ? [body] : [];

  if (!raw.length) return errorResponse("INVALID_INPUT", "At least one statement is required.", 400);
  if (raw.length > MAX_STATEMENTS_PER_REQUEST) {
    return errorResponse("INVALID_INPUT", `At most ${MAX_STATEMENTS_PER_REQUEST} statements per request.`, 400);
  }

  // `actor` is intentionally not read from the client: it is always the
  // authenticated caller, never client-asserted, so a learner's session
  // can never write telemetry under another identity.
  const actor = { objectType: "Agent", mbox: `mailto:${session.email}` };

  const rows: Array<Record<string, unknown>> = [];
  for (const candidate of raw) {
    const s = candidate as IncomingStatement;
    if (typeof s.id !== "string" || !s.verb || !s.object || typeof s.timestamp !== "string") {
      return errorResponse("INVALID_INPUT", "Each statement needs id, verb, object and timestamp.", 400);
    }
    rows.push({
      id: s.id,
      org_id: session.orgId,
      actor,
      verb: s.verb,
      object: s.object,
      result: s.result ?? null,
      context: s.context ?? null,
      timestamp: s.timestamp,
      source: "native_player",
      registration: typeof s.context?.registration === "string" ? s.context.registration : null,
    });
  }

  const supabase = await createClient();
  const { error } = await supabase.from("xapi_statements").insert(rows);
  if (error) return errorResponse("SAVE_FAILED", error.message, 500);

  return successResponse({ stored: rows.length }, 201);
});
