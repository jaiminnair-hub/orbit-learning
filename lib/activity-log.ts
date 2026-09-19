import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A thin wrapper around the same `activity_log` insert shape every caller
 * already used inline (see e.g. app/api/v1/platform-admin/orgs/route.ts) —
 * factored out once this pattern needed to repeat across every org-level
 * mutating route for compliance reporting, not before. Always takes an
 * already-constructed admin (service-role) client rather than building its
 * own, since callers that already hold one (most do, for the mutation
 * itself) shouldn't pay for a second.
 *
 * Never throws: a logging failure must not fail the request whose real
 * effect already succeeded. Errors are swallowed with a console.error,
 * matching the existing precedent in lib/certificates/issue.ts.
 */
export async function logActivity(
  admin: SupabaseClient,
  entry: {
    orgId: string | null;
    actorId: string | null;
    eventType: string;
    entityType?: string;
    entityId?: string;
    metadata?: Record<string, unknown>;
    isPlatformAdminAction?: boolean;
  }
): Promise<void> {
  const { error } = await admin.from("activity_log").insert({
    org_id: entry.orgId,
    actor_id: entry.actorId,
    event_type: entry.eventType,
    entity_type: entry.entityType ?? null,
    entity_id: entry.entityId ?? null,
    metadata: entry.metadata ?? {},
    is_platform_admin_action: entry.isPlatformAdminAction ?? false,
  });
  if (error) {
    console.error(`logActivity: insert failed for "${entry.eventType}"`, error.message);
  }
}
