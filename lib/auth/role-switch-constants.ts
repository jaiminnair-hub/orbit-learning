// Shared between the server action (lib/auth/role-switch.ts) and the client
// UI (components/shell/RoleSwitcher.tsx) so the allow-listed account and the
// switchable role set are defined once, not duplicated and left to drift.
// Opt-in: set ROLE_SWITCH_EMAIL + ROLE_SWITCH_ORG_SLUG to let exactly one account switch its own role.
export const ROLE_SWITCH_EMAIL = (process.env.ROLE_SWITCH_EMAIL ?? "").trim().toLowerCase();
export const ROLE_SWITCH_HOME_ORG_SLUG = (process.env.ROLE_SWITCH_ORG_SLUG ?? "").trim();
export const SWITCHABLE_ROLES = ["learner", "manager", "org_admin", "org_owner"] as const;
export type SwitchableRole = (typeof SWITCHABLE_ROLES)[number];
export const SWITCHABLE_ROLE_LABELS: Record<SwitchableRole, string> = {
  learner: "Learner",
  manager: "Manager",
  org_admin: "Organisation admin",
  org_owner: "Organisation owner",
};
