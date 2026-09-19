function config() {
  return {
    url: process.env.ORBIT_SUPABASE_URL,
    serviceKey: process.env.ORBIT_SUPABASE_SERVICE_ROLE_KEY,
    publishableKey: process.env.ORBIT_SUPABASE_PUBLISHABLE_KEY,
  };
}

async function db(settings, path, options = {}) {
  const response = await fetch(`${settings.url}${path}`, {
    ...options,
    headers: {
      apikey: settings.serviceKey,
      Authorization: `Bearer ${settings.serviceKey}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.message || payload?.hint || "Orbit could not update 360 access.");
  return payload;
}

async function currentUser(settings, request) {
  const authorization = request.headers.authorization || "";
  if (!authorization.startsWith("Bearer ")) throw new Error("Sign in before setting up 360 Feedback.");
  const response = await fetch(`${settings.url}/auth/v1/user`, {
    headers: { apikey: settings.publishableKey, Authorization: authorization },
  });
  const user = await response.json().catch(() => null);
  if (!response.ok || !user?.id) throw new Error("Your sign-in has expired. Please sign in again.");
  return user;
}

module.exports = async (request, response) => {
  if (request.method !== "POST") return response.status(405).json({ message: "Method not allowed." });

  try {
    const settings = config();
    if (!settings.url || !settings.serviceKey || !settings.publishableKey) {
      throw new Error("360 access setup is not configured yet.");
    }

    const user = await currentUser(settings, request);
    const activeOrganizations = await db(settings, `/rest/v1/user_active_organizations?user_id=eq.${encodeURIComponent(user.id)}&select=organization_id&limit=1`);
    const organizationId = activeOrganizations[0]?.organization_id;
    if (!organizationId) throw new Error("Choose an Orbit organization before setting up 360 Feedback.");

    const memberships = await db(settings, `/rest/v1/organization_memberships?organization_id=eq.${encodeURIComponent(organizationId)}&user_id=eq.${encodeURIComponent(user.id)}&status=eq.active&select=org_role&limit=1`);
    const membership = memberships[0];
    if (!membership || !["org_owner", "org_admin"].includes(membership.org_role)) {
      return response.status(403).json({ message: "An organization owner or administrator must set up 360 administrator access." });
    }

    const entitlements = await db(settings, `/rest/v1/organization_product_entitlements?organization_id=eq.${encodeURIComponent(organizationId)}&product_key=eq.feedback&status=in.(trial,active)&select=id&limit=1`);
    if (!entitlements.length) return response.status(403).json({ message: "360 Feedback is not enabled for this organization yet." });

    await db(settings, "/rest/v1/product_role_assignments?on_conflict=organization_id,user_id,product_key,role_key", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ organization_id: organizationId, user_id: user.id, product_key: "feedback", role_key: "feedback_admin", granted_by: user.id }),
    });
    await db(settings, "/rest/v1/audit_events", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ organization_id: organizationId, actor_id: user.id, event_type: "feedback.admin_access_activated", entity_type: "product_role_assignment", entity_id: "feedback_admin" }),
    });

    return response.status(200).json({ ok: true });
  } catch (error) {
    return response.status(400).json({ message: error.message || "Orbit could not update 360 access." });
  }
};
