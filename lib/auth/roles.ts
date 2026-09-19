import type { SessionContext } from "@/lib/auth/session";

export type Role = SessionContext["role"];

// Mirrors the DB's role_rank() (supabase/migrations/...143000_rls_and_helpers.sql)
// exactly, so the API-layer check in withAuth() and the RLS check underneath
// it agree on the same hierarchy — learner < manager < org_admin < org_owner.
const ROLE_RANK: Record<Role, number> = {
  learner: 1,
  manager: 2,
  org_admin: 3,
  org_owner: 4,
};

export function roleRank(role: Role): number {
  return ROLE_RANK[role];
}

export function hasRole(actual: Role, minRole: Role): boolean {
  return roleRank(actual) >= roleRank(minRole);
}
