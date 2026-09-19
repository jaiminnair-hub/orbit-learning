# 360 Degree Feedback — Product Status

Last updated: 28 August 2026 — Foundation-connected build

## Role in Orbit

360 Degree Feedback is Orbit’s first active product. It is a protected HR-admin workspace for designing feedback cycles, managing people and reviewers, gathering responses, analysing results, and turning insight into actions.

## Current experience

- Public Orbit entry: `https://your-360-app.vercel.app/orbit-360/`; this is
  the sole public product chooser and shows only live products.
- Public 360 explanation: `/orbit-360/360`; protected admin sign-in:
  `/orbit-360/sign-in`.
- Product access begins from a labelled `Sign in to 360` action. The public
  landing never requires authentication or masquerades as a workspace.
- 360 administrator navigation is deliberately limited to Home, Cycles,
  People, Questions & reviewers, and Reports. Private reviewers use an
  invitation-only route without administrator navigation.
- The current Foundation-connected console uses the Orbit organization,
  entitlement, product-role, and active-organization model.
- A successful sign-in without an active 360 organization membership now shows
  a dedicated access-resolution screen. It does not silently look like a
  workspace or create an organization; users can use their invitation, choose
  the correct work account, or deliberately start a new organization.
- An owner or organization administrator with an already-enabled 360 trial can
  now finish the missing Feedback-administrator grant from the console. The
  server verifies the signed-in user, membership, active organization and
  entitlement before writing the role and audit record; ordinary employees
  cannot self-grant access.

## Built in the prototype

- Task-first 360 landing: launch a cycle, design questions, manage people, and review insights.
- Dashboard and workspace navigation, now aligned with the Orbit suite pattern: explicit organisation context, product switcher, role-preview context, and a simplified sidebar of Overview, Cycles, People, Question library, Reports, Action plans, and Settings. The Learning link is a product entry, not cross-product SSO.
- Cycle creation, status display, nominations, approvals, and local launch behavior.
- Manual question library, question editing, and survey preview.
- People and reviewer directory with local role presentation.
- Reporting UI with spider/radar visualisation, competency scores, rater-group comparison, written themes, and development actions.
- Action-plan goals with local progress behaviour.
- Organisation and profile schema in Supabase migrations.

## Built in the Foundation-connected 360 console

### Cycle and questions

- Cycle creation and purpose framing.
- Admin-authored rating and open-text questions.
- Downloadable Excel/CSV question template, client-side preview, and durable
  question import into a chosen cycle.

### People and subjects

- Private 200-person demo directory imported into **Orbit Sample Company**.
- The directory is separate from user accounts: no employee is invited merely
  because they are imported.
- Cumulative subject-group builder: individual people, departments,
  designations, department + designation, and entire organization.
- Multiple subject selections are combined, de-duplicated, previewed, and then
  saved as the cycle roster. A manual one-person exception remains available.

### Multi-perspective rater planning

- Optional perspectives: self, manager, skip-level manager, direct reports,
  same-team colleagues, peers, cross-functional partners, and external
  customers.
- Manager and skip-level relationships use the imported reporting hierarchy.
- Direct reports, same-team colleagues, and peers are calculated per subject;
  duplicate people are retained only in their highest-priority perspective.
- Cross-functional partners use the same cumulative person/department/
  designation selection pattern as subject selection.
- External customers can be entered one at a time or imported in Excel/CSV,
  each linked to the feedback subject they know.
- Final review modal shows both sides of the plan—who is assessed and who gives
  feedback—plus request counts, missing reporting data, duplicates removed,
  and anonymity-threshold warnings.

### Data migrations completed on Orbit Platform Foundation

- `20260821100200_organization_people_directory.sql`
- `20260821100300_feedback_directory_roster.sql`
- `20260821100400_feedback_audience_builder.sql`
- `20260821100500_feedback_multi_perspective_and_external_contacts.sql`

All four were confirmed successfully applied on 21 August 2026.

### Secure review workflow — implemented, activation pending

- Server endpoints issue 256-bit, single-purpose reviewer tokens and persist
  only their SHA-256 hashes. The raw token is held in the email link fragment,
  never in a database record, URL path, or browser administration view.
- Live-cycle invitation delivery is limited to an authenticated
  `feedback_admin`, approved roster assignments, and the current organisation.
  The server records non-sensitive delivery state and an audit event; it never
  returns recipient addresses, provider detail, or tokens to the console.
- The private reviewer page supports rating/open-text answers, save-and-resume,
  required-question validation, submission confirmation, and freezes a
  completed response. Clearing a saved answer removes it from the private
  response store rather than leaving stale content behind.
- Protected report calculation uses completed responses only. Anonymous rater
  groups are withheld until the cycle threshold is reached; under-threshold
  groups return neither scores nor response counts that could identify a voice.
- The admin browser receives a narrow delivery-status view only; recipient
  addresses and token hashes stay in the server-only delivery table.
- **Synthetic QA automation is verified:** the `Orbit 360 QA` GitHub workflow
  starts a disposable local Foundation stack, creates a synthetic admin,
  reviewer cycle and in-memory mail sink, and verifies admin authorization,
  private-link delivery, response clearing/freezing, and anonymous-group
  suppression. The verified run is `33194958797`; it does not send real email
  or exercise the production Foundation database.
- Migration `20260828000100_feedback_delivery_confidentiality_hardening.sql`
  prevents more than one active private link per rater task and protects
  submitted responses from later changes.

This capability is **not live for customer cycles yet**, but it has now been
smoke-tested with real evidence. **2026-08-29:** all three invitation/
response/confidentiality migrations are confirmed applied on the live
Foundation database, and an isolated test reviewer completed the full
controlled smoke test — real email delivery, real submission, correct
post-submission lock, and correct anonymous-group suppression in the
protected report, all against a disposable synthetic organization, never a
customer org. A real directory-import bug was found and fixed in the same
pass (`790fef4`). Both feature flags remain `false` in production; this was
a verification run, not an activation. Full account: `docs/CURRENT_STATUS.md`
in the LMS repo.

### Still pending before a real customer cycle

- Configure a real production sender domain — invitations currently send from
  a temporary placeholder address (`feedback@example.com`, an unrelated
  product's domain) by the product owner's deliberate choice, pending a
  dedicated domain purchase.
- Complete a formal go/no-go review before enabling the two feature flags for
  real customer use.
- Reminders, bounce/webhook handling, reviewer replacement/withdrawal, and a
  deliberate audited re-open flow.
- Report export, comment safety review, scheduled release, and durable action
  plans.
- Full automated and human security, accessibility, privacy and UAT testing.

## Planned premium reports

- Individual summary and competency spider report.
- Self-versus-others blind-spot analysis.
- Rater-group comparison and score distribution.
- Comment themes and sentiment analysis.
- Completion health, anonymity-threshold monitor, and response confidence.
- Team capability heatmap, manager portfolio, historical trends, and benchmark reporting.
- Action-plan progress and executive insight views.

## Premium 360 program build plan

This plan incorporates the missing capabilities identified against the
360-degree best-practice review. The current workspace is a prototype; the
items below are the work required before Orbit can run a real confidential
customer cycle.

### Release 1 — secure product foundation

1. Connect Feedback to the shared Orbit login, active-organization context,
   product entitlement, and explicit Feedback roles.
2. Create real Feedback tables for cycles, templates, competency dimensions,
   questions, scale definitions, participants, rater relationships, responses,
   report releases, action plans, and audit events.
3. Add product and resource-level RLS: a user must have Feedback access and
   separately be authorized for the specific cycle, report, or assignment.
4. Replace local prototype state with durable server-side workflow state,
   reliable loading/error/empty states, and end-to-end tests.

### Release 2 — program design and administration

1. Cycle purpose: require the administrator to choose development-only,
   appraisal, or hybrid use, with purpose-specific wording and safeguards.
2. Configurable competency frameworks, including an initial leadership
   library; later connect this to Orbit Competency Management as the canonical
   source of competencies.
3. Versioned question templates with manual/admin-authored questions,
   competency mapping, rating items, open-text prompts, required/optional
   settings, branching, and preview.
4. Configurable rating scales for developmental feedback and formal appraisal;
   preserve scale labels and scoring rules with each launched cycle.
5. Admin workflow for draft, review, approval, scheduled, live, closed,
   report-ready, and archived states.
6. Stakeholder setup: cycle sponsor, HR owner, managers, coaches, and
   escalation contacts.

### Release 3 — people, raters, and communication

1. People directory, CSV import/export, manager/direct-report hierarchy, and
   optional HRIS integration boundary.
2. Subject selection and rater nomination: self, manager, direct reports,
   peers, cross-functional partners, and external reviewers.
3. Development-mode self-nomination, manager/admin approval, rater caps,
   duplicate prevention, replacement, and withdrawal workflows.
4. Branded email templates for invitations, reminders, overdue notices,
   report release, and action-plan follow-up; all copy is editable per cycle.
5. Configurable reminder schedule, time-zone aware deadlines, delivery status,
   bounce handling, and administrator escalation.
6. Program messaging page explaining purpose, how feedback is used, timing,
   confidentiality, support contacts, and how success will be measured.

### Release 4 — reviewer experience and confidentiality

1. Secure authenticated or token-based reviewer access, save-and-resume,
   progress indication, mobile usability, validation, and accessible keyboard
   operation.
2. Rating and open-text response capture, optional private notes, reviewer
   declarations, and a clear submit/confirmation flow.
3. Anonymous rater-group rules: configurable minimum threshold, suppression
   of under-threshold results, pooled group display, and prevention of
   personally identifying report combinations.
4. Confidentiality notices shown at nomination, invitation, survey, and
   report-release points; policy acknowledgement where required.
5. Response freezing after submission, permitted re-open flow, late-response
   handling, and audit history of every administrative change.

### Release 5 — reports, insight, and release control

1. Report calculation from real response data, with clear scoring rules,
   confidence/response-rate indicators, and visible anonymity suppression.
2. Individual summary, competency spider/radar, self-versus-others blind-spot
   view, rater-group comparison, score distribution, strengths, and priority
   development areas.
3. Open-comment experience: grouped comments, themes, sentiment only when
   sufficiently safe and explainable, and safeguards against exposing a rater.
4. Team capability heatmap, manager portfolio, department comparison,
   historical trend, benchmark, completion-health, and executive insight
   reports.
5. Report release controls: manual or scheduled release, manager-before-subject
   choice, coach access, redaction/suppression, and a complete release audit.
6. Accessible in-app report, PDF export, CSV export for authorized admins, and
   printable development plan.

### Release 6 — action, learning, and program measurement

1. Require one or two focused behavioral-development goals per subject;
   associate each goal with evidence, owner, due date, milestones, and status.
2. Check-ins, manager/coach comments, coaching assignments, nudges, and
   development-plan progress.
3. Learning recommendations from LMS only after an explicit user/organization
   permission model and competency mapping are available.
4. Program success dashboard: participation, completion, response rates,
   time-to-complete, report-release progress, action-plan adoption, and
   post-cycle effectiveness measures.
5. Optional follow-up/pulse check to measure behavior change without treating
   a 360 cycle as a one-time event.

### Release 7 — enterprise readiness

1. Configurable data retention, archival, deletion, legal hold, and export
   policies.
2. Full audit trail, admin support tooling, security review, rate limiting,
   monitoring, and incident-ready logs.
3. SSO/SCIM, HRIS integrations, custom branding, localization, API access,
   advanced approvals, and enterprise support controls.
4. Accessibility validation, performance testing, privacy/security testing,
   penetration-test remediation, and customer acceptance testing.

## Delivery order

Build Releases 1–4 before advanced report visualizations. A spider chart is
valuable only after the underlying rater assignment, confidentiality, response,
and scoring logic is trustworthy. Releases 5–7 follow in that order.

## Source used for this addition

The plan was expanded using the themes in the 360 best-practice document the
team reviewed: stakeholder alignment, clear purpose, competency-based content,
communication, confidentiality, follow-up, focused goals, and program success
measurement. See [Best Practices for 360-Degree Feedback](https://www.scribd.com/document/458062204/360-Best-Practices-pdf).
