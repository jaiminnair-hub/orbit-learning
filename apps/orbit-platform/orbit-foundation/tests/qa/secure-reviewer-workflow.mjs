/*
 * Disposable 360 QA journey. It runs only against `orbit-foundation-qa`, a
 * local Supabase stack started by GitHub Actions. It creates synthetic users,
 * directory people and a cycle, then invokes the real Vercel route modules.
 * Resend is intercepted in memory: no external email is ever sent.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.cwd());
const now = Date.now();
const suffix = `${now}`;
const password = "Orbit-qa-password-2026!";
const env = Object.fromEntries(execFileSync("npx", ["supabase", "status", "--workdir", "orbit-foundation", "-o", "env"], { encoding: "utf8" })
  .split(/\r?\n/).filter(Boolean).map((line) => { const index = line.indexOf("="); return [line.slice(0, index), line.slice(index + 1).replace(/^"|"$/g, "")]; }));
const apiUrl = env.API_URL;
const anonKey = env.ANON_KEY;
const serviceKey = env.SERVICE_ROLE_KEY;
if (!apiUrl || !anonKey || !serviceKey) throw new Error("Local Foundation Supabase credentials were not available.");

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${response.status}: ${body?.message || body?.hint || JSON.stringify(body)}`);
  return body;
}
async function admin(pathname, options = {}) {
  return request(`${apiUrl}${pathname}`, { ...options, headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", ...(options.headers || {}) } });
}
async function rest(table, query = "", options = {}) {
  return admin(`/rest/v1/${table}${query ? `?${query}` : ""}`, options);
}
async function createUser(label) {
  const email = `orbit-qa-${label}-${suffix}@example.test`;
  const user = await admin("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: `Orbit QA ${label}` } }) });
  const session = await request(`${apiUrl}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: anonKey, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  return { id: user.id, email, token: session.access_token };
}
function responseCapture() {
  let status = 200; let payload = null;
  return { response: { status(code) { status = code; return this; }, setHeader() { return this; }, json(value) { payload = value; return this; } }, result: () => ({ status, payload }) };
}
async function invoke(handler, requestInput) {
  const captured = responseCapture();
  await handler(requestInput, captured.response);
  return captured.result();
}

const emails = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  if (String(url) === "https://api.resend.com/emails") {
    emails.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ id: `qa-message-${emails.length}` }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  return realFetch(url, options);
};
process.env.ORBIT_SUPABASE_URL = apiUrl;
process.env.ORBIT_SUPABASE_PUBLISHABLE_KEY = anonKey;
process.env.ORBIT_SUPABASE_SERVICE_ROLE_KEY = serviceKey;
process.env.ORBIT_FEEDBACK_INVITATIONS_ENABLED = "true";
process.env.ORBIT_FEEDBACK_REVIEW_ENABLED = "true";
process.env.RESEND_API_KEY = "qa-not-a-real-provider-key";
process.env.RESEND_FROM_EMAIL = "Orbit QA <qa@example.test>";
process.env.ORBIT_FEEDBACK_REVIEW_URL = "http://127.0.0.1:55300/orbit-360/review.html";
const invitations = (await import(path.join(ROOT, "api/feedback-invitations.js"))).default;
const review = (await import(path.join(ROOT, "api/feedback-review.js"))).default;
const reports = (await import(path.join(ROOT, "api/feedback-reports.js"))).default;

const steps = [];
const record = (name, status, detail) => steps.push({ name, status, detail });
try {
  const [adminUser, ordinaryUser] = await Promise.all([createUser("admin"), createUser("ordinary")]);
  const [org] = await rest("foundation_organizations", "", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ name: "Orbit 360 QA", slug: `orbit-360-qa-${suffix}` }) });
  await rest("organization_memberships", "", { method: "POST", body: JSON.stringify([{ organization_id: org.id, user_id: adminUser.id, org_role: "org_admin", status: "active" }, { organization_id: org.id, user_id: ordinaryUser.id, org_role: "employee", status: "active" }]) });
  await rest("organization_product_entitlements", "", { method: "POST", body: JSON.stringify({ organization_id: org.id, product_key: "feedback", status: "active" }) });
  await rest("product_role_assignments", "", { method: "POST", body: JSON.stringify({ organization_id: org.id, user_id: adminUser.id, product_key: "feedback", role_key: "feedback_admin", granted_by: adminUser.id }) });
  const people = await rest("organization_people", "", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(["Subject", "Reviewer One", "Reviewer Two", "Reviewer Three"].map((full_name, index) => ({ organization_id: org.id, full_name, work_email: `orbit-qa-${suffix}-${index}@example.test`, imported_by: adminUser.id }))) });
  const closesAt = new Date(Date.now() + 86400000).toISOString();
  const [cycle] = await rest("feedback_cycles", "", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ organization_id: org.id, name: `QA cycle ${suffix}`, purpose: "development", feedback_opens_at: new Date(Date.now() - 60000).toISOString(), feedback_closes_at: closesAt, anonymous_group_threshold: 3, created_by: adminUser.id }) });
  await rest("feedback_cycle_questions", "", { method: "POST", body: JSON.stringify({ organization_id: org.id, cycle_id: cycle.id, competency_label: "Trust", question_type: "rating", prompt: "Builds trust with colleagues.", scale_definition: { min: 1, max: 5, labels: { 1: "Rarely", 5: "Consistently" } }, is_required: true, sort_order: 1 }) });
  const [subject] = await rest("feedback_cycle_roster_subjects", "", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ organization_id: org.id, cycle_id: cycle.id, subject_person_id: people[0].id, created_by: adminUser.id }) });
  const raters = await rest("feedback_cycle_roster_raters", "", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(people.slice(1).map((person) => ({ organization_id: org.id, cycle_id: cycle.id, subject_roster_id: subject.id, reviewer_person_id: person.id, rater_group: "peer", status: "approved", nominated_by: adminUser.id, reviewed_by: adminUser.id }))) });
  await rest("feedback_cycles", `id=eq.${cycle.id}`, { method: "PATCH", body: JSON.stringify({ status: "live" }) });

  const denied = await invoke(invitations, { method: "POST", headers: { authorization: `Bearer ${ordinaryUser.token}` }, body: { organizationId: org.id, cycleId: cycle.id, rosterRaterIds: raters.map((rater) => rater.id) } });
  assert.equal(denied.status, 403); record("Admin boundary rejects ordinary user", "passed", "403 returned before any invitation was delivered.");

  const sent = await invoke(invitations, { method: "POST", headers: { authorization: `Bearer ${adminUser.token}` }, body: { organizationId: org.id, cycleId: cycle.id, rosterRaterIds: raters.map((rater) => rater.id) } });
  assert.equal(sent.status, 200); assert.equal(sent.payload.sent, 3); assert.equal(emails.length, 3); assert.equal(JSON.stringify(sent.payload).includes("token="), false);
  record("Admin sends approved private invitations", "passed", "3 synthetic links delivered to the in-memory mail sink; no token returned to admin.");
  const duplicate = await invoke(invitations, { method: "POST", headers: { authorization: `Bearer ${adminUser.token}` }, body: { organizationId: org.id, cycleId: cycle.id, rosterRaterIds: raters.map((rater) => rater.id) } });
  assert.equal(duplicate.status, 409); record("Admin cannot create duplicate active links", "passed", "Already-invited raters are no longer eligible for a second send request.");

  const reviewerToken = new URL(emails[0].html.match(/href="([^"]+)"/)[1]).hash.slice("#token=".length);
  const loaded = await invoke(review, { method: "POST", headers: {}, body: { action: "load", token: reviewerToken } });
  assert.equal(loaded.status, 200); assert.equal(loaded.payload.questions.length, 1); record("Reviewer opens private survey", "passed", "Only the assigned synthetic task was loaded.");
  const questionId = loaded.payload.questions[0].id;
  await invoke(review, { method: "POST", headers: {}, body: { action: "save", token: reviewerToken, answers: [{ questionId, rating: 5, comment: "Synthetic QA response" }] } });
  await invoke(review, { method: "POST", headers: {}, body: { action: "save", token: reviewerToken, answers: [] } });
  const cleared = await rest("feedback_invitation_responses", `cycle_id=eq.${cycle.id}&select=id`);
  assert.equal(cleared.length, 0); record("Reviewer can clear a saved draft", "passed", "The response store contains no stale answer.");
  const submitted = await invoke(review, { method: "POST", headers: {}, body: { action: "submit", token: reviewerToken, answers: [{ questionId, rating: 4, comment: "Synthetic QA response" }] } });
  assert.equal(submitted.payload.submitted, true);
  const frozen = await invoke(review, { method: "POST", headers: {}, body: { action: "save", token: reviewerToken, answers: [{ questionId, rating: 1, comment: "Changed" }] } });
  assert.equal(frozen.status, 409); record("Reviewer submission is frozen", "passed", "Completed private link cannot save another response.");
  const protectedReport = await invoke(reports, { method: "GET", headers: { authorization: `Bearer ${adminUser.token}` }, query: { organizationId: org.id, cycleId: cycle.id } });
  const peer = protectedReport.payload.reports[0].groups.find((group) => group.key === "peer");
  assert.equal(peer.visible, false); assert.equal(peer.completed, null); assert.equal(peer.ratingAverage, null); record("Anonymous peer group is suppressed", "passed", "One completed reviewer is below the three-voice threshold; no count or score returned.");
} catch (error) {
  record("360 secure reviewer workflow", "failed", error instanceof Error ? error.message : String(error));
  throw error;
} finally {
  globalThis.fetch = realFetch;
  mkdirSync(path.join(ROOT, "artifacts", "360-qa"), { recursive: true });
  writeFileSync(path.join(ROOT, "artifacts", "360-qa", `secure-reviewer-${suffix}.json`), JSON.stringify({ suite: "Orbit 360 secure reviewer workflow", startedAt: new Date(now).toISOString(), completedAt: new Date().toISOString(), steps }, null, 2));
}
