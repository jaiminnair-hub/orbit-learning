import { createClient } from "@/lib/supabase/server";
import { getSessionContext, type SessionContext } from "@/lib/auth/session";

export type PlatformRole = "platform_owner" | "platform_admin";

export type PlatformAccess = {
  session: SessionContext;
  role: PlatformRole;
};

// Platform authority is deliberately separate from an organization role.
// A person can be an org_owner in one tenant without gaining platform access;
// a platform owner is granted through platform_admins, verified in Postgres.
export async function getPlatformAccess(): Promise<PlatformAccess | null> {
  const session = await getSessionContext();
  if (!session) return null;

  const supabase = await createClient();
  const { data } = await supabase.rpc("platform_admin_role");
  if (data !== "platform_owner" && data !== "platform_admin") return null;

  return { session, role: data };
}

export async function requirePlatformOwner(): Promise<PlatformAccess | null> {
  const access = await getPlatformAccess();
  return access?.role === "platform_owner" ? access : null;
}
