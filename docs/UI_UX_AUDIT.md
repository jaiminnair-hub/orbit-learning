# UI/UX Audit — Current State vs. [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md)

> **Resolution update — 2026-08-26.** This audit describes the pre-redesign baseline. The recommended programme has since been delivered in successive releases: shared Orbit tokens and components, a role-aware product shell, migration of existing LMS pages to that shell, and visual/mobile/keyboard/accessibility QA. The authenticated `/platform` command centre now uses the same system. Remaining future work is feature expansion, not a return to the browser-default baseline described below. See [CURRENT_STATUS.md](CURRENT_STATUS.md) for the current release ledger.

**Date:** 2026-08-17. **Trigger:** the 2026-08-16 "world-class LMS + authoring tool" direction ([MASTER_FEATURE_MATRIX.md](MASTER_FEATURE_MATRIX.md) reconciliation note 4) raises the bar the UI needs to clear. Phase 3 step 3 is paused for this pass. **No backend, API, route, or data-layer change in this document or the work it describes.** Phase 2 stays frozen.

## Method

Read every page/component under `app/` (27 files use inline styles; **zero** use a CSS class or Tailwind utility despite Tailwind being installed and configured) and compared against [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md)'s IA, component inventory, and token list. Confirmed in the running dev server via the accessibility tree (screenshot capture wasn't available in this environment — no display attached to the preview pane).

## Headline finding

**There is no design system in the running app today — by design, stated explicitly in the code.** `app/(app)/admin/content/ui.tsx` says outright: *"Kept deliberately plain — this is the UI layer over Phase 2's existing API, not a design system. A real design system is a separate, later investment."* That investment is what this pass begins, at the scale the current instruction allows: **small, additive, zero functional risk.**

Concretely, today:
- **No persistent navigation or app shell anywhere.** `app/(app)/layout.tsx` — shared by every authenticated screen — is a pure auth gate with no chrome. Moving between Dashboard → Courses → Admin relies on ad hoc in-page text links (`← Dashboard`).
- **Every screen hand-writes its own inline styles.** The same values are duplicated verbatim rather than shared: the error-banner style (`color: "#b23a3a", background: "#faeae8"`) appears independently in at least **5 files** (`login`, `signup`, `admin-console`, `accept-invite`, `admin/content/ui.tsx`).
- **No design tokens exist.** `globals.css` defines exactly two variables (`--background`, `--foreground`).
- **Native browser controls, unstyled.** Every `<button>`, `<input>`, `<select>` renders with OS/browser defaults — no consistent padding, radius, or hover/focus treatment.
- **No visible-focus guarantee.** Nothing removes the browser default focus ring (good — no violation today), but nothing guarantees one either; it varies by browser/OS rather than being a deliberate, tested part of the product, which [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) §7 requires as non-negotiable.

None of this is a regression — it's the explicit, documented state of a UI built to prove Phase 1/2 functionality, not to look finished. The gap to "world-class" is real and large; this pass narrows the *foundation* layer of it without touching anything structural.

## Prioritized findings

Ranked by (impact on every screen) ÷ (risk of touching it). **Bold** = implemented in this pass.

| # | Finding | Impact | Risk to implement | This pass? |
|---|---|---|---|---|
| 1 | **No design tokens — colors/spacing/radius hand-duplicated per file** | Every screen | None — pure CSS addition, no component touched | **Yes** |
| 2 | **No shared visible-focus treatment** | Every interactive element, every screen | None — pure CSS addition | **Yes** |
| 3 | **No consistent button/input styling** — raw OS defaults | Every form, every screen | None — pure CSS addition, existing inline styles still win where they set explicit values | **Yes** |
| 4 | **No persistent app shell/navigation** — the single most-visible gap vs. [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) §1–3 | Every authenticated screen | Low — one file (`app/(app)/layout.tsx`), additive only, uses session data the file already reads | **Yes**, minimal version (see scope note below) |
| 5 | Duplicated inline error-banner objects across 5 files | Low visual impact (already looks identical everywhere by coincidence); real maintenance risk (a color change needs 5 edits) | Low, but touches 5 files for a purely cosmetic dedup | No — flagged, not worth the diff surface this pass |
| 6 | Full four-persona IA (rail nav for Admin/Platform Admin, tab bar for Learner/Manager, role-based routing) per [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) §2–3 | Very high once built | High — new navigation structure, new routing conventions, real design decisions per persona | No — this is the real "later investment" the code comment refers to; needs its own scoped pass |
| 7 | Persistent AI Assistant dockable panel ([DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) §2) | High, but nothing to dock yet — no AI Assistant feature exists before Phase 4 | N/A | No — no backend to attach it to |
| 8 | Empty-state, skeleton-loader, and toast components ([DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) §4) | Medium — several screens show bare "Loading…" / "No X yet." text | Medium — real components, multiple call sites to adopt them | No — component-library work, not a small pass |
| 9 | Sortable/paginated table component | Medium — admin lists will not scale visually | Medium | No — no current list is large enough to need it yet |
| 10 | Primary/secondary button visual hierarchy | Medium | Medium-high if done as a heuristic (unreliable — e.g. WorkflowBar's "Publish" isn't `type="submit"` since it isn't inside a `<form>`, so an attribute-based heuristic would inconsistently miss it) | No — needs a real `<Button variant>` component, not a CSS guess |
| 11 | Typography scale beyond default browser heading sizes | Low-medium | Low | Partially — a light heading scale is included in the token pass (#1) since it's zero extra risk |

## Why items 1–4 and not further

The instruction is explicit: small, low-risk, existing components/data only, no functionality or architecture change. Items 1–3 are pure CSS additions — they cannot break anything because inline `style` always wins over an external stylesheet, so every existing screen's explicit choices are preserved exactly; only the *unstyled* gaps (raw button/input defaults, missing focus ring, hand-picked one-off colors) get a consistent baseline.

Item 4 is the one structural change, kept deliberately minimal: a single slim header in the layout file every authenticated page already shares, built from data (`session.email`, `session.orgId`, `session.role`) that file already fetches — no new query, no new route, no new permission check. It is explicitly **not** an attempt at the four-persona rail navigation in [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) §2–3 (item #6) — that is real IA and interaction design work and does not fit "small."

## Token values — a note on provenance

[DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) §5 fixes token *roles*, not values, since branding isn't decided ([`project-lms-naming-tbd`](.)). The values chosen here are not new: they are the colors **already scattered across the codebase** — `StatusPill`'s published/review/draft colors, and the error-banner red used in 5+ files — now centralized instead of invented. This was a deliberate choice: introducing a fresh palette risked visual clash against the many untouched inline styles that remain; codifying what's already there cannot clash with itself.

## What was implemented

1. **`app/globals.css`** — semantic design tokens (color roles, spacing, radius, a heading scale), base styling for `button`/`input`/`select`/`textarea`/`label`/links, and an explicit `:focus-visible` ring respecting `prefers-reduced-motion`. Zero components touched; zero behavior changed.
2. **`app/(app)/layout.tsx`** — a slim persistent header (brand, role-aware nav links, org/role/email, logout) shared by every authenticated screen. Built entirely from the session data the file already reads.
3. **`app/(app)/dashboard/page.tsx`** — removed two now-redundant lines: its own logout form, and its own "Signed in as {email}" text. Both are caught by real, reproduced-not-assumed regressions:
   - The duplicate logout button broke `tests/e2e/onboarding.spec.ts`'s `getByRole("button", { name: "Log out" })` — the test's own prior comment ("logout only renders on /dashboard") stopped being true the moment logout moved into the shared header.
   - The duplicate email text broke `getByText(ownerEmail)` in the same spec — Playwright's strict mode refused the ambiguous match between the header's `.app-header__meta` span and the page's own "Signed in as …" paragraph.
   
   Both were found by actually running the suite against a clean dev server, not inferred. The first full run reported a failure that turned out to be a stale, hours-old dev server (a documented failure mode in this repo — see `git log`); re-running against a freshly restarted server surfaced the two real collisions above, which don't recur in a third clean run of the full 22-test suite. In both cases the fix is the same shape: the header is now the single place either piece of information is shown, and the dashboard page no longer repeats it.

All three files are reversible in isolation and touch no route, API, migration, or non-UI test assertion.

## Explicitly deferred (not started, not designed)

Items 5–10 above, plus anything requiring new components, new routes, or a real visual-design decision beyond "make the existing thing consistent." The biggest of these — the four-persona navigation architecture — is the natural next UI investment once this instruction's scope is satisfied, but it is a separate, larger piece of work and was not scoped or estimated here.
