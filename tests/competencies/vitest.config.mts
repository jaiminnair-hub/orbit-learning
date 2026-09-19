import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

// Recommendation ranking is pure application logic; keep this focused test
// independent from the repository's Docker-backed Supabase global setup.
export default defineConfig({
  root: repositoryRoot,
  resolve: { alias: { "@": repositoryRoot } },
  test: { include: ["tests/competencies/**/*.test.ts"] },
});
