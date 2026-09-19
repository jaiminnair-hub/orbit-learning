import crypto from "node:crypto";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,200}$/;
const UUID_PATTERN = /^[0-9a-f-]{36}$/i;

function json(response, status, payload) { return response.status(status).json(payload); }
function body(request) { if (!request.body) return {}; if (typeof request.body === "string") { try { return JSON.parse(request.body); } catch { return {}; } } return request.body; }
function settings() { return { url: process.env.ORBIT_SUPABASE_URL, key: process.env.ORBIT_SUPABASE_SERVICE_ROLE_KEY, enabled: process.env.ORBIT_FEEDBACK_REVIEW_ENABLED === "true" }; }
function hash(token) { return crypto.createHash("sha256").update(token).digest("hex"); }
async function db(config, path, options = {}) {
  const response = await fetch(`${config.url}${path}`, { ...options, headers: { apikey: config.key, Authorization: `Bearer ${config.key}`, "Content-Type": "application/json", ...(options.headers || {}) } });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.message || payload?.hint || "Database operation failed.");
  return payload;
}
async function context(config, token, answers) {
  if (!TOKEN_PATTERN.test(token || "")) return null;
  const deliveries = await db(config, `/rest/v1/feedback_invitation_deliveries?token_hash=eq.${encodeURIComponent(hash(token))}&select=id,organization_id,cycle_id,roster_rater_id,status,expires_at`);
  const delivery = deliveries[0];
  if (!delivery || !["sent", "opened", "completed"].includes(delivery.status) || new Date(delivery.expires_at).getTime() < Date.now()) return null;
  const [cycles, raters, questions] = await Promise.all([
    db(config, `/rest/v1/feedback_cycles?id=eq.${delivery.cycle_id}&organization_id=eq.${delivery.organization_id}&select=id,name,status,feedback_closes_at`),
    db(config, `/rest/v1/feedback_cycle_roster_raters?id=eq.${delivery.roster_rater_id}&organization_id=eq.${delivery.organization_id}&cycle_id=eq.${delivery.cycle_id}&select=id,subject_roster_id,status`),
    db(config, `/rest/v1/feedback_cycle_questions?organization_id=eq.${delivery.organization_id}&cycle_id=eq.${delivery.cycle_id}&select=id,competency_label,question_type,prompt,scale_definition,is_required,sort_order&order=sort_order.asc`)
  ]);
  const cycle = cycles[0], rater = raters[0];
  if (!cycle || !rater || cycle.status !== "live" || (cycle.feedback_closes_at && new Date(cycle.feedback_closes_at).getTime() < Date.now()) || !questions.length) return null;
  const subjects = await db(config, `/rest/v1/feedback_cycle_roster_subjects?id=eq.${rater.subject_roster_id}&organization_id=eq.${delivery.organization_id}&cycle_id=eq.${delivery.cycle_id}&select=subject_person_id`);
  if (!subjects[0]) return null;
  const people = await db(config, `/rest/v1/organization_people?id=eq.${subjects[0].subject_person_id}&organization_id=eq.${delivery.organization_id}&select=full_name`);
  const stored = answers ? await db(config, `/rest/v1/feedback_invitation_responses?delivery_id=eq.${delivery.id}&organization_id=eq.${delivery.organization_id}&select=cycle_question_id,rating,comment,is_skipped`) : [];
  return { delivery, rater, cycle, questions, answers: stored, subjectName: people[0]?.full_name || "your colleague" };
}
function validateAnswers(raw, questions, complete) {
  if (!Array.isArray(raw) || raw.length > 200) throw new Error("Invalid response payload.");
  const byId = new Map(questions.map(q => [q.id, q])), seen = new Set(), result = [];
  for (const item of raw) {
    if (!item || !UUID_PATTERN.test(item.questionId || "") || !byId.has(item.questionId) || seen.has(item.questionId)) throw new Error("Invalid response payload.");
    seen.add(item.questionId); const question = byId.get(item.questionId); const comment = typeof item.comment === "string" ? item.comment.trim().slice(0, 8000) : "";
    const rawRating = item.rating === "" || item.rating == null ? null : Number(item.rating); const scale = question.scale_definition || {}; const min = Number(scale.min ?? 1), max = Number(scale.max ?? 5);
    const rating = Number.isFinite(rawRating) && rawRating >= min && rawRating <= max ? rawRating : null;
    if (!rating && !comment) continue;
    if (question.question_type === "rating" && !rating) throw new Error("A rating is outside the allowed scale.");
    if (question.question_type === "open_text" && !comment) throw new Error("A written response is too short.");
    result.push({ cycle_question_id: question.id, rating, comment: comment || null, is_skipped: false });
  }
  if (complete) for (const question of questions) if (question.is_required && !result.some(answer => answer.cycle_question_id === question.id)) throw new Error("Please complete every required question before submitting.");
  return result;
}
async function save(config, current, answers) {
  // Upsert before pruning so a transient database failure never removes a
  // reviewer's saved response. This also makes clearing an answer real rather
  // than leaving the old answer silently in the confidential response store.
  if (answers.length) {
    await db(config, "/rest/v1/feedback_invitation_responses?on_conflict=delivery_id,cycle_question_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(answers.map(answer => ({ ...answer, organization_id: current.delivery.organization_id, cycle_id: current.delivery.cycle_id, delivery_id: current.delivery.id }))) });
  }
  const answerIds = answers.map(answer => answer.cycle_question_id);
  const stalePath = answerIds.length
    ? `/rest/v1/feedback_invitation_responses?delivery_id=eq.${current.delivery.id}&cycle_question_id=not.in.(${answerIds.join(",")})`
    : `/rest/v1/feedback_invitation_responses?delivery_id=eq.${current.delivery.id}`;
  await db(config, stalePath, { method: "DELETE", headers: { Prefer: "return=minimal" } });
}
export default async (request, response) => {
  if (request.method !== "POST") return response.status(405).setHeader("Allow", "POST").json({ message: "Method not allowed." });
  const config = settings();
  if (!config.enabled || !config.url || !config.key) {
    console.error("Private feedback response configuration incomplete", {
      reviewEnabled: config.enabled,
      supabaseUrlConfigured: Boolean(config.url),
      serviceRoleConfigured: Boolean(config.key)
    });
    return json(response, 503, { message: "Private feedback responses are not enabled yet." });
  }
  try {
    const payload = body(request), action = payload.action, current = await context(config, payload.token, action === "load");
    if (!current) return json(response, 404, { message: "This feedback link is invalid, expired, or no longer active." });
    if (action === "load") {
      if (current.delivery.status === "sent") await db(config, `/rest/v1/feedback_invitation_deliveries?id=eq.${current.delivery.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "opened", opened_at: new Date().toISOString() }) });
      return json(response, 200, { cycleName: current.cycle.name, subjectName: current.subjectName, closesAt: current.cycle.feedback_closes_at, complete: current.delivery.status === "completed", questions: current.questions, answers: current.answers });
    }
    if (current.delivery.status === "completed") return json(response, 409, { message: "This feedback request has already been submitted." });
    if (action !== "save" && action !== "submit") return json(response, 400, { message: "Invalid feedback action." });
    const answers = validateAnswers(payload.answers, current.questions, action === "submit"); await save(config, current, answers);
    if (action === "submit") await Promise.all([
      db(config, `/rest/v1/feedback_invitation_deliveries?id=eq.${current.delivery.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "completed", completed_at: new Date().toISOString() }) }),
      db(config, `/rest/v1/feedback_cycle_roster_raters?id=eq.${current.rater.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "submitted" }) }),
      // The audit record deliberately stores no answers, recipient address or
      // token. It proves the event without weakening reviewer confidentiality.
      db(config, "/rest/v1/audit_events", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ organization_id: current.delivery.organization_id, event_type: "feedback.reviewer_response_submitted", entity_type: "feedback_invitation_delivery", entity_id: current.delivery.id, metadata: { cycle_id: current.delivery.cycle_id, response_count: answers.length } }) })
    ]);
    return json(response, 200, { saved: true, submitted: action === "submit" });
  } catch (error) { console.error("Private feedback response failed", error); return json(response, 400, { message: error.message === "Please complete every required question before submitting." ? error.message : "Orbit could not save this feedback. Please check your answers and try again." }); }
};
