import { withAuth } from "@/lib/api/with-auth";
import { errorResponse, successResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";
import { encodeCursor, decodeCursor } from "@/lib/xapi/cursor";

/**
 * The other half of "a full xAPI LRS query API": the launch-token-scoped
 * Statement Resource (app/api/v1/xapi-lrs/statements/route.ts) can only
 * ever see one learner's one registration — real xAPI content credentials
 * are deliberately that narrow. An org admin reviewing xAPI activity
 * org-wide had no path to that at all before this route. Reuses
 * xapi_statements' own RLS (`org_id = current_org_id() and
 * has_role('manager')`) on the caller's own session client — no service
 * role needed, matching the read-path convention used everywhere else in
 * this codebase.
 */
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 100;

export const GET = withAuth(
  async (request, { session }) => {
    if (!session.orgId) return errorResponse("NO_ORG", "You must belong to an organization.", 409);

    const url = new URL(request.url);
    const verb = url.searchParams.get("verb");
    const activity = url.searchParams.get("activity");
    const registration = url.searchParams.get("registration");
    const since = url.searchParams.get("since");
    const until = url.searchParams.get("until");
    const ascending = url.searchParams.get("ascending") === "true";
    const cursorParam = url.searchParams.get("more");
    const limit = Math.min(Number(url.searchParams.get("limit")) || DEFAULT_LIMIT, MAX_LIMIT);

    const supabase = await createClient();
    let query = supabase
      .from("xapi_statements")
      .select("id, actor, verb, object, result, context, timestamp, stored_at, registration")
      .eq("org_id", session.orgId);

    if (verb) query = query.eq("verb->>id", verb);
    if (activity) query = query.eq("object->>id", activity);
    if (registration) query = query.eq("registration", registration);
    if (since) query = query.gte("timestamp", since);
    if (until) query = query.lte("timestamp", until);

    const cursor = cursorParam ? decodeCursor(cursorParam) : null;
    if (cursor) {
      if (ascending) query = query.or(`stored_at.gt.${cursor.storedAt},and(stored_at.eq.${cursor.storedAt},id.gt.${cursor.id})`);
      else query = query.or(`stored_at.lt.${cursor.storedAt},and(stored_at.eq.${cursor.storedAt},id.lt.${cursor.id})`);
    }

    query = query.order("stored_at", { ascending }).order("id", { ascending }).limit(limit);

    const { data, error } = await query;
    if (error) return errorResponse("QUERY_FAILED", error.message, 500);

    const statements = data ?? [];
    const last = statements[statements.length - 1];
    const more = last && statements.length === limit
      ? `/api/v1/reports/xapi-statements?${new URLSearchParams({
          ...(verb ? { verb } : {}),
          ...(activity ? { activity } : {}),
          ...(registration ? { registration } : {}),
          ...(since ? { since } : {}),
          ...(until ? { until } : {}),
          ascending: String(ascending),
          limit: String(limit),
          more: encodeCursor(last.stored_at, last.id),
        })}`
      : "";

    return successResponse({ statements, more });
  },
  { minRole: "manager" }
);
