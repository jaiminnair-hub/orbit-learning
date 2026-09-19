# Staging QA checklist

Run against the Vercel Preview URL, using a real (Preview-configured) Supabase project — not local Docker. Each item names the exact page/route so a failure is easy to trace back to code.

**Correction to the original ask:** there is no magic-link sign-in in this codebase — `lib/auth/actions.ts` only implements `signInWithPassword`, `signUp` (with email confirmation), and `resetPasswordForEmail`. The checklist below tests those three, which are the real auth surface.

---

## 1. Auth: login/logout, signup confirmation, password reset

- [ ] **Signup** (`/signup`) with a real email → confirmation email arrives → link lands on `/api/auth/callback` → redirects into the app, not to `localhost`. (This is exactly the `NEXT_PUBLIC_SITE_URL` bug named in `DEPLOYMENT.md` §2 — if the link points at the wrong host, that env var is wrong for this environment.)
- [ ] **Login** (`/login`) with correct credentials → lands on `/dashboard`.
- [ ] **Login** with wrong password → "Invalid login credentials", stays on `/login`.
- [ ] **Logout** (header button) → session actually cleared: back-navigating to `/dashboard` redirects to `/login`, not a cached page.
- [ ] **Password reset** (`/reset-password`) → email arrives → link lands on `/reset-password/confirm` → new password works, old one doesn't.
- [ ] Session persists across a hard reload (not just client-side navigation).

## 2. Organization / role isolation

Use two separate browser profiles or incognito windows for this section — cross-checking isolation from a single logged-in tab proves nothing.

- [ ] First user with no org sees the "create organization" form on `/dashboard`, not an error.
- [ ] `org_admin` sees **Courses, Reports, Admin, Authoring** in the header nav; `manager` sees **Courses, Reports** only (no Admin/Authoring); `learner` sees **Courses** only.
- [ ] A `manager`/`learner` who directly navigates to `/admin` or `/admin/content` is redirected, not shown a broken/empty page.
- [ ] A `learner` who directly navigates to `/admin/reports` is redirected to `/dashboard`.
- [ ] Invite a user (`/admin` → invitations) → they accept via `/invite/[token]` → land in the correct org with the assigned role.
- [ ] **The isolation check that matters most:** with two orgs (Org A admin, Org B admin), confirm Org A's admin cannot see Org B's courses, members, enrollments, or reports anywhere in the UI — not just that the API blocks it (that's already covered by 65 automated tests; this pass is checking nothing in the UI *offers* a cross-org action it shouldn't, e.g. a stale dropdown listing another org's course).

## 3. Course authoring and publishing

- [ ] Content library (`/admin/content/assets`): upload a video, PDF, and image; each appears with the correct type.
- [ ] Build a learning object (`/admin/content/learning-objects`) from an uploaded asset.
- [ ] Build a course (`/admin/content/courses`): module → lesson → attach the learning object.
- [ ] Publish workflow: draft → review → approval → published, each transition succeeds and is reflected in the course's visible status.
- [ ] Published course appears in the learner catalogue (`/courses`); a draft course does not.
- [ ] Native authoring (`/admin/authoring`): create a spec, add a few blocks (text, quiz), publish, and confirm it's playable from `/courses/[id]` end to end.

## 4. SCORM: upload, launch, completion, bookmark/resume, score/progress

This is the surface item 1 of the hardening order specifically targeted — confirm the fixes hold on real infrastructure, not just local Docker.

- [ ] Upload a real SCORM 1.2 package (`/admin/content/assets`) → registers with the correct version and entry point.
- [ ] Upload a real SCORM 2004 package → same.
- [ ] Upload something deliberately oversized or wrong-type → **rejected before it reaches extraction**, with a clear error, not a 500. (Proves the `file_size_limit`/`allowed_mime_types` bucket fix from the security review actually holds in the real Supabase project — the local-Docker verification doesn't guarantee the same Storage config exists remotely.)
- [x] Attach the SCORM package to a course, publish, learner enrolls and opens it (`/courses/[id]`). Confirmed 2026-08-24 against the real isolated-bridge deployment in Production.
- [x] **Launch:** the package loads and its own on-screen status shows it found the tracking API (no "API not found" message in the content itself). Confirmed 2026-08-24 — see `docs/ORBIT_STATUS.md` §8 item 1 for the two bugs (`APP_ORIGIN` blank, `total_time_sec` integer rounding) found and fixed to get here, and the direct-API verification that the save actually persists.
- [ ] **Bookmark:** interact partway through (advance a page/slide if the content supports it), leave the course, come back — content resumes rather than restarting from the beginning. **Not yet re-verified** through the isolated bridge after the 2026-08-24 fixes — the automated check confirmed status persistence but didn't drive a full multi-slide run.
- [ ] **Completion + score:** finish the package → learner's sidebar shows it as complete → `/admin/reports` shows the same completion, with a score if the package reported one. **Not yet re-verified** through the isolated bridge after the 2026-08-24 fixes.
- [ ] **Progress persistence under interruption:** start a SCORM item, close the browser tab (not "log out") mid-session → reopen → progress from just before the close is present, not lost. (This is the `sendBeacon`-on-unload path — worth checking specifically because it's the one path that can't be proven by a normal click-through.)

## 5. Assignments and reporting/export

- [ ] `org_admin` assigns a published course to one or more people via `/admin/reports` → assignment appears immediately in the report table.
- [ ] Assigned learner sees the course on their `/dashboard`, sorted correctly (overdue items first, per the sort rule already in `my-learning.tsx`).
- [ ] Set a due date in the past on an assignment → report shows it flagged "overdue"; the summary tile's overdue count matches.
- [ ] Filter the report by status and by course → row count changes correctly, not just visually truncated.
- [ ] **CSV export** → downloaded file opens cleanly in a spreadsheet app, columns aligned, and a learner name/course title containing a comma doesn't shift later columns (the export quotes every field specifically for this).
- [ ] A `manager` (not `org_admin`) can view the report but has no assign controls.

---

## What this checklist does *not* cover, on purpose

- The authoring tool's deeper editing surfaces (block-level editing, layers/timeline, media pipeline) — out of scope while authoring work is paused.
- AI features — the gateway has never been exercised against a real provider.
- Billing, certificates — not built.
- Load/performance under concurrent users — this is a functional smoke test, not a load test.
