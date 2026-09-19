import { withAuth } from "@/lib/api/with-auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasRole, type Role } from "@/lib/auth/roles";
import { logActivity } from "@/lib/activity-log";

const VALID_ROLES: Role[] = ["learner", "manager", "org_admin", "org_owner"];
const VALID_STATUSES = ["active", "suspended"] as const;
type MemberStatus = (typeof VALID_STATUSES)[number];

export const PATCH = withAuth<{ params: Promise<{ id: string }> }>(
  async (request, { session, params }) => {
    const { id } = await params;

    if (id === session.userId) {
      return errorResponse(
        "FORBIDDEN",
        "You cannot change your own role or access through this route.",
        403
      );
    }

    const body = await request.json().catch(() => null);
    const role = body?.role as Role | undefined;
    const status = body?.status as MemberStatus | undefined;

    if (role === undefined && status === undefined) {
      return errorResponse("INVALID_INPUT", "A role or status change is required.", 400);
    }
    if (role !== undefined && !VALID_ROLES.includes(role)) {
      return errorResponse("INVALID_INPUT", "A valid role is required.", 400);
    }
    if (status !== undefined && !VALID_STATUSES.includes(status)) {
      return errorResponse("INVALID_INPUT", "A valid status is required.", 400);
    }
    if (role !== undefined && !hasRole(session.role, role)) {
      return errorResponse(
        "FORBIDDEN",
        "You cannot grant a role higher than your own.",
        403
      );
    }

    // Confirm the target is genuinely a member of the caller's own org
    // through the caller's own session client — RLS (profiles_select)
    // enforces this independent of the org_id check below.
    const supabase = await createClient();
    const { data: target, error: targetError } = await supabase
      .from("profiles")
      .select("id, org_id, role")
      .eq("id", id)
      .single();

    if (targetError || !target || target.org_id !== session.orgId) {
      return errorResponse("NOT_FOUND", "No such member in your organization.", 404);
    }
    // A deactivate/reactivate must not become a way to act on someone above
    // your own rank — same guard the role-change path already applies.
    if (status !== undefined && !hasRole(session.role, target.role)) {
      return errorResponse(
        "FORBIDDEN",
        "You cannot change access for someone with a higher role than your own.",
        403
      );
    }

    // profiles.role/status can only change via service_role — see
    // supabase/migrations/...150000_prevent_profile_privilege_escalation.sql.
    const admin = createAdminClient();
    const update: { role?: Role; status?: MemberStatus } = {};
    if (role !== undefined) update.role = role;
    if (status !== undefined) update.status = status;

    const { data: updated, error } = await admin
      .from("profiles")
      .update(update)
      .eq("id", id)
      .select("id, email, full_name, role, department_id, status")
      .single();

    if (error) return errorResponse("UPDATE_FAILED", error.message, 500);

    if (role !== undefined) {
      await logActivity(admin, {
        orgId: session.orgId,
        actorId: session.userId,
        eventType: "org.member.role_changed",
        entityType: "profiles",
        entityId: id,
        metadata: { from: target.role, to: role },
      });
    }
    if (status !== undefined) {
      await logActivity(admin, {
        orgId: session.orgId,
        actorId: session.userId,
        eventType: "org.member.status_changed",
        entityType: "profiles",
        entityId: id,
        metadata: { to: status },
      });
    }

    return successResponse({ member: updated });
  },
  { minRole: "org_admin" }
);
