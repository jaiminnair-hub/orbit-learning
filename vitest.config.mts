import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    // Mirrors the `@/*` path alias in tsconfig.json, so tests import library
    // code the same way application code does.
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    // Resolves the local Supabase connection details once before any worker
    // starts. Without it, several file-workers can miss a cold disk cache at
    // the same moment and each spawn `npx supabase status` — which queries
    // the Docker API, and is the pressure that produced Docker 502s in the
    // Playwright suite.
    globalSetup: ["tests/setup/global-setup.ts"],
    // Each test file's first DB call shells out to `npx supabase status`
    // to read connection details (tests/setup/local-supabase.ts), which
    // costs ~7-8s on its own — it got slower once Storage was enabled for
    // Phase 2, and files run in parallel, so 15s left no real margin and
    // schema-hygiene started timing out on a query that isn't slow.
    testTimeout: 45_000,
  },
});
