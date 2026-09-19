import { withAuth } from "@/lib/api/with-auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createAdminClient } from "@/lib/supabase/admin";
import { applyJoinRules } from "@/lib/lms/enrollment-rules";
import { invitationAcceptLimiter } from "@/lib/ratelimit";

// Service-role for the same reason app/api/v1/orgs/route.ts is: this
// mutates profiles.org_id/role, which only service_role may change (see
// the escalation-prevention trigger). It's also the only way to even see
// the invitation row here — the accepting user isn't an org member yet,
// so org_invitations_select's RLS policy (org_id = current_org_id())
// wouldn't return anything through their own session client.
export const POST = withAuth(async (request, { session }) => {
  if (session.orgId) {
    return errorResponse(
      "ALREADY_IN_ORG",
      "You already belong to an organization.",
      409
    );
  }

  const body = await request.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (!token) {
    return errorResponse("INVALID_INPUT", "An invitation token is required.", 400);
  }

  const admin = createAdminClient();
  const { data: invitation, error } = await admin
    .from("org_invitations")
    .select("id, org_id, email, role, status, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (error) return errorResponse("QUERY_FAILED", error.message, 500);
  if (!invitation || invitation.status !== "pending" || new Date(invitation.expires_at) < new Date()) {
    return errorResponse(
      "INVITATION_INVALID",
      "This invitation is invalid, expired, or already used.",
      410
    );
  }
  if (invitation.email.toLowerCase() !== session.email.toLowerCase()) {
    return errorResponse(
      "EMAIL_MISMATCH",
      "This invitation was sent to a different email address.",
      403
    );
  }

  const { error: profileError } = await admin
    .from("profiles")
    .update({ org_id: invitation.org_id, role: invitation.role })
    .eq("id", session.userId);
  if (profileError) return errorResponse("UPDATE_FAILED", profileError.message, 500);

  const { error: invitationError } = await admin
    .from("org_invitations")
    .update({ status: "accepted" })
    .eq("id", invitation.id);
  if (invitationError) return errorResponse("UPDATE_FAILED", invitationError.message, 500);

  const { data: org } = await admin
    .from("organizations")
    .select("id, name, slug")
    .eq("id", invitation.org_id)
    .single();

  // Best-effort, per lib/lms/enrollment-rules.ts's own stance: a
  // misconfigured or already-satisfied auto-enrollment rule must never
  // fail the join it's attached to.
  await applyJoinRules(admin, { orgId: invitation.org_id, userId: session.userId, role: invitation.role });

  return successResponse({ org });
}, { rateLimit: invitationAcceptLimiter });
