import { withAuth } from "@/lib/api/with-auth";
import { errorResponse, successResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";

/**
 * The org-level compliance/audit trail — activity_log rows for the
 * caller's own org, newest first. No service role needed: activity_log's
 * select policy already permits `org_id = current_org_id()` on the
 * caller's own session client (see supabase/migrations/
 * 20260814143000_rls_and_helpers.sql). Writing to this table still goes
 * through the service role everywhere (lib/activity-log.ts) — this route
 * only reads.
 */

const HEADER = ["Timestamp", "Event", "Actor", "Entity type", "Entity ID"];

function csvEscape(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

interface ActivityRow {
  id: string;
  event_type: string;
  entity_type: string | null;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  is_platform_admin_action: boolean;
  created_at: string;
  actor_id: string | null;
}

export const GET = withAuth(
  async (request, { session }) => {
    if (!session.orgId) return errorResponse("NO_ORG", "You must belong to an organization.", 409);

    const url = new URL(request.url);
    const format = url.searchParams.get("format");
    const eventType = url.searchParams.get("eventType");
    const limit = Math.min(Number(url.searchParams.get("limit")) || 100, 500);

    const supabase = await createClient();
    let query = supabase
      .from("activity_log")
      .select("id, event_type, entity_type, entity_id, metadata, is_platform_admin_action, created_at, actor_id")
      .eq("org_id", session.orgId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (eventType) query = query.eq("event_type", eventType);

    const { data: rows, error } = await query;
    if (error) return errorResponse("QUERY_FAILED", error.message, 500);

    const activity = (rows ?? []) as ActivityRow[];

    if (format === "csv") {
      const actorIds = [...new Set(activity.map((r) => r.actor_id).filter((id): id is string => !!id))];
      const { data: actors } = actorIds.length
        ? await supabase.from("profiles").select("id, full_name, email").in("id", actorIds)
        : { data: [] };
      const actorMap = new Map((actors ?? []).map((a) => [a.id, a.full_name ?? a.email]));

      const body = activity.map((r) => [
        new Date(r.created_at).toLocaleString(),
        r.event_type,
        (r.actor_id && actorMap.get(r.actor_id)) || (r.is_platform_admin_action ? "Platform owner" : "System"),
        r.entity_type ?? "",
        r.entity_id ?? "",
      ]);
      const csv = [HEADER, ...body].map((line) => line.map(csvEscape).join(",")).join("\n");
      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="activity-log-${new Date().toISOString().slice(0, 10)}.csv"`,
        },
      });
    }

    return successResponse({ activity });
  },
  { minRole: "manager" }
);
