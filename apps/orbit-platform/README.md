# Orbit 360

## Current release snapshot — 2026-08-29

**Visual-system update — 2026-08-29.** Orbit 360 public, administrator,
reviewer, private-report and platform-control pages now load the shared Orbit
Sanskrit visual layer (indigo, peacock, lotus, leaf and saffron/coral). This
is presentation-only; authentication, invitation tokens, reviewer privacy,
response handling and report confidentiality rules are unchanged.

**Site integrity pass and single landing page — 2026-08-29 (`d32cce4`).**
`landing.html` replaced `suite.html` as the sole public homepage — the two
were competing entry points, which is fixed now. Also fixed in the same
pass: every dead call-to-action on the landing page (`index.html`, a file
that never existed), a CSP rule silently blocking the Inter font, two
unescaped-HTML XSS gaps, and removed ~2,000 lines of confirmed-unreachable
legacy code (`suite.html`, `workspace.html`, `app.js` and 6 dedicated CSS
files). `corporate.html` was found accidentally orphaned by the earlier
navigation-simplification commit (redirected away with no other page
linking it, despite still being actively edited) and was restored as a real,
reachable page. Full account: `docs/CURRENT_STATUS.md` in the LMS repo.

**First real 360 secure-cycle smoke test — 2026-08-29.** Ran with real
evidence against a disposable synthetic organization: unauthenticated API
rejection, single-link delivery, real submission, post-submission edit
lock, and correct anonymous-group suppression in the protected report — see
`docs/products/360-degree-feedback.md` and `docs/CURRENT_STATUS.md` for the
full account. Found and fixed a real directory-import bug in the same pass
(`790fef4`). Not an activation — both feature flags remain `false` in
Production; the invitation sender still uses a temporary placeholder domain
pending a real one being purchased.

Orbit now has one public product chooser and two clear authenticated product
entries:

- **Orbit suite entry** — `/orbit-360/` is the one public starting point
  (`landing.html`). It offers only the two live products and makes the
  authentication destination explicit.
- **Orbit 360 Feedback** — public story at `/orbit-360/360` and an
  authenticated feedback workspace at `/orbit-360/sign-in`.
- **Orbit Learning** — public story at `/orbit-360/learning.html`; eligible
  Orbit users enter the LMS through a short-lived, server-authorized,
  POST-only **Open Learning** handoff.
- **Reviewer privacy boundary** — reviewer invitation links open a
  single-purpose private route at `/orbit-360/review`; they do not expose
  administrator navigation.
- **Public homepage and trust layer** — accessible contrast, keyboard focus,
  shared footer, and draft privacy, terms, cookie, and security pages are live
  under `orbit-360/`.

Production alias: [your-360-app.vercel.app](https://your-360-app.vercel.app).
Cross-product release notes live in the LMS repository at
`docs/CURRENT_STATUS.md`.

This repository is a **retroactive baseline** for the Orbit 360 front-end and its
LMS-entry Edge Function — version control introduced after the fact, on
2026-08-25, once it was clear the code had never had any.

## Scope of this repository

Only the Orbit 360 product source, its secure server endpoints, and the
corresponding Foundation migrations are tracked here:

- `orbit-360/` — the live front-end, deployed as-is to the Vercel project
  `orbit-360` (`prj_YOUR_PROJECT_ID`, team `your-team`),
  production alias `https://your-360-app.vercel.app`.
- `supabase/functions/mint-lms-entry-token/` — the Edge Function deployed to
  the Orbit Foundation Supabase project (`YOUR_PROJECT_REF`). It is the
  real authorization boundary for the "Open Learning" product-shell entry
  point: it re-derives the caller's organization, entitlement, and role
  server-side from their own session on every call, independent of anything
  the client sends.
- `api/feedback-*.js` — server-only invitation delivery, token-bound reviewer
  response handling, and confidentiality-protected report calculation. These
  endpoints never expose the service key or raw reviewer token to the browser.
- `orbit-foundation/supabase/migrations/` — the shared organization and 360
  schema, including the invitation and confidentiality release migrations.

`vercel.json` (repository root) is also tracked — it defines the routing,
redirects, and Content-Security-Policy for the whole Vercel project and
directly governs Orbit 360's behavior.

## What is deliberately *not* tracked here

This repository lives inside a much larger, shared personal workspace that
also contains several unrelated projects — `MoneyPrinterTurbo` (its own
separate git repository), `leadership_intelligence`,
`simulation_builder_redesign`, `orbit-foundation`, `shani-short`, `work`,
plus a long tail of pre-reorganization root-level pages (`app.js`,
`index.html`, `auth-page.html`, `workspace-*.html`, etc.) that `vercel.json`
now redirects away from and that are no longer live content. None of that
is tracked here — see `.gitignore`, which is whitelist-style rather than
the usual blocklist style, precisely so this stays true as the workspace
around it continues to change.

## Deployment

Deploys are made from the workspace root to the Vercel project whose Root
Directory is `.`. Treat a commit as a source-control record, not proof that a
deployment is healthy: confirm the production alias after every release.

## Baseline note

The commit that introduces this file is retroactive: it captures the state
of both tracked paths as they already existed in production at the time,
not new work. See that commit's message for the specific deployment IDs it
corresponds to.
