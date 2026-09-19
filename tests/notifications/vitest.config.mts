import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

// Pure notification tests use in-memory provider/database fakes and do not
// need the repository's Docker-backed Supabase global setup.
export default defineConfig({
  root: repositoryRoot,
  resolve: {
    alias: {
      "@": repositoryRoot,
    },
  },
  test: {
    include: ["tests/notifications/**/*.test.ts"],
  },
});
