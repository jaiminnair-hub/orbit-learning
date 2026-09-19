const UUID_PATTERN = /^[0-9a-f-]{36}$/i;
const ANONYMOUS_GROUPS = new Set(["peer", "same_team", "cross_functional", "direct_report", "external"]);
const GROUP_LABELS = { self: "Self", manager: "Manager", skip_manager: "Skip-level manager", peer: "Peers", same_team: "Same-team colleagues", cross_functional: "Cross-functional partners", direct_report: "Direct reports", external: "External customers" };

function json(response, status, payload) { return response.status(status).json(payload); }
function config() { return { url: process.env.ORBIT_SUPABASE_URL, serviceKey: process.env.ORBIT_SUPABASE_SERVICE_ROLE_KEY, publishableKey: process.env.ORBIT_SUPABASE_PUBLISHABLE_KEY, cronSecret: process.env.CRON_SECRET }; }
async function db(settings, path, options = {}) {
  const response = await fetch(`${settings.url}${path}`, { ...options, headers: { apikey: settings.serviceKey, Authorization: `Bearer ${settings.serviceKey}`, "Content-Type": "application/json", ...(options.headers || {}) } });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.message || payload?.hint || "Orbit could not prepare this protected report.");
  return payload;
}
async function authenticatedUser(settings, request) {
  const authorization = request.headers.authorization || "";
  if (!authorization.startsWith("Bearer ")) throw new Error("Sign in before viewing protected reports.");
  const response = await fetch(`${settings.url}/auth/v1/user`, { headers: { apikey: settings.publishableKey, Authorization: authorization } });
  const user = await response.json().catch(() => null);
  if (!response.ok || !user?.id) throw new Error("Your Orbit session has expired. Please sign in again.");
  return user;
}
function mean(values) { return values.length ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100 : null; }
function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
function csvResponse(response, cycle, reports) {
  // Deliberately the same shape the JSON report already exposes -- a
  // withheld anonymous group has already had its counts, scores and
  // competency detail stripped by reportGroup() before this ever runs.
  // This export cannot leak anything the screen doesn't already withhold.
  const header = ["Subject", "Job title", "Group", "Group visible", "Invited", "Completed", "Group rating average", "Competency", "Competency average", "Competency responses"];
  const rows = [header];
  reports.forEach((report) => {
    if (!report.groups.length) {
      rows.push([report.subjectName, report.jobTitle || "", "", "", "", "", "", "", "", ""]);
      return;
    }
    report.groups.forEach((group) => {
      if (!group.visible) {
        rows.push([report.subjectName, report.jobTitle || "", group.label, "Withheld (below anonymity threshold)", "", "", "", "", "", ""]);
        return;
      }
      if (!group.competencies.length) {
        rows.push([report.subjectName, report.jobTitle || "", group.label, "Visible", group.invited, group.completed, group.ratingAverage ?? "", "", "", ""]);
        return;
      }
      group.competencies.forEach((competency) => {
        rows.push([report.subjectName, report.jobTitle || "", group.label, "Visible", group.invited, group.completed, group.ratingAverage ?? "", competency.label, competency.average ?? "", competency.responseCount]);
      });
    });
  });
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const filename = `${cycle.name.replace(/[^a-z0-9]+/gi, "-")}-protected-report.csv`;
  response.setHeader("Content-Type", "text/csv; charset=utf-8");
  response.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  return response.status(200).send(csv);
}
function reportGroup(group, raters, completedDeliveryByRater, answersByDelivery, questions, threshold) {
  const completed = raters.filter(rater => completedDeliveryByRater.has(rater.id));
  const visible = !ANONYMOUS_GROUPS.has(group) || completed.length >= threshold;
  const ratings = [];
  const byCompetency = new Map();
  const comments = [];
  completed.forEach(rater => (answersByDelivery.get(completedDeliveryByRater.get(rater.id)) || []).forEach(answer => {
    const question = questions.get(answer.cycle_question_id);
    if (answer.rating !== null && answer.rating !== undefined) {
      const competency = question?.competency_label || "General capability";
      ratings.push(Number(answer.rating));
      if (!byCompetency.has(competency)) byCompetency.set(competency, []);
      byCompetency.get(competency).push(Number(answer.rating));
    }
    // Comments are per-response free text, never per-rater-attributed once
    // grouped here -- same anonymity gate as scores, just no averaging.
    if (answer.comment && String(answer.comment).trim() && visible) {
      comments.push({ prompt: question?.prompt || "Open-ended question", competencyLabel: question?.competency_label || null, text: String(answer.comment).trim() });
    }
  }));
  // For a withheld anonymous group, even its completion count can reveal who
  // contributed. Return no count, scores, comments, or competency detail.
  return { key: group, label: GROUP_LABELS[group] || group, invited: visible ? raters.length : null, completed: visible ? completed.length : null, visible, minimum: ANONYMOUS_GROUPS.has(group) ? threshold : null, ratingAverage: visible ? mean(ratings) : null, responseCount: visible ? ratings.length : 0, competencies: visible ? [...byCompetency.entries()].map(([label, values]) => ({ label, average: mean(values), responseCount: values.length })).sort((a, b) => a.label.localeCompare(b.label)) : [], comments: visible ? comments : [] };
}

// Vercel Cron calls this endpoint directly on a schedule (see vercel.json)
// -- there is no signed-in user on that request. Vercel signs cron-
// triggered requests with "Authorization: Bearer <CRON_SECRET>" when that
// secret is configured; checked before any normal user-auth path below,
// and folded into this file rather than kept as its own function to stay
// under the Hobby plan's 12-serverless-function limit for this project.
async function runScheduledRelease(settings) {
  const now = new Date().toISOString();
  // Only a cycle already closed, past its own chosen release moment, and
  // not already fully processed is due. A cycle stays "closed" (not
  // "report_ready") until this runs, so this query naturally skips
  // anything already handled by a previous run.
  const dueCycles = await db(settings, `/rest/v1/feedback_cycles?status=eq.closed&report_release_at=lte.${encodeURIComponent(now)}&select=id,organization_id,name,comments_reviewed_at`);
  const results = [];
  for (const cycle of dueCycles) {
    // A cycle with open-text questions cannot auto-release until an
    // administrator has ticked "I've reviewed the comments" -- the same
    // gate the manual release action enforces. It stays "closed" and is
    // picked up by a later run once reviewed.
    const openTextQuestions = await db(settings, `/rest/v1/feedback_cycle_questions?cycle_id=eq.${cycle.id}&organization_id=eq.${cycle.organization_id}&question_type=eq.open_text&select=id&limit=1`);
    if (openTextQuestions.length && !cycle.comments_reviewed_at) {
      results.push({ cycleId: cycle.id, cycleName: cycle.name, released: 0, skipped: "comments_not_reviewed" });
      continue;
    }
    const subjects = await db(settings, `/rest/v1/feedback_cycle_roster_subjects?cycle_id=eq.${cycle.id}&organization_id=eq.${cycle.organization_id}&status=neq.withdrawn&select=id`);
    let released = 0;
    for (const subject of subjects) {
      await db(settings, "/rest/v1/feedback_directory_report_releases?on_conflict=roster_subject_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ organization_id: cycle.organization_id, cycle_id: cycle.id, roster_subject_id: subject.id, status: "released", released_at: now, released_by: null }) });
      released += 1;
    }
    await db(settings, `/rest/v1/feedback_cycles?id=eq.${cycle.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "report_ready" }) });
    await db(settings, "/rest/v1/audit_events", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ organization_id: cycle.organization_id, actor_id: null, event_type: "feedback.reports_auto_released", entity_type: "feedback_cycle", entity_id: cycle.id, metadata: { released, triggeredBy: "scheduled_release_cron" } }) });
    results.push({ cycleId: cycle.id, cycleName: cycle.name, released });
  }
  return results;
}

module.exports = async (request, response) => {
  const settings = config();

  if (settings.cronSecret && request.headers.authorization === `Bearer ${settings.cronSecret}`) {
    if (!settings.url || !settings.serviceKey) return json(response, 503, { message: "Scheduled release is not configured yet." });
    try {
      const results = await runScheduledRelease(settings);
      return json(response, 200, { processed: results.length, results });
    } catch (error) {
      console.error("Scheduled release cron failed", error);
      return json(response, 500, { message: error.message || "Scheduled release could not run." });
    }
  }

  if (!["GET", "POST"].includes(request.method)) return response.status(405).setHeader("Allow", "GET, POST").json({ message: "Method not allowed." });
  if (!settings.url || !settings.serviceKey || !settings.publishableKey) return json(response, 503, { message: "Protected reporting is not configured yet." });
  try {
    const body = request.body && typeof request.body === "object" ? request.body : {};
    const organizationId = request.method === "GET" ? request.query.organizationId : body.organizationId;
    const cycleId = request.method === "GET" ? request.query.cycleId : body.cycleId;
    if (!UUID_PATTERN.test(organizationId || "") || !UUID_PATTERN.test(cycleId || "")) return json(response, 400, { message: "Choose an Orbit organization and feedback cycle." });
    const user = await authenticatedUser(settings, request);
    const roles = await db(settings, `/rest/v1/product_role_assignments?organization_id=eq.${organizationId}&user_id=eq.${user.id}&product_key=eq.feedback&role_key=eq.feedback_admin&select=user_id`);
    if (!roles.length) return json(response, 403, { message: "Only an authorised feedback administrator can view protected reports." });
    const cycleRows = await db(settings, `/rest/v1/feedback_cycles?id=eq.${cycleId}&organization_id=eq.${organizationId}&select=id,name,status,anonymous_group_threshold,feedback_closes_at,comments_reviewed_at,comments_reviewed_by`);
    const cycle = cycleRows[0];
    if (!cycle) return json(response, 404, { message: "This feedback cycle was not found." });
    const [subjects, raters, deliveries, answers, questionRows, people, releases, openTextQuestions, actionPlans] = await Promise.all([
      db(settings, `/rest/v1/feedback_cycle_roster_subjects?organization_id=eq.${organizationId}&cycle_id=eq.${cycleId}&status=neq.withdrawn&select=id,subject_person_id`),
      db(settings, `/rest/v1/feedback_cycle_roster_raters?organization_id=eq.${organizationId}&cycle_id=eq.${cycleId}&status=in.(approved,invited,submitted)&select=id,subject_roster_id,rater_group`),
      db(settings, `/rest/v1/feedback_invitation_deliveries?organization_id=eq.${organizationId}&cycle_id=eq.${cycleId}&select=id,roster_rater_id,status,created_at`),
      db(settings, `/rest/v1/feedback_invitation_responses?organization_id=eq.${organizationId}&cycle_id=eq.${cycleId}&select=delivery_id,cycle_question_id,rating,comment`),
      db(settings, `/rest/v1/feedback_cycle_questions?organization_id=eq.${organizationId}&cycle_id=eq.${cycleId}&select=id,competency_label,prompt`),
      db(settings, `/rest/v1/organization_people?organization_id=eq.${organizationId}&select=id,full_name,job_title`),
      db(settings, `/rest/v1/feedback_directory_report_releases?organization_id=eq.${organizationId}&cycle_id=eq.${cycleId}&select=roster_subject_id,status,released_at`).catch(error => { if (error.message.includes("feedback_directory_report_releases")) throw new Error("Protected reports need the latest database migration before they can be viewed."); throw error; }),
      db(settings, `/rest/v1/feedback_cycle_questions?organization_id=eq.${organizationId}&cycle_id=eq.${cycleId}&question_type=eq.open_text&select=id&limit=1`),
      db(settings, `/rest/v1/feedback_directory_action_plans?organization_id=eq.${organizationId}&cycle_id=eq.${cycleId}&select=id,roster_subject_id,status,feedback_directory_action_goals(id,competency_id,title,behavioral_commitment,due_at,status,sort_order)`).catch(() => [])
    ]);
    const commentReviewRequired = openTextQuestions.length > 0;
    if (request.method === "POST" && body.action === "mark_comments_reviewed") {
      if (!['closed', 'report_ready'].includes(cycle.status)) return json(response, 409, { message: "Close the feedback cycle before reviewing its comments." });
      await db(settings, `/rest/v1/feedback_cycles?id=eq.${cycleId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ comments_reviewed_at: new Date().toISOString(), comments_reviewed_by: user.id }) });
      await db(settings, "/rest/v1/audit_events", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ organization_id: organizationId, actor_id: user.id, event_type: "feedback.comments_reviewed", entity_type: "feedback_cycle", entity_id: cycleId, metadata: {} }) });
      return json(response, 200, { reviewed: true });
    }
    if (request.method === "POST" && body.action === "release") {
      if (!UUID_PATTERN.test(body.rosterSubjectId || "")) return json(response, 400, { message: "Choose a report to release." });
      if (!subjects.some(subject => subject.id === body.rosterSubjectId)) return json(response, 404, { message: "That person is not part of this cycle." });
      if (!['closed', 'report_ready'].includes(cycle.status)) return json(response, 409, { message: "Close the feedback cycle before releasing a report." });
      if (commentReviewRequired && !cycle.comments_reviewed_at) return json(response, 409, { message: "Review this cycle's written comments before releasing any report." });
      await db(settings, "/rest/v1/feedback_directory_report_releases?on_conflict=roster_subject_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ organization_id: organizationId, cycle_id: cycleId, roster_subject_id: body.rosterSubjectId, status: "released", released_at: new Date().toISOString(), released_by: user.id }) });
      return json(response, 200, { released: true });
    }
    if (request.method === "POST" && body.action === "save_action_plan") {
      if (!UUID_PATTERN.test(body.rosterSubjectId || "")) return json(response, 400, { message: "Choose a person to plan actions for." });
      if (!subjects.some(subject => subject.id === body.rosterSubjectId)) return json(response, 404, { message: "That person is not part of this cycle." });
      const goalsInput = Array.isArray(body.goals) ? body.goals : [];
      for (const goal of goalsInput) {
        const title = String(goal.title || "").trim();
        const commitment = String(goal.behavioralCommitment || "").trim();
        if (title.length < 3 || title.length > 240) return json(response, 400, { message: "Each goal needs a title between 3 and 240 characters." });
        if (commitment.length < 10 || commitment.length > 4000) return json(response, 400, { message: "Each goal's behavioral commitment needs to be between 10 and 4000 characters." });
      }
      const [plan] = await db(settings, "/rest/v1/feedback_directory_action_plans?on_conflict=roster_subject_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify({ organization_id: organizationId, cycle_id: cycleId, roster_subject_id: body.rosterSubjectId, created_by: user.id }) });
      const existingGoals = await db(settings, `/rest/v1/feedback_directory_action_goals?organization_id=eq.${organizationId}&action_plan_id=eq.${plan.id}&select=id`);
      const keepIds = new Set(goalsInput.filter(goal => UUID_PATTERN.test(goal.id || "")).map(goal => goal.id));
      const toDelete = existingGoals.filter(goal => !keepIds.has(goal.id));
      for (const goal of toDelete) {
        await db(settings, `/rest/v1/feedback_directory_action_goals?id=eq.${goal.id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
      }
      for (const [index, goal] of goalsInput.entries()) {
        const payload = { organization_id: organizationId, action_plan_id: plan.id, competency_id: UUID_PATTERN.test(goal.competencyId || "") ? goal.competencyId : null, title: String(goal.title).trim(), behavioral_commitment: String(goal.behavioralCommitment).trim(), due_at: goal.dueAt || null, status: ['not_started', 'in_progress', 'complete', 'cancelled'].includes(goal.status) ? goal.status : 'not_started', sort_order: index };
        if (UUID_PATTERN.test(goal.id || "") && keepIds.has(goal.id)) {
          await db(settings, `/rest/v1/feedback_directory_action_goals?id=eq.${goal.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(payload) });
        } else {
          await db(settings, "/rest/v1/feedback_directory_action_goals", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(payload) });
        }
      }
      await db(settings, "/rest/v1/audit_events", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ organization_id: organizationId, actor_id: user.id, event_type: "feedback.action_plan_saved", entity_type: "feedback_directory_action_plans", entity_id: plan.id, metadata: { rosterSubjectId: body.rosterSubjectId, goalCount: goalsInput.length } }) });
      return json(response, 200, { saved: true });
    }
    if (request.method === "POST" && body.action === "reopen_cycle") {
      // Reopening only extends the response window for people who have not
      // finished yet — a completed response cannot be edited even after
      // reopen (enforced at the database level, not here). Any already-
      // released report is withdrawn until the cycle is explicitly closed
      // and released again, so nobody acts on now-outdated insight.
      if (!['closed', 'report_ready'].includes(cycle.status)) return json(response, 409, { message: "Only a closed cycle can be reopened." });
      // The cycle-status change is the one guarded by a database trigger
      // (it can reject reopen, e.g. no reviewer left who hasn't submitted)
      // and must run first: if it fails, nothing else should have happened.
      // A withdrawn report is a real confidentiality-relevant side effect,
      // not something to risk leaving behind after a failed reopen.
      await db(settings, `/rest/v1/feedback_cycles?id=eq.${cycleId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "live" }) });
      const withdrawn = await db(settings, `/rest/v1/feedback_directory_report_releases?organization_id=eq.${organizationId}&cycle_id=eq.${cycleId}&status=eq.released`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ status: "withheld", released_at: null, released_by: null }) });
      await db(settings, "/rest/v1/audit_events", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ organization_id: organizationId, actor_id: user.id, event_type: "feedback.cycle_reopened", entity_type: "feedback_cycle", entity_id: cycleId, metadata: { previousStatus: cycle.status, reportsWithdrawn: withdrawn.length } }) });
      return json(response, 200, { reopened: true, reportsWithdrawn: withdrawn.length });
    }
    const peopleById = new Map(people.map(person => [person.id, person]));
    const questions = new Map(questionRows.map(question => [question.id, question]));
    const completedDeliveryByRater = new Map();
    deliveries.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))).forEach(delivery => { if (delivery.status === "completed") completedDeliveryByRater.set(delivery.roster_rater_id, delivery.id); });
    const answersByDelivery = new Map();
    answers.forEach(answer => { if (!answersByDelivery.has(answer.delivery_id)) answersByDelivery.set(answer.delivery_id, []); answersByDelivery.get(answer.delivery_id).push(answer); });
    const releaseBySubject = new Map(releases.map(release => [release.roster_subject_id, release]));
    const actionPlanBySubject = new Map(actionPlans.map(plan => [plan.roster_subject_id, plan]));
    const reports = subjects.map(subject => {
      const grouped = new Map();
      raters.filter(rater => rater.subject_roster_id === subject.id).forEach(rater => { if (!grouped.has(rater.rater_group)) grouped.set(rater.rater_group, []); grouped.get(rater.rater_group).push(rater); });
      const groups = [...grouped.entries()].map(([group, groupRaters]) => reportGroup(group, groupRaters, completedDeliveryByRater, answersByDelivery, questions, Number(cycle.anonymous_group_threshold))).sort((a, b) => a.label.localeCompare(b.label));
      const person = peopleById.get(subject.subject_person_id) || {};
      const release = releaseBySubject.get(subject.id);
      const plan = actionPlanBySubject.get(subject.id);
      const actionPlan = plan ? { status: plan.status, goals: [...(plan.feedback_directory_action_goals || [])].sort((a, b) => a.sort_order - b.sort_order).map(goal => ({ id: goal.id, competencyId: goal.competency_id, title: goal.title, behavioralCommitment: goal.behavioral_commitment, dueAt: goal.due_at, status: goal.status })) } : { status: "not_started", goals: [] };
      return { rosterSubjectId: subject.id, subjectName: person.full_name || "Feedback subject", jobTitle: person.job_title || null, completion: { invited: raters.filter(rater => rater.subject_roster_id === subject.id).length, completed: raters.filter(rater => rater.subject_roster_id === subject.id && completedDeliveryByRater.has(rater.id)).length }, released: release?.status === "released", releasedAt: release?.released_at || null, groups, actionPlan };
    });
    if (request.method === "GET" && request.query.format === "csv") {
      return csvResponse(response, cycle, reports);
    }
    return json(response, 200, { cycle: { id: cycle.id, name: cycle.name, status: cycle.status, anonymousGroupThreshold: cycle.anonymous_group_threshold, canRelease: ['closed', 'report_ready'].includes(cycle.status), commentReviewRequired, commentsReviewedAt: cycle.comments_reviewed_at }, reports });
  } catch (error) { console.error("Protected report failed", error); return json(response, 400, { message: error.message || "Orbit could not prepare this protected report." }); }
};
