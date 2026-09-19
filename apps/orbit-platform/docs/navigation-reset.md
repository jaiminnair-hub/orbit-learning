# Orbit Navigation Reset

Last updated: 29 August 2026

**2026-08-29 update.** The public chooser described below moved from a
dedicated `suite.html` page to `landing.html`, which is now the sole public
homepage (`vercel.json` rewrites `/orbit-360/` there). `suite.html` was
removed as a redundant second entry point. `corporate.html` is live again —
it was found accidentally orphaned by an earlier routing change (redirected
to the chooser with no other page linking it) and has been restored as a
reachable page, linked from the shared footer. See `docs/CURRENT_STATUS.md`
for the full account.

## Canonical journeys

| Audience | Start | Next route | End state |
| --- | --- | --- | --- |
| Visitor choosing a product | `/orbit-360/` | 360 Feedback or Orbit Learning | Clear product landing or sign-in |
| 360 administrator | `/orbit-360/sign-in` | authenticated 360 workspace | Home → Cycles → People → Questions & reviewers → Reports |
| 360 reviewer | private invitation link only | `/orbit-360/review#token` | confidential single-purpose review; no admin shell |
| Learning learner or administrator | Learning sign-in | Learning role resolution | learner or management workspace |

## Rules

- `landing.html` is the only public product chooser. It presents only products that are live, and links to both 360 Feedback and Orbit Learning.
- `Growth` and `Competencies` are roadmap products, not workspace navigation.
- A 360 administrator sees only the tasks needed to operate a feedback cycle.
- A reviewer never enters the administrator workspace. Their invitation opens a private review page.
- Learning and 360 do not claim shared sign-in. Any cross-product launch states the secure handoff/authentication boundary honestly.
- `corporate.html` is a real, reachable marketing/pricing page (not a redirect target); `/orbit-360/360`, `/orbit-360/learning`, `/orbit-360/sign-in`, and `/orbit-360/review` are readable canonical routes.

## Release verification

Verify the four public routes return their intended document and `landing.html` has exactly two live-product primary calls to action. Verify role navigation through the isolated QA organisation before relying on a customer workspace.
