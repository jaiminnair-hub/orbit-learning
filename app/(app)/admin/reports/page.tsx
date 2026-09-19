import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth/session";
import { hasRole } from "@/lib/auth/roles";
import { PageShell, PageHeading } from "@/components/shell/Shell";
import { ReportsConsole } from "./reports-console";

// manager+ rather than org_admin: seeing how a team is progressing is a
// manager's job, and the API enforces the same bar independently. The
// redirect exists so a learner who guesses the URL gets sent somewhere
// useful instead of an empty console.
export default async function ReportsPage() {
  const session = await getSessionContext();
  if (!session || !hasRole(session.role, "manager")) redirect("/dashboard");

  return (
    <PageShell maxWidth="72rem">
      <PageHeading
        title="Assign & Track"
        description="Assign courses and assessments, and see how far people have got — one place instead of two separate assignment flows. Progress is derived from the content a learner has actually finished — for SCORM and authored courses, from what the course itself reported."
      />
      {/* Assigning a course to someone else is an org_admin action —
          managers read the report, admins decide who takes what. The
          enrolment API enforces the same split independently. */}
      <ReportsConsole canAssign={hasRole(session.role, "org_admin")} orgId={session.orgId} />
    </PageShell>
  );
}
