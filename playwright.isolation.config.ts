import { defineConfig, devices } from "@playwright/test";
import { execSync } from "node:child_process";

/**
 * A deliberately separate config from playwright.config.ts, not an extra
 * project inside it. Next.js bakes `NEXT_PUBLIC_*` variables in at build
 * time, so a build with `NEXT_PUBLIC_SCORM_CONTENT_ORIGIN` set can't
 * share a build artifact with the main suite, which needs that variable
 * unset to exercise the default same-origin path everywhere else. Two
 * configs, two builds, no interference.
 *
 * Not wired into ci.yml yet — running two full `next build`s roughly
 * doubles that job's time, which is worth a deliberate decision rather
 * than a silent addition. Run locally via:
 *   npx playwright test --config=playwright.isolation.config.ts
 */

const SHARED_SECRET = "isolation-test-shared-secret-do-not-use-in-prod";

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
  };
}

export default defineConfig({
  testDir: "./tests/e2e-isolation",
  globalSetup: "./tests/e2e/global-setup.ts",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: { baseURL: "http://localhost:3000", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "npm run build && npm run start",
      url: "http://localhost:3000",
      reuseExistingServer: false,
      // A fresh NEXT_PUBLIC_SCORM_CONTENT_ORIGIN value here changes what
      // Turbopack has to re-inline into the client bundle versus the
      // routine CI build's warm cache, plus this now competes with the
      // content-origin build for the same CPU — both push this well past
      // the main suite's 300s budget the first time this config runs.
      timeout: 600_000,
      env: {
        ...localSupabaseEnv(),
        NEXT_PUBLIC_SCORM_CONTENT_ORIGIN: "http://localhost:3100",
        SCORM_BRIDGE_TOKEN_SECRET: SHARED_SECRET,
        CONTENT_BRIDGE_SECRET: SHARED_SECRET,
      },
    },
    {
      command: "npm run build && npm run start",
      cwd: "./apps/scorm-content",
      // Not the bare root — this app has no route there, so it 404s,
      // and Playwright's webServer readiness check only accepts
      // 2xx/3xx/400-403 (checked in node_modules/playwright/types/
      // test.d.ts rather than assumed after this cost two full timeout
      // cycles to track down). The bridge page itself returns 200 even
      // for a made-up packageId — confirmed directly with curl — so it
      // doubles as a real health check.
      url: "http://localhost:3100/bridge/healthcheck",
      reuseExistingServer: false,
      // Generous: this build takes ~15s in isolation but competes for the
      // same CPU with the main app's ~6-minute build when both webServer
      // entries start in parallel, measured taking ~130s under that
      // contention during this work.
      timeout: 400_000,
      env: {
        APP_ORIGIN: "http://localhost:3000",
        SCORM_BRIDGE_TOKEN_SECRET: SHARED_SECRET,
        CONTENT_BRIDGE_SECRET: SHARED_SECRET,
      },
    },
  ],
});
