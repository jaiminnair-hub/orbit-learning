const config = window.ORBIT_PLATFORM_SUPABASE;
// Orbit product-shell entry for Learning — see docs on the LMS side at
// docs/ORBIT_LMS_INTEGRATION_PLAN.md. The LMS's own entry route already
// accepts a signed, replay-guarded, POST-only token from this origin.
const LMS_ENTRY_URL = "https://raw-app.vercel.app/api/orbit/entry";
const sessionStorageKey = "orbit-platform-session-v1";
const state = { token: null, refreshToken: null, user: null, passwordRecovery: false, passwordSetupToken: "", passwordSetupType: "", profile: null, organizations: [], activeOrganization: null, memberships: [], roles: [], entitlements: [], cycles: [], questions: [], participants: [], nominations: [], assignments: [], invitationDeliveries: [], people: [], directoryPeople: [], directoryAvailable: false, rosterAvailable: false, rosterSubjects: [], rosterRaters: [], externalContacts: [], externalAvailable: false, externalImportRows: [], importRows: [], questionImportRows: [], protectedReport: null, audienceScope: "individual", audienceSelectedIds: [], audienceDepartments: [], audienceJobTitles: [], audienceDraftIds: [], audienceDraftSources: [], raterScope: "individual", raterSelectedIds: [], raterDepartments: [], raterJobTitles: [], raterDraftIds: [], raterDraftSources: [], raterPerspectives: ["self", "manager", "peer"], replacingRaterId: null, actionPlanDraft: null };
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  window.setTimeout(() => element.classList.remove("show"), 2800);
}

function headers() {
  return { apikey: config.publishableKey, Authorization: `Bearer ${state.token}`, "Content-Type": "application/json" };
}

async function request(path, options = {}) {
  let response = await fetch(`${config.url}${path}`, { ...options, headers: { ...headers(), ...(options.headers || {}) } });
  if (response.status === 401 && await refreshSession()) {
    response = await fetch(`${config.url}${path}`, { ...options, headers: { ...headers(), ...(options.headers || {}) } });
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.message || payload?.msg || payload?.hint || "Orbit could not complete that request.");
  return payload;
}

async function rest(table, query = "", options = {}) {
  return request(`/rest/v1/${table}${query ? `?${query}` : ""}`, options);
}

async function rpc(name, body = {}) {
  return request(`/rest/v1/rpc/${name}`, { method: "POST", body: JSON.stringify(body) });
}

function displayName(person) {
  return person?.full_name || person?.email || "Orbit member";
}

function initials(name) {
  return String(name).split(" ").filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "O";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
}

function isoFromInput(value) {
  return value ? new Date(value).toISOString() : null;
}

function directoryCell(record, aliases) {
  const entries = Object.entries(record);
  for (const alias of aliases) {
    const match = entries.find(([key]) => key.toLowerCase().replace(/[^a-z0-9]/g, "") === alias);
    if (match && String(match[1] ?? "").trim()) return String(match[1]).trim();
  }
  return "";
}

function normalizeDirectoryRows(records) {
  const people = new Map();
  const skipped = [];
  records.forEach((record, index) => {
    const firstName = directoryCell(record, ["firstname", "first"]);
    const lastName = directoryCell(record, ["lastname", "last"]);
    const fullName = directoryCell(record, ["fullname", "employeename", "name"]) || `${firstName} ${lastName}`.trim();
    const email = directoryCell(record, ["workemail", "email", "emailaddress"]).toLowerCase();
    if (!fullName || !/^\S+@\S+\.\S+$/.test(email)) { skipped.push(index + 2); return; }
    people.set(email, {
      employee_number: directoryCell(record, ["employeeid", "employeenumber", "employee"]) || null,
      first_name: firstName || null,
      last_name: lastName || null,
      full_name: fullName,
      work_email: email,
      job_title: directoryCell(record, ["jobtitle", "title", "designation"]) || null,
      department: directoryCell(record, ["department", "function"]) || null,
      location: directoryCell(record, ["location", "office", "city"]) || null,
      manager_email: directoryCell(record, ["manageremail", "reportingtoemail", "manager"]) || null,
      employment_status: directoryCell(record, ["employmentstatus", "status"]).toLowerCase().replace(/\s+/g, "_") || "active",
      start_date: directoryCell(record, ["startdate", "joiningdate", "dateofjoining"]) || null,
    });
  });
  return { people: [...people.values()], skipped };
}

async function readDirectoryFile(file) {
  if (!window.XLSX) throw new Error("The secure spreadsheet reader is still loading. Please choose the file again in a moment.");
  const workbook = window.XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const directorySheetName = workbook.SheetNames.find((name) => /employee\s*directory/i.test(name)) || workbook.SheetNames[0];
  const directorySheet = workbook.Sheets[directorySheetName];
  if (!directorySheet) throw new Error("This file does not contain a readable worksheet.");
  // Accept a simple CSV as well as the guided Excel template. Find the real
  // header row rather than assuming a fixed row number.
  const rows = window.XLSX.utils.sheet_to_json(directorySheet, { header: 1, defval: "", raw: false });
  const headerIndex = rows.findIndex((row) => {
    const labels = row.map((cell) => String(cell).toLowerCase().replace(/[^a-z0-9]/g, ""));
    return labels.some((label) => ["fullname", "employeename", "name", "firstname"].includes(label))
      && labels.some((label) => ["workemail", "email", "emailaddress"].includes(label));
  });
  if (headerIndex < 0) return [];
  const headers = rows[headerIndex];
  return rows.slice(headerIndex + 1)
    .filter((row) => row.some((cell) => String(cell).trim()))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
}

function clearDirectoryImport() {
  state.importRows = [];
  const file = $("#directory-file");
  const fileName = $("#directory-file-name");
  const preview = $("#directory-import-preview");
  const actions = $("#directory-import-actions");
  const note = $("#directory-import-note");
  if (file) file.value = "";
  if (fileName) fileName.textContent = "No file selected";
  if (preview) preview.classList.add("hidden");
  if (actions) actions.classList.add("hidden");
  if (note) note.textContent = "";
}

function normalizeQuestionRows(records) {
  const questions = [];
  const skipped = [];
  records.forEach((record, index) => {
    const prompt = directoryCell(record, ["question", "prompt", "questionwording"]);
    const typeValue = directoryCell(record, ["questiontype", "type"]).toLowerCase().replace(/[^a-z0-9]/g, "");
    const questionType = ["rating", "15rating", "1to5rating"].includes(typeValue) ? "rating" : ["opentext", "text", "comment"].includes(typeValue) ? "open_text" : "";
    const requiredValue = directoryCell(record, ["required", "isrequired"]).toLowerCase();
    if (prompt.length < 5 || !questionType) { skipped.push(index + 7); return; }
    questions.push({
      prompt,
      question_type: questionType,
      competency_label: directoryCell(record, ["competency", "competencylabel"]) || null,
      is_required: !["no", "false", "optional", "0"].includes(requiredValue)
    });
  });
  return { questions, skipped };
}

async function readQuestionFile(file) {
  if (!window.XLSX) throw new Error("The secure spreadsheet reader is still loading. Please choose the file again in a moment.");
  const workbook = window.XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const sheetName = workbook.SheetNames.find((name) => /question\s*import/i.test(name)) || workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error("This file does not contain a readable worksheet.");
  return window.XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false, range: /question\s*import/i.test(sheetName) ? 5 : 0 });
}

function clearQuestionImport() {
  state.questionImportRows = [];
  $("#question-file").value = "";
  $("#question-file-name").textContent = "No file selected";
  $("#question-import-preview").classList.add("hidden");
  $("#question-import-actions").classList.add("hidden");
  $("#question-import-note").textContent = "";
}

function renderQuestionImportPreview(skipped) {
  const preview = state.questionImportRows.slice(0, 4);
  $("#question-import-preview").innerHTML = `<div class="import-preview-head"><b>Ready to import ${state.questionImportRows.length} questions</b><span>${skipped.length ? `${skipped.length} row${skipped.length === 1 ? "" : "s"} skipped` : "All rows look good"}</span></div><table><thead><tr><th>Question</th><th>Type</th><th>Competency</th></tr></thead><tbody>${preview.map((question) => `<tr><td>${escapeHtml(question.prompt)}</td><td>${question.question_type === "rating" ? "1–5 rating" : "Open text"}</td><td>${escapeHtml(question.competency_label || "—")}</td></tr>`).join("")}</tbody></table>${state.questionImportRows.length > preview.length ? `<p class="form-note">Plus ${state.questionImportRows.length - preview.length} more questions.</p>` : ""}`;
  $("#question-import-preview").classList.remove("hidden");
  $("#question-import-actions").classList.remove("hidden");
}

function renderDirectoryPreview(skipped) {
  const preview = state.importRows.slice(0, 4);
  const previewElement = $("#directory-import-preview");
  const actions = $("#directory-import-actions");
  if (!previewElement || !actions) throw new Error("The People Directory screen did not load completely. Please refresh and try again.");
  previewElement.innerHTML = `<div class="import-preview-head"><b>Ready to import ${state.importRows.length} people</b><span>${skipped.length ? `${skipped.length} row${skipped.length === 1 ? "" : "s"} skipped` : "All rows look good"}</span></div><table><thead><tr><th>Person</th><th>Role</th><th>Department</th><th>Manager</th></tr></thead><tbody>${preview.map((person) => `<tr><td>${escapeHtml(person.full_name)}<br><small>${escapeHtml(person.work_email)}</small></td><td>${escapeHtml(person.job_title || "—")}</td><td>${escapeHtml(person.department || "—")}</td><td>${escapeHtml(person.manager_email || "—")}</td></tr>`).join("")}</tbody></table>${state.importRows.length > preview.length ? `<p class="form-note">Plus ${state.importRows.length - preview.length} more people.</p>` : ""}`;
  previewElement.classList.remove("hidden");
  actions.classList.remove("hidden");
}

function setScreen(name) {
  $("#auth-screen").classList.toggle("hidden", name !== "auth");
  $("#signup-screen").classList.toggle("hidden", name !== "signup");
  $("#setup-screen").classList.toggle("hidden", name !== "setup");
  $("#no-access-screen").classList.toggle("hidden", name !== "no-access");
  $("#reset-screen").classList.toggle("hidden", name !== "reset");
  $("#confirm-screen").classList.toggle("hidden", name !== "confirm");
  $("#app-shell").classList.toggle("hidden", name !== "app");
}

function saveSession(session) {
  state.token = session.access_token;
  state.refreshToken = session.refresh_token || state.refreshToken;
  state.user = session.user || state.user;
  localStorage.setItem(sessionStorageKey, JSON.stringify({ token: state.token, refreshToken: state.refreshToken }));
}

async function loadUser(accessToken) {
  const response = await fetch(`${config.url}/auth/v1/user`, { headers: { apikey: config.publishableKey, Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) return null;
  return response.json();
}

async function refreshSession() {
  if (!state.refreshToken) return false;
  const response = await fetch(`${config.url}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: config.publishableKey, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: state.refreshToken })
  });
  if (!response.ok) return false;
  const session = await response.json();
  saveSession(session);
  state.user = session.user || await loadUser(session.access_token);
  return Boolean(state.user);
}

async function authenticateFromLink() {
  const values = new URLSearchParams(location.hash.slice(1));
  const accessToken = values.get("access_token");
  if (!accessToken) return false;
  const user = await loadUser(accessToken);
  if (!user) return false;
  saveSession({ access_token: accessToken, refresh_token: values.get("refresh_token"), user });
  state.passwordRecovery = values.get("type") === "recovery";
  history.replaceState({}, document.title, location.pathname);
  return true;
}

async function restoreSession() {
  const saved = JSON.parse(localStorage.getItem(sessionStorageKey) || "null");
  if (!saved?.token) return false;
  state.token = saved.token;
  state.refreshToken = saved.refreshToken || null;
  state.user = await loadUser(saved.token);
  return Boolean(state.user) || refreshSession();
}

async function loadContext() {
  state.profile = (await rest("foundation_profiles", `id=eq.${state.user.id}&select=id,email,full_name`))[0] || null;
  state.memberships = await rest("organization_memberships", `user_id=eq.${state.user.id}&status=eq.active&select=organization_id,org_role,status`);
  if (!state.memberships.length) { setScreen("no-access"); return; }

  const organizationIds = state.memberships.map((membership) => membership.organization_id).join(",");
  state.organizations = await rest("foundation_organizations", `id=in.(${organizationIds})&select=id,name,slug,status`);
  const activeRows = await rest("user_active_organizations", `user_id=eq.${state.user.id}&select=organization_id`);
  const selectedId = activeRows[0]?.organization_id || state.organizations[0]?.id;
  if (!selectedId) throw new Error("No active Orbit organization is available.");
  if (!activeRows[0]) await rpc("set_active_organization", { target_organization_id: selectedId });
  state.activeOrganization = state.organizations.find((organization) => organization.id === selectedId) || state.organizations[0];
  await loadProductData();
  setScreen("app");
  renderShell();
}

async function loadProductData() {
  const orgId = state.activeOrganization.id;
  state.roles = await rest("product_role_assignments", `organization_id=eq.${orgId}&user_id=eq.${state.user.id}&select=product_key,role_key,expires_at`);
  state.entitlements = await rest("organization_product_entitlements", `organization_id=eq.${orgId}&select=product_key,status,ends_at,plan_tier`);
  state.people = await rest("foundation_profiles", "select=id,email,full_name");
  const feedbackEnabled = hasFeedbackAccess();
  state.directoryPeople = [];
  state.directoryAvailable = false;
  state.rosterAvailable = false;
  state.rosterSubjects = [];
  state.rosterRaters = [];
  state.externalContacts = [];
  state.externalAvailable = false;
  state.invitationDeliveries = [];
  if (!feedbackEnabled) { state.cycles = []; state.questions = []; state.participants = []; state.nominations = []; state.assignments = []; return; }
  [state.cycles, state.questions, state.participants, state.nominations, state.assignments] = await Promise.all([
    rest("feedback_cycles", `organization_id=eq.${orgId}&select=*&order=created_at.desc`),
    rest("feedback_cycle_questions", `organization_id=eq.${orgId}&select=id,cycle_id,competency_label,question_type,prompt,sort_order&order=sort_order.asc`),
    rest("feedback_cycle_participants", `organization_id=eq.${orgId}&select=*&order=created_at.desc`),
    rest("feedback_rater_nominations", `organization_id=eq.${orgId}&select=*&order=created_at.desc`),
    rest("feedback_review_assignments", `organization_id=eq.${orgId}&select=*&order=created_at.desc`)
  ]);
  try {
    state.directoryPeople = await rest("organization_people", `organization_id=eq.${orgId}&select=*&order=full_name.asc`);
    state.directoryAvailable = true;
  } catch (error) {
    if (!error.message.includes("organization_people")) throw error;
  }
  try {
    [state.rosterSubjects, state.rosterRaters] = await Promise.all([
      rest("feedback_cycle_roster_subjects", `organization_id=eq.${orgId}&select=*&order=created_at.desc`),
      rest("feedback_cycle_roster_raters", `organization_id=eq.${orgId}&select=*&order=created_at.desc`)
    ]);
    state.rosterAvailable = true;
  } catch (error) {
    if (!error.message.includes("feedback_cycle_roster")) throw error;
  }
  try {
    state.externalContacts = await rest("feedback_external_contacts", `organization_id=eq.${orgId}&select=*&order=created_at.desc`);
    state.externalAvailable = true;
  } catch (error) {
    if (!error.message.includes("feedback_external_contacts")) throw error;
  }
  try {
    // The browser needs delivery state for the administrator UI, never token
    // hashes or recipient details. The status view is deliberately narrow.
    state.invitationDeliveries = await rest("feedback_invitation_delivery_status", `organization_id=eq.${orgId}&select=cycle_id,roster_rater_id,status,delivery_kind,sent_at,opened_at,completed_at,created_at&order=created_at.desc`);
  } catch (error) {
    // Older Foundation environments may not have the narrow status view yet.
    // Keep the console usable until the mandatory hardening migration lands.
    if (!error.message.includes("feedback_invitation_deliveries") && !error.message.includes("feedback_invitation_delivery_status")) throw error;
  }
}

function feedbackEntitlement() {
  return state.entitlements.find((entitlement) => entitlement.product_key === "feedback" && ["trial", "active"].includes(entitlement.status));
}

function hasFeedbackAccess() {
  return Boolean(feedbackEntitlement() && state.roles.some((role) => role.product_key === "feedback"));
}

function isFeedbackAdmin() {
  return state.roles.some((role) => role.product_key === "feedback" && role.role_key === "feedback_admin");
}

// Mirrors feedbackEntitlement()/hasFeedbackAccess() exactly, for the same
// reason: this app's existing convention is client-side filtering of
// already-fetched state.entitlements/state.roles, used for UI/UX only.
// The real authorization boundary is the mint-lms-entry-token Edge
// Function, which re-derives everything server-side from the caller's own
// JWT and never trusts these client-side results.
function lmsEntitlement() {
  return state.entitlements.find((entitlement) => entitlement.product_key === "lms" && ["trial", "active"].includes(entitlement.status));
}

function lmsRole() {
  return state.roles.find((role) => role.product_key === "lms" && (!role.expires_at || new Date(role.expires_at) > new Date()));
}

function hasLmsAccess() {
  return Boolean(lmsEntitlement() && lmsRole());
}

function renderLearningTile() {
  if (hasLmsAccess()) {
    return `<button type="button" class="product-chip clickable" id="open-learning-tile">Open Learning workspace <span>↗</span></button>`;
  }
  const explanation = lmsEntitlement()
    ? "You don't have a Learning role in this organization yet"
    : "Ask your Orbit admin to enable Learning for this organization";
  return `<div class="product-chip disabled" title="${escapeHtml(explanation)}"><span>Learning workspace</span><small>${escapeHtml(explanation)}</small></div>`;
}

// The click handler for the "Open Learning" tile. The minted token exists
// only as the local `token` variable below, from the moment the Edge
// Function's response resolves to the moment the form submits — never
// assigned to `state`, never in a URL, never in localStorage/sessionStorage,
// never logged or passed to toast()/analytics. Per
// docs/ORBIT_LMS_INTEGRATION_PLAN.md's requirement, this must stay that way.
async function openLearning() {
  if (!hasLmsAccess()) return;
  let token;
  try {
    // No body: the Edge Function derives the active organization exclusively
    // from the caller's own authenticated session server-side (verified live
    // — a tampered/fabricated organizationId here has no effect on it), so
    // there's nothing for the client to send.
    const result = await request("/functions/v1/mint-lms-entry-token", {
      method: "POST",
    });
    token = result?.token;
  } catch (error) {
    toast(error.message || "Could not open Learning right now.");
    return;
  }
  if (!token) {
    toast("Could not open Learning right now.");
    return;
  }
  const form = document.createElement("form");
  form.method = "POST";
  form.action = LMS_ENTRY_URL;
  form.style.display = "none";
  const input = document.createElement("input");
  input.type = "hidden";
  input.name = "token";
  input.value = token;
  form.appendChild(input);
  document.body.appendChild(form);
  form.submit();
}

function currentMembership() {
  return state.memberships.find((membership) => membership.organization_id === state.activeOrganization.id);
}

function renderShell() {
  const personName = displayName(state.profile || state.user);
  $("#avatar").textContent = initials(personName);
  $("#organization-select").innerHTML = state.organizations.map((organization) => `<option value="${organization.id}" ${organization.id === state.activeOrganization.id ? "selected" : ""}>${escapeHtml(organization.name)}</option>`).join("");
  $("#product-strip").innerHTML =
    `<a class="product-chip product-suite-link" href="./">All Orbit products</a>` +
    `<span class="product-chip ${feedbackEntitlement() ? "active" : ""}">360 Feedback${state.entitlements.some((item) => item.product_key === "feedback") ? " · enabled" : ""}</span>` +
    renderLearningTile();
  if (hasLmsAccess()) $("#open-learning-tile")?.addEventListener("click", openLearning);
  const entitlement = feedbackEntitlement();
  $("#trial-badge").classList.toggle("hidden", !entitlement || entitlement.status !== "trial");
  $("#trial-badge").textContent = entitlement?.status === "trial" ? "360 trial" : "";
  $("#product-gate").classList.toggle("hidden", hasFeedbackAccess());
  $("#feedback-workspace").classList.toggle("hidden", !hasFeedbackAccess());
  const membership = currentMembership();
  const canStartTrial = membership?.org_role === "org_owner";
  const canFinishFeedbackSetup = ["org_owner", "org_admin"].includes(membership?.org_role);
  const showSetupAction = feedbackEntitlement() ? canFinishFeedbackSetup : canStartTrial;
  $("#start-trial").classList.toggle("hidden", !showSetupAction);
  $("#start-trial").innerHTML = feedbackEntitlement()
    ? "Finish 360 setup <span>→</span>"
    : "Activate 360 workspace <span>→</span>";
  if (!hasFeedbackAccess()) {
    $("#trial-note").textContent = feedbackEntitlement()
      ? (canFinishFeedbackSetup
        ? "Your 360 trial is active. Finish setup to give this administrator account access."
        : "360 Feedback is active. Ask an organization owner or administrator to grant you 360 access.")
      : "360 Feedback has not been enabled for this organization.";
  }
  if (hasFeedbackAccess()) renderFeedbackWorkspace();
}

function userName(userId) {
  return displayName(state.people.find((person) => person.id === userId));
}

function directoryPersonName(personId) {
  const person = state.directoryPeople.find((item) => item.id === personId);
  return person ? `${person.full_name}${person.job_title ? ` · ${person.job_title}` : ""}` : "Team member";
}

function directoryOptions(selected = "", includeBlank = true) {
  return `${includeBlank ? '<option value="">Select a person</option>' : ""}${state.directoryPeople.map((person) => `<option value="${person.id}" ${person.id === selected ? "selected" : ""}>${escapeHtml(directoryPersonName(person.id))}</option>`).join("")}`;
}

function renderDirectory() {
  $("#directory-count").textContent = state.directoryPeople.length;
  if (!state.directoryAvailable) {
    $("#directory-status").textContent = "Directory is being prepared";
    $("#directory-list").innerHTML = "Your private employee directory will appear here once it is connected to this workspace.";
    return;
  }
  $("#directory-status").textContent = state.directoryPeople.length ? "Private to authorised feedback administrators" : "Ready for your first import";
  const editor = $("#directory-person-to-edit");
  if (editor) editor.innerHTML = directoryOptions();
  $("#directory-list").innerHTML = state.directoryPeople.length
    ? state.directoryPeople.slice(0, 8).map((person) => `<div class="row-card"><div><b>${escapeHtml(person.full_name)}</b><p>${escapeHtml(person.job_title || "Team member")} · ${escapeHtml(person.department || "No department")} · ${escapeHtml(person.work_email)}</p></div><span class="status approved">${escapeHtml(person.employment_status)}</span></div>`).join("") + (state.directoryPeople.length > 8 ? `<p class="empty-state">Showing the first 8 of ${state.directoryPeople.length} people.</p>` : "")
    : "Your imported workforce will appear here.";
}

function activeDirectoryPeople() {
  return state.directoryPeople.filter((person) => person.employment_status === "active");
}

function selectedAudiencePeople() {
  const scope = state.audienceScope;
  const people = activeDirectoryPeople();
  if (scope === "entire_organization") return people;
  if (scope === "individual") return people.filter((person) => state.audienceSelectedIds.includes(person.id));
  const departments = state.audienceDepartments;
  const titles = state.audienceJobTitles;
  if (scope === "department") return people.filter((person) => departments.includes(person.department || ""));
  if (scope === "job_title") return people.filter((person) => titles.includes(person.job_title || ""));
  return people.filter((person) => departments.includes(person.department || "") && titles.includes(person.job_title || ""));
}

function stagedAudiencePeople() {
  const stagedIds = new Set(state.audienceDraftIds);
  return activeDirectoryPeople().filter((person) => stagedIds.has(person.id));
}

function audienceSourceLabel() {
  if (state.audienceScope === "entire_organization") return "Entire active organization";
  if (state.audienceScope === "individual") return `${state.audienceSelectedIds.length} individual${state.audienceSelectedIds.length === 1 ? "" : "s"}`;
  if (state.audienceScope === "department") return state.audienceDepartments.join(", ");
  if (state.audienceScope === "job_title") return state.audienceJobTitles.join(", ");
  return `${state.audienceDepartments.join(", ")} · ${state.audienceJobTitles.join(", ")}`;
}

function resetCurrentAudienceSelection() {
  state.audienceSelectedIds = [];
  state.audienceDepartments = [];
  state.audienceJobTitles = [];
}

function audienceOptionMarkup(attribute, value, label, count, checked = false) {
  const unavailable = count === 0 && !checked;
  return `<label class="audience-option ${unavailable ? "unavailable" : ""}"><input type="checkbox" ${attribute} value="${escapeHtml(value)}" ${checked ? "checked" : ""} ${unavailable ? "disabled" : ""}><span><b>${escapeHtml(label)}</b><small>${unavailable ? "No match with current selection" : `${count} people`}</small></span></label>`;
}

function renderAudienceBuilder() {
  const people = activeDirectoryPeople();
  const scope = state.audienceScope;
  const selectedCycleId = $("#audience-cycle").value;
  const departments = [...new Set(people.map((person) => person.department).filter(Boolean))].sort();
  const titles = [...new Set(people.map((person) => person.job_title).filter(Boolean))].sort();
  $("#audience-cycle").innerHTML = `<option value="">Select a cycle</option>${state.cycles.map((cycle) => `<option value="${cycle.id}">${escapeHtml(cycle.name)}</option>`).join("")}`;
  $("#audience-cycle").value = selectedCycleId;
  $("#audience-scope").value = scope;
  if (!state.directoryAvailable) {
    $("#audience-filter-panel").innerHTML = "Your private workforce directory is being prepared.";
    $("#audience-preview").innerHTML = "";
    return;
  }
  const selectedDepartments = state.audienceDepartments;
  const selectedTitles = state.audienceJobTitles;
  const departmentCount = (department) => people.filter((person) => person.department === department && (!selectedTitles.length || selectedTitles.includes(person.job_title))).length;
  const titleCount = (title) => people.filter((person) => person.job_title === title && (!selectedDepartments.length || selectedDepartments.includes(person.department))).length;
  if (scope === "individual") {
    $("#audience-filter-panel").innerHTML = `<p class="form-note">Choose the individual people who will receive feedback.</p><div class="audience-option-grid">${people.map((person) => audienceOptionMarkup("data-audience-person", person.id, directoryPersonName(person.id), 1, state.audienceSelectedIds.includes(person.id))).join("")}</div>`;
  } else if (scope === "department") {
    $("#audience-filter-panel").innerHTML = `<p class="form-note">Choose one or more departments. Only active people are included.</p><div class="audience-option-grid">${departments.map((department) => audienceOptionMarkup("data-audience-department", department, department, people.filter((person) => person.department === department).length, selectedDepartments.includes(department))).join("")}</div>`;
  } else if (scope === "job_title") {
    $("#audience-filter-panel").innerHTML = `<p class="form-note">Choose one or more designations. Only active people are included.</p><div class="audience-option-grid">${titles.map((title) => audienceOptionMarkup("data-audience-title", title, title, people.filter((person) => person.job_title === title).length, selectedTitles.includes(title))).join("")}</div>`;
  } else if (scope === "department_job_title") {
    $("#audience-filter-panel").innerHTML = `<p class="form-note">Choose department and designation. Orbit includes only people matching both selections. Options with no matching people are marked clearly.</p><div class="audience-filter-columns"><div><b>Departments</b><div class="audience-option-grid">${departments.map((department) => audienceOptionMarkup("data-audience-department", department, department, departmentCount(department), selectedDepartments.includes(department))).join("")}</div></div><div><b>Designations</b><div class="audience-option-grid">${titles.map((title) => audienceOptionMarkup("data-audience-title", title, title, titleCount(title), selectedTitles.includes(title))).join("")}</div></div></div>`;
  } else {
    $("#audience-filter-panel").innerHTML = `<p class="form-note"><b>Entire active organization</b><br>${people.length} active people will be assessed. Inactive employees are excluded.</p>`;
  }
  $$('[data-audience-person]').forEach((input) => input.addEventListener("change", () => {
    state.audienceSelectedIds = $$('[data-audience-person]:checked').map((item) => item.value);
    renderCurrentAudienceAction();
    renderAudiencePreview();
  }));
  $$('[data-audience-department]').forEach((input) => input.addEventListener("change", () => {
    state.audienceDepartments = $$('[data-audience-department]:checked').map((item) => item.value);
    renderAudienceBuilder();
  }));
  $$('[data-audience-title]').forEach((input) => input.addEventListener("change", () => {
    state.audienceJobTitles = $$('[data-audience-title]:checked').map((item) => item.value);
    renderAudienceBuilder();
  }));
  renderCurrentAudienceAction();
  renderStagedAudienceGroup();
  renderAudiencePreview();
}

function renderCurrentAudienceAction() {
  const current = selectedAudiencePeople();
  const alreadyStaged = new Set(state.audienceDraftIds);
  const newPeople = current.filter((person) => !alreadyStaged.has(person.id));
  const hasSelection = current.length > 0;
  $("#audience-current-actions").innerHTML = `<div><b>Current selection</b><small>${hasSelection ? `${current.length} people match this choice${newPeople.length !== current.length ? ` · ${newPeople.length} new to the assessment group` : ""}` : "Choose people, a department, a designation, or a combined filter."}</small></div><button class="button secondary" id="stage-audience-selection" ${newPeople.length ? "" : "disabled"}>Add this selection to assessment group <span>→</span></button>`;
  $("#stage-audience-selection").addEventListener("click", () => {
    if (!newPeople.length) return;
    state.audienceDraftIds = [...new Set([...state.audienceDraftIds, ...newPeople.map((person) => person.id)])];
    state.audienceDraftSources.push({ method: state.audienceScope, label: audienceSourceLabel(), people_added: newPeople.length, selected_at: new Date().toISOString() });
    resetCurrentAudienceSelection();
    $("#audience-note").textContent = `${newPeople.length} people added to your assessment group. Add another selection or continue when ready.`;
    renderAudienceBuilder();
  });
}

function renderStagedAudienceGroup() {
  const people = stagedAudiencePeople();
  const sources = state.audienceDraftSources;
  $("#audience-group").innerHTML = `<div class="audience-group-head"><div><span>ASSESSMENT GROUP</span><b>${people.length} people ready</b><small>Selections are combined. A person included more than once appears only once.</small></div>${people.length ? `<button class="text-button" id="clear-audience-group">Clear group</button>` : ""}</div>${sources.length ? `<div class="audience-source-list">${sources.map((source) => `<span>${escapeHtml(source.label)} <i>+${source.people_added}</i></span>`).join("")}</div>` : `<p>Build your group by adding one or more selections above.</p>`}`;
  $("#clear-audience-group")?.addEventListener("click", () => {
    state.audienceDraftIds = [];
    state.audienceDraftSources = [];
    $("#audience-note").textContent = "Assessment group cleared.";
    renderAudienceBuilder();
  });
}

function renderAudiencePreview() {
  const selected = stagedAudiencePeople();
  const cycleId = $("#audience-cycle").value;
  const rostered = new Set(state.rosterSubjects.filter((subject) => subject.cycle_id === cycleId).map((subject) => subject.subject_person_id));
  const newPeople = selected.filter((person) => !rostered.has(person.id));
  const selectedLabels = [...state.audienceDepartments, ...state.audienceJobTitles];
  const noMatchMessage = selectedLabels.length ? `No active people match ${selectedLabels.map((label) => escapeHtml(label)).join(" + ")}. Choose another combination.` : "Choose an assessment group to preview the people before adding them.";
  $("#audience-preview").innerHTML = `<div class="import-preview-head"><b>${selected.length} people in assessment group</b><span>${newPeople.length} new to this cycle${selected.length - newPeople.length ? ` · ${selected.length - newPeople.length} already included` : ""}</span></div>${selected.length ? `<p class="form-note">${selected.slice(0, 8).map((person) => escapeHtml(person.full_name)).join(" · ")}${selected.length > 8 ? ` · plus ${selected.length - 8} more` : ""}</p>` : `<p class="form-note">${state.audienceDraftSources.length ? "Everyone in this group is already included in this cycle." : noMatchMessage}</p>`}`;
  $("#add-audience").disabled = !cycleId || !newPeople.length;
  $("#add-audience").innerHTML = newPeople.length ? `Add ${newPeople.length} people to cycle <span>→</span>` : "Add selected people to cycle";
}

function raterCycleSubjects() {
  const cycleId = $("#rater-cycle").value;
  return state.rosterSubjects.filter((subject) => subject.cycle_id === cycleId);
}

function directoryPerson(id) {
  return state.directoryPeople.find((person) => person.id === id) || null;
}

function selectedRaterPeople() {
  const scope = state.raterScope;
  const people = activeDirectoryPeople();
  if (scope === "entire_organization") return people;
  if (scope === "individual") return people.filter((person) => state.raterSelectedIds.includes(person.id));
  if (scope === "department") return people.filter((person) => state.raterDepartments.includes(person.department || ""));
  if (scope === "job_title") return people.filter((person) => state.raterJobTitles.includes(person.job_title || ""));
  return people.filter((person) => state.raterDepartments.includes(person.department || "") && state.raterJobTitles.includes(person.job_title || ""));
}

function stagedRaterPeople() {
  const ids = new Set(state.raterDraftIds);
  return activeDirectoryPeople().filter((person) => ids.has(person.id));
}

function raterSourceLabel() {
  if (state.raterScope === "entire_organization") return "Entire active organization";
  if (state.raterScope === "individual") return `${state.raterSelectedIds.length} individual${state.raterSelectedIds.length === 1 ? "" : "s"}`;
  if (state.raterScope === "department") return state.raterDepartments.join(", ");
  if (state.raterScope === "job_title") return state.raterJobTitles.join(", ");
  return `${state.raterDepartments.join(", ")} · ${state.raterJobTitles.join(", ")}`;
}

function resetCurrentRaterSelection() {
  state.raterSelectedIds = [];
  state.raterDepartments = [];
  state.raterJobTitles = [];
}

function raterGroupLabel() {
  return { self: "Self", manager: "Manager", skip_manager: "Skip-level manager", direct_report: "Direct reports", same_team: "Same-team colleagues", peer: "Peers", cross_functional: "Cross-functional partners", external: "External customers" };
}

function raterAssignmentKey(subjectId, reviewerId = null, externalContactId = null) {
  return `${subjectId}:${externalContactId ? `external:${externalContactId}` : `person:${reviewerId}`}`;
}

function plannedRaterAssignments() {
  const subjects = raterCycleSubjects();
  const enabled = state.raterPerspectives;
  const candidates = [];
  const missing = { manager: 0, skip_manager: 0 };
  const emailLookup = new Map(activeDirectoryPeople().map((person) => [String(person.work_email).toLowerCase(), person]));
  const add = (group, subject, reviewer = null, external = null) => candidates.push({ group, subject, reviewer, external });
  subjects.forEach((subject) => {
    const person = directoryPerson(subject.subject_person_id);
    if (!person) return;
    const manager = directoryPerson(subject.manager_person_id);
    const directReports = activeDirectoryPeople().filter((candidate) => String(candidate.manager_email || "").toLowerCase() === String(person.work_email).toLowerCase());
    if (enabled.includes("self")) add("self", subject, person);
    if (enabled.includes("manager")) manager ? add("manager", subject, manager) : missing.manager++;
    if (enabled.includes("skip_manager")) {
      const skipManager = manager ? emailLookup.get(String(manager.manager_email || "").toLowerCase()) : null;
      skipManager ? add("skip_manager", subject, skipManager) : missing.skip_manager++;
    }
    if (enabled.includes("direct_report")) directReports.forEach((reviewer) => add("direct_report", subject, reviewer));
    const excludedIds = new Set([person.id, manager?.id, ...directReports.map((item) => item.id)].filter(Boolean));
    if (enabled.includes("peer")) activeDirectoryPeople().filter((candidate) => candidate.id !== person.id && candidate.job_title && candidate.job_title === person.job_title && !excludedIds.has(candidate.id)).forEach((reviewer) => add("peer", subject, reviewer));
    if (enabled.includes("same_team")) activeDirectoryPeople().filter((candidate) => candidate.id !== person.id && candidate.department && candidate.department === person.department && !excludedIds.has(candidate.id)).forEach((reviewer) => add("same_team", subject, reviewer));
    if (enabled.includes("cross_functional")) stagedRaterPeople().filter((reviewer) => reviewer.id !== person.id && !excludedIds.has(reviewer.id)).forEach((reviewer) => add("cross_functional", subject, reviewer));
    if (enabled.includes("external")) state.externalContacts.filter((contact) => contact.subject_roster_id === subject.id && contact.status === "active").forEach((external) => add("external", subject, null, external));
  });
  const priority = ["self", "manager", "skip_manager", "direct_report", "peer", "same_team", "cross_functional", "external"];
  const unique = new Map();
  priority.forEach((group) => candidates.filter((item) => item.group === group).forEach((item) => {
    const key = raterAssignmentKey(item.subject.id, item.reviewer?.id, item.external?.id);
    if (!unique.has(key)) unique.set(key, item);
  }));
  const existing = new Set(state.rosterRaters.filter((rater) => rater.cycle_id === $("#rater-cycle").value && rater.status !== "withdrawn").map((rater) => raterAssignmentKey(rater.subject_roster_id, rater.reviewer_person_id, rater.external_contact_id)));
  const assignments = [...unique.values()];
  const summary = Object.fromEntries(priority.map((group) => [group, assignments.filter((item) => item.group === group).length]));
  const threshold = state.cycles.find((cycle) => cycle.id === $("#rater-cycle").value)?.anonymous_group_threshold || 3;
  const privateGroups = ["peer", "same_team", "cross_functional", "direct_report", "external"];
  const privacyWarnings = privateGroups.flatMap((group) => subjects.filter((subject) => {
    const count = assignments.filter((item) => item.subject.id === subject.id && item.group === group).length;
    return count > 0 && count < threshold;
  }).map((subject) => ({ group, subject, threshold })));
  return { subjects, assignments, newAssignments: assignments.filter((item) => !existing.has(raterAssignmentKey(item.subject.id, item.reviewer?.id, item.external?.id))), existingCount: assignments.filter((item) => existing.has(raterAssignmentKey(item.subject.id, item.reviewer?.id, item.external?.id))).length, missing, summary, privacyWarnings, threshold };
}

function renderRaterBuilder() {
  const cycleSelect = $("#rater-cycle");
  const selectedCycle = cycleSelect.value;
  cycleSelect.innerHTML = `<option value="">Select a cycle</option>${state.cycles.map((cycle) => `<option value="${cycle.id}">${escapeHtml(cycle.name)}</option>`).join("")}`;
  cycleSelect.value = selectedCycle;
  $$('[data-perspective]').forEach((input) => { input.checked = state.raterPerspectives.includes(input.dataset.perspective); });
  const crossFunctionalEnabled = state.raterPerspectives.includes("cross_functional");
  const externalEnabled = state.raterPerspectives.includes("external");
  const people = activeDirectoryPeople();
  const departments = [...new Set(people.map((person) => person.department).filter(Boolean))].sort();
  const titles = [...new Set(people.map((person) => person.job_title).filter(Boolean))].sort();
  const targetCount = raterCycleSubjects().length;
  $("#rater-rule-note").textContent = targetCount ? `${targetCount} feedback subjects are ready in this cycle. Manager, skip-level, direct-report, peer and same-team relationships are calculated from your private directory.` : "Choose a cycle with feedback subjects first.";
  $("#rater-filter-controls").classList.toggle("hidden", !crossFunctionalEnabled);
  $("#external-contact-panel").classList.toggle("hidden", !externalEnabled);
  if (!crossFunctionalEnabled) {
    $("#rater-filter-panel").innerHTML = `<p class="form-note"><b>Cross-functional partners are optional.</b><br>Turn on Cross-functional partners above if you want to select people from other departments or designations.</p>`;
    $("#rater-current-actions").innerHTML = "";
    $("#rater-group-summary").innerHTML = "";
  } else {
    $("#rater-scope").value = state.raterScope;
    const departmentCount = (department) => people.filter((person) => person.department === department && (!state.raterJobTitles.length || state.raterJobTitles.includes(person.job_title))).length;
    const titleCount = (title) => people.filter((person) => person.job_title === title && (!state.raterDepartments.length || state.raterDepartments.includes(person.department))).length;
    if (state.raterScope === "individual") $("#rater-filter-panel").innerHTML = `<p class="form-note">Choose individual cross-functional partners.</p><div class="audience-option-grid">${people.map((person) => audienceOptionMarkup("data-rater-person", person.id, directoryPersonName(person.id), 1, state.raterSelectedIds.includes(person.id))).join("")}</div>`;
    else if (state.raterScope === "department") $("#rater-filter-panel").innerHTML = `<p class="form-note">Choose one or more departments for the cross-functional pool.</p><div class="audience-option-grid">${departments.map((department) => audienceOptionMarkup("data-rater-department", department, department, people.filter((person) => person.department === department).length, state.raterDepartments.includes(department))).join("")}</div>`;
    else if (state.raterScope === "job_title") $("#rater-filter-panel").innerHTML = `<p class="form-note">Choose one or more designations for the cross-functional pool.</p><div class="audience-option-grid">${titles.map((title) => audienceOptionMarkup("data-rater-title", title, title, people.filter((person) => person.job_title === title).length, state.raterJobTitles.includes(title))).join("")}</div>`;
    else if (state.raterScope === "department_job_title") $("#rater-filter-panel").innerHTML = `<p class="form-note">Choose a department and designation. Only people matching both are added to the cross-functional pool.</p><div class="audience-filter-columns"><div><b>Departments</b><div class="audience-option-grid">${departments.map((department) => audienceOptionMarkup("data-rater-department", department, department, departmentCount(department), state.raterDepartments.includes(department))).join("")}</div></div><div><b>Designations</b><div class="audience-option-grid">${titles.map((title) => audienceOptionMarkup("data-rater-title", title, title, titleCount(title), state.raterJobTitles.includes(title))).join("")}</div></div></div>`;
    else $("#rater-filter-panel").innerHTML = `<p class="form-note"><b>Entire active organization</b><br>${people.length} people will be added to the cross-functional pool. The final review will show the request volume.</p>`;
    $$('[data-rater-person]').forEach((input) => input.addEventListener("change", () => { state.raterSelectedIds = $$('[data-rater-person]:checked').map((item) => item.value); renderCurrentRaterAction(); renderRaterImpact(); }));
    $$('[data-rater-department]').forEach((input) => input.addEventListener("change", () => { state.raterDepartments = $$('[data-rater-department]:checked').map((item) => item.value); renderRaterBuilder(); }));
    $$('[data-rater-title]').forEach((input) => input.addEventListener("change", () => { state.raterJobTitles = $$('[data-rater-title]:checked').map((item) => item.value); renderRaterBuilder(); }));
    renderCurrentRaterAction();
    renderStagedRaterGroup();
  }
  renderExternalContacts();
  renderRaterImpact();
}

function renderCurrentRaterAction() {
  const current = selectedRaterPeople();
  const currentIds = new Set(state.raterDraftIds);
  const newPeople = current.filter((person) => !currentIds.has(person.id));
  $("#rater-current-actions").innerHTML = `<div><b>Current rater selection</b><small>${current.length ? `${current.length} people match this choice${newPeople.length !== current.length ? ` · ${newPeople.length} new to the rater pool` : ""}` : "Choose people, a department, a designation, or a combined filter."}</small></div><button class="button secondary" id="stage-rater-selection" ${newPeople.length ? "" : "disabled"}>Add to rater pool <span>→</span></button>`;
  $("#stage-rater-selection").addEventListener("click", () => {
    if (!newPeople.length) return;
    state.raterDraftIds = [...new Set([...state.raterDraftIds, ...newPeople.map((person) => person.id)])];
    state.raterDraftSources.push({ method: state.raterScope, label: raterSourceLabel(), people_added: newPeople.length });
    resetCurrentRaterSelection();
    $("#rater-builder-note").textContent = `${newPeople.length} people added to the rater pool.`;
    renderRaterBuilder();
  });
}

function renderStagedRaterGroup() {
  const people = stagedRaterPeople();
  $("#rater-group-summary").innerHTML = `<div class="audience-group-head"><div><span>RATER POOL</span><b>${people.length} people ready</b><small>Selections are combined and duplicate people are removed.</small></div>${people.length ? `<button class="text-button" id="clear-rater-group">Clear pool</button>` : ""}</div>${state.raterDraftSources.length ? `<div class="audience-source-list">${state.raterDraftSources.map((source) => `<span>${escapeHtml(source.label)} <i>+${source.people_added}</i></span>`).join("")}</div>` : `<p>Build the rater pool by adding one or more selections above.</p>`}`;
  $("#clear-rater-group")?.addEventListener("click", () => { state.raterDraftIds = []; state.raterDraftSources = []; renderRaterBuilder(); });
}

function normalizeExternalRows(records) {
  const rows = [];
  const skipped = [];
  records.forEach((record, index) => {
    const subjectEmail = directoryCell(record, ["feedbacksubjectemail", "subjectemail", "employeeemail"]).toLowerCase();
    const fullName = directoryCell(record, ["fullname", "name", "contactname"]);
    const email = directoryCell(record, ["email", "workemail", "contactemail"]).toLowerCase();
    if (!subjectEmail || !fullName || !/^\S+@\S+\.\S+$/.test(email)) { skipped.push(index + 2); return; }
    rows.push({ subjectEmail, fullName, email, companyName: directoryCell(record, ["company", "companyname"]), relationshipLabel: directoryCell(record, ["relationship", "relationshiplabel", "type"]) });
  });
  return { rows, skipped };
}

function renderExternalContacts() {
  if (!state.raterPerspectives.includes("external")) return;
  const cycleId = $("#rater-cycle").value;
  const subjects = raterCycleSubjects();
  $("#external-subject").innerHTML = `<option value="">Select a feedback subject</option>${subjects.map((subject) => `<option value="${subject.id}">${escapeHtml(directoryPersonName(subject.subject_person_id))}</option>`).join("")}`;
  if (!state.externalAvailable) {
    $("#external-contact-list").innerHTML = `<p class="form-note">External contacts will be available once the 360 external-contact update has been connected.</p>`;
    return;
  }
  const contacts = state.externalContacts.filter((contact) => contact.cycle_id === cycleId && contact.status !== "withdrawn");
  $("#external-contact-list").innerHTML = contacts.length ? `<div class="import-preview-head"><b>${contacts.length} external contact${contacts.length === 1 ? "" : "s"} ready</b><span>Private invitation links are sent only after approval.</span></div>${contacts.slice(0, 6).map((contact) => `<div class="external-row"><b>${escapeHtml(contact.full_name)}</b><span>${escapeHtml(contact.email)} · feedback for ${escapeHtml(directoryPersonName(state.rosterSubjects.find((subject) => subject.id === contact.subject_roster_id)?.subject_person_id))}</span></div>`).join("")}${contacts.length > 6 ? `<p class="form-note">Plus ${contacts.length - 6} more contacts.</p>` : ""}` : `<p class="form-note">No external contacts have been added for this cycle yet.</p>`;
}

function renderRaterImpact() {
  const plan = plannedRaterAssignments();
  const cycleMissing = !$("#rater-cycle").value;
  const groupNeedsPool = state.raterPerspectives.includes("cross_functional") && !stagedRaterPeople().length;
  const noAssignments = !plan.assignments.length;
  $("#open-rater-review").disabled = cycleMissing || groupNeedsPool || noAssignments || !plan.newAssignments.length;
  const detail = state.raterPerspectives.map((group) => `${raterGroupLabel()[group]}: ${plan.summary[group] || 0}`).join(" · ");
  const note = cycleMissing ? "Choose a cycle first." : groupNeedsPool ? "Build the cross-functional partner pool before reviewing this plan." : noAssignments ? "This combination did not find any reviewers." : `${plan.newAssignments.length} new confidential feedback request${plan.newAssignments.length === 1 ? "" : "s"} will be prepared${plan.existingCount ? ` · ${plan.existingCount} already on the rater list` : ""}. ${detail}${plan.privacyWarnings.length ? ` · ${plan.privacyWarnings.length} privacy check${plan.privacyWarnings.length === 1 ? "" : "s"} need attention` : ""}.`;
  $("#rater-impact").innerHTML = `<b>Assignment impact</b><p>${note}</p>`;
}

function openRaterReview() {
  const plan = plannedRaterAssignments();
  const cycle = state.cycles.find((item) => item.id === $("#rater-cycle").value);
  if (!plan.newAssignments.length) return;
  const subjectNames = plan.subjects.slice(0, 6).map((subject) => escapeHtml(directoryPersonName(subject.subject_person_id))).join(" · ");
  const perspectives = state.raterPerspectives.map((group) => `<span>${escapeHtml(raterGroupLabel()[group])} <i>${plan.summary[group] || 0} requests</i></span>`).join("");
  $("#rater-review-content").innerHTML = `<div class="review-summary"><article><span>WHO IS ASSESSED</span><b>${plan.subjects.length} people in ${escapeHtml(cycle?.name || "this cycle")}</b><p>${subjectNames}${plan.subjects.length > 6 ? ` · plus ${plan.subjects.length - 6} more` : ""}</p></article><article><span>WHO GIVES FEEDBACK</span><b>${state.raterPerspectives.length} perspectives selected</b><p class="review-perspective-list">${perspectives}</p></article><article><span>WHAT WILL HAPPEN</span><b>${plan.newAssignments.length} private feedback requests will be added</b><p>No email is sent at this stage. You will approve the rater list before invitations are released.</p></article></div>`;
  const warnings = [plan.missing.manager ? `${plan.missing.manager} subject${plan.missing.manager === 1 ? "" : "s"} without an imported manager` : "", plan.missing.skip_manager ? `${plan.missing.skip_manager} subject${plan.missing.skip_manager === 1 ? "" : "s"} without an imported skip-level manager` : ""].filter(Boolean);
  if (plan.privacyWarnings.length) warnings.push(`${plan.privacyWarnings.length} anonymous group${plan.privacyWarnings.length === 1 ? " is" : "s are"} below the ${plan.threshold}-person privacy threshold`);
  $("#rater-review-note").textContent = warnings.length ? `Attention: ${warnings.join(" · ")}.` : "";
  $("#rater-review-modal").classList.remove("hidden");
  $("#close-rater-review").focus();
}

function closeRaterReview() {
  $("#rater-review-modal").classList.add("hidden");
  $("#open-rater-review").focus();
}

function renderFeedbackWorkspace() {
  $("#cycle-count").textContent = state.cycles.length;
  $("#participant-count").textContent = state.rosterAvailable ? state.rosterSubjects.length : state.participants.length;
  $("#task-count").textContent = state.assignments.length;
  renderDirectory();
  $("#next-action").textContent = state.cycles.length ? "Select feedback subjects and the right rater groups from your workforce directory." : "Create your first feedback cycle.";
  $("#participant-cycle").innerHTML = `<option value="">Select a cycle</option>${state.cycles.map((cycle) => `<option value="${cycle.id}">${escapeHtml(cycle.name)}</option>`).join("")}`;
  $("#question-cycle").innerHTML = `<option value="">Select a cycle</option>${state.cycles.map((cycle) => `<option value="${cycle.id}">${escapeHtml(cycle.name)}</option>`).join("")}`;
  renderQuestions();
  $("#participant-subject").innerHTML = directoryOptions();
  $("#participant-manager").innerHTML = directoryOptions("", true);
  $("#nomination-reviewer").innerHTML = directoryOptions();
  $("#nomination-participant").innerHTML = `<option value="">Select a feedback subject</option>${state.rosterSubjects.map((subject) => `<option value="${subject.id}">${escapeHtml(directoryPersonName(subject.subject_person_id))} · ${escapeHtml(state.cycles.find((cycle) => cycle.id === subject.cycle_id)?.name || "Cycle")}</option>`).join("")}`;
  renderAudienceBuilder();
  renderRaterBuilder();
  renderInvitationDelivery();
  renderProtectedReports();
  $("#cycle-list").innerHTML = state.cycles.length ? state.cycles.map((cycle) => {
    const subjectCount = state.rosterSubjects.filter((subject) => subject.cycle_id === cycle.id && subject.status !== "withdrawn").length;
    const approvedCount = state.rosterRaters.filter((rater) => rater.cycle_id === cycle.id && rater.status === "approved").length;
    const questionCount = state.questions.filter((question) => question.cycle_id === cycle.id).length;
    const canLaunch = cycle.status === "draft" && subjectCount > 0 && approvedCount > 0 && questionCount > 0;
    return `<div class="row-card"><div><b>${escapeHtml(cycle.name)}</b><p>${escapeHtml(cycle.purpose)} · ${cycle.status} · anonymity threshold ${cycle.anonymous_group_threshold}</p></div><div><span class="status ${cycle.status === "live" ? "approved" : "pending"}">${cycle.status}</span>${cycle.status === "draft" ? `<button class="text-button" data-launch="${cycle.id}" ${canLaunch ? "" : "disabled"}>Launch cycle</button>` : ""}${cycle.status === "live" ? `<button class="text-button" data-close-cycle="${cycle.id}">Close cycle</button>` : ""}${["closed", "report_ready"].includes(cycle.status) && isFeedbackAdmin() ? `<button class="text-button" data-reopen-cycle="${cycle.id}">Reopen cycle</button>` : ""}</div></div>`;
  }).join("") : "No cycles yet.";
  const visibleRosterRaters = state.rosterRaters.filter((nomination) => nomination.status !== "withdrawn");
  $("#nomination-list").innerHTML = visibleRosterRaters.length ? visibleRosterRaters.map((nomination) => {
    const cycle = state.cycles.find((item) => item.id === nomination.cycle_id);
    const canReplace = isFeedbackAdmin() && cycle && ["draft", "live"].includes(cycle.status);
    if (state.replacingRaterId === nomination.id) {
      return `<div class="row-card"><div><b>Replacing ${escapeHtml(nomination.external_contact_id ? state.externalContacts.find((contact) => contact.id === nomination.external_contact_id)?.full_name || "External contact" : directoryPersonName(nomination.reviewer_person_id))}</b><p>Choose who takes over this ${nomination.rater_group.replaceAll("_", " ")} assignment. If they already answered anything, that response is deleted, not kept.</p><select id="replace-reviewer-select">${directoryOptions()}</select></div><div><button class="text-button" data-confirm-replace="${nomination.id}">Confirm replace</button><button class="text-button" data-cancel-replace="${nomination.id}">Cancel</button></div></div>`;
    }
    return `<div class="row-card"><div><b>${escapeHtml(nomination.external_contact_id ? state.externalContacts.find((contact) => contact.id === nomination.external_contact_id)?.full_name || "External contact" : directoryPersonName(nomination.reviewer_person_id))}</b><p>${nomination.rater_group.replaceAll("_", " ")} feedback for ${escapeHtml(directoryPersonName(state.rosterSubjects.find((subject) => subject.id === nomination.subject_roster_id)?.subject_person_id))}</p></div><div><span class="status ${nomination.status === "approved" ? "approved" : "pending"}">${nomination.status}</span>${nomination.status === "pending" && isFeedbackAdmin() ? `<button class="text-button" data-approve="${nomination.id}">Approve</button>` : ""}${canReplace ? `<button class="text-button" data-start-replace="${nomination.id}">Replace</button>` : ""}</div></div>`;
  }).join("") : "No rater nominations yet.";
  $$('[data-approve]').forEach((button) => button.addEventListener("click", () => approveNomination(button.dataset.approve)));
  $$('[data-start-replace]').forEach((button) => button.addEventListener("click", () => { state.replacingRaterId = button.dataset.startReplace; renderShell(); }));
  $$('[data-cancel-replace]').forEach((button) => button.addEventListener("click", () => { state.replacingRaterId = null; renderShell(); }));
  $$('[data-confirm-replace]').forEach((button) => button.addEventListener("click", () => replaceReviewer(button.dataset.confirmReplace)));
  $$('[data-launch]').forEach((button) => button.addEventListener("click", () => launchCycle(button.dataset.launch)));
  $$('[data-close-cycle]').forEach((button) => button.addEventListener("click", () => closeCycle(button.dataset.closeCycle)));
  $$('[data-reopen-cycle]').forEach((button) => button.addEventListener("click", () => reopenCycle(button.dataset.reopenCycle)));
}

function renderInvitationDelivery() {
  const select = $("#invitation-cycle");
  if (!select) return;
  const selectedCycleId = select.value;
  select.innerHTML = `<option value="">Select a cycle</option>${state.cycles.map((cycle) => `<option value="${cycle.id}">${escapeHtml(cycle.name)} · ${escapeHtml(cycle.status)}</option>`).join("")}`;
  select.value = selectedCycleId;
  const cycle = state.cycles.find((item) => item.id === select.value);
  const approved = state.rosterRaters.filter((rater) => rater.cycle_id === cycle?.id && rater.status === "approved");
  const invited = state.rosterRaters.filter((rater) => rater.cycle_id === cycle?.id && rater.status === "invited");
  const sent = state.invitationDeliveries.filter((delivery) => delivery.cycle_id === cycle?.id && delivery.status === "sent").length;
  const button = $("#send-approved-invitations");
  button.disabled = !isFeedbackAdmin() || !cycle || cycle.status !== "live" || !approved.length;
  const reminderButton = $("#send-reminders");
  reminderButton.disabled = !isFeedbackAdmin() || !cycle || cycle.status !== "live" || !invited.length;
  $("#invitation-delivery-summary").textContent = !cycle
    ? "Choose a cycle to review approved reviewer assignments."
    : cycle.status !== "live"
      ? `${approved.length} approved reviewer${approved.length === 1 ? " is" : "s are"} ready. Launch this cycle before invitations can be released.`
      : `${approved.length} approved reviewer${approved.length === 1 ? " is" : "s are"} ready to send · ${invited.length} already marked invited · ${sent} delivery record${sent === 1 ? "" : "s"} sent.`;
  renderDeliveryAudit(cycle);
}

const DELIVERY_STATUS_TONE = { completed: "approved", sent: "pending", opened: "pending", queued: "pending", failed: "failed", revoked: "failed", expired: "failed" };
const DELIVERY_KIND_LABEL = { initial: "invitation", reminder: "reminder", resend: "resend" };
function renderDeliveryAudit(cycle) {
  const container = $("#delivery-audit-list");
  if (!container) return;
  if (!cycle) { container.className = "empty-state"; container.textContent = "Choose a cycle to see its delivery history."; return; }
  const deliveries = state.invitationDeliveries.filter((delivery) => delivery.cycle_id === cycle.id).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  if (!deliveries.length) { container.className = "empty-state"; container.textContent = "No invitations sent yet for this cycle."; return; }
  container.className = "";
  container.innerHTML = deliveries.map((delivery) => {
    const rater = state.rosterRaters.find((item) => item.id === delivery.roster_rater_id);
    const recipientName = !rater ? "Former reviewer" : rater.external_contact_id
      ? state.externalContacts.find((contact) => contact.id === rater.external_contact_id)?.full_name || "External contact"
      : directoryPersonName(rater.reviewer_person_id);
    const subjectName = rater ? directoryPersonName(state.rosterSubjects.find((subject) => subject.id === rater.subject_roster_id)?.subject_person_id) : "";
    const milestone = delivery.completed_at ? `completed ${new Date(delivery.completed_at).toLocaleString()}`
      : delivery.opened_at ? `opened ${new Date(delivery.opened_at).toLocaleString()}`
      : delivery.sent_at ? `sent ${new Date(delivery.sent_at).toLocaleString()}`
      : `queued ${new Date(delivery.created_at).toLocaleString()}`;
    const tone = DELIVERY_STATUS_TONE[delivery.status] || "pending";
    return `<div class="row-card"><div><b>${escapeHtml(recipientName)}</b><p>${escapeHtml(DELIVERY_KIND_LABEL[delivery.delivery_kind] || delivery.delivery_kind)} for ${escapeHtml(subjectName)} · ${escapeHtml(milestone)}</p></div><div><span class="status ${tone}">${escapeHtml(delivery.status)}</span></div></div>`;
  }).join("");
}

function renderProtectedReports() {
  const cycleSelect = $("#reports-cycle");
  if (!cycleSelect) return;
  const chosenCycle = cycleSelect.value;
  cycleSelect.innerHTML = `<option value="">Select a cycle</option>${state.cycles.map((cycle) => `<option value="${cycle.id}">${escapeHtml(cycle.name)} · ${escapeHtml(cycle.status)}</option>`).join("")}`;
  cycleSelect.value = chosenCycle;
  $("#export-reports-csv").disabled = !isFeedbackAdmin() || !chosenCycle;
  const scheduleInput = $("#scheduled-release-at");
  const chosenCycleRecord = state.cycles.find((item) => item.id === chosenCycle);
  scheduleInput.disabled = !isFeedbackAdmin() || !chosenCycle;
  $("#save-scheduled-release").disabled = !isFeedbackAdmin() || !chosenCycle;
  scheduleInput.value = chosenCycleRecord?.report_release_at ? new Date(chosenCycleRecord.report_release_at).toISOString().slice(0, 16) : "";
  const data = state.protectedReport;
  const commentsReviewButton = $("#mark-comments-reviewed");
  commentsReviewButton.disabled = !isFeedbackAdmin() || !chosenCycle || !data || data.cycle.id !== chosenCycle || !data.cycle.commentReviewRequired || !!data.cycle.commentsReviewedAt;
  $("#comments-reviewed-note").textContent = !data || data.cycle.id !== chosenCycle
    ? "Read every written comment in this cycle before releasing any report."
    : !data.cycle.commentReviewRequired
      ? "This cycle has no open-text questions, so there is nothing to review."
      : data.cycle.commentsReviewedAt
        ? `Comments reviewed ${new Date(data.cycle.commentsReviewedAt).toLocaleString()}.`
        : "Step through each feedback subject below and read their \"Written comments\" section, then confirm here — release stays locked until you do.";
  const subjectSelect = $("#reports-subject");
  if (!data || data.cycle.id !== chosenCycle) {
    subjectSelect.disabled = true;
    subjectSelect.innerHTML = "<option value=\"\">Choose a cycle first</option>";
    $("#report-title").textContent = "No report selected";
    $("#report-summary").textContent = "No individual responses are displayed here.";
    $("#report-content").innerHTML = "";
    $("#report-comments").innerHTML = "";
    $("#release-protected-report").disabled = true;
    state.actionPlanDraft = null;
    renderActionPlan(null);
    return;
  }
  const chosenSubject = subjectSelect.value;
  subjectSelect.disabled = false;
  subjectSelect.innerHTML = `<option value="">Select a feedback subject</option>${data.reports.map((report) => `<option value="${report.rosterSubjectId}">${escapeHtml(report.subjectName)}${report.jobTitle ? ` · ${escapeHtml(report.jobTitle)}` : ""}</option>`).join("")}`;
  subjectSelect.value = data.reports.some((report) => report.rosterSubjectId === chosenSubject) ? chosenSubject : data.reports[0]?.rosterSubjectId || "";
  const report = data.reports.find((item) => item.rosterSubjectId === subjectSelect.value);
  if (!report) { state.actionPlanDraft = null; renderActionPlan(null); $("#report-comments").innerHTML = ""; return; }
  $("#report-title").textContent = `${report.subjectName}'s protected report`;
  $("#report-release-status").textContent = report.released ? `Released ${new Date(report.releasedAt).toLocaleDateString()}` : "Withheld — administrator preview only";
  $("#report-summary").innerHTML = `<div class="review-summary"><article><span>COMPLETION</span><b>${report.completion.completed} of ${report.completion.invited} voices submitted</b><p>Only completed feedback contributes to this view.</p></article><article><span>ANONYMITY THRESHOLD</span><b>${data.cycle.anonymousGroupThreshold} voices</b><p>Peer-style groups remain hidden until enough people respond.</p></article><article><span>REPORT STATE</span><b>${report.released ? "Released" : "Withheld"}</b><p>${data.cycle.canRelease ? "This cycle is ready for deliberate release." : "Close the cycle before releasing this report."}</p></article></div>`;
  $("#report-content").innerHTML = report.groups.length ? report.groups.map((group) => group.visible
    ? `<article class="task-card"><span class="status approved">${escapeHtml(group.label)}</span><h3>${group.ratingAverage === null ? "No rating submitted yet" : `${group.ratingAverage.toFixed(2)} / 5`}</h3><p>${group.completed} of ${group.invited} voices completed · ${group.responseCount} scored response${group.responseCount === 1 ? "" : "s"} used.</p>${group.competencies.length ? `<div class="report-competencies">${group.competencies.map((competency) => `<div><b>${escapeHtml(competency.label)}</b><br><span>${competency.average.toFixed(2)} / 5 · ${competency.responseCount} response${competency.responseCount === 1 ? "" : "s"}</span></div>`).join("")}</div>` : ""}</article>`
    : `<article class="task-card"><span class="status pending">${escapeHtml(group.label)} withheld</span><h3>Anonymous group protected</h3><p>This group is below the ${group.minimum}-voice privacy threshold. No completion counts, scores, or comments are shown.</p></article>`).join("") : "<p class=\"empty-state\">No rater groups are configured for this person.</p>";
  const visibleComments = report.groups.filter((group) => group.visible).flatMap((group) => group.comments.map((comment) => ({ ...comment, groupLabel: group.label })));
  $("#report-comments").innerHTML = visibleComments.length
    ? visibleComments.map((comment) => `<div class="row-card"><div><b>${escapeHtml(comment.competencyLabel || comment.prompt)}</b><p>${escapeHtml(comment.text)}</p></div><span class="status pending">${escapeHtml(comment.groupLabel)}</span></div>`).join("")
    : "<p class=\"empty-state\">No written comments to review for this person yet — either no open-text questions were answered, or every anonymous group is still below the privacy threshold.</p>";
  const commentsBlocked = data.cycle.commentReviewRequired && !data.cycle.commentsReviewedAt;
  const release = $("#release-protected-report");
  release.disabled = !isFeedbackAdmin() || !data.cycle.canRelease || report.released || commentsBlocked;
  release.style.opacity = release.disabled ? "0.45" : "";
  release.style.cursor = release.disabled ? "not-allowed" : "";
  $("#release-report-note").textContent = report.released ? "This report has already been released." : commentsBlocked ? "Review this cycle's written comments (above) before releasing any report." : data.cycle.canRelease ? "Review the protected groups above, then release deliberately." : "A report can be released only after its cycle is closed.";
  if (!state.actionPlanDraft || state.actionPlanDraft.rosterSubjectId !== report.rosterSubjectId) {
    state.actionPlanDraft = { rosterSubjectId: report.rosterSubjectId, goals: report.actionPlan.goals.map((goal) => ({ ...goal })) };
  }
  renderActionPlan(report);
}

function readActionPlanRows() {
  return $$("#action-plan-goals [data-goal-row]").map((row) => ({
    id: row.dataset.goalId || null,
    title: row.querySelector(".ap-title").value,
    behavioralCommitment: row.querySelector(".ap-commitment").value,
    dueAt: row.querySelector(".ap-due").value || null,
    status: row.querySelector(".ap-status").value
  }));
}

function renderActionPlan(report) {
  const container = $("#action-plan-goals");
  const addButton = $("#add-action-goal");
  const saveButton = $("#save-action-plan");
  if (!report || !state.actionPlanDraft) {
    container.innerHTML = "<p class=\"empty-state\">Choose a feedback subject above to plan development actions.</p>";
    addButton.disabled = true;
    saveButton.disabled = true;
    return;
  }
  addButton.disabled = !isFeedbackAdmin();
  saveButton.disabled = !isFeedbackAdmin();
  const goals = state.actionPlanDraft.goals;
  container.innerHTML = goals.length ? goals.map((goal, index) => `<article class="task-card action-goal-card" data-goal-row data-goal-id="${goal.id || ""}"><label>Goal<input class="ap-title" maxlength="240" placeholder="e.g. Run every planning meeting with a written agenda" value="${escapeHtml(goal.title || "")}"></label><label>Behavioral commitment<textarea class="ap-commitment" maxlength="4000" placeholder="Describe the specific, observable behaviour change...">${escapeHtml(goal.behavioralCommitment || "")}</textarea></label><div class="form-grid"><label>Due<input type="date" class="ap-due" value="${goal.dueAt || ""}"></label><label>Status<select class="ap-status"><option value="not_started"${goal.status === "not_started" ? " selected" : ""}>Not started</option><option value="in_progress"${goal.status === "in_progress" ? " selected" : ""}>In progress</option><option value="complete"${goal.status === "complete" ? " selected" : ""}>Complete</option><option value="cancelled"${goal.status === "cancelled" ? " selected" : ""}>Cancelled</option></select></label></div><button class="text-button" data-remove-goal="${index}">Remove goal</button></article>`).join("") : "<p class=\"empty-state\">No action-plan goals yet. Add one below.</p>";
  $$('[data-remove-goal]').forEach((button) => button.addEventListener("click", () => {
    state.actionPlanDraft.goals = readActionPlanRows();
    state.actionPlanDraft.goals.splice(Number(button.dataset.removeGoal), 1);
    renderActionPlan(report);
  }));
}

function addActionGoal() {
  if (!state.actionPlanDraft) return;
  state.actionPlanDraft.goals = readActionPlanRows();
  state.actionPlanDraft.goals.push({ id: null, title: "", behavioralCommitment: "", dueAt: null, status: "not_started" });
  renderActionPlan(state.protectedReport?.reports.find((item) => item.rosterSubjectId === state.actionPlanDraft.rosterSubjectId));
}

async function saveActionPlan() {
  if (!state.actionPlanDraft) return;
  const cycleId = $("#reports-cycle").value;
  const rosterSubjectId = state.actionPlanDraft.rosterSubjectId;
  if (!cycleId || !rosterSubjectId) return;
  const goals = readActionPlanRows();
  const button = $("#save-action-plan");
  try {
    button.disabled = true;
    button.textContent = "Saving…";
    const response = await fetch("/api/feedback-reports", { method: "POST", headers: headers(), body: JSON.stringify({ organizationId: state.activeOrganization.id, cycleId, rosterSubjectId, action: "save_action_plan", goals }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || "Orbit could not save this action plan.");
    toast("Action plan saved.");
    state.actionPlanDraft = null;
    await loadProtectedReports();
    $("#reports-cycle").value = cycleId;
    $("#reports-subject").value = rosterSubjectId;
    renderProtectedReports();
  } catch (error) {
    toast(error.message);
  } finally {
    button.textContent = "Save action plan";
    button.disabled = !isFeedbackAdmin();
  }
}

async function markCommentsReviewed() {
  const cycleId = $("#reports-cycle").value;
  if (!cycleId) return;
  const button = $("#mark-comments-reviewed");
  try {
    button.disabled = true;
    button.textContent = "Saving…";
    const response = await fetch("/api/feedback-reports", { method: "POST", headers: headers(), body: JSON.stringify({ organizationId: state.activeOrganization.id, cycleId, action: "mark_comments_reviewed" }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || "Orbit could not record this review.");
    toast("Comment review recorded. Reports can now be released.");
    await loadProtectedReports();
    $("#reports-cycle").value = cycleId;
    renderProtectedReports();
  } catch (error) {
    toast(error.message);
  } finally {
    button.innerHTML = "I've reviewed the comments <span>✓</span>";
    renderProtectedReports();
  }
}

async function loadProtectedReports() {
  const cycleId = $("#reports-cycle").value;
  if (!cycleId) return;
  $("#reports-note").textContent = "Preparing protected report…";
  try {
    const response = await fetch(`/api/feedback-reports?organizationId=${encodeURIComponent(state.activeOrganization.id)}&cycleId=${encodeURIComponent(cycleId)}`, { headers: headers() });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || "Orbit could not prepare this protected report.");
    state.protectedReport = payload;
    renderProtectedReports();
    $("#reports-note").textContent = "Administrator preview only. Anonymous groups are withheld automatically.";
  } catch (error) { state.protectedReport = null; renderProtectedReports(); $("#reports-note").textContent = error.message; }
}

async function releaseProtectedReport() {
  const cycleId = $("#reports-cycle").value;
  const rosterSubjectId = $("#reports-subject").value;
  if (!cycleId || !rosterSubjectId) return;
  const button = $("#release-protected-report");
  try {
    button.disabled = true; button.textContent = "Releasing…";
    const response = await fetch("/api/feedback-reports", { method: "POST", headers: headers(), body: JSON.stringify({ organizationId: state.activeOrganization.id, cycleId, rosterSubjectId, action: "release" }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || "Orbit could not release this report.");
    await loadProtectedReports();
    toast("Protected report released.");
  } catch (error) { $("#release-report-note").textContent = error.message; }
  finally { button.innerHTML = "Release protected report <span>→</span>"; renderProtectedReports(); }
}

async function sendApprovedInvitations() {
  const cycleId = $("#invitation-cycle").value;
  const cycle = state.cycles.find((item) => item.id === cycleId);
  const rosterRaterIds = state.rosterRaters.filter((rater) => rater.cycle_id === cycleId && rater.status === "approved").map((rater) => rater.id);
  if (!cycle || cycle.status !== "live" || !rosterRaterIds.length) return;
  const button = $("#send-approved-invitations");
  try {
    button.disabled = true;
    button.textContent = "Sending invitations…";
    const response = await fetch("/api/feedback-invitations", { method: "POST", headers: headers(), body: JSON.stringify({ organizationId: state.activeOrganization.id, cycleId, rosterRaterIds }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || "Orbit could not send reviewer invitations.");
    $("#invitation-delivery-note").textContent = `${payload.sent || 0} invitation${payload.sent === 1 ? "" : "s"} sent${payload.alreadyDelivered ? ` · ${payload.alreadyDelivered} already had a private link` : ""}${payload.failed ? ` · ${payload.failed} could not be delivered` : ""}${payload.skipped ? ` · ${payload.skipped} skipped because a recipient address was unavailable` : ""}.`;
    await loadAndRender();
    $("#invitation-cycle").value = cycleId;
    renderInvitationDelivery();
  } catch (error) {
    $("#invitation-delivery-note").textContent = error.message;
  } finally {
    button.innerHTML = "Send approved invitations <span>→</span>";
    renderInvitationDelivery();
  }
}

async function sendReminders() {
  const cycleId = $("#invitation-cycle").value;
  const cycle = state.cycles.find((item) => item.id === cycleId);
  const rosterRaterIds = state.rosterRaters.filter((rater) => rater.cycle_id === cycleId && rater.status === "invited").map((rater) => rater.id);
  if (!cycle || cycle.status !== "live" || !rosterRaterIds.length) return;
  const button = $("#send-reminders");
  try {
    button.disabled = true;
    button.textContent = "Sending reminders…";
    const response = await fetch("/api/feedback-invitations", { method: "POST", headers: headers(), body: JSON.stringify({ organizationId: state.activeOrganization.id, cycleId, rosterRaterIds, kind: "reminder" }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || "Orbit could not send reminders.");
    $("#invitation-delivery-note").textContent = `${payload.sent || 0} reminder${payload.sent === 1 ? "" : "s"} sent${payload.failed ? ` · ${payload.failed} could not be delivered` : ""}${payload.skipped ? ` · ${payload.skipped} skipped because a recipient address was unavailable` : ""}.`;
    await loadAndRender();
    $("#invitation-cycle").value = cycleId;
    renderInvitationDelivery();
  } catch (error) {
    $("#invitation-delivery-note").textContent = error.message;
  } finally {
    button.innerHTML = "Send reminders <span>→</span>";
    renderInvitationDelivery();
  }
}

function renderQuestions() {
  const cycleId = $("#question-cycle").value;
  const questions = state.questions.filter((question) => question.cycle_id === cycleId);
  $("#question-count").textContent = questions.length;
  if (!cycleId) {
    $("#question-list").innerHTML = "Choose a cycle above to view its questions.";
    return;
  }
  $("#question-list").innerHTML = questions.length
    ? questions.map((question, index) => `<div class="row-card"><div><b>${index + 1}. ${escapeHtml(question.prompt)}</b><p>${escapeHtml(question.competency_label || "General feedback")} · ${question.question_type === "rating" ? "1–5 rating" : "Open text"}</p></div><span class="status approved">saved</span></div>`).join("")
    : "No questions have been added to this cycle yet.";
}

async function loadAndRender() {
  await loadProductData();
  renderShell();
}

async function launchCycle(cycleId) {
  try {
    await rest(`feedback_cycles?id=eq.${cycleId}`, "", { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "live" }) });
    toast("Feedback collection is now live.");
    await loadAndRender();
  } catch (error) { toast(error.message); }
}

async function closeCycle(cycleId) {
  const cycle = state.cycles.find((item) => item.id === cycleId);
  if (!cycle || cycle.status !== "live") return;
  if (!window.confirm(`Close “${cycle.name}”? No new invitations can be sent after this.`)) return;
  try {
    await rest(`feedback_cycles?id=eq.${cycleId}`, "", { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "closed" }) });
    toast("Feedback cycle closed. Protected reports can now be released.");
    await loadAndRender();
  } catch (error) { toast(error.message); }
}

async function saveScheduledRelease() {
  const cycleId = $("#reports-cycle").value;
  const input = $("#scheduled-release-at");
  if (!cycleId) return;
  const button = $("#save-scheduled-release");
  try {
    button.disabled = true;
    button.textContent = "Saving…";
    // The database itself rejects a release time earlier than the cycle's
    // own closing time -- that constraint is not re-checked here, its real
    // error message is allowed to surface as-is.
    const releaseAt = input.value ? new Date(input.value).toISOString() : null;
    await rest(`feedback_cycles?id=eq.${cycleId}`, "", { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ report_release_at: releaseAt }) });
    toast(releaseAt ? "Scheduled release saved. Runs once daily." : "Scheduled release cleared.");
    await loadAndRender();
    $("#reports-cycle").value = cycleId;
    renderProtectedReports();
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = !isFeedbackAdmin() || !cycleId;
    button.textContent = "Save release schedule";
  }
}

async function exportReportsCsv() {
  const cycleId = $("#reports-cycle").value;
  if (!cycleId) return;
  const button = $("#export-reports-csv");
  try {
    button.disabled = true;
    button.textContent = "Preparing export…";
    const response = await fetch(`/api/feedback-reports?organizationId=${encodeURIComponent(state.activeOrganization.id)}&cycleId=${encodeURIComponent(cycleId)}&format=csv`, { headers: headers() });
    if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.message || "Orbit could not prepare this export."); }
    const blob = await response.blob();
    const disposition = response.headers.get("content-disposition") || "";
    const filenameMatch = disposition.match(/filename="([^"]+)"/);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filenameMatch ? filenameMatch[1] : "protected-report.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = !isFeedbackAdmin() || !cycleId;
    button.innerHTML = "Export cycle report (CSV) <span>↓</span>";
  }
}

async function replaceReviewer(rosterRaterId) {
  const nomination = state.rosterRaters.find((item) => item.id === rosterRaterId);
  const select = $("#replace-reviewer-select");
  const newReviewerPersonId = select?.value;
  if (!nomination || !newReviewerPersonId) return;
  if (newReviewerPersonId === nomination.reviewer_person_id) { toast("Choose someone different to replace them with."); return; }
  if (!window.confirm("Replace this reviewer? If they already answered anything, that response is deleted, not transferred to the new person.")) return;
  try {
    const response = await fetch("/api/feedback-replace-reviewer", { method: "POST", headers: headers(), body: JSON.stringify({ organizationId: state.activeOrganization.id, cycleId: nomination.cycle_id, rosterRaterId, newReviewerPersonId }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "Orbit could not replace this reviewer.");
    toast(data.responseDeleted ? "Reviewer replaced. Their earlier response was deleted." : "Reviewer replaced.");
    state.replacingRaterId = null;
    await loadAndRender();
  } catch (error) {
    toast(error.message);
  }
}

async function reopenCycle(cycleId) {
  const cycle = state.cycles.find((item) => item.id === cycleId);
  if (!cycle || !["closed", "report_ready"].includes(cycle.status)) return;
  if (!window.confirm(`Reopen “${cycle.name}”? Anyone who has not yet responded can respond again. Completed responses cannot be changed. Any already-released report will be withdrawn until this cycle is closed and released again.`)) return;
  try {
    const response = await fetch("/api/feedback-reports", { method: "POST", headers: headers(), body: JSON.stringify({ organizationId: state.activeOrganization.id, cycleId, action: "reopen_cycle" }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "Orbit could not reopen this cycle.");
    toast(data.reportsWithdrawn ? `Cycle reopened. ${data.reportsWithdrawn} released report${data.reportsWithdrawn === 1 ? "" : "s"} withdrawn until it closes again.` : "Cycle reopened.");
    await loadAndRender();
  } catch (error) { toast(error.message); }
}

async function approveNomination(nominationId) {
  try {
    await rest(`feedback_cycle_roster_raters?id=eq.${nominationId}`, "", { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "approved", reviewed_by: state.user.id }) });
    toast("Rater approved. Invitations are sent when the cycle is ready to launch.");
    await loadAndRender();
  } catch (error) { toast(error.message); }
}

function authEmail() { return $("#auth-email").value.trim().toLowerCase(); }
function authPassword() { return $("#auth-password").value; }
function authRedirectUrl() { return `${location.origin}/orbit-360/orbit-console.html`; }
function authErrorMessage(payload, fallback) {
  return payload?.message || payload?.msg || payload?.error_description || payload?.error || fallback;
}

function emailLinkProblem() {
  const values = new URLSearchParams(location.hash.slice(1));
  if (!values.get("error")) return "";
  history.replaceState({}, document.title, location.pathname);
  return "This password link is invalid or expired. Return to Orbit and request one new password link.";
}

function passwordSetupConfirmation() {
  const values = new URLSearchParams(location.search);
  const tokenHash = values.get("token_hash");
  const type = values.get("type");
  if (!tokenHash || !["recovery", "email"].includes(type)) return false;
  state.passwordSetupToken = tokenHash;
  state.passwordSetupType = type;
  history.replaceState({}, document.title, location.pathname);
  return true;
}

function validatePasswordCredentials() {
  const email = authEmail();
  const password = authPassword();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("Enter a valid work email address.");
  if (password.length < 10) throw new Error("Use a password with at least 10 characters.");
  return { email, password };
}

async function submitPasswordAuth() {
  const button = $("#password-sign-in");
  try {
    const { email, password } = validatePasswordCredentials();
    button.disabled = true;
    button.textContent = "Signing in…";
    const response = await fetch(`${config.url}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: config.publishableKey, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
    const session = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(authErrorMessage(session, "Orbit could not complete that sign-in."));
    saveSession(session);
    state.user = session.user || await loadUser(session.access_token);
    await loadContext();
  } catch (error) { $("#auth-note").textContent = error.message; }
  finally {
    button.disabled = false;
    button.innerHTML = "Sign in <span>→</span>";
  }
}

$("#password-sign-in").addEventListener("click", () => submitPasswordAuth());

$("#open-signup").addEventListener("click", () => {
  $("#signup-email").value = authEmail();
  $("#signup-note").textContent = "";
  setScreen("signup");
});

$("#back-to-signin").addEventListener("click", () => setScreen("auth"));

$("#create-organization-from-access").addEventListener("click", () => setScreen("setup"));

$("#try-another-account").addEventListener("click", async () => {
  try { await fetch(`${config.url}/auth/v1/logout`, { method: "POST", headers: headers() }); } catch (_) { /* Clear this browser even if the network is unavailable. */ }
  localStorage.removeItem(sessionStorageKey);
  state.token = null;
  state.refreshToken = null;
  state.user = null;
  $("#auth-password").value = "";
  $("#auth-note").textContent = "Sign in with the work email that received your Orbit invitation.";
  setScreen("auth");
  $("#auth-email").focus();
});

$("#signup-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = $("#signup-email").value.trim().toLowerCase();
  const password = $("#signup-password").value;
  const confirmation = $("#signup-password-confirm").value;
  if (!/^\S+@\S+\.\S+$/.test(email)) { $("#signup-note").textContent = "Enter a valid work email address."; return; }
  if (password.length < 10) { $("#signup-note").textContent = "Use a password with at least 10 characters."; return; }
  if (password !== confirmation) { $("#signup-note").textContent = "The passwords do not match."; return; }
  const button = event.submitter;
  try {
    button.disabled = true;
    button.textContent = "Creating workspace…";
    const response = await fetch(`${config.url}/auth/v1/signup`, {
      method: "POST",
      headers: { apikey: config.publishableKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, email_redirect_to: authRedirectUrl() })
    });
    const session = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(authErrorMessage(session, "Orbit could not create that workspace."));
    if (!session.access_token) {
      $("#signup-note").textContent = "Check your inbox and choose Confirm workspace to finish setting up Orbit.";
      return;
    }
    saveSession(session);
    state.user = session.user || await loadUser(session.access_token);
    await loadContext();
  } catch (error) { $("#signup-note").textContent = error.message; }
  finally { button.disabled = false; button.innerHTML = "Create workspace <span>→</span>"; }
});

$("#reset-password").addEventListener("click", async () => {
  const email = authEmail();
  if (!/^\S+@\S+\.\S+$/.test(email)) { $("#auth-note").textContent = "Enter your work email first."; return; }
  const button = $("#reset-password"); button.disabled = true; button.textContent = "Sending password setup email…";
  try {
    const response = await fetch(`${config.url}/auth/v1/recover`, { method: "POST", headers: { apikey: config.publishableKey, "Content-Type": "application/json" }, body: JSON.stringify({ email, redirect_to: authRedirectUrl() }) });
    if (!response.ok) { const error = await response.json().catch(() => ({})); throw new Error(authErrorMessage(error, "Could not start password setup.")); }
    $("#auth-note").textContent = "Check your email and choose Set your password. You will return to Orbit to finish securely.";
  } catch (error) { $("#auth-note").textContent = error.message; }
  finally { button.disabled = false; button.textContent = "Set or reset my password"; }
});

$("#continue-password-setup").addEventListener("click", async () => {
  const button = $("#continue-password-setup");
  try {
    button.disabled = true;
    button.textContent = "Confirming…";
    const response = await fetch(`${config.url}/auth/v1/verify`, { method: "POST", headers: { apikey: config.publishableKey, "Content-Type": "application/json" }, body: JSON.stringify({ token_hash: state.passwordSetupToken, type: state.passwordSetupType }) });
    const session = await response.json().catch(() => ({}));
    if (!response.ok || !session.access_token) throw new Error(authErrorMessage(session, "This password setup link is invalid or has expired. Request a new one and try again."));
    saveSession(session);
    state.user = session.user || await loadUser(session.access_token);
    state.passwordRecovery = state.passwordSetupType === "recovery";
    if (state.passwordRecovery) setScreen("reset");
    else await loadContext();
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; button.innerHTML = state.passwordSetupType === "recovery" ? "Continue securely <span>→</span>" : "Confirm workspace <span>→</span>"; }
});

$("#password-reset-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const password = $("#new-password").value;
  if (password.length < 10) { $("#password-reset-note").textContent = "Use a password with at least 10 characters."; return; }
  if (password !== $("#confirm-password").value) { $("#password-reset-note").textContent = "The passwords do not match."; return; }
  try {
    const response = await fetch(`${config.url}/auth/v1/user`, { method: "PUT", headers: headers(), body: JSON.stringify({ password }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(authErrorMessage(payload, "Orbit could not save that password."));
    state.passwordRecovery = false;
    await loadContext();
    toast("Password saved. You can now sign in with it.");
  } catch (error) { $("#password-reset-note").textContent = error.message; }
});

$("#organization-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = $("#organization-name").value.trim();
  const slug = $("#organization-slug").value.trim().toLowerCase();
  try {
    await rpc("create_organization_for_current_user", { organization_name: name, organization_slug: slug });
    await loadContext();
    toast("Organization created. You can now start a 360 trial.");
  } catch (error) { $("#setup-note").textContent = error.message; }
});

$("#organization-select").addEventListener("change", async (event) => {
  try {
    await rpc("set_active_organization", { target_organization_id: event.target.value });
    await loadContext();
  } catch (error) { toast(error.message); }
});

$("#start-trial").addEventListener("click", async () => {
  try {
    if (feedbackEntitlement()) {
      const response = await fetch("/api/feedback-access", { method: "POST", headers: headers() });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || "Orbit could not finish 360 setup.");
    } else {
      await rpc("start_feedback_trial_for_current_org");
    }
    await loadAndRender();
    toast(feedbackEntitlement() ? "360 administrator access is ready." : "Your 14-day 360 Feedback trial is active.");
  } catch (error) { $("#trial-note").textContent = error.message; }
});

$("#cycle-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await rest("feedback_cycles", "", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ organization_id: state.activeOrganization.id, name: $("#cycle-name").value.trim(), purpose: $("#cycle-purpose").value, description: $("#cycle-description").value.trim() || null, feedback_opens_at: isoFromInput($("#cycle-opens").value), feedback_closes_at: isoFromInput($("#cycle-closes").value), anonymous_group_threshold: Number($("#cycle-threshold").value), created_by: state.user.id }) });
    event.target.reset(); $("#cycle-note").textContent = "Cycle draft saved."; await loadAndRender();
  } catch (error) { $("#cycle-note").textContent = error.message; }
});

$("#question-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const cycleId = $("#question-cycle").value;
  try {
    const existing = await rest("feedback_cycle_questions", `cycle_id=eq.${cycleId}&select=sort_order&order=sort_order.desc&limit=1`);
    await rest("feedback_cycle_questions", "", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ organization_id: state.activeOrganization.id, cycle_id: cycleId, competency_label: $("#question-competency").value.trim() || null, question_type: $("#question-type").value, prompt: $("#question-prompt").value.trim(), scale_definition: { min: 1, max: 5, labels: { 1: "Rarely", 5: "Consistently" } }, sort_order: (existing[0]?.sort_order || 0) + 1 }) });
    const selectedCycle = cycleId;
    event.target.reset();
    $("#question-cycle").value = selectedCycle;
    $("#question-note").textContent = "Question added to the cycle.";
    await loadAndRender();
    $("#question-cycle").value = selectedCycle;
    renderQuestions();
  } catch (error) { $("#question-note").textContent = error.message; }
});

$("#question-cycle").addEventListener("change", renderQuestions);

$("#question-file").addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (!file) return;
  const cycleId = $("#question-cycle").value;
  if (!cycleId) { clearQuestionImport(); $("#question-import-note").textContent = "Choose the cycle you want to add questions to first."; return; }
  try {
    $("#question-file-name").textContent = "Reading your file…";
    const { questions, skipped } = normalizeQuestionRows(await readQuestionFile(file));
    if (!questions.length) throw new Error("We could not find valid question wording and question types in that file.");
    state.questionImportRows = questions;
    $("#question-file-name").textContent = `${file.name} · ${questions.length} questions ready`;
    $("#question-import-note").textContent = skipped.length ? `${skipped.length} row${skipped.length === 1 ? " was" : "s were"} skipped because its question or type was missing.` : "Review the preview below before importing.";
    renderQuestionImportPreview(skipped);
  } catch (error) {
    clearQuestionImport();
    $("#question-import-note").textContent = error.message;
  }
});

$("#clear-question-file").addEventListener("click", clearQuestionImport);

$("#import-questions").addEventListener("click", async () => {
  const cycleId = $("#question-cycle").value;
  if (!cycleId || !state.questionImportRows.length) return;
  const button = $("#import-questions");
  try {
    button.disabled = true;
    button.textContent = "Importing questions…";
    const existing = await rest("feedback_cycle_questions", `cycle_id=eq.${cycleId}&select=sort_order&order=sort_order.desc&limit=1`);
    const startingOrder = existing[0]?.sort_order || 0;
    const questions = state.questionImportRows.map((question, index) => ({
      organization_id: state.activeOrganization.id,
      cycle_id: cycleId,
      competency_label: question.competency_label,
      question_type: question.question_type,
      prompt: question.prompt,
      is_required: question.is_required,
      scale_definition: { min: 1, max: 5, labels: { 1: "Rarely", 5: "Consistently" } },
      sort_order: startingOrder + index + 1
    }));
    await rest("feedback_cycle_questions", "", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(questions) });
    clearQuestionImport();
    await loadAndRender();
    $("#question-cycle").value = cycleId;
    renderQuestions();
    $("#question-note").textContent = `${questions.length} questions added to this cycle.`;
  } catch (error) { $("#question-import-note").textContent = error.message; }
  finally { button.disabled = false; button.innerHTML = "Import questions <span>→</span>"; }
});

$("#audience-scope").addEventListener("change", (event) => {
  state.audienceScope = event.target.value;
  resetCurrentAudienceSelection();
  $("#audience-note").textContent = "";
  renderAudienceBuilder();
});

$("#audience-cycle").addEventListener("change", renderAudiencePreview);

$("#rater-cycle").addEventListener("change", renderRaterBuilder);
$("#invitation-cycle").addEventListener("change", renderInvitationDelivery);
$("#send-approved-invitations").addEventListener("click", sendApprovedInvitations);
$("#send-reminders").addEventListener("click", sendReminders);
$("#export-reports-csv").addEventListener("click", exportReportsCsv);
$("#save-scheduled-release").addEventListener("click", saveScheduledRelease);
$("#reports-cycle").addEventListener("change", loadProtectedReports);
$("#reports-subject").addEventListener("change", renderProtectedReports);
$("#release-protected-report").addEventListener("click", releaseProtectedReport);
$("#mark-comments-reviewed").addEventListener("click", markCommentsReviewed);
$("#add-action-goal").addEventListener("click", addActionGoal);
$("#save-action-plan").addEventListener("click", saveActionPlan);
$$('[data-perspective]').forEach((input) => input.addEventListener("change", () => {
  state.raterPerspectives = $$('[data-perspective]:checked').map((item) => item.dataset.perspective);
  if (!state.raterPerspectives.includes("cross_functional")) { state.raterDraftIds = []; state.raterDraftSources = []; resetCurrentRaterSelection(); }
  $("#rater-builder-note").textContent = "";
  renderRaterBuilder();
}));
$("#rater-scope").addEventListener("change", (event) => {
  state.raterScope = event.target.value;
  resetCurrentRaterSelection();
  renderRaterBuilder();
});
$("#open-rater-review").addEventListener("click", openRaterReview);
$("#close-rater-review").addEventListener("click", closeRaterReview);
$("#back-to-rater-builder").addEventListener("click", closeRaterReview);
$("#rater-review-modal").addEventListener("click", (event) => { if (event.target === $("#rater-review-modal")) closeRaterReview(); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !$("#rater-review-modal").classList.contains("hidden")) closeRaterReview(); });

$("#confirm-rater-plan").addEventListener("click", async () => {
  const plan = plannedRaterAssignments();
  if (!plan.newAssignments.length) return;
  const button = $("#confirm-rater-plan");
  try {
    button.disabled = true;
    button.textContent = "Saving rater plan…";
    const rows = plan.newAssignments.map(({ subject, reviewer, external, group }) => ({
      organization_id: state.activeOrganization.id,
      cycle_id: subject.cycle_id,
      subject_roster_id: subject.id,
      reviewer_person_id: reviewer?.id || null,
      external_contact_id: external?.id || null,
      rater_group: group,
      status: "pending",
      nominated_by: state.user.id
    }));
    await rest("feedback_cycle_roster_raters", "", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(rows) });
    const cycleId = $("#rater-cycle").value;
    state.raterDraftIds = [];
    state.raterDraftSources = [];
    closeRaterReview();
    await loadAndRender();
    $("#rater-cycle").value = cycleId;
    renderRaterBuilder();
    $("#rater-builder-note").textContent = `${rows.length} rater assignments have been added for approval. No invitations have been sent.`;
  } catch (error) { $("#rater-review-note").textContent = error.message; }
  finally { button.disabled = false; button.innerHTML = "Save rater plan <span>→</span>"; }
});

$("#external-contact-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.externalAvailable) { $("#external-contact-note").textContent = "External contacts are not connected yet. Run the supplied Orbit 360 database update first."; return; }
  const subjectRosterId = $("#external-subject").value;
  if (!subjectRosterId) { $("#external-contact-note").textContent = "Choose the feedback subject this customer knows."; return; }
  try {
    const cycleId = $("#rater-cycle").value;
    await rest("feedback_external_contacts", "", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ organization_id: state.activeOrganization.id, cycle_id: $("#rater-cycle").value, subject_roster_id: subjectRosterId, full_name: $("#external-name").value.trim(), email: $("#external-email").value.trim(), company_name: $("#external-company").value.trim() || null, relationship_label: $("#external-relationship").value.trim() || null, created_by: state.user.id }) });
    $("#external-contact-form").reset();
    await loadAndRender();
    $("#rater-cycle").value = cycleId;
    renderRaterBuilder();
    $("#external-contact-note").textContent = "External contact added. It will be included in the final review.";
  } catch (error) { $("#external-contact-note").textContent = error.message; }
});

$("#external-file").addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (!file) return;
  try {
    if (!window.XLSX) throw new Error("The spreadsheet reader is still loading. Choose the file again in a moment.");
    const workbook = window.XLSX.read(await file.arrayBuffer(), { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const { rows, skipped } = normalizeExternalRows(window.XLSX.utils.sheet_to_json(sheet, { defval: "" }));
    state.externalImportRows = rows;
    $("#import-external-contacts").disabled = !rows.length;
    $("#external-import-note").textContent = rows.length ? `${rows.length} contacts ready${skipped.length ? ` · ${skipped.length} skipped` : ""}.` : "No valid contacts found. Include Feedback Subject Email, Full Name and Email.";
  } catch (error) { state.externalImportRows = []; $("#import-external-contacts").disabled = true; $("#external-import-note").textContent = error.message; }
});

$("#import-external-contacts").addEventListener("click", async () => {
  if (!state.externalAvailable || !state.externalImportRows.length) return;
  const cycleId = $("#rater-cycle").value;
  const subjectsByEmail = new Map(raterCycleSubjects().map((subject) => [String(directoryPerson(subject.subject_person_id)?.work_email || "").toLowerCase(), subject]));
  const rows = state.externalImportRows.map((contact) => ({ ...contact, subject: subjectsByEmail.get(contact.subjectEmail) })).filter((contact) => contact.subject);
  if (!rows.length) { $("#external-import-note").textContent = "None of the subject emails match feedback subjects in this cycle."; return; }
  try {
    await rest("feedback_external_contacts", "", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(rows.map((contact) => ({ organization_id: state.activeOrganization.id, cycle_id: cycleId, subject_roster_id: contact.subject.id, full_name: contact.fullName, email: contact.email, company_name: contact.companyName || null, relationship_label: contact.relationshipLabel || null, created_by: state.user.id }))) });
    state.externalImportRows = []; $("#external-file").value = ""; $("#import-external-contacts").disabled = true;
    await loadAndRender(); $("#rater-cycle").value = cycleId; renderRaterBuilder();
    $("#external-import-note").textContent = `${rows.length} external contacts added.`;
  } catch (error) { $("#external-import-note").textContent = error.message; }
});

$("#add-audience").addEventListener("click", async () => {
  const cycleId = $("#audience-cycle").value;
  const selected = stagedAudiencePeople();
  if (!cycleId || !selected.length) return;
  const existing = new Set(state.rosterSubjects.filter((subject) => subject.cycle_id === cycleId).map((subject) => subject.subject_person_id));
  const newPeople = selected.filter((person) => !existing.has(person.id));
  if (!newPeople.length) { $("#audience-note").textContent = "Everyone in this selection is already part of the cycle."; return; }
  const peopleByEmail = new Map(state.directoryPeople.map((person) => [String(person.work_email).toLowerCase(), person]));
  const selectionSource = { method: "combined_audience_builder", sources: state.audienceDraftSources, selected_at: new Date().toISOString() };
  const button = $("#add-audience");
  try {
    button.disabled = true;
    button.textContent = "Adding people…";
    const rows = newPeople.map((person) => ({
      organization_id: state.activeOrganization.id,
      cycle_id: cycleId,
      subject_person_id: person.id,
      manager_person_id: peopleByEmail.get(String(person.manager_email || "").toLowerCase())?.id || null,
      status: "nominating",
      created_by: state.user.id,
      selection_source: selectionSource
    }));
    await rest("feedback_cycle_roster_subjects", "", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(rows) });
    await loadAndRender();
    state.audienceDraftIds = [];
    state.audienceDraftSources = [];
    renderAudienceBuilder();
    $("#audience-cycle").value = cycleId;
    renderAudiencePreview();
    $("#audience-note").textContent = `${rows.length} people have been added to this cycle.`;
  } catch (error) { $("#audience-note").textContent = error.message; }
  finally { button.disabled = false; }
});

$("#participant-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    if (!state.rosterAvailable) throw new Error("The people-to-cycle connection is being prepared. Refresh once it is ready.");
    await rest("feedback_cycle_roster_subjects", "", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ organization_id: state.activeOrganization.id, cycle_id: $("#participant-cycle").value, subject_person_id: $("#participant-subject").value, manager_person_id: $("#participant-manager").value || null, status: "nominating", created_by: state.user.id }) });
    $("#participant-note").textContent = "Feedback subject added."; await loadAndRender();
  } catch (error) { $("#participant-note").textContent = error.message; }
});

$("#nomination-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const participant = state.rosterSubjects.find((item) => item.id === $("#nomination-participant").value);
  if (!participant) { $("#nomination-note").textContent = "Choose a feedback subject first."; return; }
  try {
    if (!state.rosterAvailable) throw new Error("The people-to-cycle connection is being prepared. Refresh once it is ready.");
    await rest("feedback_cycle_roster_raters", "", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ organization_id: state.activeOrganization.id, cycle_id: participant.cycle_id, subject_roster_id: participant.id, reviewer_person_id: $("#nomination-reviewer").value, rater_group: $("#nomination-group").value, nominated_by: state.user.id }) });
    $("#nomination-note").textContent = "Rater nomination saved for approval."; await loadAndRender();
  } catch (error) { $("#nomination-note").textContent = error.message; }
});

$("#directory-file").addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (!file) return;
  try {
    $("#directory-file-name").textContent = "Reading your file…";
    const { people, skipped } = normalizeDirectoryRows(await readDirectoryFile(file));
    if (!people.length) throw new Error("We could not find valid names and work email addresses in that file.");
    state.importRows = people;
    $("#directory-file-name").textContent = `${file.name} · ${people.length} people ready`;
    $("#directory-import-note").textContent = skipped.length ? `${skipped.length} row${skipped.length === 1 ? " was" : "s were"} skipped because a name or work email was missing.` : "Review the first few people below before importing.";
    renderDirectoryPreview(skipped);
  } catch (error) {
    clearDirectoryImport();
    $("#directory-import-note").textContent = error.message;
  }
});

$("#clear-directory-file").addEventListener("click", clearDirectoryImport);

$("#directory-person-to-edit").addEventListener("change", (event) => {
  const person = directoryPerson(event.target.value);
  $("#directory-email-to-edit").value = person?.work_email || "";
  $("#directory-correction-note").textContent = person ? "Review the address carefully before saving. No invitation will be sent." : "Use this only to correct a private directory record. It does not send an invitation.";
});

$("#save-directory-email").addEventListener("click", async () => {
  const personId = $("#directory-person-to-edit").value;
  const workEmail = $("#directory-email-to-edit").value.trim().toLowerCase();
  const note = $("#directory-correction-note");
  if (!personId) { note.textContent = "Select the person whose email you want to correct."; return; }
  if (!/^\S+@\S+\.\S+$/.test(workEmail)) { note.textContent = "Enter a valid work email address."; return; }
  const button = $("#save-directory-email");
  try {
    button.disabled = true;
    button.textContent = "Saving…";
    await rest("organization_people", `id=eq.${personId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ work_email: workEmail }) });
    await loadAndRender();
    $("#directory-person-to-edit").value = personId;
    $("#directory-email-to-edit").value = workEmail;
    note.textContent = "Email corrected privately. No invitation has been sent.";
  } catch (error) { note.textContent = error.message; }
  finally { button.disabled = false; button.textContent = "Save email correction"; }
});

$("#import-directory").addEventListener("click", async () => {
  if (!state.importRows.length) return;
  if (!state.directoryAvailable) { $("#directory-import-note").textContent = "The workforce directory is being connected to this workspace. Please try again once setup is complete."; return; }
  const button = $("#import-directory");
  try {
    button.disabled = true;
    button.textContent = "Importing people…";
    const rows = state.importRows.map((person) => ({ ...person, organization_id: state.activeOrganization.id, imported_by: state.user.id, source: "spreadsheet_import" }));
    await rest("organization_people", "on_conflict=organization_id,normalized_email", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows) });
    clearDirectoryImport();
    await loadAndRender();
    toast(`${rows.length} people are now in your private workspace directory.`);
  } catch (error) { $("#directory-import-note").textContent = error.message; }
  finally { button.disabled = false; button.innerHTML = "Import people <span>→</span>"; }
});

$$('.nav-item').forEach((button) => button.addEventListener("click", () => {
  $$('.nav-item').forEach((item) => item.classList.toggle("active", item === button));
  $$('[data-panel]').forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === button.dataset.view));
}));
$$('[data-jump]').forEach((button) => button.addEventListener("click", () => {
  $(`.nav-item[data-view="${button.dataset.jump}"]`).click();
  if (button.dataset.focus) {
    window.setTimeout(() => document.getElementById(button.dataset.focus)?.focus(), 0);
  }
}));

$("#set-password").addEventListener("click", () => {
  $("#password-reset-note").textContent = "Choose a password you will use for future Orbit sign-ins.";
  $("#new-password").value = "";
  $("#confirm-password").value = "";
  setScreen("reset");
});

$("#sign-out").addEventListener("click", async () => {
  try { await fetch(`${config.url}/auth/v1/logout`, { method: "POST", headers: headers() }); } catch (_) { /* Local session removal still protects this browser. */ }
  localStorage.removeItem(sessionStorageKey);
  location.href = "orbit-console.html";
});

(async function initialize() {
  try {
    if (passwordSetupConfirmation()) {
      const isRecovery = state.passwordSetupType === "recovery";
      $("#confirmation-title").textContent = isRecovery ? "Set up your Orbit password." : "Confirm your Orbit workspace.";
      $("#confirmation-copy").textContent = isRecovery ? "You are about to securely create a password for your people workspace." : "You are about to securely confirm your email and finish creating your company workspace.";
      $("#continue-password-setup").innerHTML = isRecovery ? "Continue securely <span>→</span>" : "Confirm workspace <span>→</span>";
      setScreen("confirm");
      return;
    }
    const linkProblem = emailLinkProblem();
    if (linkProblem) { setScreen("auth"); $("#auth-note").textContent = linkProblem; return; }
    const signedInFromLink = await authenticateFromLink();
    if (signedInFromLink && state.passwordRecovery) { setScreen("reset"); return; }
    if (!signedInFromLink && !(await restoreSession())) { setScreen("auth"); return; }
    await loadContext();
  } catch (error) {
    console.error(error);
    localStorage.removeItem(sessionStorageKey);
    setScreen("auth");
    $("#auth-note").textContent = error.message;
  }
})();
