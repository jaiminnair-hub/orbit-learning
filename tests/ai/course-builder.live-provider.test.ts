import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The one test in this repo that makes a real, billed call to a real AI
 * provider. Self-gating: it only runs when `isCourseBuilderConfigured()` is
 * true (a real key is present), so `vitest run` in CI or on a machine with
 * no key configured skips this file harmlessly rather than failing or
 * spending money it has no key to spend. This is deliberately kept in the
 * suite rather than thrown away after one manual run, so "does the real
 * provider still work" is answerable by running tests, not by re-deriving a
 * one-off script — per the project's own rule that real-provider
 * verification must not be claimed without a real call actually run.
 *
 * DB writes still go through the disposable local Postgres instance (the
 * same seeding pattern every other integration test uses) — only the
 * generation call itself leaves the machine, to the real AICredits API.
 * `logAiUsage` is mocked for the same reason tests/ai/gateway.test.ts and
 * tests/ai/course-builder.test.ts already mock it: it writes through the
 * *app's* own admin client (lib/supabase/admin.ts, configured from
 * .env.local), which in this environment points at a real, shared hosted
 * Supabase project this test suite has no business writing into.
 */
vi.mock("@/lib/ai/usage", () => ({
  logAiUsage: async () => {},
  monthToDateSpendUsd: async () => 0,
}));

const { runCourseBuilderJob, isCourseBuilderConfigured } = await import("@/lib/ai/course-builder");
const { seedOrgWithUser, cleanupOrg, adminClient } = await import("../setup/seed");
import type { SeededOrg } from "../setup/seed";

const SOURCE_TEXT =
  "Fire safety in the workplace starts with knowing your exits. Every employee should know the location of at " +
  "least two evacuation routes, the assembly point outside the building, and how to operate a fire extinguisher " +
  "on a small, contained fire. Never re-enter a building once an alarm has sounded.";

describe.runIf(isCourseBuilderConfigured())("AI Course Builder Lite — real provider", () => {
  let org: SeededOrg;

  beforeAll(async () => {
    org = await seedOrgWithUser("live-provider");
  }, 30_000);

  afterAll(async () => {
    await cleanupOrg(org);
  });

  it(
    "generates a real draft course from real source text through the configured provider",
    async () => {
      const { data: job, error } = await adminClient
        .from("authoring_jobs")
        .insert({ org_id: org.orgId, kind: "generate_course", status: "queued", created_by: org.userId })
        .select("id")
        .single();
      expect(error).toBeNull();

      await runCourseBuilderJob(adminClient, {
        orgId: org.orgId,
        userId: org.userId,
        jobId: job!.id,
        sourceText: SOURCE_TEXT,
      });

      const { data: finishedJob } = await adminClient
        .from("authoring_jobs")
        .select("*")
        .eq("id", job!.id)
        .single();

      expect(finishedJob!.status, `job failed: ${finishedJob?.error}`).toBe("succeeded");
      expect(finishedJob!.output?.specId).toBeTruthy();

      const { data: spec } = await adminClient
        .from("course_specifications")
        .select("*")
        .eq("id", finishedJob!.output.specId)
        .single();

      expect(spec!.status).toBe("draft");
      expect(spec!.source_kind).toBe("prompt");
      expect(spec!.title.length).toBeGreaterThan(0);

      const document = spec!.spec as {
        objectives: unknown[];
        sections: Array<{ pages: Array<{ blocks: unknown[] }> }>;
      };
      expect(document.objectives.length).toBeGreaterThan(0);
      expect(document.sections[0].pages[0].blocks.length).toBeGreaterThan(0);
    },
    60_000
  );
});
