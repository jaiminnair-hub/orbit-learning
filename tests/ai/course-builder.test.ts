import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// generateStructured's internal usage logging goes through
// lib/supabase/admin.ts's service-role client, which is the app's own
// runtime config rather than the test harness's local-supabase resolver
// (tests/setup/local-supabase.ts, shelling out to `npx supabase status`).
// Stubbed here for the same reason tests/ai/gateway.test.ts stubs it: these
// stay focused on course-builder orchestration and real Postgres persistence
// (via the test harness's own admin client, passed explicitly into
// runCourseBuilderJob), not on whether the app's runtime env is configured.
vi.mock("@/lib/ai/usage", () => ({
  logAiUsage: async () => {},
  monthToDateSpendUsd: async () => 0,
}));

const { registerAdapter } = await import("@/lib/ai/gateway");
const { runCourseBuilderJob, isCourseBuilderConfigured, MIN_SOURCE_TEXT_LENGTH } = await import(
  "@/lib/ai/course-builder"
);
import type { AdapterRequest, AdapterResponse, ProviderAdapter } from "@/lib/ai/types";
import { seedOrgWithUser, cleanupOrg, adminClient, type SeededOrg } from "../setup/seed";

/** A scripted adapter: each call shifts the next queued response. */
class ScriptedAdapter implements ProviderAdapter {
  readonly supportsNativeStructuredOutput = true;
  calls: AdapterRequest[] = [];

  constructor(
    readonly name: string,
    private script: Array<{ text: string }>,
    private configured = true
  ) {}

  isConfigured() {
    return this.configured;
  }

  async generate(request: AdapterRequest): Promise<AdapterResponse> {
    this.calls.push(request);
    const next = this.script.shift();
    if (!next) throw new Error("script exhausted");
    return { text: next.text, tokensIn: 100, tokensOut: 50 };
  }
}

const SOURCE_TEXT =
  "Fire safety in the workplace starts with knowing your exits. Every employee should know the location of at " +
  "least two evacuation routes, the assembly point outside the building, and how to operate a fire extinguisher " +
  "on a small, contained fire. Never re-enter a building once an alarm has sounded.";

function outlineResponse(overrides?: { sectionId?: string }) {
  return JSON.stringify({
    title: "Workplace Fire Safety",
    description: "An introduction to fire safety fundamentals for every employee.",
    sections: [
      {
        id: overrides?.sectionId ?? "sec-intro",
        title: "Introduction",
        pages: [
          { id: "page-exits", title: "Know your exits" },
          { id: "page-extinguishers", title: "Using an extinguisher" },
        ],
      },
    ],
  });
}

function objectivesResponse(overrides?: { objectiveId?: string }) {
  return JSON.stringify({
    objectives: [
      { id: overrides?.objectiveId ?? "obj-exits", text: "Identify at least two evacuation routes from your workspace." },
      { id: "obj-extinguisher", text: "Operate a fire extinguisher on a small, contained fire." },
    ],
  });
}

function pageBlocksResponse(overrides?: { headingId?: string }) {
  return JSON.stringify({
    blocks: [
      { id: overrides?.headingId ?? "block-heading", type: "heading", text: "Know your exits", level: 1 },
      {
        id: "block-body",
        type: "text",
        content: { blocks: [{ kind: "paragraph", spans: [{ text: "Every employee should know two evacuation routes." }] }] },
      },
    ],
  });
}

async function insertQueuedJob(orgId: string, userId: string, input: Record<string, unknown> = {}) {
  const { data, error } = await adminClient
    .from("authoring_jobs")
    .insert({ org_id: orgId, kind: "generate_course", status: "queued", input, created_by: userId })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

async function loadJob(jobId: string) {
  const { data, error } = await adminClient.from("authoring_jobs").select("*").eq("id", jobId).single();
  if (error) throw error;
  return data;
}

async function loadSpec(specId: string) {
  const { data, error } = await adminClient.from("course_specifications").select("*").eq("id", specId).single();
  if (error) throw error;
  return data;
}

describe("AI Course Builder Lite", () => {
  let org: SeededOrg;

  beforeAll(async () => {
    org = await seedOrgWithUser("course-builder");
  }, 30_000);

  afterAll(async () => {
    await cleanupOrg(org);
  });

  beforeEach(() => {
    // A real, unconfigured adapter by default — every test opts into
    // "configured" explicitly rather than depending on ambient env vars.
    registerAdapter("anthropic", new ScriptedAdapter("anthropic", [], false));
  });

  describe("provider not configured", () => {
    it("isCourseBuilderConfigured() reflects the registered adapter's real configuration", () => {
      expect(isCourseBuilderConfigured()).toBe(false);
      registerAdapter("anthropic", new ScriptedAdapter("anthropic", [{ text: outlineResponse() }], true));
      expect(isCourseBuilderConfigured()).toBe(true);
    });

    it("fails the job honestly and creates no course_specifications row, rather than silently using echo", async () => {
      const jobId = await insertQueuedJob(org.orgId, org.userId);

      await runCourseBuilderJob(adminClient, {
        orgId: org.orgId,
        userId: org.userId,
        jobId,
        sourceText: SOURCE_TEXT,
      });

      const job = await loadJob(jobId);
      expect(job.status).toBe("failed");
      expect(job.error).toContain("not configured");
      expect(job.output).toBeNull();

      const { data: specs } = await adminClient
        .from("course_specifications")
        .select("id")
        .eq("generated_by_job_id", jobId);
      expect(specs).toHaveLength(0);
    });
  });

  describe("successful generation", () => {
    it("runs outline, objectives and page-blocks as three narrow calls, then saves a draft spec", async () => {
      const adapter = new ScriptedAdapter(
        "anthropic",
        [{ text: outlineResponse() }, { text: objectivesResponse() }, { text: pageBlocksResponse() }],
        true
      );
      registerAdapter("anthropic", adapter);

      const jobId = await insertQueuedJob(org.orgId, org.userId, { titleHint: null });

      await runCourseBuilderJob(adminClient, {
        orgId: org.orgId,
        userId: org.userId,
        jobId,
        sourceText: SOURCE_TEXT,
      });

      // Three separate generateStructured calls — the schema for each is
      // strictly smaller than a whole document, per the narrow-schema
      // discipline the pipeline is built on.
      expect(adapter.calls).toHaveLength(3);

      const job = await loadJob(jobId);
      expect(job.status).toBe("succeeded");
      expect(job.error).toBeNull();
      expect(job.output.specId).toBeTruthy();

      const stepNames = (job.steps as Array<{ name: string; status: string }>).map((s) => s.name);
      expect(stepNames).toEqual(["outline", "objectives", "page_blocks", "validate", "save"]);
      expect((job.steps as Array<{ status: string }>).every((s) => s.status === "succeeded")).toBe(true);

      const spec = await loadSpec(job.output.specId);

      // Draft-only: nothing generated is ever auto-published.
      expect(spec.status).toBe("draft");
      expect(spec.source_kind).toBe("prompt");
      // Job/log correlation: the row records exactly which job produced it.
      expect(spec.generated_by_job_id).toBe(jobId);
      expect(spec.org_id).toBe(org.orgId);
      expect(spec.title).toBe("Workplace Fire Safety");

      const document = spec.spec as {
        meta: { title: string; description?: unknown };
        objectives: Array<{ text: string }>;
        sections: Array<{ pages: Array<{ blocks: unknown[] }> }>;
      };

      // Requirement 1 — title and short description.
      expect(document.meta.title).toBe("Workplace Fire Safety");
      expect(document.meta.description).toBeTruthy();
      // Requirement 2 — module/lesson outline (both pages from the outline exist).
      expect(document.sections[0].pages).toHaveLength(2);
      // Requirement 3 — learning objectives.
      expect(document.objectives.length).toBeGreaterThan(0);
      // Requirement 4 — one generated lesson with valid blocks; the rest of
      // the outline is real, structured, and empty — an author's starting
      // point, not a second generated page this slice never promised.
      expect(document.sections[0].pages[0].blocks.length).toBeGreaterThan(0);
      expect(document.sections[0].pages[1].blocks).toHaveLength(0);
    });

    it("prefers an explicit working title over the model's own title", async () => {
      registerAdapter(
        "anthropic",
        new ScriptedAdapter(
          "anthropic",
          [{ text: outlineResponse() }, { text: objectivesResponse() }, { text: pageBlocksResponse() }],
          true
        )
      );

      const jobId = await insertQueuedJob(org.orgId, org.userId);
      await runCourseBuilderJob(adminClient, {
        orgId: org.orgId,
        userId: org.userId,
        jobId,
        sourceText: SOURCE_TEXT,
        titleHint: "Fire Drill Onboarding",
      });

      const job = await loadJob(jobId);
      const spec = await loadSpec(job.output.specId);
      expect(spec.title).toBe("Fire Drill Onboarding");
    });
  });

  describe("validation failure", () => {
    it("does not persist a spec whose assembled document has a real validation error", async () => {
      // The page-blocks step reuses one of the outline's own page ids as a
      // block id — each individual generation call is schema-valid on its
      // own narrow contract (ids are well-formed slugs either way), but the
      // *assembled* document has a real duplicate id once combined: pages
      // and blocks share one global id namespace (lib/spec/validate.ts), so
      // this is exactly the class of error no single narrow schema could
      // catch on its own, and the assembly gate does.
      registerAdapter(
        "anthropic",
        new ScriptedAdapter(
          "anthropic",
          [
            { text: outlineResponse() },
            { text: objectivesResponse() },
            { text: pageBlocksResponse({ headingId: "page-exits" }) },
          ],
          true
        )
      );

      const jobId = await insertQueuedJob(org.orgId, org.userId);
      await runCourseBuilderJob(adminClient, {
        orgId: org.orgId,
        userId: org.userId,
        jobId,
        sourceText: SOURCE_TEXT,
      });

      const job = await loadJob(jobId);
      expect(job.status).toBe("failed");
      expect(job.output).toBeNull();
      expect(job.error).toContain("did not pass validation");

      const { data: specs } = await adminClient
        .from("course_specifications")
        .select("id")
        .eq("generated_by_job_id", jobId);
      expect(specs).toHaveLength(0);
    });
  });

  describe("organisation isolation", () => {
    it("scopes the generated draft to the requesting organisation only", async () => {
      const otherOrg = await seedOrgWithUser("course-builder-other");
      try {
        registerAdapter(
          "anthropic",
          new ScriptedAdapter(
            "anthropic",
            [{ text: outlineResponse() }, { text: objectivesResponse() }, { text: pageBlocksResponse() }],
            true
          )
        );

        const jobId = await insertQueuedJob(org.orgId, org.userId);
        await runCourseBuilderJob(adminClient, {
          orgId: org.orgId,
          userId: org.userId,
          jobId,
          sourceText: SOURCE_TEXT,
        });

        const job = await loadJob(jobId);
        expect(job.status).toBe("succeeded");

        // The requesting org's own authenticated client sees it...
        const { data: ownRead } = await org.client
          .from("course_specifications")
          .select("id")
          .eq("id", job.output.specId);
        expect(ownRead).toHaveLength(1);

        // ...a different org's authenticated client, under RLS, does not.
        const { data: crossOrgRead, error: crossOrgError } = await otherOrg.client
          .from("course_specifications")
          .select("id")
          .eq("id", job.output.specId);
        expect(crossOrgError).toBeNull();
        expect(crossOrgRead).toHaveLength(0);

        const spec = await loadSpec(job.output.specId);
        expect(spec.org_id).toBe(org.orgId);
        expect(spec.org_id).not.toBe(otherOrg.orgId);
      } finally {
        await cleanupOrg(otherOrg);
      }
    });
  });

  it("MIN_SOURCE_TEXT_LENGTH is a real, small floor — not zero", () => {
    expect(MIN_SOURCE_TEXT_LENGTH).toBeGreaterThan(0);
    expect(MIN_SOURCE_TEXT_LENGTH).toBeLessThan(200);
  });
});
