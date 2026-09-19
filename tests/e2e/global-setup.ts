// Seeds real data and real logged-in sessions once per Playwright run,
// shared by role-matrix.spec.ts and tenant-isolation-api.spec.ts — those
// specs test API-layer authorization, not the onboarding mechanism
// itself (that's onboarding.spec.ts's job), so seeding goes straight
// through the service-role client rather than clicking through
// signup/invite/accept for every one of these users. Mirrors
// tests/setup/seed.ts's "simulate invited and accepted" pattern from the
// Vitest suite.
//
// Each seeded user is then logged in for real through the actual /login
// form (not a synthesized cookie — Supabase's @supabase/ssr cookie
// format is internal and not worth reverse-engineering), and their
// session is persisted via Playwright's storageState so API-level specs
// can reuse it without re-logging-in per test.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createLocalAdminClient, readStatusFromCli, writeStatusForWorkers } from "./local-supabase-admin";

const AUTH_DIR = path.join(__dirname, ".auth");
const PASSWORD = "E2e-role-matrix-password-123!";
const BASE_URL = "http://localhost:3000";

export interface SeededUser {
  email: string;
  userId: string;
}

export interface Meta {
  org: { id: string; name: string; slug: string };
  otherOrg: { id: string; name: string; slug: string };
  users: Record<
    | "learner"
    | "manager"
    | "org_admin"
    | "org_owner"
    | "patchTarget"
    | "otherOrgOwner"
    | "platformAdmin",
    SeededUser
  >;
}

async function waitForServer() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(BASE_URL);
      if (res.ok || res.status < 500) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Dev server at ${BASE_URL} never became ready`);
}

/**
 * Fails fast on a dev server serving a stale build.
 *
 * `reuseExistingServer` means a server left running from an earlier session
 * is adopted as-is. If its `.next` cache predates a route that has since been
 * added, Next's router genuinely does not know that route and returns its own
 * HTML 404 — which arrives at a spec as an ordinary failed assertion and
 * reads exactly like a broken feature. That cost real debugging time once;
 * this turns it into one clear sentence.
 */
async function assertServerKnowsCurrentRoutes() {
  // A nested route under a dynamic segment: the shape that a stale route
  // manifest drops first, and unauthenticated it should redirect or 401 —
  // anything but Next's own "page could not be found".
  const probe = `${BASE_URL}/api/v1/authoring/specs/00000000-0000-4000-8000-000000000000/versions`;
  const res = await fetch(probe).catch(() => null);
  const body = res ? await res.text().catch(() => "") : "";

  if (res && res.status === 404 && body.includes("This page could not be found")) {
    throw new Error(
      [
        "The dev server on :3000 is serving a stale build — it does not know routes that exist in this checkout.",
        "This is a stale .next cache on a reused server, not a test failure.",
        "Fix: stop the server on port 3000, delete .next, and re-run.",
      ].join("\n")
    );
  }
}

/**
 * Auth and Storage come up after Postgres does, and the CLI's own
 * health-check can report ready slightly before they accept work. Seeding
 * into that window produced `AuthRetryableFetchError: Processing this request
 * timed out` and failed the whole run during setup.
 */
async function waitForSupabaseServices(admin: ReturnType<typeof createLocalAdminClient>) {
  const deadline = Date.now() + 90_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      // Exercises PostgREST → Postgres and GoTrue, which is what seeding needs.
      const { error: dbError } = await admin.from("organizations").select("id").limit(1);
      if (dbError) throw dbError;
      const { error: authError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
      if (authError) throw authError;
      return;
    } catch (error) {
      lastError = error;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error(
    `Supabase services never became ready for seeding. Last error: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  );
}

export default async function globalSetup() {
  mkdirSync(AUTH_DIR, { recursive: true });

  // Resolved once, here, and written for the workers to read. Every spec file
  // runs in its own process, so without this each one shells out to
  // `npx supabase status` — which queries the Docker API and, across eight
  // spec files, was enough to make Docker return 502s mid-run. See
  // local-supabase-admin.ts for the full account.
  writeStatusForWorkers(readStatusFromCli());

  await waitForServer();
  await assertServerKnowsCurrentRoutes();

  const admin = createLocalAdminClient();
  await waitForSupabaseServices(admin);

  const suffix = Date.now();

  const { data: org, error: orgError } = await admin
    .from("organizations")
    .insert({ name: `RoleMatrix Org ${suffix}`, slug: `role-matrix-org-${suffix}` })
    .select("id, name, slug")
    .single();
  if (orgError) throw orgError;

  const { data: otherOrg, error: otherOrgError } = await admin
    .from("organizations")
    .insert({ name: `RoleMatrix Other Org ${suffix}`, slug: `role-matrix-other-org-${suffix}` })
    .select("id, name, slug")
    .single();
  if (otherOrgError) throw otherOrgError;

  async function makeUser(label: string, orgId: string | null, role: string): Promise<SeededUser> {
    const email = `role-matrix-${label}-${suffix}@example.test`;
    const { data: userRes, error } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    if (error) throw error;
    if (orgId) {
      const { error: profileError } = await admin
        .from("profiles")
        .update({ org_id: orgId, role })
        .eq("id", userRes.user.id);
      if (profileError) throw profileError;
    }
    return { email, userId: userRes.user.id };
  }

  const users: Meta["users"] = {
    learner: await makeUser("learner", org.id, "learner"),
    manager: await makeUser("manager", org.id, "manager"),
    org_admin: await makeUser("org-admin", org.id, "org_admin"),
    org_owner: await makeUser("org-owner", org.id, "org_owner"),
    patchTarget: await makeUser("patch-target", org.id, "learner"),
    otherOrgOwner: await makeUser("other-org-owner", otherOrg.id, "org_owner"),
    platformAdmin: await makeUser("platform-admin", null, "learner"),
  };

  const { error: platformAdminError } = await admin
    .from("platform_admins")
    .insert({ user_id: users.platformAdmin.userId });
  if (platformAdminError) throw platformAdminError;

  // Before the login loop, not after: the first of these seven logins is
  // otherwise the request that compiles /login and /dashboard, and it has to
  // do it inside waitForURL's budget. That is what made setup itself time out.
  await warmRoutes();

  const browser = await chromium.launch();
  for (const [key, user] of Object.entries(users)) {
    const context = await browser.newContext({ baseURL: BASE_URL });
    const page = await context.newPage();
    await page.goto("/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    // Generous because a cold Turbopack compile of the post-login route can
    // still land here even after warming, and a slow compile is not a
    // failing login. A manager+ user lands on /choose-workspace instead of
    // /dashboard (lib/auth/actions.ts) so they can pick a starting point —
    // either is proof the session cookie is set, which is all storageState()
    // below actually captures; specs navigate to their own target page
    // regardless of where login left off.
    await page.waitForURL(/\/dashboard|\/choose-workspace/, { timeout: 90_000 });
    await context.storageState({ path: path.join(AUTH_DIR, `${key}.json`) });
    await context.close();
  }
  await browser.close();

  const meta: Meta = { org, otherOrg, users };
  writeFileSync(path.join(AUTH_DIR, "meta.json"), JSON.stringify(meta, null, 2));
}

// `next dev` under Turbopack compiles each route on first hit, so whichever
// spec happens to run first pays that cost inside its own timeout — measured
// at 1-3 minutes for the first spec alphabetically, on work that takes
// seconds once warm. That is a setup cost, not a test's cost, so it is paid
// here. Unauthenticated requests are enough: compilation happens before the
// auth check, and a 401/redirect means the route is built.
/**
 * Belt-and-braces since the move to a production build.
 *
 * This existed because `next dev` compiled routes on first hit, putting that
 * cost inside whichever test touched a route first. The suite now runs
 * against `next build && next start`, so there is no compilation left to
 * pay for and this is no longer load-bearing. It stays because it costs
 * about a second, it primes lazy module loading and connection pools, and it
 * fails loudly if a route family is unreachable before any spec runs.
 */
async function warmRoutes() {
  const routes = [
    // pages
    "/login",
    "/dashboard",
    "/courses",
    "/admin",
    "/admin/content",
    "/admin/authoring",
    // platform + content APIs
    "/api/v1/orgs/me",
    "/api/v1/enrollments",
    "/api/v1/progress",
    "/api/v1/content/assets",
    "/api/v1/content/courses",
    "/api/v1/content/learning-objects",
    // authoring, runtime and publishing APIs
    "/api/v1/authoring/specs",
    "/api/v1/authoring/components",
    "/api/v1/authoring/templates",
    "/api/v1/publishing/packages",
  ];
  await Promise.all(
    routes.map((route) =>
      fetch(`${BASE_URL}${route}`).catch(() => {
        // A warm-up failure is never a reason to fail the run — the specs
        // will surface any real problem with their own assertions.
      })
    )
  );
}
