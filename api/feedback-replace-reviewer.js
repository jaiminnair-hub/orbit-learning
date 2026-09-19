const UUID_PATTERN = /^[0-9a-f-]{36}$/i;

function json(response, status, payload) {
  return response.status(status).json(payload);
}

function config() {
  return {
    url: process.env.ORBIT_SUPABASE_URL,
    serviceKey: process.env.ORBIT_SUPABASE_SERVICE_ROLE_KEY,
    publishableKey: process.env.ORBIT_SUPABASE_PUBLISHABLE_KEY
  };
}

async function db(settings, path, options = {}) {
  const response = await fetch(`${settings.url}${path}`, {
    ...options,
    headers: {
      apikey: settings.serviceKey,
      Authorization: `Bearer ${settings.serviceKey}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.message || payload?.hint || "Orbit could not replace this reviewer.");
  return payload;
}

async function authenticatedUser(settings, request) {
  const authorization = request.headers.authorization || "";
  if (!authorization.startsWith("Bearer ")) throw new Error("Sign in before replacing a reviewer.");
  const response = await fetch(`${settings.url}/auth/v1/user`, { headers: { apikey: settings.publishableKey, Authorization: authorization } });
  const user = await response.json().catch(() => null);
  if (!response.ok || !user?.id) throw new Error("Your Orbit session has expired. Please sign in again.");
  return user;
}

module.exports = async (request, response) => {
  if (request.method !== "POST") return response.status(405).setHeader("Allow", "POST").json({ message: "Method not allowed." });

  const settings = config();
  if (!settings.url || !settings.serviceKey || !settings.publishableKey) return json(response, 503, { message: "Reviewer replacement is not configured yet." });

  try {
    const body = request.body && typeof request.body === "object" ? request.body : {};
    const organizationId = typeof body.organizationId === "string" ? body.organizationId : "";
    const cycleId = typeof body.cycleId === "string" ? body.cycleId : "";
    const rosterRaterId = typeof body.rosterRaterId === "string" ? body.rosterRaterId : "";
    const newReviewerPersonId = typeof body.newReviewerPersonId === "string" ? body.newReviewerPersonId : null;
    const newExternalContactId = typeof body.newExternalContactId === "string" ? body.newExternalContactId : null;
    if (![organizationId, cycleId, rosterRaterId].every((value) => UUID_PATTERN.test(value)) || (!newReviewerPersonId && !newExternalContactId) || (newReviewerPersonId && newExternalContactId)) {
      return json(response, 400, { message: "Choose the reviewer to replace and exactly one new reviewer." });
    }

    const user = await authenticatedUser(settings, request);
    const roles = await db(settings, `/rest/v1/product_role_assignments?organization_id=eq.${organizationId}&user_id=eq.${user.id}&product_key=eq.feedback&role_key=eq.feedback_admin&select=user_id`);
    if (!roles.length) return json(response, 403, { message: "Only an authorised feedback administrator can replace a reviewer." });

    const cycleRows = await db(settings, `/rest/v1/feedback_cycles?id=eq.${cycleId}&organization_id=eq.${organizationId}&select=id,status`);
    const cycle = cycleRows[0];
    if (!cycle) return json(response, 404, { message: "This feedback cycle was not found." });
    if (!["draft", "live"].includes(cycle.status)) return json(response, 409, { message: "A reviewer can only be replaced while the cycle is still open for responses." });

    const raterRows = await db(settings, `/rest/v1/feedback_cycle_roster_raters?id=eq.${rosterRaterId}&organization_id=eq.${organizationId}&cycle_id=eq.${cycleId}&select=id,subject_roster_id,rater_group,status`);
    const oldRater = raterRows[0];
    if (!oldRater) return json(response, 404, { message: "That reviewer assignment was not found in this cycle." });
    if (oldRater.status === "withdrawn") return json(response, 409, { message: "This reviewer has already been replaced or withdrawn." });

    // Every delivery this reviewer ever had -- completed or not -- is being
    // superseded by the replacement, so each is revoked first. A delivery
    // still marked "completed" is what the database's confidentiality-
    // hardening trigger checks before allowing its response to be touched;
    // revoking it here is what makes the deletion below legal, not a way
    // around that protection.
    const deliveries = await db(settings, `/rest/v1/feedback_invitation_deliveries?organization_id=eq.${organizationId}&cycle_id=eq.${cycleId}&roster_rater_id=eq.${rosterRaterId}&status=in.(queued,sent,opened,completed)&select=id,status`);
    let responseDeleted = false;
    for (const delivery of deliveries) {
      await db(settings, `/rest/v1/feedback_invitation_deliveries?id=eq.${delivery.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "revoked" }) });
      const deleted = await db(settings, `/rest/v1/feedback_invitation_responses?delivery_id=eq.${delivery.id}`, { method: "DELETE", headers: { Prefer: "return=representation" } });
      if (deleted.length) responseDeleted = true;
    }

    await db(settings, `/rest/v1/feedback_cycle_roster_raters?id=eq.${rosterRaterId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "withdrawn" }) });

    const created = await db(settings, "/rest/v1/feedback_cycle_roster_raters", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        organization_id: organizationId,
        cycle_id: cycleId,
        subject_roster_id: oldRater.subject_roster_id,
        rater_group: oldRater.rater_group,
        reviewer_person_id: newReviewerPersonId,
        external_contact_id: newExternalContactId,
        status: "approved",
        nominated_by: user.id,
        reviewed_by: user.id,
        decision_note: `Replaces roster rater ${rosterRaterId}`
      })
    });
    const newRater = created[0];

    await db(settings, "/rest/v1/audit_events", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ organization_id: organizationId, actor_id: user.id, event_type: "feedback.reviewer_replaced", entity_type: "feedback_cycle_roster_raters", entity_id: rosterRaterId, metadata: { newRosterRaterId: newRater?.id, responseDeleted } }) });

    return json(response, 200, { replaced: true, newRosterRaterId: newRater?.id, responseDeleted });
  } catch (error) {
    console.error("Feedback reviewer replacement failed", error);
    return json(response, 500, { message: error.message || "Orbit could not replace this reviewer." });
  }
};
