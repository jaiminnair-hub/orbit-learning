# Orbit Foundation ↔ LMS Integration Plan — First Safe Slice

**Status: FROZEN, complete, 2026-08-25.** Approved role mapping, implemented, tested (72/72 e2e including 7 new, 403/403 unit, clean tsc/eslint), pushed, green on CI, migrated to production, and verified end-to-end in production with a real signed token — full account of that run in §9. No course, enrollment, progress, or SCORM data has moved. No database merge has happened or is planned by this document. Both sides of this integration were directly inspected before this was written — not assumed.

**Scope 2 — Orbit product-shell entry: also COMPLETE and production-verified, 2026-08-25.** The Orbit-side "Open Learning" tile, its server-side authorization Edge Function, and the tampered-request protection that guards it are all live in production and independently confirmed — full account in §10. **No deeper integration work begins past this point without the user's explicit approval of the next scope.**

- **LMS side**: this codebase (`lib/auth/session.ts`, `lib/api/with-auth.ts`, `supabase/migrations/20260814*`).
- **Orbit Foundation side**: `<local path> project\orbit-foundation\` — a sibling project, not yet connected to any live Supabase database per its own README (its migrations are the source of truth for the target schema regardless). Read in full: schema, security functions, and its own written `docs/authorization-contract.md`.

This repo already contained two internal planning documents before this one — `docs/ORBIT_INTEGRATION_READINESS.md` and `docs/ORBIT_PLATFORM_INTEGRATION_REVIEW.md` (both 2026-08-21) — which independently designed almost exactly what Orbit Foundation's real migrations implement. This plan confirms that consistency by direct comparison rather than assuming it, and narrows those two documents' broader design down to the one slice approved for implementation now.

---

## 1. Current LMS auth/org/role model

Verified directly (`lib/auth/session.ts`, `lib/api/with-auth.ts`, `supabase/migrations/20260814130000_core_tenancy_schema.sql`, `20260814143000_rls_and_helpers.sql`).

- **Auth**: Supabase Auth, email/password only. Confirmed by grep of every `supabase.auth.*` call in the codebase: `signInWithPassword`, `signUp`, `resetPasswordForEmail`, `updateUser`, `signOut`, `getUser`, `exchangeCodeForSession`. No OAuth, no SSO, no magic link today.
- **Organization**: one org per user — `profiles.org_id`, a nullable FK, not a membership table.
- **Roles**: one column, org-wide, four values: `learner < manager < org_admin < org_owner`, ranked by `role_rank()` (Postgres) / `ROLE_RANK` (`lib/auth/roles.ts`), identical on both sides by design.
- **Enforcement**: `withAuth({ minRole })` at the API layer (defense in depth, a clean 401/403 before the database is touched) and `has_role()` inside RLS (the real boundary — 59 policy expressions across 31 tables).
- **Session resolution**: one function, `getSessionContext()`, called by both `withAuth()` and every route-group page layout. It calls `supabase.auth.getUser()` (which revalidates the JWT against the Auth server, not just reads the cookie) and then does a **live `profiles` lookup** for `orgId`/`role` on every call — there are no custom JWT claims anywhere in this project.
- `profiles.role`/`org_id`/`department_id` cannot be self-updated by a normal client — a `before update` trigger resets them to their prior value unless the write comes from the service role.

## 2. Orbit Foundation auth/org/role model

Verified directly against `orbit-foundation/supabase/migrations/20260821090000-090300*` and `orbit-foundation/docs/authorization-contract.md`.

- **Auth**: also Supabase Auth — its **own**, separate `auth.users` table, in its own Supabase project.
- **Identity vs. membership are separate**: `profiles` there is identity only (no `org_id`, no `role`). `organization_memberships` is the many-to-many join (`org_role ∈ {employee, manager, org_admin, org_owner}`), and `user_active_organizations` holds which single org a session is currently acting in — composite-FK'd to membership, so a suspended membership can never remain "active."
- **A genuine product dimension the LMS has none of**: `products` (a row per product, not an enum — `lms`, `feedback`, `growth`, `competencies`, confirmed seeded), `product_roles` (per-product role vocabulary, not one shared enum), `organization_product_entitlements` (`trial|active|suspended|cancelled`, dated window, per product per org), `product_role_assignments` (explicit grant, optional `expires_at`, FK'd to an active membership — cannot exist without one).
- **The composite gate**: `can_access_product(product_key, role_key, org_id)` requires, independently, all three: active membership → active/trial entitlement → non-expired product-role grant.
- **The one rule that matters most, quoted directly from Orbit's own contract doc**: *"An `org_admin` does not automatically see Feedback reports or LMS content. A purchased product does not automatically grant every employee access."* No implicit escalation anywhere in the design.

## 3. Organization ID mapping

Orbit `organizations.id` and LMS `organizations.id` are UUIDs from unrelated keyspaces — there is no natural equality, and none should be invented. New, explicit, admin-populated LMS-side table:

```sql
create table orbit_organization_links (
  orbit_organization_id uuid primary key,
  lms_organization_id   uuid not null references organizations(id) on delete cascade,
  linked_by             uuid references profiles(id) on delete set null,
  linked_at             timestamptz not null default now(),
  unique (lms_organization_id)
);
```

One-to-one in both directions. **An Orbit org with no row here cannot enter the LMS at all** — this is the safety valve that stops an unrecognized Orbit org from silently provisioning an LMS tenant.

## 4. Role mapping

The user's original request named LMS-side roles as `learner, manager, content admin, LMS admin, platform admin`. Orbit Foundation's actual seeded `lms` product roles (`20260821090300_orbit_product_catalog.sql`) are `learner, l_and_d_admin, content_author, instructor, learning_manager` — a different vocabulary, confirmed by direct read, not assumption. The mapping below reconciles the two and was reviewed and adjusted once already (the `content_author` row was tightened from an initial draft that over-granted `org_admin`).

| Orbit `lms` product role | → LMS role | Rationale |
|---|---|---|
| `learner` | `learner` | Exact match |
| `learning_manager` | `manager` | Matches LMS `manager`'s existing gate (completion reports, member list) |
| `l_and_d_admin` | `org_admin` | Matches this repo's own prior review recommendation |
| `content_author` | **no LMS access** | The LMS has no role between `manager` and `org_admin` today — every authoring/content route is gated `minRole: "org_admin"`, confirmed by grep. Rather than over-granting `org_admin` to satisfy `content_author`, this slice denies entry outright with a clear message, until the LMS has a real, dedicated content-author role. Named follow-up work, not built here. |
| `instructor` | `learner` (least-privilege default) | No ILT/instructor concept exists in this LMS yet. Default to least privilege; never over-grant. |
| *(no `lms` entitlement, or entitled but no `lms` product role)* | **no LMS access** | Matches Orbit's own contract — membership and org-level role never imply product access |
| Orbit `platform_admins` | **out of scope this slice** | Orbit's contract requires cross-tenant support access to be server-side and audit-logged, not a browser-level grant — a separate feature |

This mapping is implemented as data (`orbit_role_map` table, §6), not hard-coded logic, so a confirmed future change is an update, not a redeploy.

## 5. Session/token trust boundary

**LMS and Orbit Foundation are separate Supabase projects with separate `auth.users` tables.** There is no shared JWT signing key and no shared session store — an Orbit session cannot simply be "recognized" by the LMS. Supabase Auth also has no supported API to fabricate a session and hand it to a browser directly.

**This slice uses a temporary, one-time, passwordless LMS auth-link bridge — a deliberate, approved, explicitly temporary exception to the LMS's password-only sign-in policy**, narrowly scoped: only reachable via a verified, single-use, replay-guarded, Orbit-signed request, never a general passwordless-login feature. It is intended to be **replaced by real OIDC/SAML SSO** once Orbit Foundation and the LMS both support it — that is named as the target end state, not built now, since it requires standing up an identity-provider role on Orbit's side and Supabase SSO/OIDC configuration on the LMS's, neither of which exists today.

**Mechanism**: the LMS admin client calls `supabase.auth.admin.generateLink({ type: "magiclink" | "invite", email, options: { redirectTo: "<appOrigin>/api/auth/callback?next=/dashboard" } })` — a real, documented Supabase Admin API call returning a one-time `action_link`, **not a session**. The entry route redirects the browser to that link; the browser is carried through Supabase's own hosted verify step to the LMS's **existing, already-built** `/api/auth/callback` route, which runs its normal `exchangeCodeForSession` — that route is what actually establishes the real browser session, exactly as it already does for every ordinary signup-confirmation and password-reset link in this codebase. The admin client never creates or holds a session.

**Replay safety** — the part that has to be airtight, since it authorizes generating a real sign-in link for someone:

- Token payload: `{ iss: "orbit-foundation", aud: "lms", jti: <uuid>, iat, exp, orbitUserId, orbitOrgId, email, lmsProductRole }`, HMAC-SHA256 signed (`node:crypto`, mirroring the proven `lib/scorm/bridge-token.ts` pattern), shared secret `ORBIT_ENTRY_TOKEN_SECRET`.
- Every `jti` is inserted into a new `orbit_entry_token_uses(jti primary key, consumed_at)` table **before** any other step runs — the primary-key uniqueness constraint is the actual replay guard (atomic, not an application-level check-then-act race). A reused `jti` is rejected (401) before the org link is even looked up.
- **Delivery is `POST` body only, never a query parameter** — the entry route rejects `GET` (405) — so the token can never appear in a URL, browser history, a `Referer` header, or an ordinary access log.

**Full sequence:**
1. `POST` body received, signature + `iss`/`aud`/`exp` verified.
2. `jti` inserted into `orbit_entry_token_uses` — reject on conflict, before anything else.
3. `orbit_organization_links` looked up for `orbitOrgId` — 403 if unlinked.
4. LMS `profiles`/`auth.users` account found-or-created for this person (matched by email within the linked org), `role` set server-side per §4's mapping (via the admin client, same trust level as the existing `prevent_profile_privilege_escalation` trigger already assumes).
5. `generateLink` called — generates a one-time link, nothing more.
6. Browser redirected through it, lands on the existing `/api/auth/callback`, which establishes the real session, then redirects to `/dashboard`.

From step 6 onward, **`getSessionContext()`, `withAuth()`, and every RLS policy run completely unmodified.** This is the core safety property: the Orbit entry path ends by driving the LMS's own existing callback route exactly like any other sign-in link, and does not add a second authorization code path anywhere.

## 6. Data ownership

Orbit Foundation owns identity (`auth.users`, canonical `profiles`) and organization/product/role/entitlement truth **going forward**. For this slice, the LMS **keeps its own local `profiles`/`organizations` as a synced/derived copy**, not yet the source of truth — full identity consolidation is later, deeper work, explicitly deferred. Courses, enrollments, learning progress, and SCORM records remain **100% LMS-owned**; nothing in this slice reads or writes them.

## 7. Rollout, rollback, and migration safety

Every artifact in this slice is additive: three new tables, one new route, one new secret. `/login` and `/signup` remain fully functional, completely untouched — the two entry paths coexist, proven by a direct regression test (§9). Rollback is org-by-org (`delete from orbit_organization_links where orbit_organization_id = ...`) or total (unset `ORBIT_ENTRY_TOKEN_SECRET`, which kills the entry route entirely — LMS-only login keeps working). No migration touches an existing table; no data moves; nothing is destructive.

## 8. Risks and open decisions

1. **The role-mapping table (§4) still needs the user's explicit confirmation** given the original name mismatch — this document proposes a reconciliation, it does not unilaterally decide one.
2. **Orbit Foundation has no app shell yet** to actually send an entry token from — this slice builds and tests the LMS-side verification route against a locally-generated test token; a real "click a tile in Orbit and land in the LMS" flow needs Orbit-side work outside this plan's control.
3. **Find-or-create-by-email profile matching** has an edge case: an LMS-native `org_admin` and an Orbit-mapped user sharing an email in the same org. Resolved by always re-deriving role server-side on every entry — never trusting a stale local value.
4. **`generateLink`'s `action_link` is single-use and short-lived by Supabase's own design.** A slow browser (e.g. behind a corporate proxy) could see it expire before use — worth a clear "link expired, go back to Orbit and try again" error state rather than a silent failure.

---

## Environment variables / secrets needed

| Variable | Where | Purpose |
|---|---|---|
| `ORBIT_ENTRY_TOKEN_SECRET` | LMS (`learning-platform` Vercel project) | HMAC signing key shared with Orbit Foundation, verifies the entry token's authenticity |

Not set by this work — per this session's standing rule, secrets are never handled in chat. The user sets this in Vercel; the same value must be configured on the Orbit Foundation side once it exists to sign tokens with.

## Manual test checklist

**Use a dedicated, non-owner test identity — never the account you personally use to administer the LMS.** The route always re-derives role server-side from the mapping on every entry, by design (§5) — it never trusts a stale local value. Running this checklist against your own real `org_owner` account will silently downgrade it to whatever role the test token carries (confirmed in practice, 2026-08-25 — see §9). Create or reuse a throwaway email (e.g. `orbit-test+<label>@yourdomain>`) for every run instead.

1. Generate a test entry token locally (throwaway script, same signing pattern as `mintBridgeToken`) for a known **test** email, a linked Orbit org, and each role in §4's mapping table in turn.
2. `POST` it to `/api/orbit/entry` (form-encoded, as a real Orbit form submission would send it — see §5's note on `readToken`) — confirm the browser is carried through `generateLink` → `/orbit/complete`'s client-side `verifyOtp()` → lands on `/dashboard` with the correct org and role.
3. Replay the **exact same token** — confirm the second attempt is rejected and does **not** generate a second sign-in link.
4. `GET` the entry route directly — confirm 405.
5. Generate a token for an **unlinked** Orbit org — confirm 403, and confirm no LMS org or profile was created.
6. Generate a token mapped to `content_author` — confirm the response is a clear "not yet supported" denial, not an `org_admin` session.
7. Confirm `/login` and `/signup` still work exactly as before, unaffected.

## Rollback procedure

- **Single organization**: `delete from orbit_organization_links where orbit_organization_id = '<id>';` — that org's users can no longer enter via Orbit; LMS-native accounts in that org are unaffected.
- **Entire feature**: unset `ORBIT_ENTRY_TOKEN_SECRET` in Vercel and redeploy — `/api/orbit/entry` can no longer verify any token and refuses all requests. `/login`/`/signup` are untouched by either action.
- No data deletion, no schema rollback required — every table added by this slice is additive and can simply stop being written to.

## 9. Production verification, 2026-08-25 — closing the loop

Approved role mapping (§4, confirmed by the user, no changes from the proposal): `learner→learner`, `learning_manager→manager`, `l_and_d_admin→org_admin`, `content_author→no access`, `instructor→learner`, no entitlement/product role→no access, `platform_admins`→out of scope. The one-time passwordless auth-link bridge (§5) was approved explicitly as a temporary mechanism, with real OIDC/SAML named as the long-term replacement.

Rollout, in order: pushed to `origin/main` (`32c4232`) → CI green (both jobs, full suite, real GitHub Actions infrastructure) → production migration applied (`npx supabase db push`, confirmed via `npx supabase migration list` showing the new migration on both Local and Remote) → `ORBIT_ENTRY_TOKEN_SECRET` generated and set in Vercel Production by the user (value never seen by the assistant) → redeployed → one test organization linked via a manual `orbit_organization_links` insert.

**Verified working end-to-end against real production, with a real signed token** — not just local/CI tests: a token was minted locally with the real secret (secret entered only into the user's own terminal session, never pasted into chat), delivered via a real HTML form POST exactly as designed, and confirmed landing on `/dashboard` in production with the correct linked org and the correct mapped role (`l_and_d_admin → org_admin`), full Admin/Authoring/Reports access visible in the nav.

**Real finding from that run, now a standing rule (folded into the manual test checklist above):** the test was run against the user's own actual `org_owner` account (`owner@example.com`), which the route's find-or-create-by-email logic matched to an *existing* LMS profile — and, per §5's design (role is always re-derived server-side on every entry, never trusted from a stale value), silently downgraded that account from `org_owner` to `org_admin`. This is not a bug — it is the intended, designed behavior of the mapping — but it is a real trap for whoever runs this checklist next using their own primary account instead of a dedicated test identity. Restored via `update profiles set role = 'org_owner' where email = '<account>';`, run manually in the Supabase SQL Editor by the user (the assistant has no production database credentials).

## 10. Orbit product-shell entry — second scope, COMPLETE, 2026-08-25

Built the other half of the bridge this plan always assumed would exist: a real "Open Learning" tile inside Orbit's actual authenticated shell (`orbit-360/orbit-console.js`, the live app at `your-360-app.vercel.app`), gated on real entitlement + role, that mints the entry token server-side and delivers it exactly as this plan's route (`/api/orbit/entry`) already expected. Nothing in §1–§9 above was modified — the token bridge, tenant mapping, and role rules are untouched.

**Built:**
- `mint-lms-entry-token` — a new Supabase Edge Function on the Orbit Foundation project (`YOUR_PROJECT_REF`), the real authorization boundary for this scope. Deployed via the Supabase Dashboard's own function editor (the project's Management-API/CLI access was blocked by a platform-level account restriction unrelated to this integration — dashboard deploy uses the same authenticated browser session, not the CLI).
- `hasLmsAccess()` / tile rendering / `openLearning()` in `orbit-console.js` — click handler that mints a token and delivers it via a hidden, auto-submitting POST-only form, matching this plan's §5 exactly.
- A CSP fix in `orbit-360`'s `vercel.json`: the site's existing `form-action 'self' mailto:` directive blocked the cross-origin POST to the LMS outright — a real, pre-existing gap this integration's own live testing surfaced, not a design flaw in this plan. Added the LMS's exact origin to `form-action`; nothing else in the policy changed.

**Server-side tamper-resistance — proven, not assumed:**

The Edge Function never reads the request body at all. Grepped the entire deployed source: zero occurrences of `organizationId`, `request.json()`, or `request.body`. The active organization comes exclusively from `supabase.rpc("current_organization_id")`, executed through a Supabase client scoped to the caller's own `Authorization` JWT — resolved server-side in Postgres from that session's real active-org state, never from anything the client sends.

Confirmed live, against the real deployed function, authenticated as a real test user: sent `{"organizationId": "<fabricated-uuid>"}` in the request body. The minted token's `orbitOrgId` claim came back as the session's real active org every time — the fabricated value had zero effect, across three independent runs (two before the client cleanup below, one after). One run was carried all the way through a real form POST to `/api/orbit/entry` and landed correctly in the real linked org, proving the tampering had no effect anywhere in the full chain, not just at the mint step.

**Client-side cleanup, 2026-08-25:** removed `organizationId` from the request body `orbit-console.js` sends to `mint-lms-entry-token` — the server never read it, so sending it was dead weight, not a safeguard. Deployed to production; re-ran the tamper-resistance test immediately after (independent raw request, unrelated to what the app's own client code now sends) and confirmed it still holds, then re-ran a full real click-through with the actual updated UI and confirmed it still lands correctly.

**Test evidence, live production, real clicks (not simulated):**
1. Entitled + roled → real enabled "Open Learning →" tile.
2. Click → real signed token → real form POST → real landing on `/dashboard`, correct org, correct mapped role.
3. Token confirmed never in the URL or browser history at any point — final URL is a clean `/dashboard`, no query string.
4. No entitlement → denied, disabled tile with "Ask your Orbit admin to enable Learning for this organization."
5. No role (entitled only) → denied, both client-side (tile hidden) and independently server-side (direct Edge Function call rejected it).
6. Expired role → same dual denial as no-role.
7. Tampered `organizationId` → no effect, before and after the client cleanup (above).
8. Orbit 360 (360 Feedback) confirmed unaffected throughout every test.

**Test isolation:** all of the above used a dedicated non-owner test identity (`lms-test@orbit-sample.test`, Orbit role `learner`) linked to a brand-new, fully separate LMS organization (`Orbit Integration Test Org`) created specifically for this — `HumanCapabilityIntel` (the real tenant) was never touched, no profile or role assignment was created there.

**Live deployment evidence:** `sb-project-ref: YOUR_PROJECT_REF` confirmed on every response; `x-deno-execution-id` fresh and unique per call, confirming live execution rather than a cached response. Supabase's gateway does not expose a build/version hash in response headers — the function's formal version/deploy-timestamp is visible only on the Dashboard's own Functions → Details page, which requires the project owner's own login session.

**Cleanup, when the test setup is no longer needed:** delete the `orbit_organization_links` row for orbit org `6b7da1aa-3935-4551-9b08-ceb4d60cec86`; delete the `Orbit Integration Test Org` LMS organization (cascades its membership/profile rows); delete the `lms-test@orbit-sample.test` auth user on the Orbit Foundation project. None of this touches `HumanCapabilityIntel` or any other production data.
