import { errorResponse, successResponse } from "@/lib/api/response";
import { requirePlatformOwner } from "@/lib/auth/platform";
import { getSessionContext } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

// Orbit Foundation is a separate Supabase project; there is no direct
// database connection from this app to it (see docs/ORBIT_PLATFORM_BUILD_STATUS.md
// §7 -- bridges, not merges). This calls the `platform-feedback-health` Edge
// Function deployed on Foundation, which itself only returns banded
// aggregate counts -- never raw responses, ratings, comments, or identity.
const FOUNDATION_FUNCTION_URL = process.env.ORBIT_PLATFORM_HEALTH_FUNCTION_URL;

export async function GET() {
  const access = await requirePlatformOwner();
  const session = await getSessionContext();
  if (!access || !session) return errorResponse("FORBIDDEN", "Platform owner access required.", 403);
  const bridgeSecret = process.env.ORBIT_PLATFORM_HEALTH_BRIDGE_SECRET;
  if (!FOUNDATION_FUNCTION_URL || !bridgeSecret) {
    return errorResponse("NOT_CONFIGURED", "The 360 platform health rollup is not configured.", 503);
  }
  const response = await fetch(FOUNDATION_FUNCTION_URL, {
    headers: { "x-bridge-secret": bridgeSecret },
    cache: "no-store",
  });
  if (!response.ok) return errorResponse("HEALTH_FETCH_FAILED", "Orbit 360 health data is unavailable.", 502);
  const data = await response.json();
  await createAdminClient().from("activity_log").insert({
    org_id: null,
    actor_id: session.userId,
    event_type: "platform_admin.feedback_health.viewed",
    entity_type: "feedback_health_rollup",
    metadata: { organizationsWithFeedbackEnabled: data?.platformSummary?.organizationsWithFeedbackEnabled ?? null },
    is_platform_admin_action: true,
  });
  return successResponse(data);
}
