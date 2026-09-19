"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { ROLE_SWITCH_EMAIL, ROLE_SWITCH_HOME_ORG_SLUG, SWITCHABLE_ROLES, type SwitchableRole } from "@/lib/auth/role-switch-constants";

// Lets exactly one account (the platform owner's own) genuinely switch its
// real role/org within its own home organisation (ROLE_SWITCH_ORG_SLUG) -- built so the
// owner can actually act as each role (submit as a learner, approve as an
// admin), not just preview screens. Deliberately not a general capability:
// every other account, including other platform admins, is rejected here.
export async function switchActingRole(formData: FormData) {
  const session = await getSessionContext();
  if (!session || !ROLE_SWITCH_EMAIL || !ROLE_SWITCH_HOME_ORG_SLUG || session.email.toLowerCase() !== ROLE_SWITCH_EMAIL) {
    redirect("/dashboard");
  }

  const targetRole = String(formData.get("role") ?? "");
  if (!SWITCHABLE_ROLES.includes(targetRole as SwitchableRole)) {
    redirect("/dashboard?error=" + encodeURIComponent("Unknown role."));
  }

  // The privilege-escalation-prevention trigger on profiles
  // (docs/MULTI_TENANCY.md §2a) silently reverts any attempt to change
  // role/org_id through a normal authenticated client, by design -- exactly
  // the guard that makes a self-service role switch safe for everyone
  // except this one, deliberately allow-listed account, which can only
  // bypass it through the service-role client.
  const admin = createAdminClient();

  const { data: org, error: orgError } = await admin
    .from("organizations")
    .select("id")
    .eq("slug", ROLE_SWITCH_HOME_ORG_SLUG)
    .single();
  if (orgError || !org) {
    redirect("/dashboard?error=" + encodeURIComponent("Home organisation not found."));
  }

  const { error: updateError } = await admin
    .from("profiles")
    .update({ role: targetRole, org_id: org.id })
    .eq("id", session.userId);
  if (updateError) {
    redirect("/dashboard?error=" + encodeURIComponent("Role switch failed."));
  }

  // Real audit trail: every switch is a real permission change on a real
  // account, and the existing activity_log is exactly where every other
  // platform-admin action already gets recorded.
  await admin.from("activity_log").insert({
    org_id: org.id,
    actor_id: session.userId,
    event_type: "platform_owner.role_switch",
    entity_type: "profiles",
    entity_id: session.userId,
    metadata: { from: session.role, to: targetRole },
    is_platform_admin_action: true,
  });

  // Without this, the shared (app)/layout.tsx render (which reads role/org
  // straight from the database on every request, no explicit cache of its
  // own) can still be served from Next's client-side router cache for the
  // route being redirected to -- confirmed live: the database update above
  // is correct immediately, but the banner didn't appear until this was
  // added. "layout" busts every route sharing this layout, not just
  // "/dashboard", since the switch changes what the whole shell shows.
  revalidatePath("/", "layout");
  redirect("/dashboard");
}
