import { errorResponse, successResponse } from "@/lib/api/response";
import { requirePlatformOwner } from "@/lib/auth/platform";
import { createAdminClient } from "@/lib/supabase/admin";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Platform-only assignment path. It creates an org-specific org_admin
// invitation, never a platform grant and never an account transfer.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requirePlatformOwner();
  if (!access) return errorResponse("FORBIDDEN", "Platform owner access required.", 403);

  const { id: orgId } = await params;
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!EMAIL_RE.test(email)) return errorResponse("INVALID_INPUT", "A valid admin email is required.", 400);

  const admin = createAdminClient();
  const { data: organization } = await admin.from("organizations").select("id, is_active").eq("id", orgId).maybeSingle();
  if (!organization || !organization.is_active) return errorResponse("NOT_FOUND", "No active organization found.", 404);

  const { data: existingProfile } = await admin
    .from("profiles")
    .select("org_id")
    .eq("email", email)
    .is("deleted_at", null)
    .maybeSingle();
  if (existingProfile?.org_id && existingProfile.org_id !== orgId) {
    return errorResponse(
      "ADMIN_ALREADY_ASSIGNED",
      "That email already belongs to another organization. Account transfers are intentionally not supported here.",
      409
    );
  }

  const token = crypto.randomUUID();
  const { data: invitation, error } = await admin
    .from("org_invitations")
    .insert({ org_id: orgId, email, role: "org_admin", token, invited_by: access.session.userId })
    .select("id, email, role, status, token, expires_at")
    .single();
  if (error) return errorResponse("CREATE_FAILED", error.message, 500);

  await admin.from("activity_log").insert({
    org_id: orgId,
    actor_id: access.session.userId,
    event_type: "platform_owner.organization_admin.invited",
    entity_type: "org_invitations",
    entity_id: invitation.id,
    metadata: { email },
    is_platform_admin_action: true,
  });
  return successResponse({ invitation }, 201);
}
