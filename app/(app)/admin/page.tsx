import { getSessionContext } from "@/lib/auth/session";
import { hasRole } from "@/lib/auth/roles";
import { AdminConsole } from "./admin-console";

export default async function AdminPage() {
  const session = await getSessionContext();

  if (!session || !hasRole(session.role, "org_admin")) {
    return (
      <main className="admin-access-denied">
        <h1>Admin</h1>
        <p>You don&apos;t have access to this page.</p>
      </main>
    );
  }

  return (
    <main className="admin-workspace">
      <section className="admin-workspace__hero">
        <div>
          <p>Organisation control</p>
          <h1>Build a learning space people can trust.</h1>
          <span>
            Invite the right people, set their level of access, and keep your learning environment deliberately organised.
          </span>
        </div>
        <div className="admin-workspace__hero-mark" aria-hidden="true"><i>O</i><b /></div>
      </section>
      <AdminConsole currentUserId={session.userId} />
    </main>
  );
}
