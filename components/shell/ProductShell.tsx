"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SWITCHABLE_ROLES, SWITCHABLE_ROLE_LABELS, type SwitchableRole } from "@/lib/auth/role-switch-constants";

type WorkspaceLink = { href: string; label: string; kicker?: string };
type ProductShellProps = {
  email: string;
  role: "learner" | "manager" | "org_admin" | "org_owner";
  hasOrganization: boolean;
  canSeeReports: boolean;
  canManageOrganization: boolean;
  isPlatformOwner: boolean;
  logoutAction: (formData: FormData) => void | Promise<void>;
  // Only ever true for one hard-coded account (lib/auth/role-switch.ts) --
  // lets that account genuinely switch its own role/org, not preview one.
  roleSwitchEnabled?: boolean;
  switchRoleAction?: (formData: FormData) => void | Promise<void>;
};

const roleNames: Record<ProductShellProps["role"], string> = { learner: "Learner", manager: "Manager", org_admin: "Organisation admin", org_owner: "Organisation owner" };
function isActive(pathname: string, href: string) { return href === "/dashboard" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`); }
/**
 * A tab bar is a flat set of sibling routes, not a nesting hierarchy — but
 * several share a URL prefix with each other (every /admin/* tab matches
 * /admin's own isActive check). Picking the longest matching href resolves
 * the ambiguity to the most specific tab instead of highlighting every
 * ancestor-shaped match at once.
 */
function bestMatch(pathname: string, links: WorkspaceLink[]) {
  return links.filter((link) => isActive(pathname, link.href)).reduce<WorkspaceLink | undefined>((best, link) => (!best || link.href.length > best.href.length ? link : best), undefined);
}

export function ProductShell({ email, role, hasOrganization, canSeeReports, canManageOrganization, isPlatformOwner, logoutAction, roleSwitchEnabled, switchRoleAction }: ProductShellProps) {
  const pathname = usePathname();
  const isAdminView = pathname.startsWith("/admin") || pathname.startsWith("/platform");
  const learnerLinks: WorkspaceLink[] = [
    { href: "/dashboard", label: "My learning", kicker: "Everything assigned to you" },
    { href: "/courses", label: "Explore", kicker: "Course catalogue" },
    { href: "/search", label: "Search", kicker: "Find across learning" },
    { href: "/skills", label: "Skills", kicker: "Learning evidence" },
    { href: "/transcript", label: "Transcript", kicker: "Your full record" },
    { href: "/certificates", label: "Certificates", kicker: "Your credentials" },
    { href: "/guide", label: "Guide", kicker: "Ask published learning" },
  ];
  const adminLinks: WorkspaceLink[] = [
    { href: "/admin", label: "People", kicker: "Roster & access" },
    { href: "/admin/content/courses", label: "Curriculum", kicker: "Build & assemble" },
    { href: "/admin/content/assessments", label: "Assessments", kicker: "Question bank & scoring" },
    ...(canSeeReports ? [{ href: "/admin/reports", label: "Assign & Track", kicker: "Assign, monitor, export" }] : []),
  ];
  const managerLinks: WorkspaceLink[] = [
    { href: "/admin/reports", label: "Team insights", kicker: "Progress and attention" },
    { href: "/dashboard", label: "My learning", kicker: "Personal learning" },
  ];
  const localLinks = isAdminView && canManageOrganization ? adminLinks : canSeeReports && isAdminView ? managerLinks : learnerLinks;
  const localTitle = isAdminView && canManageOrganization ? "Manage learning" : canSeeReports && isAdminView ? "Team insights" : "My learning";
  const activeLink = bestMatch(pathname, localLinks);
  const activeLocalLabel = activeLink?.label ?? localTitle;
  const renderLinks = (links: WorkspaceLink[]) => links.map((link) => <Link aria-current={link === activeLink ? "page" : undefined} className={link === activeLink ? "product-shell__link is-active" : "product-shell__link"} href={link.href} key={`${link.href}-${link.label}`}><span>{link.label}</span>{link.kicker && <small>{link.kicker}</small>}</Link>);

  return <header className="product-shell">
    {roleSwitchEnabled && role !== "org_owner" && switchRoleAction && (
      <div className="product-shell__role-switch-banner" role="status">
        <span>⚠ Acting as <b>{roleNames[role]}</b> in your organisation — every action right now uses this role&apos;s real permissions.</span>
        <form action={switchRoleAction}><input type="hidden" name="role" value="org_owner" /><button type="submit">Return to Owner</button></form>
      </div>
    )}
    <div className="product-shell__bar">
      <Link className="product-shell__brand" href="/dashboard" aria-label="Orbit Learning home"><span aria-hidden="true">O</span><strong>Orbit</strong> Learning</Link>
      <details className="product-shell__switcher product-shell__switcher--org">
        <summary><i aria-hidden="true" />{hasOrganization ? "Your organisation" : "Set up organisation"}</summary>
        <div><b>Organisation context</b><span>Your access is scoped to the organisation selected when you signed in.</span><Link href="/choose-workspace">Choose a starting area →</Link></div>
      </details>
      <details className="product-shell__switcher">
        <summary>Product: <b>Learning</b></summary>
        <div><b>Orbit products</b><Link href="/dashboard">Learning <small>Current product</small></Link><a href="/orbit-360/workspace.html">360 Feedback <small>People intelligence</small></a>{isPlatformOwner && <Link href="/platform">Platform Control <small>Orbit owner only</small></Link>}</div>
      </details>
      <div className="product-shell__identity"><span className="product-shell__avatar" aria-hidden="true">{email.slice(0, 1).toUpperCase()}</span><span><b>{roleNames[role]}</b><small>{email}</small></span>
        {roleSwitchEnabled && switchRoleAction && (
          <details className="product-shell__role-pill">
            <summary>🎭 Switch role</summary>
            <div>
              <b>Switch your real role</b>
              <span>Changes your actual permissions in your organisation — you can genuinely act as this role, not just preview it.</span>
              {SWITCHABLE_ROLES.map((r: SwitchableRole) => (
                <form action={switchRoleAction} key={r}>
                  <input type="hidden" name="role" value={r} />
                  <button type="submit" disabled={r === role}>{SWITCHABLE_ROLE_LABELS[r]}{r === role ? " (current)" : ""}</button>
                </form>
              ))}
            </div>
          </details>
        )}
        <form action={logoutAction}><button type="submit">Log out</button></form>
      </div>
    </div>
    {hasOrganization && <nav className="product-shell__nav" aria-label="Learning workspace navigation">
      <div className="product-shell__nav-title"><span>Learning</span><b>{activeLocalLabel}</b></div>
      <div className="product-shell__links">{renderLinks(localLinks)}</div>
      {(canManageOrganization || canSeeReports || isPlatformOwner) && <details className="product-shell__view-switcher"><summary>Viewing: <b>{localTitle}</b></summary><div><Link href="/dashboard">My learning</Link>{canSeeReports && <Link href="/admin/reports">Team insights</Link>}{canManageOrganization && <Link href="/admin">Manage learning</Link>}{isPlatformOwner && <Link href="/platform">Platform Control</Link>}</div></details>}
    </nav>}
  </header>;
}