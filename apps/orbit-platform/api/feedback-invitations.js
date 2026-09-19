const crypto = require("crypto");

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ASSIGNMENTS_PER_REQUEST = 250;

function parseBody(request) {
  if (!request.body) return {};
  if (typeof request.body === "string") {
    try { return JSON.parse(request.body); } catch { return {}; }
  }
  return request.body;
}

function json(response, status, payload) {
  return response.status(status).json(payload);
}

function requiredEnvironment() {
  const config = {
    supabaseUrl: process.env.ORBIT_SUPABASE_URL,
    serviceKey: process.env.ORBIT_SUPABASE_SERVICE_ROLE_KEY,
    publishableKey: process.env.ORBIT_SUPABASE_PUBLISHABLE_KEY,
    resendKey: process.env.RESEND_API_KEY,
    fromEmail: process.env.RESEND_FROM_EMAIL,
    reviewerUrl: process.env.ORBIT_FEEDBACK_REVIEW_URL,
    enabled: process.env.ORBIT_FEEDBACK_INVITATIONS_ENABLED === "true"
  };
  return config;
}

async function supabase(config, path, options = {}) {
  const response = await fetch(`${config.supabaseUrl}${path}`, {
    ...options,
    headers: {
      apikey: config.serviceKey,
      Authorization: `Bearer ${config.serviceKey}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.message || payload?.hint || "Orbit could not process the invitation request.");
  return payload;
}

async function authenticatedUser(config, request) {
  const authorization = request.headers.authorization || "";
  if (!authorization.startsWith("Bearer ")) throw new Error("Sign in before sending reviewer invitations.");
  const response = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
    headers: { apikey: config.publishableKey, Authorization: authorization }
  });
  const user = await response.json().catch(() => null);
  if (!response.ok || !user?.id) throw new Error("Your Orbit session has expired. Please sign in again.");
  return user;
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function safeList(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter((value) => typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value)))];
}

function htmlEscape(value) {
  return String(value || "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
}

function emailContent(kind, link, cycleName, subjectName) {
  if (kind === "reminder") {
    return {
      subject: `Reminder: your confidential 360 feedback is still open — ${cycleName}`,
      text: `This is a reminder that your confidential 360 feedback for ${subjectName} is still open. Use your private link before the feedback deadline: ${link}`,
      html: `<p>This is a reminder that your confidential 360 feedback for <strong>${htmlEscape(subjectName)}</strong> is still open.</p><p><a href="${htmlEscape(link)}">Open your private feedback request</a></p><p>This link is personal to you. Please do not forward it.</p>`
    };
  }
  return {
    subject: `Your confidential 360 feedback request — ${cycleName}`,
    text: `You have been invited to provide confidential 360 feedback for ${subjectName}. Use your private link before the feedback deadline: ${link}`,
    html: `<p>You have been invited to provide confidential 360 feedback for <strong>${htmlEscape(subjectName)}</strong>.</p><p><a href="${htmlEscape(link)}">Open your private feedback request</a></p><p>This link is personal to you. Please do not forward it.</p>`
  };
}

async function sendEmail(config, recipient, link, cycleName, subjectName, kind) {
  const content = emailContent(kind, link, cycleName, subjectName);
  const emailResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: config.fromEmail, to: [recipient], ...content })
  });
  const payload = await emailResponse.json().catch(() => null);
  if (!emailResponse.ok) throw new Error(payload?.message || "Email provider rejected this invitation.");
  return payload?.id || null;
}

module.exports = async (request, response) => {
  if (request.method !== "POST") return response.status(405).setHeader("Allow", "POST").json({ message: "Method not allowed." });

  const config = requiredEnvironment();
  if (!config.enabled) return json(response, 503, { message: "Reviewer invitation delivery is not enabled yet." });
  if (!config.supabaseUrl || !config.serviceKey || !config.publishableKey || !config.resendKey || !config.fromEmail || !config.reviewerUrl) {
    return json(response, 503, { message: "Reviewer invitation delivery is not configured yet." });
  }

  try {
    const body = parseBody(request);
    const organizationId = typeof body.organizationId === "string" ? body.organizationId : "";
    const cycleId = typeof body.cycleId === "string" ? body.cycleId : "";
    const rosterRaterIds = safeList(body.rosterRaterIds);
    const kind = body.kind === "reminder" ? "reminder" : "initial";
    if (!/^[0-9a-f-]{36}$/i.test(organizationId) || !/^[0-9a-f-]{36}$/i.test(cycleId) || !rosterRaterIds.length || rosterRaterIds.length > MAX_ASSIGNMENTS_PER_REQUEST) {
      return json(response, 400, { message: "Choose between 1 and 250 approved reviewer assignments." });
    }

    const user = await authenticatedUser(config, request);
    const adminRoles = await supabase(config, `/rest/v1/product_role_assignments?organization_id=eq.${encodeURIComponent(organizationId)}&user_id=eq.${encodeURIComponent(user.id)}&product_key=eq.feedback&role_key=eq.feedback_admin&select=user_id`);
    if (!adminRoles.length) return json(response, 403, { message: "Only an authorised feedback administrator can send invitations." });

    const cycleRows = await supabase(config, `/rest/v1/feedback_cycles?id=eq.${encodeURIComponent(cycleId)}&organization_id=eq.${encodeURIComponent(organizationId)}&select=id,name,feedback_closes_at,status`);
    const cycle = cycleRows[0];
    if (!cycle || cycle.status !== "live") return json(response, 409, { message: "Launch the feedback cycle before sending invitations." });
    if (cycle.feedback_closes_at && new Date(cycle.feedback_closes_at).getTime() <= Date.now()) {
      return json(response, 409, { message: "This feedback cycle has already closed. Invitations cannot be sent." });
    }

    const ids = rosterRaterIds.join(",");
    // Initial invitations target approved-but-not-yet-invited raters; a
    // reminder targets raters already invited who have not submitted yet
    // (a submitted rater is never in status "invited" again, so this
    // naturally excludes anyone who has already finished).
    const targetStatus = kind === "reminder" ? "invited" : "approved";
    const roster = await supabase(config, `/rest/v1/feedback_cycle_roster_raters?organization_id=eq.${encodeURIComponent(organizationId)}&cycle_id=eq.${encodeURIComponent(cycleId)}&id=in.(${ids})&status=eq.${targetStatus}&select=id,reviewer_person_id,external_contact_id,subject_roster_id`);
    if (!roster.length) return json(response, 409, { message: kind === "reminder" ? "No invited reviewers are waiting on a reminder." : "No approved reviewer assignments are ready to send." });

    const [people, externalContacts, subjects] = await Promise.all([
      supabase(config, `/rest/v1/organization_people?organization_id=eq.${encodeURIComponent(organizationId)}&select=id,full_name,work_email`),
      supabase(config, `/rest/v1/feedback_external_contacts?organization_id=eq.${encodeURIComponent(organizationId)}&cycle_id=eq.${encodeURIComponent(cycleId)}&select=id,full_name,email`),
      supabase(config, `/rest/v1/feedback_cycle_roster_subjects?organization_id=eq.${encodeURIComponent(organizationId)}&cycle_id=eq.${encodeURIComponent(cycleId)}&select=id,subject_person_id`)
    ]);
    const peopleById = new Map(people.map((person) => [person.id, person]));
    const externalById = new Map(externalContacts.map((contact) => [contact.id, contact]));
    const subjectsById = new Map(subjects.map((subject) => [subject.id, peopleById.get(subject.subject_person_id)]));

    const existingDeliveries = await supabase(config, `/rest/v1/feedback_invitation_deliveries?organization_id=eq.${encodeURIComponent(organizationId)}&cycle_id=eq.${encodeURIComponent(cycleId)}&roster_rater_id=in.(${ids})&status=in.(queued,sent,opened,completed)&select=id,roster_rater_id`);
    const activeDeliveryByRater = new Map(existingDeliveries.map((delivery) => [delivery.roster_rater_id, delivery.id]));
    const result = { sent: 0, failed: 0, skipped: 0, alreadyDelivered: 0, failures: [] };
    for (const rater of roster) {
      // An initial invitation must never duplicate an already-active link. A
      // reminder is the opposite case: an active link existing is expected,
      // and the "one active link per rater" database constraint means the
      // prior one must be explicitly revoked before a new one can be sent.
      if (kind === "initial" && activeDeliveryByRater.has(rater.id)) { result.alreadyDelivered += 1; continue; }
      const recipient = rater.external_contact_id ? externalById.get(rater.external_contact_id) : peopleById.get(rater.reviewer_person_id);
      const subject = subjectsById.get(rater.subject_roster_id);
      const email = String(recipient?.email || recipient?.work_email || "").trim().toLowerCase();
      if (!EMAIL_PATTERN.test(email) || !subject) { result.skipped += 1; continue; }

      if (kind === "reminder" && activeDeliveryByRater.has(rater.id)) {
        await supabase(config, `/rest/v1/feedback_invitation_deliveries?id=eq.${encodeURIComponent(activeDeliveryByRater.get(rater.id))}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "revoked" }) });
      }

      const token = crypto.randomBytes(32).toString("base64url");
      const expiresAt = cycle.feedback_closes_at || new Date(Date.now() + 30 * 86400000).toISOString();
      const deliveries = await supabase(config, "/rest/v1/feedback_invitation_deliveries", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ organization_id: organizationId, cycle_id: cycleId, roster_rater_id: rater.id, recipient_email: email, token_hash: tokenHash(token), expires_at: expiresAt, created_by: user.id, delivery_kind: kind })
      });
      const delivery = deliveries[0];
      try {
        // A fragment is not sent in request paths, referrer headers, or logs.
        const messageId = await sendEmail(config, email, `${config.reviewerUrl}#token=${encodeURIComponent(token)}`, cycle.name, subject.full_name || "a colleague", kind);
        await supabase(config, `/rest/v1/feedback_invitation_deliveries?id=eq.${encodeURIComponent(delivery.id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "sent", sent_at: new Date().toISOString(), provider_message_id: messageId }) });
        if (kind === "initial") await supabase(config, `/rest/v1/feedback_cycle_roster_raters?id=eq.${encodeURIComponent(rater.id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "invited" }) });
        result.sent += 1;
      } catch (error) {
        await supabase(config, `/rest/v1/feedback_invitation_deliveries?id=eq.${encodeURIComponent(delivery.id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "failed", failure_reason: String(error.message || "Delivery failed").slice(0, 500) }) });
        result.failed += 1;
        result.failures.push({ rosterRaterId: rater.id, message: "Invitation could not be delivered." });
      }
    }

    await supabase(config, "/rest/v1/audit_events", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ organization_id: organizationId, actor_id: user.id, event_type: kind === "reminder" ? "feedback.reminders_sent" : "feedback.invitations_sent", entity_type: "feedback_cycle", entity_id: cycleId, metadata: { sent: result.sent, failed: result.failed, skipped: result.skipped } }) });
    return json(response, 200, result);
  } catch (error) {
    console.error("Feedback invitation delivery failed", error);
    return json(response, 500, { message: "Orbit could not send reviewer invitations. Please try again." });
  }
};
