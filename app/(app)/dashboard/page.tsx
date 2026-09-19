import { getSessionContext } from "@/lib/auth/session";
import { hasRole } from "@/lib/auth/roles";
import { PageShell } from "@/components/shell/Shell";
import { NoWorkspaceNotice } from "./create-org-form";
import { LearnerHome } from "./learner-home";

export default async function DashboardPage() {
  // AppLayout already guarantees a session exists; re-reading it here just
  // to render its contents, not to re-check authorization.
  const session = await getSessionContext();

  return (
    <PageShell maxWidth="78rem">
      {!session?.orgId && <NoWorkspaceNotice />}

      {session?.orgId && (
        <LearnerHome
          canSeeReports={hasRole(session.role, "manager")}
          canManageOrganization={hasRole(session.role, "org_admin")}
          canAuthor={hasRole(session.role, "org_admin")}
        />
      )}
    </PageShell>
  );
}
