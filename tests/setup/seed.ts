// Seeds real, disposable orgs and real authenticated users (via the local
// Supabase Admin API) so tests exercise genuine RLS-governed sessions —
// not raw SQL with an elevated role, which would prove nothing about
// whether a real client can see data it shouldn't.
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient, getLocalStatus } from "./local-supabase";

export interface SeededOrg {
  orgId: string;
  slug: string;
  userId: string;
  email: string;
  client: SupabaseClient; // signed in as this org's test user
}

const admin = createAdminClient();
const TEST_PASSWORD = "Test-password-123!";

export async function seedOrgWithUser(label: string): Promise<SeededOrg> {
  const suffix = randomUUID().slice(0, 8);
  const slug = `test-org-${label}-${suffix}`;
  const email = `test-${label}-${suffix}@example.test`;

  const { data: org, error: orgError } = await admin
    .from("organizations")
    .insert({ name: `Test Org ${label}`, slug })
    .select()
    .single();
  if (orgError) throw orgError;

  const { data: userRes, error: userError } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (userError) throw userError;
  const userId = userRes.user.id;

  // handle_new_user() already created a bare profile row (org_id null);
  // assign it here, simulating "invited and accepted" without needing the
  // invite-acceptance UI, which is a later step. Uses the service role, so
  // the privilege-escalation trigger allows it.
  const { error: profileError } = await admin
    .from("profiles")
    .update({ org_id: org.id })
    .eq("id", userId);
  if (profileError) throw profileError;

  const { API_URL, ANON_KEY } = getLocalStatus();
  const client = createClient(API_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: signInError } = await client.auth.signInWithPassword({
    email,
    password: TEST_PASSWORD,
  });
  if (signInError) throw signInError;

  return { orgId: org.id, slug, userId, email, client };
}

export async function makePlatformAdmin(userId: string) {
  const { error } = await admin.from("platform_admins").insert({ user_id: userId });
  if (error) throw error;
}

export async function cleanupOrg(seeded: SeededOrg) {
  await admin.auth.admin.deleteUser(seeded.userId); // profiles row cascades via FK
  await admin.from("organizations").delete().eq("id", seeded.orgId);
}

export { admin as adminClient };
