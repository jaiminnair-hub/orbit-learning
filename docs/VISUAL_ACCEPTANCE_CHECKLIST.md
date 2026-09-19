# Visual Acceptance & Navigation Clarity Checklist

Tracks `docs/ORBIT_PLATFORM_BUILD_STATUS.md` §13 P0 item 3. Built 2026-08-30, real routes only
(confirmed via the actual `app/**/page.tsx` file tree and the real orbit-360 HTML file list — nothing
invented). Each row gets checked at desktop and mobile width, for: correct font (Inter, no leftover
Georgia), spacing/color/contrast against the Sanskrit tokens, no dead or ambiguous links, and — where
a role transition crosses a real sign-in boundary — a short explanation of why.

Status legend: `☐` not yet checked · `✅` checked, no issues · `⚠️` checked, issue found and fixed ·
`❌` checked, issue found, not yet fixed.

## Already covered this session (not re-listed below)

- LMS-wide Inter/Georgia font fix — `app/globals.css`, `app/layout.tsx`.
- 360 landing page primary CTAs routing through the Precision Builder / AI Quick Create choice
  instead of skipping straight to the console — `landing.html`, `feedback.html`.

---

## Role 1 — Learner (Orbit Learning) — ✅ complete 2026-08-30

| Route | Desktop | Mobile |
|---|---|---|
| `/login` | ✅ | ✅ |
| `/signup`, `/signup/check-email` | ✅ | ✅ (signup only) |
| `/reset-password`, `/check-email`, `/confirm` | ⚠️→✅ | not separately checked (same AuthShell as login/signup, low risk) |
| `/choose-workspace` | ✅ | ✅ |
| `/dashboard` (learner-home + create-org-form states) | ✅ | ✅ |
| `/courses` (catalogue) | ⚠️→✅ | ✅ |
| `/courses/[id]` (invalid-id state; no seeded course to test the real player) | ✅ | not checked |
| `/assessments` | ✅ | ✅ |
| `/assessments/[id]` (invalid-id state) | ⚠️→✅ | not checked |
| `/invite/[token]` (invalid/already-member state) | ✅ | not checked |
| `/orbit/complete` (no-token state) | ✅ | not checked |

### Findings

1. **Fixed — `ProductShell.tsx` nav label desync.** The "you are here" label next to the tab bar
   (`LEARNING / X`) was hardcoded to the macro-view name ("My learning"/"Manage learning"/"Team
   insights") instead of the actual active tab, so it silently showed the wrong label on every
   route except the first tab in each set (`/courses`, `/assessments`, and every non-`/admin`
   admin sub-page all showed a stale label). Added `activeLocalLabel`, computed from whichever
   link in the current role's nav set actually matches the path. The "Viewing:" role-switcher
   (a genuinely different concept — which macro view you're in) was correct already and untouched.
2. **Fixed — bare Next.js 404 on `/assessments/[id]`.** This route calls `notFound()` for a
   missing/foreign assessment, and there was no custom `not-found.tsx` anywhere in the app, so it
   fell through to Next's unstyled default (wrong font, no design treatment) — inconsistent with
   `/courses/[id]`, which handles the identical situation with a styled inline message. Added
   `app/(app)/not-found.tsx` using the existing `PageShell`/`PageHeading`/`Card` primitives, so
   this is now fixed for every future route that calls `notFound()`, not just this one.
3. **Fixed — wrong heading copy on `/reset-password`.** The request-a-reset-link page had a
   hardcoded `<h2>Check your email</h2>` — the copy that belongs on the *next* step
   (`/reset-password/check-email`), not this one. Changed to "Reset your password."
4. Not a bug, ruled out: the repeated 404/409 console errors seen on later page loads were stale
   entries from earlier test actions (a deliberately-invalid course ID, an already-a-member invite
   accept) persisting in the browser tab's console buffer across navigations, not fresh errors per
   page.
5. **Not fixed, not urgent, worth a future look:** the `/signup` and `/reset-password` forms clear
   all fields after a validation error (e.g. an invalid email domain) instead of preserving what
   the user typed — real friction, but cosmetic/UX polish rather than a visual-consistency bug, so
   left out of this pass's scope.

## Role 2 — Course author (Orbit Learning) — ✅ complete 2026-08-30

| Route | Desktop | Mobile |
|---|---|---|
| `/admin/authoring` (spec list) | ⚠️→✅ | not checked |
| `/admin/authoring/[id]` (block editor — internals intentionally out of scope) | ✅ loads clean | not checked |
| `/admin/content` (Orbit Studio hub) | ✅ | ✅ |
| `/admin/content/courses`, `/[id]` (editor, real course created) | ✅ | ✅ |
| `/admin/content/learning-objects` | ✅ | not checked |
| `/admin/content/assessments` | ✅ | not checked |
| `/admin/content/assets` | ✅ | not checked |

### Findings

6. **Fixed — multiple simultaneously-"active" tabs in `ProductShell.tsx`.** On `/admin/authoring`,
   three tabs highlighted as active at once ("Overview," "Content & AI," "People & access"), because
   the active-tab check used a "starts with" prefix match designed for genuinely nested routes
   (`/courses` → `/courses/[id]`), applied to a flat row of sibling admin tabs that all share the
   `/admin` URL prefix. Replaced with a longest-matching-href rule (`bestMatch`), which correctly
   picks the most specific tab instead of every ancestor-shaped match. This also fixes finding #1's
   label bug more robustly than the original patch did.
7. **Not fixed, flagged for a product decision, not a nav-code bug:** "Overview" and "People & access"
   in `adminLinks` point to the exact same URL (`/admin`). Live content on `/admin` (hero: "Build a
   learning space people can trust" / "Organisation control" / member + invite + governance stats) is
   clearly about people & access, not a generic overview — suggesting "People & access" is the correct
   label for this page and "Overview" is orphaned, possibly meant for a separate not-yet-built org-stats
   page. Needs a decision on intent, not a guess from me.
8. **Fixed — no scroll affordance on horizontally-overflowing tab bars.** On mobile, both the main
   product nav and the "Orbit Studio" sub-nav clip tab text with no visual hint that the row scrolls
   (`overflow-x: auto` was already there, just invisible). Added a right-edge fade
   (`mask-image: linear-gradient`) to both in their existing mobile media queries.
9. Not a bug, ruled out: an apparent "giant blank gap above the header" after a form submission was
   just a lingering `scrollY` position from before the navigation, not a layout defect — confirmed via
   `scrollY`/`scrollHeight` and resolved by scrolling to top.

## Role 3 — Organisation admin (Orbit Learning) — ✅ complete 2026-08-30

| Route | Desktop | Mobile |
|---|---|---|
| `/admin` (admin console) | ✅ (see finding #7) | not separately checked |
| `/admin/reports` (+ assign panel) | ✅ | ✅ |
| `/dashboard` (create-org-form state, new org) | ✅ | ✅ |

## Role 4 — Platform owner (Orbit Learning) — ⚠️ partial, deferred by user decision 2026-08-30

| Route | Desktop | Mobile |
|---|---|---|
| Access control for a non-platform-owner (redirect on `/platform`) | ✅ fails safe, no error leakage | not checked |
| `/platform` actual console content | ⏸️ deferred — granting platform_owner even to a disposable test account was blocked by the harness's own safety classifier (privilege-escalation guardrail); user chose to skip rather than grant permission or do it manually. Not a found bug — a scope decision. Platform Control already has its own documented gaps in `ORBIT_PLATFORM_BUILD_STATUS.md` (QA runner "partly guided/manual"). |

## Role 5 — 360 administrator (Orbit 360) — ✅ complete 2026-08-30 (tested live against a real populated org — "Orbit Sample Company" — not a fresh empty account, per the real credentials the user supplied)

| Route | Desktop | Mobile |
|---|---|---|
| `orbit-console.html` sign-in | ✅ | not separately checked |
| Console → Home panel | ✅ | ✅ |
| Console → Cycles panel (4 real cycles) | ✅ | not checked |
| Console → People panel (201 real people) | ✅ | ✅ |
| Console → Questions & reviewers panel | ✅ | not checked |
| Console → Reports panel | ✅ (empty-state only — deeper report-generation testing is functional QA, out of this pass's scope) | not checked |
| `quick-cycle.html` (AI Quick Create) | ⚠️→✅ (see finding #10) | not checked |
| `platform-admin.html` (real platform-admin access on this account, not user- or self-granted) | ✅ (95 real protected reports across 3 orgs) | ✅ |

### Findings

10. **Fixed — CSP-blocked inline style silently breaking layout.** `quick-cycle.js` rendered each
    question row's type-select/remove-button column with a literal `style="flex:0 0 120px"` attribute.
    The site's own Content Security Policy (`style-src 'self' https://fonts.googleapis.com`, in
    `vercel.json`) blocks inline styles, so this never actually applied — the column silently fell
    back to `flex:1` (equal width with the text column) instead of its intended fixed 120px, on
    every question row across the product. Fixed by moving the rule into a real CSS class
    (`.quick-q-row__meta`) in `quick-cycle.css` and referencing it from the template instead of an
    inline attribute. Confirmed via grep this was the only inline-style attribute anywhere in the
    orbit-360 JS codebase — not a wider pattern.
11. **Fixed — same missing-scroll-affordance pattern as the LMS.** The org-name `<select>` in the
    topbar hard-clips on mobile ("Orbit Sample Company" → "Orbit Sar", no ellipsis), and the
    `.sidebar` tab row (Home/Cycles/People/...) clips with no scroll hint, identical to the LMS
    findings #1 and #8. Fixed with `text-overflow:ellipsis` on the select and the same
    `mask-image` fade-edge pattern on `.sidebar`, in `orbit-console.css`. **Verified live** — deployed
    to production (commit `4d2eb1f`) and confirmed via direct fetch of the served CSS.
12. Not a bug, ruled out: a second apparent CSP-violation console entry seen on `platform-admin.html`
    was a stale carryover from the earlier `quick-cycle.html` visit in the same tab session (identical
    error hash) — confirmed via grep that no inline-style code exists anywhere in `platform-admin.js`
    or `orbit-platform-config.js`.
13. Not a bug: mid-pass, the Browser pane's screenshot capture went blank for several checks (pane
    was hidden on the client side, outside my control). Switched to DOM/accessibility-tree and
    computed-style checks for that stretch; screenshots resumed working shortly after without any
    page-side fix needed.

## Role 6 — Invited reviewer (Orbit 360, private-link only) — ✅ complete 2026-08-30

| Route | Desktop | Mobile |
|---|---|---|
| `review.html` (no-token state) | ✅ | ✅ |
| `report.html` (no-token state) | ⚠️→✅ (see finding #14) | not checked |

### Findings

14. **Fixed — stale "Please wait." placeholder never cleared.** `#personal-report`'s HTML default is
    the literal text "Please wait." `report.js`'s `load()` correctly updates the heading and note for
    both the no-token and invalid-token early-return paths, but never touched `#personal-report`
    itself, so both error states showed "This link is incomplete" / "This report is unavailable" with
    a stray "Please wait." box still sitting underneath. Fixed by clearing `#personal-report` in both
    early-return branches. **Verified live** — deployed to production (commit `4d2eb1f`) and confirmed
    by loading `report.html` with no token: the placeholder box is now empty instead of showing
    "Please wait."

## Public / shared entry points (no auth)

| Route | Desktop | Mobile |
|---|---|---|
| `/` (LMS root) | ☐ | ☐ |
| `landing.html` (Orbit public chooser) | ☐ | ☐ |
| `feedback.html` (360 product page — Precision Builder / AI Quick Create) | ☐ | ☐ |
| `learning.html` (Learning product page) | ☐ | ☐ |
| `privacy.html`, `terms.html`, `cookies.html`, `security.html` | ☐ | ☐ |
| `corporate.html` | ☐ | ☐ |

## Sign-in boundary transitions (needs a short explanation, not a silent redirect)

| Transition | Explained today? |
|---|---|
| Orbit 360 console → Orbit Learning (via `mint-lms-entry-token` hand-off) | ☐ |
| Orbit public chooser → Learning login (separate credentials) | ☐ |
| Orbit public chooser → 360 login (separate credentials) | ☐ |

---

**Row count**: ~45 route checks × 2 device widths ≈ 90 individual checks, plus 3 transition checks.
Working through this in batches by role, screenshotting and fixing issues in the same pass rather than
just cataloguing them for a later fix round.
