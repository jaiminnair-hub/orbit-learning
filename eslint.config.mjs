import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Security-audit finding (2026-09-16): createAdminClient() bypasses RLS —
// every existing call site (42 as of the audit) was checked and found to
// carry a justifying comment, by convention rather than enforcement. This
// rule makes the convention self-enforcing rather than relying on every
// future reviewer to remember to ask "why service-role here?" on every PR.
const localRules = {
  rules: {
    "require-admin-client-comment": {
      create(context) {
        const sourceCode = context.sourceCode;
        return {
          CallExpression(node) {
            const callee = node.callee;
            const name =
              callee.type === "Identifier"
                ? callee.name
                : callee.type === "MemberExpression" && callee.property.type === "Identifier"
                  ? callee.property.name
                  : null;
            if (name !== "createAdminClient") return;
            const line = node.loc.start.line;
            const justified = sourceCode
              .getAllComments()
              .some((c) => c.loc.end.line === line || c.loc.end.line === line - 1);
            if (!justified) {
              context.report({
                node,
                message:
                  "createAdminClient() bypasses RLS — add a comment on this line or the one above explaining why service-role access is needed here (see lib/supabase/admin.ts).",
              });
            }
          },
        };
      },
    },
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  { plugins: { local: localRules }, rules: { "local/require-admin-client-comment": "warn" } },
  globalIgnores([
    ".next/**",
    // Alternate build outputs the QA runner produces (docs reference these
    // as .next-qa*) -- same class of miss as apps/** below: an un-ignored
    // build dir gets linted as source and floods the report with noise
    // from generated/minified files, which is what happened here.
    ".next-qa/**",
    ".next-qa-debug/**",
    ".next-qa-background/**",
    ".open-next/**",
    ".wrangler/**",
    // Standalone workers under spikes/ have their own build dirs and
    // wrangler-generated runtime declarations; both are artifacts, not source.
    "spikes/**/.wrangler/**",
    "spikes/**/worker-configuration.d.ts",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "cloudflare-env.d.ts",
    "supabase/.temp/**",
    "supabase/.branches/**",
    // apps/scorm-content is a second, independently deployed Next.js app
    // (docs/SCORM_CONTENT_ISOLATION_ARCHITECTURE.md) with its own
    // node_modules and .next build output — a bare ".next/**" here only
    // matches the root build dir, not a nested one, which is how its
    // compiled Turbopack output ended up linted as source the first time
    // this config ran after that app existed.
    "apps/**",
  ]),
]);

export default eslintConfig;
