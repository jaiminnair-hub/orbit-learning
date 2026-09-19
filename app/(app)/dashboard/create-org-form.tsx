// Organizations are created only by a platform owner (Platform Control →
// Organisations → POST /api/v1/platform-admin/orgs), which also invites that
// org's first admin. There is deliberately no self-serve path here any more —
// see the plan this replaced ("Remap the LMS around three roles"): a signed-up
// user with no org_id is waiting on an invitation, not creating their own tenant.
export function NoWorkspaceNotice() {
  return (
    <div className="workspace-setup">
      <p>Almost there</p>
      <h2>Waiting for your workspace.</h2>
      <span>
        Your account isn&apos;t linked to an organisation yet. A platform owner needs to create your
        organisation and send you an invitation before you can get started — check your email for an
        invite, or ask whoever set up your account to send one.
      </span>
    </div>
  );
}
