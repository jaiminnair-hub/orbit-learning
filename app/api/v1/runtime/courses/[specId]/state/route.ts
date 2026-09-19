import { withAuth } from "@/lib/api/with-auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";

type Ctx = { params: Promise<{ specId: string }> };

const STATE_COLUMNS = "current_page_id, variables, block_states, spec_version, completed_at";

// Resume state — docs/PHASE3_API_EVENTS.md §5. No minRole: every learner
// needs their own row. RLS on course_runtime_state already restricts
// reads/writes to the caller's own row (managers+ may additionally read,
// never write, another learner's) — this route adds no looser access than
// that, it just gives the runtime a stable place to call.
//
// State is looked up (and written) against the specification's CURRENT
// version, not a version the client claims — a learner resuming after a
// republish gets a fresh state row for the new version rather than being
// fed state addressed against a structure that no longer matches.
export const GET = withAuth<Ctx>(async (_request, { session, params }) => {
  const { specId } = await params;
  const supabase = await createClient();

  const { data: spec, error: specError } = await supabase
    .from("course_specifications")
    .select("id, org_id, version")
    .eq("id", specId)
    .single();
  if (specError || !spec || spec.org_id !== session.orgId) {
    return errorResponse("NOT_FOUND", "No such course specification.", 404);
  }

  const { data: row, error } = await supabase
    .from("course_runtime_state")
    .select(STATE_COLUMNS)
    .eq("org_id", session.orgId)
    .eq("user_id", session.userId)
    .eq("course_specification_id", specId)
    .eq("spec_version", spec.version)
    .maybeSingle();

  if (error) return errorResponse("QUERY_FAILED", error.message, 500);

  return successResponse({ state: row ?? null, specVersion: spec.version });
});

// The wire body mirrors the DB row shape 1:1 (current_page_id, variables,
// block_states, completed) — the client's lib/runtime/types.ts
// toPersisted()/fromPersisted() round-trip through exactly this shape, so
// there is no separate camelCase translation layer to keep in sync.
export const PUT = withAuth<Ctx>(async (request, { session, params }) => {
  const { specId } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return errorResponse("INVALID_INPUT", "A state body is required.", 400);
  }

  const currentPageId = typeof body.current_page_id === "string" ? body.current_page_id : null;
  const variables = body.variables && typeof body.variables === "object" ? body.variables : {};
  const blockStates = body.block_states && typeof body.block_states === "object" ? body.block_states : {};
  const completed = body.completed === true;

  const supabase = await createClient();
  const { data: spec, error: specError } = await supabase
    .from("course_specifications")
    .select("id, org_id, version")
    .eq("id", specId)
    .single();
  if (specError || !spec || spec.org_id !== session.orgId) {
    return errorResponse("NOT_FOUND", "No such course specification.", 404);
  }

  const payload: Record<string, unknown> = {
    org_id: session.orgId,
    user_id: session.userId,
    course_specification_id: specId,
    spec_version: spec.version,
    current_page_id: currentPageId,
    variables,
    block_states: blockStates,
  };
  // Completion is monotonic: only ever stamped, never cleared by omission —
  // a stale client PUT without `completed: true` must not un-complete a
  // learner who already finished.
  if (completed) payload.completed_at = new Date().toISOString();

  const { data: saved, error } = await supabase
    .from("course_runtime_state")
    .upsert(payload, { onConflict: "org_id,user_id,course_specification_id,spec_version" })
    .select(STATE_COLUMNS)
    .single();

  if (error) return errorResponse("SAVE_FAILED", error.message, 500);
  return successResponse({ state: saved });
});

/**
 * Beacon alias for PUT.
 *
 * When a learner leaves mid-course the player has to get their position out
 * before the page is torn down, and `navigator.sendBeacon` is the only
 * transport the browser promises to deliver after that point — `fetch` with
 * `keepalive` is documented to survive unload but was observed being dropped
 * here under exactly the condition it exists for (request issued, no
 * response, nothing written). sendBeacon can only issue POST, so POST is
 * accepted as an alias rather than reshaping resume around a transport
 * limitation. The semantics are identical: same handler, same idempotent
 * upsert, same RLS.
 */
export const POST = PUT;
