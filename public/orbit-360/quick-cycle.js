const config = window.ORBIT_PLATFORM_SUPABASE;
const sessionStorageKey = "orbit-platform-session-v1";
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const state = {
  token: null,
  user: null,
  activeOrganization: null,
  editingCycleId: null,
  subject: null, // { id, name, context, email, rosterSubjectId? }
  reviewers: [], // { kind: "internal"|"external", id, name, email, existingRaterId? }
  pendingReviewers: [], // same shape, loaded from a draft, awaiting an approve/reject decision
  questions: [], // { competency_label, question_type, prompt, existingId? }
  departments: []
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
}

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  window.setTimeout(() => element.classList.remove("show"), 3200);
}

function note(message) { $("#quick-note").textContent = message || ""; }

function headers() {
  return { apikey: config.publishableKey, Authorization: `Bearer ${state.token}`, "Content-Type": "application/json" };
}

async function rest(table, query = "", options = {}) {
  const response = await fetch(`${config.url}/rest/v1/${table}${query ? `?${query}` : ""}`, { ...options, headers: { ...headers(), ...(options.headers || {}) } });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.message || payload?.hint || `Orbit could not complete that request (${table}).`);
  return payload;
}

async function restoreSessionOrRedirect() {
  const saved = JSON.parse(localStorage.getItem(sessionStorageKey) || "null");
  if (!saved?.token) { location.href = "orbit-console.html"; return false; }
  state.token = saved.token;
  const response = await fetch(`${config.url}/auth/v1/user`, { headers: { apikey: config.publishableKey, Authorization: `Bearer ${state.token}` } });
  const user = await response.json().catch(() => null);
  if (!response.ok || !user?.id) { location.href = "orbit-console.html"; return false; }
  state.user = user;
  return true;
}

function showOrgStep(mode) {
  $("#step-org").classList.remove("hidden");
  $("#quick-cycle-steps").classList.add("hidden");
  $("#quick-org-form").classList.toggle("hidden", mode !== "create");
  const action = $("#quick-org-action");
  action.classList.toggle("hidden", mode === "create" || mode === "wait");
  if (mode === "create") {
    $("#org-step-title").textContent = "Create your organisation";
    $("#org-step-hint").textContent = "You're not part of an Orbit organisation yet. Create one to start your first 360 cycle — you'll become its owner.";
  } else if (mode === "trial") {
    $("#org-step-title").textContent = "Activate 360 Feedback";
    $("#org-step-hint").textContent = "Your organisation is ready. Turn on a 14-day 360 Feedback trial to continue.";
    action.textContent = "Activate 360 workspace →";
  } else if (mode === "finish") {
    $("#org-step-title").textContent = "Finish 360 setup";
    $("#org-step-hint").textContent = "360 Feedback is already active for your organisation. Finish setup to give this account administrator access.";
    action.textContent = "Finish 360 setup →";
  } else {
    $("#org-step-title").textContent = "Waiting on an administrator";
    $("#org-step-hint").textContent = "360 Feedback is active for your organisation, but only an owner or administrator can grant you access here. Ask them to finish setup, or grant it to you directly.";
  }
}

async function loadActiveOrganization() {
  const memberships = await rest("organization_memberships", `user_id=eq.${state.user.id}&status=eq.active&select=organization_id,org_role`);
  if (!memberships.length) { showOrgStep("create"); return; }

  const activeRows = await rest("user_active_organizations", `user_id=eq.${state.user.id}&select=organization_id`);
  const organizationId = activeRows[0]?.organization_id || memberships[0].organization_id;
  const membership = memberships.find((item) => item.organization_id === organizationId) || memberships[0];
  const orgs = await rest("foundation_organizations", `id=eq.${organizationId}&select=id,name`);
  state.activeOrganization = orgs[0];

  const [adminRoles, entitlements] = await Promise.all([
    rest("product_role_assignments", `organization_id=eq.${organizationId}&user_id=eq.${state.user.id}&product_key=eq.feedback&role_key=eq.feedback_admin&select=user_id`),
    rest("organization_product_entitlements", `organization_id=eq.${organizationId}&product_key=eq.feedback&status=in.(trial,active)&select=status`)
  ]);

  if (adminRoles.length) {
    $("#step-org").classList.add("hidden");
    $("#quick-cycle-steps").classList.remove("hidden");
    const people = await rest("organization_people", `organization_id=eq.${organizationId}&employment_status=eq.active&select=department`);
    state.departments = [...new Set(people.map((person) => person.department).filter(Boolean))].sort();
    const select = $("#department-select");
    state.departments.forEach((department) => {
      const option = document.createElement("option");
      option.value = department;
      option.textContent = department;
      select.appendChild(option);
    });
    await loadDraftOptions();
    return;
  }

  // Mirrors orbit-console.js's own canStartTrial/canFinishFeedbackSetup rules
  // exactly (§ "start-trial" click handler) rather than inventing a looser
  // version of the same access-control decision.
  const hasEntitlement = entitlements.length > 0;
  const canStartTrial = membership.org_role === "org_owner";
  const canFinishSetup = ["org_owner", "org_admin"].includes(membership.org_role);
  if (hasEntitlement && canFinishSetup) { showOrgStep("finish"); return; }
  if (!hasEntitlement && canStartTrial) { showOrgStep("trial"); return; }
  showOrgStep("wait");
}

$("#quick-org-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = $("#quick-org-name").value.trim();
  const slug = $("#quick-org-slug").value.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const noteEl = $("#org-step-note");
  try {
    noteEl.textContent = "Creating organisation…";
    await rest("rpc/create_organization_for_current_user", "", { method: "POST", body: JSON.stringify({ organization_name: name, organization_slug: slug }) });
    noteEl.textContent = "Organisation created — activating your 360 trial…";
    await loadActiveOrganization();
  } catch (error) { noteEl.textContent = error.message; }
});

$("#quick-org-action").addEventListener("click", async () => {
  const button = $("#quick-org-action");
  const noteEl = $("#org-step-note");
  try {
    button.disabled = true;
    const finishing = button.textContent.includes("Finish");
    if (finishing) {
      const response = await fetch("/api/feedback-access", { method: "POST", headers: headers() });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || "Orbit could not finish 360 setup.");
    } else {
      await rest("rpc/start_feedback_trial_for_current_org", "", { method: "POST", body: JSON.stringify({}) });
    }
    noteEl.textContent = "";
    await loadActiveOrganization();
  } catch (error) { noteEl.textContent = error.message; }
  finally { button.disabled = false; }
});

// ---- Resume a draft cycle ----
async function loadDraftOptions() {
  const drafts = await rest("feedback_cycles", `organization_id=eq.${state.activeOrganization.id}&status=eq.draft&select=id,name&order=created_at.desc`).catch(() => []);
  const bar = $("#quick-resume-bar");
  const select = $("#resume-draft-select");
  if (!drafts.length) { bar.classList.add("hidden"); return; }
  bar.classList.remove("hidden");
  select.innerHTML = `<option value="">Start a new cycle</option>${drafts.map((draft) => `<option value="${draft.id}">${escapeHtml(draft.name)}</option>`).join("")}`;
}

function resetQuickCycleState() {
  state.editingCycleId = null;
  state.subject = null;
  state.reviewers = [];
  state.pendingReviewers = [];
  state.questions = [];
  $("#subject-chosen").innerHTML = "";
  $("#add-manager-reviewer").classList.add("hidden");
  $("#quick-opens").value = toLocalInputValue(new Date());
  $("#quick-closes").value = toLocalInputValue(new Date(Date.now() + 14 * 86400000));
  $("#quick-threshold").value = "3";
  $("#question-custom-note").value = "";
  renderQuestions();
  renderReviewerChips();
  renderPendingReviewers();
}

$("#resume-draft-select").addEventListener("change", async (event) => {
  const cycleId = event.target.value;
  if (!cycleId) { resetQuickCycleState(); return; }
  const noteEl = $("#quick-note");
  try {
    noteEl.textContent = "Loading draft…";
    const [cycle] = await rest("feedback_cycles", `id=eq.${cycleId}&select=id,name,purpose,description,feedback_opens_at,feedback_closes_at,anonymous_group_threshold`);
    state.editingCycleId = cycle.id;

    const [questions, subjects, raters, externalContacts] = await Promise.all([
      rest("feedback_cycle_questions", `cycle_id=eq.${cycleId}&select=id,competency_label,question_type,prompt&order=sort_order.asc`),
      rest("feedback_cycle_roster_subjects", `cycle_id=eq.${cycleId}&select=id,subject_person_id`),
      rest("feedback_cycle_roster_raters", `cycle_id=eq.${cycleId}&select=id,reviewer_person_id,external_contact_id,status&status=in.(approved,pending)`),
      rest("feedback_external_contacts", `cycle_id=eq.${cycleId}&select=id,full_name,email`)
    ]);

    state.questions = questions.map((question) => ({ existingId: question.id, competency_label: question.competency_label || "", question_type: question.question_type, prompt: question.prompt }));

    const subjectRow = subjects[0];
    if (subjectRow) {
      const [person] = await rest("organization_people", `id=eq.${subjectRow.subject_person_id}&select=id,full_name,job_title,department,work_email`);
      state.subject = { id: person.id, name: person.full_name, context: person.job_title || person.department || "", email: (person.work_email || "").toLowerCase(), rosterSubjectId: subjectRow.id };
      $("#subject-chosen").innerHTML = `<span class="quick-chip">${escapeHtml(person.full_name)}<button type="button" id="clear-subject">×</button></span>`;
      $("#clear-subject").addEventListener("click", () => { state.subject = null; $("#subject-chosen").innerHTML = ""; updateSummary(); });
    }

    const externalById = new Map(externalContacts.map((contact) => [contact.id, contact]));
    const internalIds = raters.filter((rater) => rater.reviewer_person_id).map((rater) => rater.reviewer_person_id);
    const internalPeople = internalIds.length ? await rest("organization_people", `id=in.(${internalIds.join(",")})&select=id,full_name`) : [];
    const internalById = new Map(internalPeople.map((person) => [person.id, person]));
    const toReviewer = (rater) => rater.external_contact_id
      ? { kind: "external", id: `external-${externalById.get(rater.external_contact_id)?.email}`, name: externalById.get(rater.external_contact_id)?.full_name || "External reviewer", email: externalById.get(rater.external_contact_id)?.email, existingRaterId: rater.id }
      : { kind: "internal", id: rater.reviewer_person_id, name: internalById.get(rater.reviewer_person_id)?.full_name || "Reviewer", existingRaterId: rater.id };
    // Approved raters are already good to go, so they load as ordinary
    // reviewer chips. Pending ones (e.g. nominated in the full builder but
    // never approved there) need an explicit decision here - silently
    // treating them as approved, or silently ignoring them, are both wrong.
    state.reviewers = raters.filter((rater) => rater.status === "approved").map(toReviewer);
    state.pendingReviewers = raters.filter((rater) => rater.status === "pending").map(toReviewer);
    renderPendingReviewers();

    if (cycle.feedback_opens_at) $("#quick-opens").value = toLocalInputValue(new Date(cycle.feedback_opens_at));
    if (cycle.feedback_closes_at) $("#quick-closes").value = toLocalInputValue(new Date(cycle.feedback_closes_at));
    $("#quick-threshold").value = String(cycle.anonymous_group_threshold || 3);
    if (cycle.purpose === "appraisal") $("#question-purpose").value = "performance";
    if (cycle.description) $("#question-custom-note").value = cycle.description;

    renderQuestions();
    renderReviewerChips();
    noteEl.textContent = `Continuing "${cycle.name}" — anything you add below joins what's already there.`;
  } catch (error) { noteEl.textContent = error.message; }
});

// ---- Info (i) buttons ----
$$('.quick-info').forEach((button) => button.addEventListener("click", () => {
  const panel = $(`#${button.dataset.infoTarget}`);
  const expanded = !panel.classList.contains("hidden");
  panel.classList.toggle("hidden", expanded);
  button.setAttribute("aria-expanded", String(!expanded));
}));

// ---- Reviewer file upload ----
function normalizeReviewerRows(records) {
  const rows = [];
  records.forEach((record) => {
    const entries = Object.entries(record);
    const find = (aliases) => {
      for (const alias of aliases) {
        const match = entries.find(([key]) => key.toLowerCase().replace(/[^a-z0-9]/g, "") === alias);
        if (match && String(match[1] ?? "").trim()) return String(match[1]).trim();
      }
      return "";
    };
    const fullName = find(["fullname", "name"]);
    const email = find(["email", "workemail"]).toLowerCase();
    if (fullName && /^\S+@\S+\.\S+$/.test(email)) rows.push({ name: fullName, email });
  });
  return rows;
}

let reviewerFileRows = [];
$("#reviewer-file").addEventListener("change", async (event) => {
  const [file] = event.target.files;
  const noteEl = $("#reviewer-upload-note");
  const importButton = $("#import-reviewer-file");
  if (!file) return;
  $("#reviewer-file-name").textContent = file.name;
  try {
    if (!window.XLSX) throw new Error("The spreadsheet reader is still loading. Choose the file again in a moment.");
    const workbook = window.XLSX.read(await file.arrayBuffer(), { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    reviewerFileRows = normalizeReviewerRows(window.XLSX.utils.sheet_to_json(sheet, { defval: "" }));
    importButton.disabled = !reviewerFileRows.length;
    noteEl.textContent = reviewerFileRows.length ? `${reviewerFileRows.length} reviewer${reviewerFileRows.length === 1 ? "" : "s"} ready to add.` : "No valid rows found. Include a Full Name column and an Email column.";
  } catch (error) { reviewerFileRows = []; importButton.disabled = true; noteEl.textContent = error.message; }
});

$("#import-reviewer-file").addEventListener("click", () => {
  let added = 0;
  let skippedSubject = 0;
  reviewerFileRows.forEach((row) => {
    if (state.subject && row.email.toLowerCase() === (state.subject.email || "").toLowerCase()) { skippedSubject += 1; return; }
    if (state.reviewers.some((reviewer) => reviewer.email === row.email || reviewer.id === row.email)) return;
    state.reviewers.push({ kind: "external", id: `external-${row.email}`, name: row.name, email: row.email });
    added += 1;
  });
  toast(`${added} reviewer${added === 1 ? "" : "s"} added${skippedSubject ? ` · ${skippedSubject} skipped (matches the subject)` : ""}.`);
  reviewerFileRows = [];
  $("#reviewer-file").value = "";
  $("#reviewer-file-name").textContent = "No file selected";
  $("#reviewer-upload-note").textContent = "";
  $("#import-reviewer-file").disabled = true;
  renderReviewerChips();
});

// ---- Step 1: subject search ----
let subjectSearchTimer = null;
$("#subject-search").addEventListener("input", (event) => {
  window.clearTimeout(subjectSearchTimer);
  const query = event.target.value.trim();
  if (query.length < 2) { $("#subject-results").innerHTML = ""; return; }
  subjectSearchTimer = window.setTimeout(async () => {
    const people = await rest("organization_people", `organization_id=eq.${state.activeOrganization.id}&employment_status=eq.active&full_name=ilike.*${encodeURIComponent(query)}*&select=id,full_name,job_title,department,work_email,manager_email&limit=8`).catch(() => []);
    $("#subject-results").innerHTML = people.map((person) =>
      `<div class="quick-result-row" data-subject-id="${person.id}" data-email="${escapeHtml(person.work_email || "")}" data-manager-email="${escapeHtml(person.manager_email || "")}"><b>${escapeHtml(person.full_name)}</b><span>${escapeHtml(person.job_title || person.department || "")}</span></div>`
    ).join("") || "<div class=\"quick-result-row\"><span>No match in your directory.</span></div>";
  }, 220);
});

$("#subject-results").addEventListener("click", async (event) => {
  const row = event.target.closest("[data-subject-id]");
  if (!row) return;
  const id = row.dataset.subjectId;
  const label = row.querySelector("b").textContent;
  const sub = row.querySelector("span").textContent;
  const managerEmail = row.dataset.managerEmail;
  state.subject = { id, name: label, context: sub, email: (row.dataset.email || "").toLowerCase(), managerPersonId: null, managerName: null };
  $("#subject-chosen").innerHTML = `<span class="quick-chip">${escapeHtml(label)}<button type="button" id="clear-subject">×</button></span>`;
  $("#subject-search").value = "";
  $("#subject-results").innerHTML = "";
  $("#clear-subject").addEventListener("click", () => { state.subject = null; $("#subject-chosen").innerHTML = ""; $("#add-manager-reviewer").classList.add("hidden"); updateSummary(); });
  // A one-click shortcut for the single most common relationship - the
  // subject's own manager - without building the full perspective/hierarchy
  // system the full builder already owns. Deliberately narrow.
  $("#add-manager-reviewer").classList.add("hidden");
  if (managerEmail) {
    const [manager] = await rest("organization_people", `organization_id=eq.${state.activeOrganization.id}&work_email=eq.${encodeURIComponent(managerEmail)}&select=id,full_name`).catch(() => []);
    if (manager) {
      state.subject.managerPersonId = manager.id;
      state.subject.managerName = manager.full_name;
      const button = $("#add-manager-reviewer");
      button.textContent = `+ Add ${manager.full_name} as reviewer (their manager)`;
      button.classList.remove("hidden");
    }
  }
  // A subject can only ever be reviewed by someone else. If they were already
  // added as a reviewer before being picked here (e.g. via the department
  // picker, before any subject existed to exclude), take them back out now
  // rather than silently letting someone review themselves.
  const removedCount = state.reviewers.length;
  state.reviewers = state.reviewers.filter((reviewer) => reviewer.id !== state.subject.id);
  if (removedCount !== state.reviewers.length) toast(`${label} was already added as a reviewer — removed, since the subject can't review themselves.`);
  renderReviewerChips();
});

$("#add-manager-reviewer").addEventListener("click", () => {
  if (!state.subject?.managerPersonId) return;
  if (state.reviewers.some((reviewer) => reviewer.id === state.subject.managerPersonId)) { toast("Already added."); return; }
  state.reviewers.push({ kind: "internal", id: state.subject.managerPersonId, name: state.subject.managerName });
  $("#add-manager-reviewer").classList.add("hidden");
  renderReviewerChips();
});

// ---- Step 2: reviewers ----
$$('.quick-tab').forEach((tab) => tab.addEventListener("click", () => {
  $$('.quick-tab').forEach((item) => item.classList.remove("active"));
  tab.classList.add("active");
  $$('.quick-tab-panel').forEach((panel) => panel.classList.add("hidden"));
  $(`[data-reviewer-panel="${tab.dataset.reviewerTab}"]`).classList.remove("hidden");
}));

function renderReviewerChips() {
  $("#reviewer-chosen").innerHTML = state.reviewers.map((reviewer, index) =>
    `<span class="quick-chip">${escapeHtml(reviewer.name)}${reviewer.kind === "external" ? " (external)" : ""}<button type="button" data-remove-reviewer="${index}">×</button></span>`
  ).join("");
  updateSummary();
}

$("#reviewer-chosen").addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-reviewer]");
  if (!button) return;
  state.reviewers.splice(Number(button.dataset.removeReviewer), 1);
  renderReviewerChips();
});

function renderPendingReviewers() {
  const container = $("#pending-reviewers");
  if (!state.pendingReviewers.length) { container.innerHTML = ""; return; }
  container.innerHTML = `<p class="quick-step-hint">Nominated but not yet approved — decide on each before launching:</p>` +
    state.pendingReviewers.map((reviewer, index) => `
      <div class="quick-pending-row">
        <span>${escapeHtml(reviewer.name)}${reviewer.kind === "external" ? " (external)" : ""}</span>
        <button type="button" class="quick-btn secondary small" data-approve-pending="${index}">Approve</button>
        <button type="button" class="quick-btn secondary small" data-reject-pending="${index}">Reject</button>
      </div>`).join("");
}

$("#pending-reviewers").addEventListener("click", async (event) => {
  const approveButton = event.target.closest("[data-approve-pending]");
  const rejectButton = event.target.closest("[data-reject-pending]");
  if (approveButton) {
    const index = Number(approveButton.dataset.approvePending);
    const reviewer = state.pendingReviewers[index];
    approveButton.disabled = true;
    try {
      await rest(`feedback_cycle_roster_raters?id=eq.${reviewer.existingRaterId}`, "", { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "approved", reviewed_by: state.user.id }) });
      state.pendingReviewers.splice(index, 1);
      state.reviewers.push(reviewer);
      toast(`${reviewer.name} approved.`);
      renderPendingReviewers();
      renderReviewerChips();
    } catch (error) { toast(error.message); approveButton.disabled = false; }
  } else if (rejectButton) {
    // Leaving the underlying row at "pending" is enough - launch only ever
    // sends to raters whose status is "approved", so an unapproved
    // nomination simply never receives an invitation. No delete needed.
    const index = Number(rejectButton.dataset.rejectPending);
    toast(`${state.pendingReviewers[index].name} left unapproved — they won't be invited.`);
    state.pendingReviewers.splice(index, 1);
    renderPendingReviewers();
  }
});

let reviewerSearchTimer = null;
$("#reviewer-search").addEventListener("input", (event) => {
  window.clearTimeout(reviewerSearchTimer);
  const query = event.target.value.trim();
  if (query.length < 2) { $("#reviewer-results").innerHTML = ""; return; }
  reviewerSearchTimer = window.setTimeout(async () => {
    const people = await rest("organization_people", `organization_id=eq.${state.activeOrganization.id}&employment_status=eq.active&full_name=ilike.*${encodeURIComponent(query)}*&select=id,full_name,job_title,department&limit=8`).catch(() => []);
    $("#reviewer-results").innerHTML = people.map((person) =>
      `<div class="quick-result-row" data-reviewer-id="${person.id}" data-name="${escapeHtml(person.full_name)}"><b>${escapeHtml(person.full_name)}</b><span>${escapeHtml(person.job_title || person.department || "")}</span></div>`
    ).join("") || "<div class=\"quick-result-row\"><span>No match in your directory.</span></div>";
  }, 220);
});

$("#reviewer-results").addEventListener("click", (event) => {
  const row = event.target.closest("[data-reviewer-id]");
  if (!row) return;
  const id = row.dataset.reviewerId;
  if (state.reviewers.some((reviewer) => reviewer.id === id)) return;
  if (state.subject && id === state.subject.id) { toast("The subject can't also be a reviewer for this cycle."); return; }
  state.reviewers.push({ kind: "internal", id, name: row.dataset.name });
  $("#reviewer-search").value = "";
  $("#reviewer-results").innerHTML = "";
  renderReviewerChips();
});

$("#department-select").addEventListener("change", async (event) => {
  const department = event.target.value;
  if (!department) return;
  const people = await rest("organization_people", `organization_id=eq.${state.activeOrganization.id}&employment_status=eq.active&department=eq.${encodeURIComponent(department)}&select=id,full_name`).catch(() => []);
  let added = 0;
  people.forEach((person) => {
    if (state.subject && person.id === state.subject.id) return;
    if (state.reviewers.some((reviewer) => reviewer.id === person.id)) return;
    state.reviewers.push({ kind: "internal", id: person.id, name: person.full_name });
    added += 1;
  });
  toast(`${added} people added from ${department}.`);
  event.target.value = "";
  renderReviewerChips();
});

$("#add-external").addEventListener("click", () => {
  const name = $("#external-name").value.trim();
  const email = $("#external-email").value.trim().toLowerCase();
  if (!name || !/^\S+@\S+\.\S+$/.test(email)) { toast("Enter a name and a valid work email."); return; }
  state.reviewers.push({ kind: "external", id: `external-${Date.now()}`, name, email });
  $("#external-name").value = "";
  $("#external-email").value = "";
  renderReviewerChips();
});

// ---- Step 3: questions ----
$("#question-purpose").addEventListener("change", (event) => {
  $("#question-custom-note").classList.toggle("hidden", event.target.value !== "custom");
});

function renderQuestions() {
  $("#question-list").innerHTML = state.questions.map((question, index) => `
    <div class="quick-question-card">
      <div class="quick-q-row">
        <div>
          <input type="text" data-q-competency="${index}" value="${escapeHtml(question.competency_label)}" placeholder="Competency (e.g. Communication)" />
          <textarea data-q-prompt="${index}" placeholder="Question wording">${escapeHtml(question.prompt)}</textarea>
        </div>
        <div class="quick-q-row__meta">
          <select data-q-type="${index}">
            <option value="rating" ${question.question_type === "rating" ? "selected" : ""}>1–5 rating</option>
            <option value="open_text" ${question.question_type === "open_text" ? "selected" : ""}>Open text</option>
          </select>
          <button type="button" class="remove" data-remove-question="${index}">Remove</button>
        </div>
      </div>
    </div>`).join("") || "<p class=\"quick-step-hint\">No questions yet — suggest some with AI, or add one manually.</p>";
  updateSummary();
}

$("#question-list").addEventListener("input", (event) => {
  const index = event.target.dataset.qCompetency ?? event.target.dataset.qPrompt ?? event.target.dataset.qType;
  if (index === undefined) return;
  const question = state.questions[Number(index)];
  if (!question) return;
  if (event.target.dataset.qCompetency !== undefined) question.competency_label = event.target.value;
  if (event.target.dataset.qPrompt !== undefined) question.prompt = event.target.value;
  if (event.target.dataset.qType !== undefined) question.question_type = event.target.value;
});

$("#question-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-question]");
  if (!button) return;
  state.questions.splice(Number(button.dataset.removeQuestion), 1);
  renderQuestions();
});

$("#add-question-manual").addEventListener("click", () => {
  state.questions.push({ competency_label: "", question_type: "rating", prompt: "" });
  renderQuestions();
});

function normalizeQuestionFileRows(records) {
  const questions = [];
  records.forEach((record) => {
    const entries = Object.entries(record);
    const find = (aliases) => {
      for (const alias of aliases) {
        const match = entries.find(([key]) => key.toLowerCase().replace(/[^a-z0-9]/g, "") === alias);
        if (match && String(match[1] ?? "").trim()) return String(match[1]).trim();
      }
      return "";
    };
    const prompt = find(["question", "prompt", "questionwording"]);
    const typeValue = find(["questiontype", "type"]).toLowerCase().replace(/[^a-z0-9]/g, "");
    const questionType = ["rating", "15rating", "1to5rating"].includes(typeValue) ? "rating" : "open_text";
    if (prompt.length >= 5) questions.push({ competency_label: find(["competency", "competencylabel"]), question_type: questionType, prompt });
  });
  return questions;
}

$("#question-file").addEventListener("change", async (event) => {
  const [file] = event.target.files;
  const nameEl = $("#question-file-name");
  if (!file) return;
  try {
    if (!window.XLSX) throw new Error("The spreadsheet reader is still loading. Choose the file again in a moment.");
    const workbook = window.XLSX.read(await file.arrayBuffer(), { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const imported = normalizeQuestionFileRows(window.XLSX.utils.sheet_to_json(sheet, { defval: "" }));
    if (!imported.length) { nameEl.textContent = "No valid rows found. Include a Question column and a Question Type column."; return; }
    state.questions.push(...imported);
    nameEl.textContent = `${imported.length} question${imported.length === 1 ? "" : "s"} added from ${file.name}.`;
    renderQuestions();
  } catch (error) { nameEl.textContent = error.message; }
  finally { event.target.value = ""; }
});

$("#suggest-questions").addEventListener("click", async () => {
  const button = $("#suggest-questions");
  const status = $("#ai-status");
  const purpose = $("#question-purpose").value;
  const customInstructions = purpose === "custom" ? $("#question-custom-note").value.trim() : "";
  // Deliberately no name: only a generic role/department string, never who
  // the subject actually is — see api/feedback-suggest-questions.js.
  const roleContext = state.subject?.context || "";
  try {
    button.disabled = true;
    status.textContent = "Asking AI for a starting set…";
    const response = await fetch("/api/feedback-suggest-questions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${state.token}` },
      body: JSON.stringify({ organizationId: state.activeOrganization.id, purpose, roleContext, customInstructions })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || "Could not generate question suggestions.");
    state.questions = payload.questions;
    status.textContent = `${payload.questions.length} questions suggested — review and edit freely below.`;
    renderQuestions();
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

// ---- Step 4: schedule defaults ----
function toLocalInputValue(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
$("#quick-opens").value = toLocalInputValue(new Date());
$("#quick-closes").value = toLocalInputValue(new Date(Date.now() + 14 * 86400000));
$$('#quick-opens, #quick-closes, #quick-threshold').forEach((el) => el.addEventListener("change", updateSummary));

// ---- Step 5: summary + launch ----
function updateSummary() {
  const threshold = Number($("#quick-threshold").value);
  const summary = $("#quick-summary");
  const launchButton = $("#launch-quick-cycle");
  if (!state.subject || !state.reviewers.length || !state.questions.length) {
    summary.innerHTML = "<p>Complete steps 1–3 above to see the plan here.</p>";
    launchButton.disabled = true;
    $("#quick-threshold-warning").textContent = "";
    return;
  }
  summary.innerHTML = `
    <p><b>${state.reviewers.length}</b> reviewer${state.reviewers.length === 1 ? "" : "s"} will be asked for confidential feedback about <b>${escapeHtml(state.subject.name)}</b>, using <b>${state.questions.length}</b> question${state.questions.length === 1 ? "" : "s"}.</p>
    <p>Reviewers: ${state.reviewers.map((reviewer) => escapeHtml(reviewer.name)).join(", ")}</p>` +
    (state.pendingReviewers.length ? `<p class="quick-warn">${state.pendingReviewers.length} nominated reviewer${state.pendingReviewers.length === 1 ? "" : "s"} still needs an approve/reject decision in step 2 — they won't be invited until you decide.</p>` : "");
  $("#quick-threshold-warning").textContent = state.reviewers.length < threshold
    ? `Attention: with only ${state.reviewers.length} reviewer${state.reviewers.length === 1 ? "" : "s"} against a ${threshold}-voice threshold, this group's report will stay withheld until more reviewers respond — exactly the confidentiality protection this platform guarantees.`
    : "";
  launchButton.disabled = false;
}

async function launchQuickCycle() {
  const button = $("#launch-quick-cycle");
  const launchNote = $("#launch-note");
  const purposeMap = { development: "development", performance: "appraisal", peer_check_in: "development", custom: "development" };
  const resuming = Boolean(state.editingCycleId);
  try {
    button.disabled = true;
    const cyclePurpose = purposeMap[$("#question-purpose").value] || "development";
    const cycleFields = {
      purpose: cyclePurpose,
      description: $("#question-custom-note").value.trim() || null,
      feedback_opens_at: new Date($("#quick-opens").value).toISOString(),
      feedback_closes_at: new Date($("#quick-closes").value).toISOString(),
      anonymous_group_threshold: Number($("#quick-threshold").value)
    };
    let cycle;
    if (resuming) {
      // Never touch the existing name here - feedback_cycles has a unique
      // (organization_id, name) constraint, and this same subject may
      // already have other cycles; renaming on every save risks colliding
      // with one of them (found live: this exact case).
      button.textContent = "Updating cycle…";
      await rest(`feedback_cycles?id=eq.${state.editingCycleId}`, "", { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(cycleFields) });
      cycle = { id: state.editingCycleId };
    } else {
      button.textContent = "Creating cycle…";
      // A timestamp keeps this unique even when the same subject gets a
      // second cycle later - "Name — quick cycle" alone would collide with
      // an earlier one under the same unique constraint.
      const name = `${state.subject.name} — quick cycle (${new Date().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })})`;
      [cycle] = await rest("feedback_cycles", "", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ ...cycleFields, name, organization_id: state.activeOrganization.id, created_by: state.user.id }) });
    }

    // Resuming a draft only ever adds what's new in *this* session - anything
    // loaded from an existing cycle already carries its own database id and
    // is left untouched, so re-launching a draft twice can never duplicate
    // questions, subjects, or reviewers it already has.
    const newQuestions = state.questions.filter((question) => !question.existingId);
    if (newQuestions.length) {
      button.textContent = "Saving questions…";
      const startOrder = state.questions.length - newQuestions.length;
      await rest("feedback_cycle_questions", "", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(newQuestions.map((question, index) => ({
          organization_id: state.activeOrganization.id,
          cycle_id: cycle.id,
          competency_label: question.competency_label.trim() || null,
          question_type: question.question_type,
          prompt: question.prompt.trim(),
          scale_definition: { min: 1, max: 5, labels: { 1: "Rarely", 5: "Consistently" } },
          sort_order: startOrder + index + 1
        })))
      });
    }

    let subjectRosterId = state.subject.rosterSubjectId;
    if (!subjectRosterId) {
      button.textContent = "Adding the subject…";
      const [subjectRoster] = await rest("feedback_cycle_roster_subjects", "", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ organization_id: state.activeOrganization.id, cycle_id: cycle.id, subject_person_id: state.subject.id, manager_person_id: state.subject.managerPersonId || null, status: "nominating", created_by: state.user.id })
      });
      subjectRosterId = subjectRoster.id;
    }

    const newReviewers = state.reviewers.filter((reviewer) => !reviewer.existingRaterId);
    if (newReviewers.length) {
      button.textContent = "Adding reviewers…";
      const externalReviewers = newReviewers.filter((reviewer) => reviewer.kind === "external");
      let externalContacts = [];
      if (externalReviewers.length) {
        externalContacts = await rest("feedback_external_contacts", "", {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify(externalReviewers.map((reviewer) => ({
            organization_id: state.activeOrganization.id, cycle_id: cycle.id, subject_roster_id: subjectRosterId,
            full_name: reviewer.name, email: reviewer.email, created_by: state.user.id
          })))
        });
      }
      const externalByEmail = new Map(externalContacts.map((contact) => [contact.email, contact]));

      const raterRows = newReviewers.map((reviewer) => ({
        organization_id: state.activeOrganization.id,
        cycle_id: cycle.id,
        subject_roster_id: subjectRosterId,
        reviewer_person_id: reviewer.kind === "internal" ? reviewer.id : null,
        external_contact_id: reviewer.kind === "external" ? externalByEmail.get(reviewer.email)?.id || null : null,
        rater_group: reviewer.kind === "external" ? "external" : "peer",
        status: "pending",
        nominated_by: state.user.id
      }));
      const createdRaters = await rest("feedback_cycle_roster_raters", "", {
        method: "POST",
        headers: { Prefer: "return=representation,resolution=ignore-duplicates" },
        body: JSON.stringify(raterRows)
      });

      button.textContent = "Approving reviewers…";
      for (const rater of createdRaters) {
        await rest(`feedback_cycle_roster_raters?id=eq.${rater.id}`, "", { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "approved", reviewed_by: state.user.id }) });
      }
    }

    button.textContent = "Launching cycle…";
    await rest(`feedback_cycles?id=eq.${cycle.id}`, "", { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "live" }) });

    // Send to every currently-approved rater, not just ones added this
    // session - /api/feedback-invitations already skips anyone with an
    // existing delivery record, so this is safe to call on a resumed cycle
    // that already has some invitations out.
    const approvedRaters = await rest("feedback_cycle_roster_raters", `cycle_id=eq.${cycle.id}&status=eq.approved&select=id`).catch(() => []);
    button.textContent = "Sending invitations…";
    const response = await fetch("/api/feedback-invitations", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ organizationId: state.activeOrganization.id, cycleId: cycle.id, rosterRaterIds: approvedRaters.map((rater) => rater.id) })
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      launchNote.textContent = `Cycle ${resuming ? "updated" : "created"} and launched, but invitations could not be sent: ${payload.message || "unknown error"}. Open the full builder to retry sending.`;
    } else {
      launchNote.textContent = `Done — ${payload.sent || 0} invitation${payload.sent === 1 ? "" : "s"} sent${payload.skipped ? `, ${payload.skipped} skipped` : ""}${payload.alreadyDelivered ? `, ${payload.alreadyDelivered} already had a link` : ""}.`;
      toast(`Feedback cycle ${resuming ? "updated" : "created"} and invitations sent.`);
    }
    button.textContent = "Cycle launched ✓";
    await loadCycleOptions(cycle.id);
  } catch (error) {
    launchNote.textContent = `Something went wrong partway through: ${error.message}. Check the full builder (Cycles page) — anything already created is saved there as a draft you can finish by hand.`;
    button.disabled = false;
    button.textContent = "Approve & launch this cycle →";
  }
}

$("#launch-quick-cycle").addEventListener("click", launchQuickCycle);

// ---- Step 6: reports (close cycle, view, release) ----
async function loadCycleOptions(selectId) {
  const cycles = await rest("feedback_cycles", `organization_id=eq.${state.activeOrganization.id}&select=id,name,status&order=created_at.desc`).catch(() => []);
  const select = $("#reports-cycle-select");
  const previous = select.value;
  select.innerHTML = `<option value="">Choose a cycle…</option>${cycles.map((cycle) => `<option value="${cycle.id}">${escapeHtml(cycle.name)} · ${cycle.status}</option>`).join("")}`;
  select.value = selectId || (cycles.some((cycle) => cycle.id === previous) ? previous : "");
  if (select.value) await loadReportsForCycle(select.value);
}

async function loadDeliveryStatus(cycleId, isLive) {
  const deliveryEl = $("#reports-delivery");
  const [raters, deliveries] = await Promise.all([
    rest("feedback_cycle_roster_raters", `cycle_id=eq.${cycleId}&select=id,status`).catch(() => []),
    rest("feedback_invitation_deliveries", `cycle_id=eq.${cycleId}&select=roster_rater_id,status`).catch(() => [])
  ]);
  const approved = raters.filter((rater) => rater.status === "approved");
  const invited = raters.filter((rater) => rater.status === "invited");
  const submitted = raters.filter((rater) => rater.status === "submitted").length;
  const failed = deliveries.filter((delivery) => delivery.status === "failed").length;
  deliveryEl.innerHTML = `<p class="quick-step-hint">Delivery: <b>${submitted}</b> responded · <b>${invited.length}</b> invited, waiting on a response · <b>${approved.length}</b> approved, not yet sent · <b>${failed}</b> failed.</p>` +
    (isLive && approved.length ? `<button type="button" id="resend-quick-invitations" class="quick-btn secondary small">Send to the ${approved.length} waiting reviewer${approved.length === 1 ? "" : "s"} →</button>` : "");
  const resendButton = $("#resend-quick-invitations");
  if (resendButton) {
    resendButton.addEventListener("click", async () => {
      resendButton.disabled = true;
      resendButton.textContent = "Sending…";
      try {
        const response = await fetch("/api/feedback-invitations", { method: "POST", headers: headers(), body: JSON.stringify({ organizationId: state.activeOrganization.id, cycleId, rosterRaterIds: approved.map((rater) => rater.id) }) });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.message || "Orbit could not send invitations.");
        toast(`${payload.sent || 0} invitation${payload.sent === 1 ? "" : "s"} sent.`);
        await loadDeliveryStatus(cycleId, isLive);
      } catch (error) { toast(error.message); resendButton.disabled = false; resendButton.textContent = `Send to the ${approved.length} waiting reviewer${approved.length === 1 ? "" : "s"} →`; }
    });
  }
}

async function loadReportsForCycle(cycleId) {
  const statusEl = $("#reports-cycle-status");
  const contentEl = $("#reports-content");
  if (!cycleId) { statusEl.innerHTML = ""; $("#reports-delivery").innerHTML = ""; contentEl.innerHTML = ""; return; }
  const [cycle] = await rest("feedback_cycles", `id=eq.${cycleId}&select=id,name,status`).catch(() => []);
  if (!cycle) return;

  if (cycle.status === "live") {
    statusEl.innerHTML = `<p class="quick-step-hint">This cycle is <b>live</b>. Close it once you're ready to release its report — no new responses can be recorded after that.</p><button type="button" id="close-quick-cycle" class="quick-btn secondary">Close cycle</button>`;
    $("#close-quick-cycle").addEventListener("click", async () => {
      if (!window.confirm(`Close "${cycle.name}"? No new responses can be recorded after this.`)) return;
      await rest(`feedback_cycles?id=eq.${cycleId}`, "", { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "closed" }) });
      toast("Cycle closed. Its report can now be released.");
      await loadCycleOptions(cycleId);
    });
    await loadDeliveryStatus(cycleId, true);
    contentEl.innerHTML = "";
    return;
  }
  if (cycle.status === "draft") {
    statusEl.innerHTML = `<p class="quick-step-hint">This cycle is still a <b>draft</b> — launch it from step 5 first.</p>`;
    $("#reports-delivery").innerHTML = "";
    contentEl.innerHTML = "";
    return;
  }

  statusEl.innerHTML = `<p class="quick-step-hint">This cycle is <b>closed</b>. Reports below are ready for a deliberate release.</p>`;
  await loadDeliveryStatus(cycleId, false);
  try {
    const response = await fetch(`/api/feedback-reports?organizationId=${encodeURIComponent(state.activeOrganization.id)}&cycleId=${encodeURIComponent(cycleId)}`, { headers: headers() });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "Orbit could not prepare this protected report.");
    // Mirrors orbit-console.js's renderProtectedReports() markup exactly
    // (same classes: review-summary/task-card/status), so it reads as the
    // same product, not a second report design.
    contentEl.innerHTML = data.reports.map((report) => `
      <div class="quick-question-card">
        <h3>${escapeHtml(report.subjectName)}'s protected report</h3>
        <p class="quick-step-hint">${report.released ? `Released ${new Date(report.releasedAt).toLocaleDateString()}` : "Withheld — not yet released"}</p>
        <div class="review-summary">
          <article><span>COMPLETION</span><b>${report.completion.completed} of ${report.completion.invited} voices submitted</b></article>
          <article><span>ANONYMITY THRESHOLD</span><b>${data.cycle.anonymousGroupThreshold} voices</b></article>
        </div>
        ${report.groups.map((group) => group.visible
          ? `<div class="task-card"><span class="status approved">${escapeHtml(group.label)}</span><h4>${group.ratingAverage === null ? "No rating submitted yet" : `${group.ratingAverage.toFixed(2)} / 5`}</h4><p>${group.completed} of ${group.invited} voices completed.</p></div>`
          : `<div class="task-card"><span class="status pending">${escapeHtml(group.label)} withheld</span><p>Below the ${group.minimum}-voice privacy threshold. No scores or comments shown.</p></div>`
        ).join("")}
        ${!report.released ? `<button type="button" class="quick-btn primary" data-release="${report.rosterSubjectId}">Release protected report →</button>` : ""}
      </div>`).join("") || "<p class=\"quick-step-hint\">No reports are ready for this cycle yet.</p>";
    $$('[data-release]').forEach((button) => button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        const releaseResponse = await fetch("/api/feedback-reports", { method: "POST", headers: headers(), body: JSON.stringify({ organizationId: state.activeOrganization.id, cycleId, rosterSubjectId: button.dataset.release, action: "release" }) });
        const payload = await releaseResponse.json().catch(() => ({}));
        if (!releaseResponse.ok) throw new Error(payload.message || "Orbit could not release this report.");
        toast("Protected report released.");
        await loadReportsForCycle(cycleId);
      } catch (error) { toast(error.message); button.disabled = false; }
    }));
  } catch (error) {
    contentEl.innerHTML = `<p class="quick-warn">${escapeHtml(error.message)}</p>`;
  }
}

$("#reports-cycle-select").addEventListener("change", (event) => loadReportsForCycle(event.target.value));

(async function init() {
  const ok = await restoreSessionOrRedirect();
  if (!ok) return;
  await loadActiveOrganization();
  renderQuestions();
  updateSummary();
  if (state.activeOrganization) await loadCycleOptions();
})();
