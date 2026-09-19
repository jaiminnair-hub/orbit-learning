import Link from "next/link";
import { getSessionContext } from "@/lib/auth/session";
import { hasRole } from "@/lib/auth/roles";

// One gate for every authoring screen beneath it — the same route-group
// layout pattern Phase 1 established instead of a per-page check.
export default async function AuthoringLayout({ children }: { children: React.ReactNode }) {
  const session = await getSessionContext();

  if (!session || !hasRole(session.role, "org_admin")) {
    return (
      <main className="authoring-access-denied">
        <h1>Authoring</h1>
        <p>You don&apos;t have access to this area.</p>
        <p>
          <Link href="/dashboard">← Dashboard</Link>
        </p>
      </main>
    );
  }

  return (
    <main className="authoring-shell">
      <nav className="authoring-shell__nav" aria-label="Authoring navigation">
        <Link className="authoring-shell__brand" href="/admin/content"><span>O</span> Orbit Studio</Link>
        <div className="authoring-shell__links">
          <Link href="/admin/content">Overview</Link>
          <Link href="/admin/content/courses">Courses</Link>
          <Link href="/admin/content/learning-objects">Learning objects</Link>
          <Link href="/admin/content/assessments">Assessments</Link>
          <Link href="/admin/content/assets">Library</Link>
        </div>
        <div className="authoring-shell__utility">
          <Link href="/admin">Organization</Link>
          <Link href="/dashboard">Learner home ↗</Link>
        </div>
      </nav>
      {children}
    </main>
  );
}
