# Deploying to Vercel

**No secrets appear in this document, and none should ever be pasted into chat or committed.** Every credential below is entered directly into the Vercel dashboard by you.

## 1. Connect the repository

1. Go to [vercel.com/new](https://vercel.com/new).
2. Import `your-github-user/orbit-learning`. Vercel auto-detects Next.js — no build command override needed (`next build` is what CI already runs, and what item 2 of the hardening order verified works with the Cloudflare tooling removed).
3. **Do not click Deploy yet** — set environment variables first (§2), or the first build will fail on missing Supabase config.

## 2. Environment variables

Vercel → Project → Settings → Environment Variables. Four variables, each needed in **both Preview and Production** (Vercel lets you tick which environments a variable applies to — tick both for all four, since staging QA needs a working Supabase connection exactly like production does):

| Variable | Where to get it | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase dashboard → Project Settings → API → Project URL | Public — safe to expose to the browser |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Same page → Project API keys → the publishable/anon key | Public — RLS is what actually protects data, not secrecy of this key |
| `SUPABASE_SECRET_KEY` | Same page → Project API keys → the **service_role** key | **Never expose this.** No `NEXT_PUBLIC_` prefix — enforced by `lib/supabase/admin.ts`, which is server-only code. Mark it "Sensitive" in Vercel's UI (hides the value after save, even from your own later view) |
| `NEXT_PUBLIC_SITE_URL` | The deployment's own URL | **Must differ between Preview and Production** — see the callout below |

### Why `NEXT_PUBLIC_SITE_URL` needs care

`lib/auth/actions.ts` uses this to build the email confirmation and password-reset links a learner clicks. Set it once for "Production" only and Preview deployments silently build links pointing at production — a learner testing signup on a preview URL gets an email link that redirects them to the live site instead of back to the preview. This exact bug is already recorded in this repo's history (`.env.local` was missing it during an earlier build).

- **Production environment:** your real production domain once one exists, or the Vercel-assigned stable production URL until then.
- **Preview environment:** Vercel exposes `$VERCEL_URL` as a built-in system variable, but `NEXT_PUBLIC_SITE_URL` needs a *fixed* value per environment, not a per-deployment one, since Next.js inlines `NEXT_PUBLIC_*` vars at build time. Practically: set Preview's `NEXT_PUBLIC_SITE_URL` to your primary preview URL pattern once you know it (Vercel gives each PR a unique preview URL, but also a stable branch-alias URL if you want one) — or accept that auth email links from preview deployments point at whichever preview built them, and treat email-link testing as a Production-environment-only check for now.

### Two different URL shapes — do not confuse them

The first deployment of this project produced a URL of the form `learning-platform-<random-hash>-<team>.vercel.app`. **That hash means it is a per-deployment URL, not the stable one** — every new deployment gets its own fresh hash, so a value like this will go stale the moment you deploy again.

The stable one — the one that should actually go into `NEXT_PUBLIC_SITE_URL` for Production — is whatever Vercel shows under **Project → Settings → Domains**. It's a fixed alias (typically `<project-name>.vercel.app` or a variant without the random segment, or your custom domain once one exists) that always points at whichever deployment is currently promoted to Production, regardless of that deployment's own hash.

**Before setting `NEXT_PUBLIC_SITE_URL`, check the Domains tab and confirm which URL is listed there — don't reuse a URL copied from a deployment's own build-complete screen**, which is exactly what produced the hash-style URL the first time around.

### What is deliberately not set yet

`ANTHROPIC_API_KEY` and `AI_MONTHLY_BUDGET_USD` — the AI gateway has never been exercised against a real provider. Leave these unset until that's a deliberate decision.

## 3. Deploy

Click Deploy. Vercel builds and gives you a Preview URL for this first deployment, and every subsequent push to any branch gets its own Preview URL automatically — that's your staging environment with no extra setup. Pushes to `main` also produce a Production deployment once you promote it (or auto-promote, depending on your project settings).

## 4. What to send back here

Once the Preview deployment is live: the Preview URL. Nothing else — no credentials, no dashboard screenshots containing keys.
