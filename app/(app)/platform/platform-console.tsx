"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { QaTestAgents } from "./qa-test-agents";
import { QaRunner } from "./qa-runner";
import { FeedbackHealthPanel } from "./feedback-health-panel";

type Organization = {
  id: string;
  name: string;
  slug: string;
  seats: number;
  is_active: boolean;
  created_at: string;
  memberCount: number;
  pendingInvitations: number;
  publishedCourses: number;
};

type NewInvitation = { email: string; token: string } | null;
type ConsoleTab = "command" | "organisations" | "portfolio" | "qa" | "activity" | "settings";
type Activity = { id: string; event_type: string; created_at: string; org_id: string | null; is_platform_admin_action: boolean };

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

export function PlatformConsole({ platformRole }: { platformRole: "platform_owner" | "platform_admin" }) {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [creating, setCreating] = useState(false);
  const [ownerInvitation, setOwnerInvitation] = useState<NewInvitation>(null);
  const [adminEmail, setAdminEmail] = useState<Record<string, string>>({});
  const [adminInvitation, setAdminInvitation] = useState<{ orgId: string; invitation: NewInvitation } | null>(null);
  const [activeTab, setActiveTab] = useState<ConsoleTab>("command");
  const [activity, setActivity] = useState<Activity[]>([]);

  const load = useCallback(async () => {
    const response = await fetch("/api/v1/platform-admin/orgs");
    const json = await response.json();
    if (!response.ok) {
      setError(json.error?.message ?? "Could not load Orbit organizations.");
    } else {
      setOrganizations(json.data.orgs ?? []);
      setActivity(json.data.activity ?? []);
    }
    setLoading(false);
  }, []);

  // react-hooks/set-state-in-effect flags this even though every setState
  // call inside `load` happens after its first `await` -- the rule can't
  // see into the async function to confirm nothing is synchronous. This is
  // the standard fetch-on-mount pattern, not the cascading-render case the
  // rule exists to catch.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const totals = useMemo(() => ({
    active: organizations.filter((organization) => organization.is_active).length,
    people: organizations.reduce((total, organization) => total + organization.memberCount, 0),
    pending: organizations.reduce((total, organization) => total + organization.pendingInvitations, 0),
  }), [organizations]);

  const portfolio = [
    { name: "360 Feedback", status: "Live", detail: "Product access is live through an explicit 360 sign-in and task-based administrator workspace. The secure reviewer workflow passed its isolated live smoke test; customer delivery flags remain deliberately disabled. Cross-product aggregate reporting and SSO are not connected yet." },
    { name: "Orbit Learning", status: "Live", detail: `${organizations.reduce((total, organization) => total + organization.publishedCourses, 0)} published courses across active workspaces. Learners now have contextual Orbit Guide help, search, a full transcript and a skills evidence/recommendation view.` },
    { name: "Competencies", status: "Live", detail: "Learning-side skill evidence and next-course mapping are live. The canonical Foundation framework, proficiency model and 360 gap hand-off are also live: the Foundation production migration is applied, and a real production smoke test of /skills/development confirmed the workspace renders correctly (see docs/CURRENT_STATUS.md)." },
    { name: "Orbit Growth", status: "In development", detail: "Goals, check-ins and growth-cycle connection are planned next." },
  ] as const;

  const inviteUrl = (invitation: NewInvitation) => invitation ? `${window.location.origin}/invite/${invitation.token}` : "";

  async function createOrganization(event: FormEvent) {
    event.preventDefault();
    setCreating(true); setError(null); setOwnerInvitation(null);
    const response = await fetch("/api/v1/platform-admin/orgs", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, ownerEmail }),
    });
    const json = await response.json();
    setCreating(false);
    if (!response.ok) { setError(json.error?.message ?? "Could not create organization."); return; }
    setName(""); setOwnerEmail(""); setOwnerInvitation(json.data.ownerInvitation); await load();
  }

  async function inviteOrganizationAdmin(event: FormEvent, orgId: string) {
    event.preventDefault();
    const email = adminEmail[orgId] ?? "";
    setError(null); setAdminInvitation(null);
    const response = await fetch(`/api/v1/platform-admin/orgs/${orgId}/admins`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }),
    });
    const json = await response.json();
    if (!response.ok) { setError(json.error?.message ?? "Could not create the administrator invitation."); return; }
    setAdminEmail((current) => ({ ...current, [orgId]: "" }));
    setAdminInvitation({ orgId, invitation: json.data.invitation });
    await load();
  }

  return (
    <main className="platform-console">
      <section className="platform-console__hero">
        <div>
          <p>Orbit Super Admin · {platformRole === "platform_owner" ? "Owner control" : "Platform administration"}</p>
          <h1>See what&apos;s live.<br />Steer what&apos;s next.</h1>
          <span>Your cross-product control plane for platform health, organisations, product progress and operational attention.</span>
        </div>
        <div className="platform-console__hero-mark" aria-hidden="true"><i>O</i><b /></div>
      </section>

      <nav className="platform-console__tabs" aria-label="Platform control sections">
        <TabButton active={activeTab === "command"} onClick={() => setActiveTab("command")}>Command centre</TabButton>
        <TabButton active={activeTab === "organisations"} onClick={() => setActiveTab("organisations")}>Organisations</TabButton>
        <TabButton active={activeTab === "portfolio"} onClick={() => setActiveTab("portfolio")}>Product portfolio</TabButton>
        <TabButton active={activeTab === "qa"} onClick={() => setActiveTab("qa")}>QA test agents</TabButton>
        <TabButton active={activeTab === "activity"} onClick={() => setActiveTab("activity")}>Activity & audit</TabButton>
        <TabButton active={activeTab === "settings"} onClick={() => setActiveTab("settings")}>Platform settings</TabButton>
      </nav>

      {error && <p className="platform-console__error" role="alert">{error}</p>}
      {ownerInvitation && <InviteNotice title="New organization owner invitation" url={inviteUrl(ownerInvitation)} onClose={() => setOwnerInvitation(null)} />}
      {adminInvitation?.invitation && <InviteNotice title="Organization administrator invitation" url={inviteUrl(adminInvitation.invitation)} onClose={() => setAdminInvitation(null)} />}

      {activeTab === "command" && <>
      <section className="platform-console__overview" aria-label="Platform overview">
        <div className="platform-console__heading"><div><p>Platform overview</p><h2>Orbit, at a glance.</h2></div><span>Live tenant view</span></div>
        <div className="platform-console__metrics">
          <Metric label="Client orgs onboarded" value={organizations.length} detail={`${totals.active} active workspaces`} />
          <Metric label="Employees registered" value={totals.people} detail="Across Orbit Learning workspaces" />
          <Metric label="Courses live" value={organizations.reduce((total, organization) => total + organization.publishedCourses, 0)} detail="Published in Orbit Learning" />
          <Metric label="Attention items" value={4} detail="Configuration and launch decisions" />
        </div>
      </section>

      <section className="platform-console__command-grid">
        <section className="platform-console__attention"><div className="platform-console__heading"><div><p>Needs your attention</p><h2>Keep the platform ready.</h2></div><span>Manual owner checklist</span></div><ol><li><b>Configure survey anonymity default</b><span>Some enterprise clients need attributed responses—confirm before their first onboarding.</span></li><li><b>Move transactional email to an Orbit domain</b><span>Until you configure your own sender domain, Learning and 360 send from a temporary one — set your own before real customers use this.</span></li><li><b>Enable OKR check-in reminder cron</b><span>The cron needs its Vercel secret before this future product goes live.</span></li><li><b>Decide Vercel plan</b><span>Confirm the plan is suitable before external commercial use.</span></li></ol></section>
        <section className="platform-console__shipped"><div className="platform-console__heading"><div><p>Recently shipped</p><h2>Build record.</h2></div><span>Owner-maintained</span></div><ol><li><time>16 Sep 2026</time><div><b>P1-A · Learning-side skills evidence</b><span>Learners can see how their published authored courses and assigned assessments map to organisation skills, review existing learning evidence and open mapped next-course options without any invented proficiency claim.</span></div></li><li><time>16 Sep 2026</time><div><b>Learner P0 · contextual Guide, transcript and search</b><span>Orbit Guide now works inside the course player with a strict same-course boundary. Learners can search published learning and their own records, and view one filtered transcript covering courses, paths, assessments, scores and certificates.</span></div></li><li><time>4 Sep 2026</time><div><b>Orbit Guide · AI Tutor Lite</b><span>Published-course RAG, AICredits embeddings and course-cited learner answers are active; unsupported questions return an explicit no-answer response.</span></div></li><li><time>4 Sep 2026</time><div><b>Learning paths and email notifications</b><span>Ordered course paths now enroll and complete as a unit; invitations, assessment assignments and automated enrollments use audited transactional email.</span></div></li><li><time>29 Aug 2026</time><div><b>Orbit Sanskrit visual system</b><span>Learning and 360 now share an indigo, peacock, lotus, leaf and saffron/coral visual layer across product entry, shared shells and protected workspaces. This is presentation-only; access, product status and confidentiality boundaries are unchanged.</span></div></li><li><time>28 Aug 2026</time><div><b>Orbit navigation reset</b><span>One public product chooser now leads to clearly labelled 360 Feedback or Learning sign-in. 360 separates its public explanation, administrator workspace, and private reviewer route; Growth and Competencies are no longer shown as usable workspace choices.</span></div></li><li><time>28 Aug 2026</time><div><b>Orbit 360 synthetic QA bots</b><span>Disposable Admin and Reviewer bots now verify invitation safety, private response handling and anonymity suppression with synthetic data and an in-memory mail sink only.</span></div></li><li><time>28 Aug 2026</time><div><b>Orbit 360 secure reviewer workflow</b><span>One-time hashed reviewer links, private response storage, submission freezing and anonymous-group report suppression are shipped and passed an isolated live smoke test. Customer delivery remains deliberately disabled pending launch decisions.</span></div></li><li><time>28 Aug 2026</time><div><b>Orbit QA Test Agents</b><span>Platform Control now holds protected Admin and Learner QA playbooks for Learning and 360, with future-product boundaries explicitly reported as prepared.</span></div></li><li><time>28 Aug 2026</time><div><b>Orbit 360 administrator repair</b><span>An active organization owner or administrator can securely finish a missing 360 role grant when 360 is already enabled. The server verifies access and records the repair.</span></div></li><li><time>27 Aug 2026</time><div><b>Orbit 360 access resolution</b><span>Signed-in accounts without an active 360 membership now receive a clear invitation, account-selection or intentional new-workspace path. Learning and 360 do not yet share SSO.</span></div></li></ol></section>
      </section>

      <section className="platform-console__recent-activity"><div className="platform-console__heading"><div><p>Recent platform activity</p><h2>What is happening now.</h2></div><button type="button" onClick={() => setActiveTab("activity")}>Open audit trail →</button></div>{activity.length ? <ul>{activity.slice(0, 5).map((entry) => <li key={entry.id}><span>{activityLabel(entry.event_type)}</span><time>{dateLabel(entry.created_at)}</time></li>)}</ul> : <p>Activity will appear here as platform and product events are recorded.</p>}</section>

      <section className="platform-console__portfolio-preview"><div className="platform-console__heading"><div><p>Product status</p><h2>One Orbit, clearly staged.</h2></div><button type="button" onClick={() => setActiveTab("portfolio")}>Open product portfolio →</button></div><div className="platform-console__product-cards">{portfolio.map((product) => <article key={product.name}><span className={`platform-status platform-status--${product.status.toLowerCase().replaceAll(" ", "-")}`}>{product.status}</span><h3>{product.name}</h3><p>{product.detail}</p></article>)}</div></section>
      </>}

      {activeTab === "organisations" && platformRole === "platform_owner" && (
        <section className="platform-console__create">
          <div><p className="platform-console__create-eyebrow">Organisation setup</p><h2>Create a protected workspace.</h2><span>Orbit creates a separate learning tenant, then gives its first owner a secure invitation.</span></div>
          <form onSubmit={createOrganization}>
            <label>Organization name<input required value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Acme India" /></label>
            <label>Initial owner work email<input required type="email" value={ownerEmail} onChange={(event) => setOwnerEmail(event.target.value)} placeholder="owner@company.com" /></label>
            <button type="submit" disabled={creating}>{creating ? "Creating…" : "Create organization →"}</button>
          </form>
        </section>
      )}

      {activeTab === "organisations" && <section className="platform-console__directory">
        <div className="platform-console__heading"><div><p>Organization directory</p><h2>Every workspace, deliberately separate.</h2></div><span>{loading ? "Loading…" : `${organizations.length} organization${organizations.length === 1 ? "" : "s"}`}</span></div>
        {!loading && organizations.length === 0 ? <p className="platform-console__empty">No organizations are available to this platform role.</p> : (
          <div className="platform-console__orgs">
            {organizations.map((organization) => (
              <article className="platform-org" key={organization.id}>
                <div className="platform-org__identity"><span>{organization.name.slice(0, 1).toUpperCase()}</span><div><h3>{organization.name}</h3><p>{organization.is_active ? "Active workspace" : "Inactive workspace"} · Created {dateLabel(organization.created_at)}</p></div></div>
                <div className="platform-org__facts"><span><b>{organization.memberCount}</b> people</span><span><b>{organization.publishedCourses}</b> published courses</span><span><b>{organization.pendingInvitations}</b> pending invites</span></div>
                {platformRole === "platform_owner" && <form className="platform-org__admin" onSubmit={(event) => inviteOrganizationAdmin(event, organization.id)}><label><span>Assign organization admin</span><input required type="email" value={adminEmail[organization.id] ?? ""} onChange={(event) => setAdminEmail((current) => ({ ...current, [organization.id]: event.target.value }))} placeholder="admin@company.com" /></label><button type="submit">Invite admin →</button></form>}
              </article>
            ))}
          </div>
        )}
      </section>}

      {activeTab === "portfolio" && <>
      <section className="platform-console__full-panel"><div className="platform-console__heading"><div><p>Orbit product portfolio</p><h2>What is live, planned and connected.</h2></div><span>Truthful platform status</span></div><div className="platform-console__product-cards platform-console__product-cards--full">{portfolio.map((product) => <article key={product.name}><span className={`platform-status platform-status--${product.status.toLowerCase().replaceAll(" ", "-")}`}>{product.status}</span><h3>{product.name}</h3><p>{product.detail}</p><small>{product.status === "Live" ? "Use the product workspace for product-specific administration." : "No user-facing product access is being advertised from this panel."}</small></article>)}</div></section>
      <FeedbackHealthPanel />
      </>}
      {activeTab === "qa" && <><QaRunner /><QaTestAgents /></>}

      {activeTab === "activity" && <section className="platform-console__full-panel"><div className="platform-console__heading"><div><p>Protected audit trail</p><h2>Activity across connected Orbit workspaces.</h2></div><div className="platform-console__heading-actions"><span>{activity.length} recent entries</span><a className="platform-console__export" href="/api/v1/reports/export?scope=platform">Download report (all orgs) ↓</a></div></div>{activity.length ? <ul className="platform-console__activity-list">{activity.map((entry) => <li key={entry.id}><div><b>{activityLabel(entry.event_type)}</b><span>{entry.is_platform_admin_action ? "Platform-owner action" : "Organisation workspace action"}</span></div><time>{dateLabel(entry.created_at)}</time></li>)}</ul> : <p className="platform-console__empty">No activity has been recorded yet.</p>}</section>}
      {activeTab === "settings" && <ComingSoonPanel title="Platform settings" text="Email health, export controls, announcements, product entitlements and platform configuration will be added here as separate, reviewed controls." />}
    </main>
  );
}

function Metric({ label, value, detail }: { label: string; value: number; detail: string }) {
  return <div className="platform-metric"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" className={active ? "is-active" : ""} onClick={onClick}>{children}</button>;
}

function ComingSoonPanel({ title, text }: { title: string; text: string }) {
  return <section className="platform-console__full-panel platform-console__coming"><p>Platform area · staged build</p><h2>{title}</h2><span>{text}</span></section>;
}

function activityLabel(eventType: string) {
  return eventType.replaceAll("_", " ").replaceAll(".", " · ");
}

function InviteNotice({ title, url, onClose }: { title: string; url: string; onClose: () => void }) {
  return <div className="platform-console__notice"><div><strong>{title}</strong><span>Email delivery is attempted automatically. Keep this secure, one-time link as a private fallback.</span><input readOnly value={url} onFocus={(event) => event.currentTarget.select()} /></div><button type="button" onClick={onClose}>Dismiss</button></div>;
}
