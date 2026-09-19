import { createClient } from "@supabase/supabase-js";
import type { SessionContext } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

// Foundation's schema (competency_workspace, competency_p2_workspace, and
// their tables, renamed with a foundation_ prefix where they collided with
// this project's own names) lives in this project's own Supabase database, so
// these default to the app's own project. Overrides support an isolated setup.
export const foundationUrl = () => process.env.ORBIT_FOUNDATION_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const foundationKey = () => process.env.ORBIT_FOUNDATION_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

export class CompetencyError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export async function foundationFor(request: Request, session: SessionContext) {
  const token = request.headers.get("x-orbit-session");
  if (!token || token.length > 12000) throw new CompetencyError("Sign in to Orbit 360 with this same account, then return here.", 401);
  if (!session.orgId) throw new CompetencyError("Choose your Learning organisation.", 403);
  const client = createClient(foundationUrl(), foundationKey(), {
    auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: { user }, error } = await client.auth.getUser(token);
  if (error || !user?.email_confirmed_at || !user.email || user.email.toLowerCase() !== session.email.toLowerCase()) {
    throw new CompetencyError("Orbit and Learning must be signed in with the same verified account.", 403);
  }
  const { data: org, error: orgError } = await client.rpc("current_organization_id");
  if (orgError || !org) throw new CompetencyError("Choose your active organisation in Orbit 360.", 403);
  // Service role is required only for the private, deny-all cross-project organisation-link table.
  const { data: link, error: linkError } = await createAdminClient().from("orbit_organization_links")
    .select("lms_organization_id").eq("orbit_organization_id", org).eq("lms_organization_id", session.orgId).maybeSingle();
  if (linkError) throw new CompetencyError("Organisation link lookup is unavailable.", 503);
  if (!link) throw new CompetencyError("The active Orbit organisation is not linked to this Learning workspace.", 403);
  return client;
}

export async function callWorkspace(client: Awaited<ReturnType<typeof foundationFor>>, action: string, payload: Record<string, unknown> = {}) {
  const { data, error } = await client.rpc("competency_workspace", { action, payload });
  if (error) {
    if (error.code === "PGRST202") throw new CompetencyError("The Foundation P1 database migration has not been applied yet.", 503);
    throw new CompetencyError(error.code === "42501" ? "Competencies access is not enabled for this account and organisation." : "The competency action could not be completed. Check the values and current publication state.", error.code === "42501" ? 403 : 400);
  }
  return data;
}

export async function callP2Workspace(client: Awaited<ReturnType<typeof foundationFor>>, action: string, payload: Record<string, unknown> = {}) {
  const { data, error } = await client.rpc("competency_p2_workspace", { action, payload });
  if (error) {
    if (error.code === "PGRST202") throw new CompetencyError("The Foundation P2 database migration has not been applied yet.", 503);
    throw new CompetencyError(error.code === "42501" ? "Competencies access is not enabled for this account and organisation." : "The competency pack or manager action could not be completed.", error.code === "42501" ? 403 : 400);
  }
  return data;
}
