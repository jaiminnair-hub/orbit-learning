import base from "./playwright.config";

/**
 * The two Orbit QA personas run only against the disposable local Supabase
 * stack. This is deliberately separate from the full regression suite so it
 * can be scheduled after a release and reported to non-engineers.
 */
export default {
  ...base,
  testDir: "./tests/e2e/qa",
  webServer: {
    ...base.webServer,
    command: "node scripts/qa/start-qa-server.mjs",
    reuseExistingServer: true,
  },
};
