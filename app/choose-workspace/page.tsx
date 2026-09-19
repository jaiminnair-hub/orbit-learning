import Link from "next/link";
import { getSessionContext } from "@/lib/auth/session";
import { hasRole } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { RedirectToLogin } from "@/components/auth/RedirectToLogin";

export default async function ChooseWorkspacePage() {
  const session = await getSessionContext();
  if (!session) return <RedirectToLogin />;

  const supabase = await createClient();
  const { data: platformRole } = await supabase.rpc("platform_admin_role");
  const managementHref = platformRole
    ? "/platform"
    : hasRole(session.role, "org_admin")
      ? "/admin"
      : "/admin/reports";
  const managementLabel = platformRole
    ? "Open platform control"
    : hasRole(session.role, "org_admin")
      ? "Manage our learning"
      : "Open team insights";

  return (
    <main className="workspace-choice">
      <section className="workspace-choice__intro">
        <div>
          <p>Orbit Learning · your workspace</p>
          <h1>What would you like to do first?</h1>
          <span>You have access to more than one learning workspace. Choose a starting point—your permissions stay exactly the same.</span>
        </div>
        <div className="workspace-choice__field" aria-hidden="true"><i>O</i><span /><span /></div>
      </section>
      <div className="workspace-choice__options">
        <Link href="/dashboard" className="workspace-choice__card workspace-choice__card--learn">
          <span>01</span><small>My learning</small><h2>Continue my learning.</h2><p>Pick up courses, assessments and the progress that belongs to you.</p><b>Open learning home →</b>
        </Link>
        <Link href={managementHref} className="workspace-choice__card workspace-choice__card--manage">
          <span>02</span><small>Management workspace</small><h2>{managementLabel}.</h2><p>Work with the people, content, reports and controls available for your verified role.</p><b>{managementLabel} →</b>
        </Link>
      </div>
      <p className="workspace-choice__foot">You can move between My Learning and your management workspace at any time from the Orbit Learning navigation.</p>
    </main>
  );
}
