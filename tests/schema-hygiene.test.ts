// Generic, catch-all check — independent of the tenant-isolation suite's
// per-table tests — fulfilling the specific promise in
// docs/DEFINITION_OF_DONE.md: "an automated check that fails CI if a new
// table lacks [RLS]." Runs against every table in `public`, so it covers
// tables added in later phases automatically, without needing anyone to
// remember to extend it.
import { describe, it, expect } from "vitest";
import { runSql } from "./setup/local-supabase";

describe("Schema hygiene", () => {
  it("every table in the public schema has row level security enabled", async () => {
    const rows = await runSql<{ table_name: string; rls_enabled: boolean }>(
      "select relname as table_name, relrowsecurity as rls_enabled from pg_class " +
        "where relnamespace = 'public'::regnamespace and relkind = 'r';"
    );

    expect(rows.length).toBeGreaterThan(0);
    const withoutRls = rows.filter((r) => !r.rls_enabled).map((r) => r.table_name);
    expect(withoutRls, `tables missing RLS: ${withoutRls.join(", ")}`).toEqual([]);
  });
});
