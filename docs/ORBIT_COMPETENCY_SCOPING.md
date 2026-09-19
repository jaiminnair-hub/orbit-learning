# Orbit Competencies — Product Scoping Document

Status: **decisions 1, 2, 4 and 5 approved by the user on 2026-08-30 (see §12). Decision 3 recorded
with a deferred sub-item.** Per `docs/ORBIT_PLATFORM_BUILD_STATUS.md` §13 (P2), Competencies was
roadmap-only until "real product scopes, data models, roles and safety rules are approved" — this
document is that approval artifact, and it now carries real sign-off.

**2026-09-16 — §5 (real schema/migrations) is implemented, code+security reviewed, migrated to
production, and live**, not just scoped: `orbit-foundation/supabase/migrations/20260916125643_p1_competency_development.sql`
(versioned/immutable-once-published frameworks, rating-to-level thresholds, anonymity-gated signal
computation reviewed line by line, consent and data-rights handling) plus the Learning-side service
layer, API routes and `/skills/development` UI. The migration is applied to the real production
Foundation Supabase project (`YOUR_PROJECT_REF`) and confirmed present directly (function + all 6
tables read back after applying), and a real production smoke test of `/skills/development` passed.
Full account in `docs/CURRENT_STATUS.md`. The purpose/lawful-basis statement this design
implies is written out in full, and verified against the actual code, in
`docs/COMPETENCY_PRIVACY_NOTICE.md`. §8
(starter-library content pass) remains a single O*NET Active Listening reference example pending a
broader pass.

Research basis: competency-framework definition/benchmark research (2026-08-30) and an 11-vendor
software comparison (`competency_software_comparison.xlsx`, delivered the same session, not checked
into this repo). Findings are summarized inline where they drove a decision; see that spreadsheet
for the full vendor-by-vendor detail.

---

## 1. What this product is

A shared competency taxonomy — definitions, proficiency levels, role mappings — that Orbit Learning
and Orbit 360 Feedback both read from and write to, so a skills gap surfaced by a 360 cycle can point
directly at the learning content that closes it, and a completed learning path can be reflected back
into the next assessment. Nobody in the vendor comparison ships this loop natively; it's the reason to
build this ourselves rather than buy or embed a third party.

Everything else in this document exists to make that loop real, safe, and shippable — not to build a
general-purpose HR suite.

## 2. Non-goals for v1

Explicitly out of scope, regardless of how the roadmap teaser on the public landing page reads:

- **Orbit Growth, goals & check-ins, performance reviews** — separate, later-roadmap products. Not
  touched by this scope.
- **Succession planning / talent marketplace** (the Fuel50-style "internal mobility" feature set) —
  a plausible v2, not v1. It requires org-chart and career-path data we don't have modeled yet.
- **A general skills-inference or resume-parsing engine** — v1 assumes competencies are assigned by
  an admin/manager, not inferred from unstructured employee data.
- **Compensation or pay-banding ties to competency level** — deliberately out; this is a legal and
  trust minefield (pay-equity implications) that shouldn't ride in on a v1 scope. Not something the
  user has asked for — recorded explicitly precisely so it can't drift in later without a real
  conversation.
- **A licensed third-party taxonomy** (Korn Ferry, SHL) — see §8, we're seeding from public data.

**v1 confirmed with the user, in plain terms (2026-08-30):** assess a person against the competency
library, identify the gap between their current level and what the role needs, and point HR/the
manager at what closes it — specifically, a learning path in Orbit Learning. No pay, no promotion
decisions, no succession planning, no career-ladder automation. Just gap → what closes it.

## 3. Product principles → concrete consequences

Each principle from the brief translates to a specific build decision, not just a value statement.

| Principle | What it actually means for the build |
|---|---|
| **Very user-friendly UI/UX** | Reuse the proven Quick Create shape: single guided flow, wizard steps, (i) explainers, not a blank admin table. Visual proficiency picker (spider/matrix view), not raw text grids. |
| **Industry-agnostic** | The *core competency layer* must be industry-neutral by construction (behavioral factors like "communication," "decision-making" — not "machine calibration"). Industry-specific content ships as optional, swappable packs layered on top, never hard-coded into the base schema. |
| **AI wherever possible** | Reuse the existing AICredits + JSON-schema-in-prompt pattern already proven in Quick Create's AI question drafting and AI Course Builder Lite — not a new AI subsystem. Every AI output is a draft; a human approves before it's live. No exceptions, matching the no-auto-publish rule already established for AI Course Builder. |
| **Compliant with Indian law (DPDP Act, 2023)** | Not a policy-page afterthought — three concrete features required in v1 (see §9): purpose-specific consent capture, employee self-service access/correction/delete, and a defined retention/purge policy. |
| **Scalable competency library** | Competencies are versioned, shared library objects with an org-level override layer — never a flat per-customer copy. Starter content ships pre-populated (see §8), because "start from a blank canvas" is the adoption blocker every vendor in the comparison sheet solves for. |

## 4. Where this lives — the architecture decision

This is the one open question that most affects everything else, so it's surfaced first, not buried
in a data-model appendix.

**Current reality** (`ORBIT_PLATFORM_BUILD_STATUS.md` §7, verified, not assumed): Orbit Learning and
Orbit 360 are **two separate Supabase projects** with no data merge — only a short-lived HMAC-signed
entry-token bridge that authenticates a user from Orbit/360 into Learning. There is no shared table
either product can query directly today.

That means the pitch line used earlier in this project — "native, no integration required" — needs a
correction: it's **native to Foundation's proven bridge pattern**, not literally one shared database.
Still a real differentiator against every vendor in the comparison (none of them have even a bridge),
but the scoping has to be honest about what "integrated" costs to build.

**Recommendation: build Competencies on Orbit Foundation**, alongside 360, for three reasons:
1. Foundation already *is* "the shared identity, membership, entitlement and product-role authority
   for the Orbit side of the suite" (§7.1, verbatim) — it's designed to be the hub other products plug
   into, and 360 already proves the pattern works in production.
2. The 360 → Learning hand-off (`mint-lms-entry-token`) is a proven, already-shipped mechanism.
   Reaching from Foundation into Learning to surface a course recommendation reuses that exact
   direction of bridge, rather than inventing a new one.
3. Assessment (360) and the competency library it assesses against belong in the same trust boundary
   — keeping them on separate infra would mean every 360 cycle needs a live cross-project call just to
   render a question against a competency definition.

**Consequence for Learning-side integration**: a competency gap → learning path recommendation is a
one-way read (Foundation asks Learning "what course maps to competency X" or vice versa), not a full
data merge. That interface needs to be designed explicitly — likely a small, purpose-built API on the
Learning side, mirroring how `mint-lms-entry-token` is a small, purpose-built API on the Foundation
side — not a shared table.

This is the first thing that needs sign-off before any schema work starts.

## 5. Core data model (conceptual — not DDL)

Named entities, at the level needed to agree on shape before anyone writes migrations:

- **`competency_library`** — a versioned collection (e.g. "Orbit Starter Library v1," or an org's own
  fork of it). Supports the override-layer requirement from §3.
- **`competencies`** — id, name, definition, category (`core` / `functional` / `leadership`),
  library_id, source (`starter` / `org_custom`).
- **`proficiency_levels`** — per competency, 3–5 levels, each with a behavioral description (not just
  a number).
- **`role_competency_maps`** — which competencies, at which levels, a given role requires. This is
  what a starter library pre-populates (§8).
- **`org_competency_overrides`** — an organisation's edits/additions layered on top of the starter
  library, never mutating the shared starter content directly (this is the "10–20% customization"
  pattern from the vendor research, made structural).
- **`competency_assessments`** — links to the *existing* 360 schema (`feedback_cycles`,
  `feedback_cycle_questions`) rather than duplicating it; a 360 question can reference a
  `competency_id` + `proficiency_level` instead of standing alone.
- **`competency_learning_links`** — maps a competency (and optionally a specific gap/level) to a
  Learning-side course or path identifier, via the Learning-side API from §4.

This section needs a real data-modeling pass with actual column types, RLS policy design (matching
the three-check model in §7.1 of the platform doc: membership → entitlement → product role), and
migration ordering — that's implementation work, not scoping, and comes after §4 is decided.

## 6. Roles & authorization

Follows the existing Foundation pattern exactly (`can_access_product(product_key, required_role_key,
organization_id)`), rather than inventing a new authorization model:

- New `product_key`: `"competencies"`.
- New product roles, mirroring the existing `feedback_admin` pattern: `competency_admin` (defines and
  edits the library, maps roles), and a read-only role for managers viewing their team's gaps.
- Entitlement gating identical to how 360 and Learning are gated today — an org must have an active
  entitlement for Competencies specifically; it is not bundled automatically into 360 or Learning
  entitlements.

## 7. AI touchpoints

All reuse the AICredits adapter pattern (OpenAI-compatible `/v1/chat/completions`, JSON schema
embedded in the system prompt) already live in this repo — not a new provider integration:

1. **Draft a starter role-competency map from a job title/description** — same shape as Quick Create's
   AI question drafting: AI proposes, admin edits/approves.
2. **Suggest a learning-path match for a surfaced gap** — reads the `competency_learning_links` table
   (§5) plus AI ranking, not an AI free-generation of course content.
3. **Summarize qualitative 360 comments into a competency-level insight** — extends work already done
   in the reports workspace, scoped to insight generation, not scoring.

Every one of these is a **draft requiring human approval before anything is saved as live data** —
the same rule already enforced for AI Course Builder Lite. This is a hard constraint, not a phase-2
nice-to-have.

## 8. Starter competency library — sourcing plan

The comparison research was clear: every credible vendor ships pre-populated content (HRSG's whole
model is "3,000+ pre-written competencies") because asking a customer to author a framework from zero
is the biggest adoption blocker in this category.

Recommendation: seed the starter library from **public, freely-licensable taxonomies** —
O\*NET (US Dept of Labor) and/or ESCO (EU) — rather than licensing a proprietary model (Korn Ferry,
SHL), consistent with the industry pattern of "start from a public baseline, customize the last
10–20%." This needs a real content pass (mapping public occupational data into our
`core`/`functional`/`leadership` category structure) before it's usable — a content workstream, not
just a schema decision, and should be scoped with its own timeline once §4 is settled.

## 9. Indian law (DPDP Act, 2023) — required v1 features, not policy text

Verified against current sources (2026-08-30), not assumed from general knowledge:

- **Purpose-specific consent capture** for competency assessment data, distinct from any general
  platform ToS — a dedicated consent flow, not an inherited checkbox.
- **Self-service data rights** for the employee whose competency data this is: view, correct, and
  request deletion — a real UI, not a support-ticket process. The Act does not exempt HR/performance
  data from these rights.
- **Retention/purge policy**: data must be deleted once its purpose is served — needs an explicit
  retention rule per data type (e.g. "assessment responses purged N months after a cycle closes,
  unless retained for an active development plan").
- **Cross-border disclosure — resolved (2026-08-30):** production hosting target is India. The
  region-verification and consent-copy work is explicitly deferred until closer to public launch,
  since no real employee data is in the system during build/pilot. Revisit before any real customer
  data is accepted.
- **Purpose-specific consent, self-service data rights, and retention/purge are NOT deferred** —
  those apply the moment real employee data enters the system, regardless of hosting region or launch
  timing, and stay a P1 requirement per §11.
- **Timeline**: Phase 2 deadline November 2026, full compliance May 2027. If this product ships in
  that window, these are v1 requirements, not a post-launch cleanup pass.

## 10. UI/UX principles

- Reuse the Sanskrit design system already live across Learning and 360 (Inter typography, indigo/
  energy palette) — no new visual language for this product.
- Default entry path is "start from the pre-populated library and customize," not "build from
  scratch" — the blank-canvas path should exist but never be the first thing an admin sees.
- Visual proficiency representation (matrix or radar view) as a first-class view, not an
  afterthought bolted onto a settings page.

## 11. Phased delivery plan (draft — for discussion, not final)

**P0 — prove the model, no live customer data**
- Finalize §4 (where it lives) and §5 (real schema) with actual migrations.
- Build the starter library content pass for a small pilot set of role families.
- Wire `competency_assessments` into one real 360 cycle end-to-end with synthetic data, same
  discipline as the 360 secure-cycle smoke test already run this session.

**P1 — the actual differentiator**
- Ship `competency_learning_links` and the gap → course recommendation flow.
- Ship the AI drafting touchpoints from §7, human-approval-gated.
- DPDP consent/rights/retention features from §9 — concurrent with P1, not after it.

**Learning-side status (2026-09-16):** the first safe prerequisite is shipped in the LMS: published authored-course `skillTagIds` and assigned assessment `skill_code` now resolve into a private learner `/skills` evidence view with mapped next-course options, plus an admin vocabulary surface and an `external_ref` seam for the future canonical taxonomy. This is deliberately not marked as the cross-product P1 above: Foundation still needs the versioned competency model, authorised gap record, `competency_learning_links` bridge and DPDP controls before Orbit can present a 360 gap as a personalised recommendation.

**P2 — broaden**
- Additional industry packs layered on the core taxonomy.
- Manager-facing team-gap dashboards.
- Succession/internal-mobility features, only after P1 is proven with a real customer.

## 12. Open decisions — sign-off record (2026-08-30)

1. **§4 (where it lives) — APPROVED.** Build on Orbit Foundation, per the recommendation.
2. **§8 (starter-content source) — APPROVED.** Seed from O\*NET/ESCO, per the recommendation.
3. **§9 (hosting region / cross-border disclosure) — RECORDED, ONE SUB-ITEM DEFERRED.** Production
   target is India hosting. Region-verification and consent-copy work deferred until closer to public
   launch (no real employee data in the system yet). The other DPDP features (consent capture, data
   rights, retention/purge) are NOT deferred and remain a P1 requirement.
4. **§2 (non-goals) — APPROVED, CLARIFIED.** Confirmed scope: assess → find the gap → point at what
   closes it (a learning path). No pay-banding link — that exclusion was written down as a preemptive
   guardrail, not something proposed or requested; the user does not want it touched.
5. **§11 (phasing) — APPROVED.** Sequence confirmed as written: prove the model with synthetic data,
   then ship the differentiator + DPDP features together, then broaden.

**Still ahead before build starts:** §5 needs a real schema/migration pass (column types, RLS design)
and §8 needs the actual O\*NET/ESCO content-mapping workstream scoped with its own timeline. Both are
implementation work that follows from this sign-off, not additional decisions blocking it.
