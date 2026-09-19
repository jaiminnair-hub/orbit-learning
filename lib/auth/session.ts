import { createClient } from "@/lib/supabase/server";

export interface SessionContext {
  userId: string;
  email: string;
  orgId: string | null;
  role: "learner" | "manager" | "org_admin" | "org_owner";
}

// The single place session + org context is resolved, per docs/API_SPEC.md
// §1 — called from route-group layouts (pages) and the withAuth() wrapper
// (API routes, added in step 8), never re-derived ad hoc per route the way
// an earlier project's ~89 routes each did.
//
// Uses auth.getUser(), not auth.getSession() — getUser() revalidates the
// JWT against the Supabase Auth server; getSession() only reads it back out
// of the cookie without verifying it wasn't tampered with. Server-side code
// must use the former.
export async function getSessionContext(): Promise<SessionContext | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("org_id, role, status")
    .eq("id", user.id)
    .single();

  if (!profile) return null;
  // A suspended member loses session access entirely (redirected to login by
  // AppLayout's `!session` branch) while their historical rows — progress,
  // attempts, certificates — stay untouched; this is a deliberate deactivate,
  // not a delete.
  if (profile.status === "suspended") return null;

  return {
    userId: user.id,
    email: user.email ?? "",
    orgId: profile.org_id,
    role: profile.role,
  };
}
