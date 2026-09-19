import { defineConfig, devices } from "@playwright/test";
import { execSync } from "node:child_process";

// The Next dev server this config spawns must run against the local,
// disposable Supabase instance (docs/TESTING.md §5's "never against a
// shared staging database" principle) — not the real project .env.local
// points to. Shell/CLI env vars override .env.local in Next's own
// precedence order, so passing these via webServer.env is enough; no
// .env file needs to change. Mirrors tests/setup/local-supabase.ts's
// approach of reading `supabase status` at run time rather than
// hardcoding keys.
function localSupabaseEnv() {
  const raw = execSync("npx supabase status -o json", { encoding: "utf-8" });
  const jsonStart = raw.indexOf("{");
  const status = JSON.parse(raw.slice(jsonStart)) as {
    API_URL: string;
    PUBLISHABLE_KEY: string;
    SECRET_KEY: string;
  };

  return {
    NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY,
    SUPABASE_SECRET_KEY: status.SECRET_KEY,
    NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
    // Local-only test value for the Orbit entry bridge (docs/ORBIT_LMS_INTEGRATION_PLAN.md
    // §5) — orbit-entry.spec.ts mints tokens with this same string. Never the real
    // secret; that lives only in Vercel, same as every other production secret.
    ORBIT_ENTRY_TOKEN_SECRET: "e2e-local-orbit-entry-secret-do-not-use-in-production",
  };
}

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  // These budgets were sized for `next dev`, where Turbopack compiled each
  // route on first hit and a working request could legitimately take 17s.
  // The suite now runs against a production build (see `webServer` below),
  // so nothing compiles mid-test and real work is fast. They stay generous
  // rather than tight because the stack underneath is still a Dockerized
  // Postgres on a developer laptop — but they are now headroom for I/O,
  // not cover for a compiler.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  // Specs share seeded state (tests/e2e/global-setup.ts) and some mutate
  // it (e.g. role-matrix.spec.ts's PATCH tests) — serial execution avoids
  // cross-file races over that shared state. This is a handful of specs,
  // not a large suite where parallelism would matter.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  /**
   * A production build, not `next dev` — the change that made this suite a
   * dependable gate rather than a coin flip.
   *
   * Under `next dev`, Turbopack compiles each route the first time it is
   * requested. That put an unpredictable multi-second cost inside whichever
   * test happened to touch a route first, and the cost moved between runs as
   * test order and machine load varied. The symptom was a rotating cast of
   * failures — a full run would fail four specs, each of which passed alone —
   * which reads exactly like flaky application code and is not.
   * `authoring-ui.spec.ts` exhausted a 180-second budget this way.
   *
   * `next build` pays that cost once, up front, outside every test budget.
   * The tests then measure the application rather than the compiler.
   *
   * `reuseExistingServer: false` is deliberate and closes a second failure
   * mode: a server left running from an earlier session serves whatever
   * build it started with, so routes added since simply 404 — which surfaces
   * as an ordinary failed assertion and reads like a broken feature.
   */
  webServer: {
    command: "npm run build && npm run start",
    url: "http://localhost:3000",
    reuseExistingServer: false,
    // Covers a cold `next build` on this stack, not just server startup.
    timeout: 300_000,
    env: localSupabaseEnv(),
  },
});
