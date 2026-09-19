"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type Member = {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  status: string;
};

type Invitation = {
  id: string;
  email: string;
  role: string;
  status: string;
  token: string;
  expires_at: string;
};

type NotificationResult =
  | { ok: true }
  | { ok: false; reason: "INVALID_RECIPIENT" | "NOT_CONFIGURED" | "PROVIDER_REJECTED" | "NETWORK_ERROR" };

const ROLES = ["learner", "manager", "org_admin", "org_owner"] as const;

function roleLabel(role: string) {
  return role.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

// Friendly, never the provider's own error text — that's an internal detail
// (see lib/notifications/email.ts's EmailDeliveryResult), not something an
// admin needs or should see verbatim.
function notificationNotice(action: string, notification: NotificationResult | undefined): string {
  if (!notification || notification.ok) return `${action} and the email was sent.`;
  const reason =
    notification.reason === "NOT_CONFIGURED"
      ? "email delivery is not configured"
      : notification.reason === "INVALID_RECIPIENT"
      ? "the email address could not be delivered to"
      : "the email could not be sent";
  return `${action}, but ${reason}.`;
}

// Every mutation here goes through the withAuth()-gated API routes from
// docs/DEVELOPMENT_SEQUENCE.md steps 8-9 (fetch, not a direct Supabase
// call) — this is the "UI → API → RLS" exercise the step exists to prove,
// not a shortcut around it.
export function AdminConsole({ currentUserId }: { currentUserId: string }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<string>("learner");
  const [inviting, setInviting] = useState(false);

  const load = useCallback(async () => {
    const [membersRes, invitationsRes] = await Promise.all([
      fetch("/api/v1/orgs/members"),
      fetch("/api/v1/orgs/invitations"),
    ]);
    const membersJson = await membersRes.json();
    const invitationsJson = await invitationsRes.json();
    if (membersRes.ok) setMembers(membersJson.data.members);
    if (invitationsRes.ok) setInvitations(invitationsJson.data.invitations);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [membersRes, invitationsRes] = await Promise.all([
        fetch("/api/v1/orgs/members"),
        fetch("/api/v1/orgs/invitations"),
      ]);
      const membersJson = await membersRes.json();
      const invitationsJson = await invitationsRes.json();
      if (cancelled) return;
      if (membersRes.ok) setMembers(membersJson.data.members);
      if (invitationsRes.ok) setInvitations(invitationsJson.data.invitations);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleInvite(event: FormEvent) {
    event.preventDefault();
    setInviting(true);
    setError(null);
    setNotice(null);

    const res = await fetch("/api/v1/orgs/invitations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
    });
    const json = await res.json();
    setInviting(false);

    if (!res.ok) {
      setError(json.error?.message ?? "Could not send invitation.");
      return;
    }
    setInviteEmail("");
    setNotice(notificationNotice("Invitation created", json.data.notification));
    await load();
  }

  async function handleRoleChange(memberId: string, role: string) {
    setError(null);
    const res = await fetch(`/api/v1/orgs/members/${memberId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    const json = await res.json();

    if (!res.ok) {
      setError(json.error?.message ?? "Could not update role.");
      return;
    }
    await load();
  }

  async function handleStatusChange(memberId: string, status: "active" | "suspended") {
    setError(null);
    const res = await fetch(`/api/v1/orgs/members/${memberId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const json = await res.json();

    if (!res.ok) {
      setError(json.error?.message ?? "Could not update access.");
      return;
    }
    await load();
  }

  if (loading) return <div className="admin-console__loading">Preparing your organisation workspace…</div>;

  const pendingInvitations = invitations.filter((invitation) => invitation.status === "pending");
  const deactivatedCount = members.filter((member) => member.status === "suspended").length;
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <div className="admin-console">
      <section className="admin-console__overview" aria-label="Organisation overview">
        <article><span>People</span><strong>{members.length}</strong><small>Members in your learning space</small></article>
        <article><span>Awaiting access</span><strong>{pendingInvitations.length}</strong><small>Private invitations awaiting acceptance</small></article>
        <article><span>Deactivated</span><strong>{deactivatedCount}</strong><small>{deactivatedCount ? "Access currently revoked" : "Everyone has active access"}</small></article>
        <article><span>Governance</span><strong>Active</strong><small>Only approved administrators can manage access</small></article>
      </section>

      {error && <p className="admin-console__message admin-console__message--error">{error}</p>}
      {notice && <p className="admin-console__message admin-console__message--notice">{notice}</p>}

      <section className="admin-console__invite">
        <div>
          <p>01 · Invite with intent</p>
          <h2>Add a person to your organisation.</h2>
          <span>Choose the smallest level of access they need. You can refine it later without exposing course or learner data unnecessarily.</span>
        </div>
        <form onSubmit={handleInvite}>
          <label>
            Work email
            <input type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="name@company.com" required />
          </label>
          <label>
            Starting role
            <select value={inviteRole} onChange={(event) => setInviteRole(event.target.value)}>
              {ROLES.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}
            </select>
          </label>
          <button type="submit" disabled={inviting}>{inviting ? "Preparing invitation…" : "Create private invitation →"}</button>
        </form>
      </section>

      <section className="admin-console__section">
        <header><div><p>02 · Invitations</p><h2>Access waiting to be accepted.</h2></div><span>{pendingInvitations.length} pending</span></header>
        {pendingInvitations.length === 0 ? <div className="admin-console__empty">No invitations are waiting. When you invite someone, their private acceptance link will appear here.</div> : (
          <div className="admin-console__table-wrap"><table className="admin-console__table"><thead><tr><th>Person</th><th>Access</th><th>Expires</th><th>Private link</th></tr></thead><tbody>
            {pendingInvitations.map((invitation) => <tr key={invitation.id}><td>{invitation.email}</td><td><span className="admin-console__role">{roleLabel(invitation.role)}</span></td><td>{new Date(invitation.expires_at).toLocaleDateString()}</td><td><input aria-label={`Acceptance link for ${invitation.email}`} readOnly value={`${origin}/invite/${invitation.token}`} onFocus={(event) => event.currentTarget.select()} /></td></tr>)}
          </tbody></table></div>
        )}
        <small className="admin-console__note">Invitation links are private. Share them only with the intended person.</small>
      </section>

      <section className="admin-console__section">
        <header><div><p>03 · People and permissions</p><h2>Keep access appropriate.</h2></div><span>{members.length} people</span></header>
        <div className="admin-console__table-wrap"><table className="admin-console__table"><thead><tr><th>Person</th><th>Role</th><th>Access control</th><th>Status</th></tr></thead><tbody>
          {members.map((member) => {
            const suspended = member.status === "suspended";
            return <tr key={member.id}>
              <td><strong>{member.full_name || member.email}</strong>{member.full_name && <small>{member.email}</small>}</td>
              <td><span className="admin-console__role">{roleLabel(member.role)}</span></td>
              <td>{member.id === currentUserId ? <span className="admin-console__locked">Your access is protected here</span> : <select aria-label={`Role for ${member.email}`} value={member.role} onChange={(event) => handleRoleChange(member.id, event.target.value)} disabled={suspended}>{ROLES.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}</select>}</td>
              <td>{member.id === currentUserId ? <span className="admin-console__locked">—</span> : (
                <div className="admin-console__status-cell">
                  <span className={suspended ? "admin-console__status admin-console__status--suspended" : "admin-console__status admin-console__status--active"}>{suspended ? "Deactivated" : "Active"}</span>
                  <button type="button" className="admin-console__status-toggle" onClick={() => handleStatusChange(member.id, suspended ? "active" : "suspended")}>{suspended ? "Reactivate" : "Deactivate"}</button>
                </div>
              )}</td>
            </tr>;
          })}
        </tbody></table></div>
      </section>
    </div>
  );
}
