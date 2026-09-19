import { getSessionContext } from "@/lib/auth/session";
import { hasRole } from "@/lib/auth/roles";
import { logout } from "@/lib/auth/actions";
import { switchActingRole } from "@/lib/auth/role-switch";
import { ROLE_SWITCH_EMAIL } from "@/lib/auth/role-switch-constants";
import { createClient } from "@/lib/supabase/server";
import { ProductShell } from "@/components/shell/ProductShell";
import { RedirectToLogin } from "@/components/auth/RedirectToLogin";

// The protected route-group layout — replaces the global middleware.ts
// pattern that CLOUDFLARE_VALIDATION_RESULTS.md ruled out (Next 16's
// proxy.ts can't run on Cloudflare Workers). Every page under app/(app)/
// is gated by this one call, shared via Next.js layout nesting rather
// than a single global interceptor.
//
// The header below is deliberately minimal — a UI/UX audit pass
// (docs/UI_UX_AUDIT.md) rather than the four-persona rail navigation
// DESIGN_SYSTEM.md §2-3 describes. It uses only the session data this
// file already reads; no new query, route, or permission check.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSessionContext();

  // A Server Component layout has no Proxy here to read the request path
  // from (see above), so it can't call redirect("/login") with the right
  // `next` value itself -- RedirectToLogin picks that up client-side via
  // usePathname() instead. No protected data is fetched below this point.
  if (!session) {
    return <RedirectToLogin />;
  }

  const isAdmin = hasRole(session.role, "org_admin");
  // Reporting is a manager's surface, not an admin's — a team lead needs
  // it without being given content-authoring rights.
  const isManager = hasRole(session.role, "manager");
  const supabase = await createClient();
  const { data: platformRole } = await supabase.rpc("platform_admin_role");
  const roleSwitchEnabled = ROLE_SWITCH_EMAIL !== "" && session.email.toLowerCase() === ROLE_SWITCH_EMAIL;

  return (
    <>
      <ProductShell email={session.email} role={session.role} hasOrganization={Boolean(session.orgId)} canSeeReports={isManager} canManageOrganization={isAdmin} isPlatformOwner={Boolean(platformRole)} logoutAction={logout} roleSwitchEnabled={roleSwitchEnabled} switchRoleAction={roleSwitchEnabled ? switchActingRole : undefined} />
      {children}
    </>
  );
}
