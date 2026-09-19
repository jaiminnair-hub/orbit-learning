import { withAuth } from "@/lib/api/with-auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasRole, type Role } from "@/lib/auth/roles";
import { logActivity } from "@/lib/activity-log";
import { sendInvitationReceivedEmail } from "@/lib/notifications";

const VALID_ROLES: Role[] = ["learner", "manager", "org_admin", "org_owner"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// No service role needed for either handler below — org_invitations'
// RLS policies (org_invitations_select/_insert) already permit an
// org_admin+ to read/write their own org's invitations directly through
// their session client, unlike org creation or invitation acceptance
// (see the neighboring routes), which touch profiles.org_id/role and so
// must go through the service role.

export const GET = withAuth(
  async (_request, { session }) => {
    if (!session.orgId) {
      return successResponse({ invitations: [] });
    }

    const supabase = await createClient();
    const { data: invitations, error } = await supabase
      .from("org_invitations")
      .select("id, email, role, status, token, expires_at, created_at")
      .eq("org_id", session.orgId)
      .order("created_at", { ascending: false });

    if (error) return errorResponse("QUERY_FAILED", error.message, 500);
    return successResponse({ invitations: invitations ?? [] });
  },
  { minRole: "org_admin" }
);

export const POST = withAuth(
  async (request, { session }) => {
    if (!session.orgId) {
      return errorResponse("NO_ORG", "You must belong to an organization to invite members.", 409);
    }

    const body = await request.json().catch(() => null);
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const role = body?.role as Role | undefined;

    if (!EMAIL_RE.test(email)) {
      return errorResponse("INVALID_INPUT", "A valid email is required.", 400);
    }
    if (!role || !VALID_ROLES.includes(role)) {
      return errorResponse("INVALID_INPUT", "A valid role is required.", 400);
    }
    if (!hasRole(session.role, role)) {
      return errorResponse(
        "FORBIDDEN",
        "You cannot invite someone to a role higher than your own.",
        403
      );
    }

    const supabase = await createClient();
    const token = crypto.randomUUID();
    const { data: invitation, error } = await supabase
      .from("org_invitations")
      .insert({ org_id: session.orgId, email, role, token, invited_by: session.userId })
      .select("id, email, role, status, token, expires_at, created_at")
      .single();

    if (error) return errorResponse("CREATE_FAILED", error.message, 500);

    const admin = createAdminClient();
    await logActivity(admin, {
      orgId: session.orgId,
      actorId: session.userId,
      eventType: "org.member.invited",
      entityType: "org_invitations",
      entityId: invitation.id,
      metadata: { email, role },
    });

    const { data: organization } = await admin.from("organizations").select("name").eq("id", session.orgId).maybeSingle();
    const notification = await sendInvitationReceivedEmail(admin, {
      orgId: session.orgId, invitationId: invitation.id, recipientEmail: invitation.email,
      organizationName: organization?.name ?? "your organization", role: invitation.role,
      token: invitation.token, expiresAt: invitation.expires_at,
    });

    return successResponse({ invitation, notification }, 201);
  },
  { minRole: "org_admin" }
);
