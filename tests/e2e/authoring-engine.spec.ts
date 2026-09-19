import { test, expect, request as pwRequest } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Meta } from "./global-setup";
import { createLocalAdminClient } from "./local-supabase-admin";

// Phase 3 step 6 — the visual authoring engine.
//
// The point of this file is the loop the whole phase exists to close: an
// author builds a course in the editor, and the runtime plays exactly what
// they built. Steps 1-5 could each be verified in isolation; this is the
// first test where authoring and playback have to agree.
const AUTH_DIR = path.join(__dirname, ".auth");
const meta = JSON.parse(readFileSync(path.join(AUTH_DIR, "meta.json"), "utf-8")) as Meta;

let cachedDb: ReturnType<typeof createLocalAdminClient> | null = null;
function dbClient() {
  if (!cachedDb) cachedDb = createLocalAdminClient();
  return cachedDb;
}

async function apiAs(key: keyof Meta["users"]) {
  return pwRequest.newContext({ baseURL: "http://localhost:3000", storageState: path.join(AUTH_DIR, `${key}.json`) });
}

test("an author builds a course in the editor and the runtime plays what they built", async ({ browser }) => {
  const suffix = Date.now();
  const context = await browser.newContext({
    baseURL: "http://localhost:3000",
    storageState: path.join(AUTH_DIR, "org_admin.json"),
  });
  const page = await context.newPage();

  // --- create ---
  await page.goto("/admin/authoring");
  await page.getByPlaceholder("Course title").fill(`Editor Course ${suffix}`);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(/\/admin\/authoring\/[0-9a-f-]{36}/);
  const specId = page.url().split("/").pop()!;

  // A blank course opens on a real page with real starter blocks, not an
  // empty shell the author has to decode.
  await expect(page.getByRole("button", { name: "Page 1" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit Heading block" })).toBeVisible();

  /**
   * Waits for the edit to actually reach the server, not for a label.
   *
   * Asserting on "All changes saved" only works for the *first* edit. After
   * that the indicator already reads "All changes saved" from the previous
   * save, so the assertion passes instantly and the test races ahead to read
   * a database that has not been written yet. That is the same mistake the
   * runtime suite's autosave test was written to avoid, and it produced a
   * genuinely confusing failure: the editor showed the right thing and the
   * stored document did not have it.
   */
  async function savedAfter(action: () => Promise<void>) {
    const written = page.waitForResponse(
      (r) =>
        r.url().includes(`/api/v1/authoring/specs/${specId}`) &&
        ["PATCH", "POST"].includes(r.request().method()) &&
        r.status() === 200
    );
    await action();
    await written;
  }

  // --- edit the heading through the inspector ---
  await page.getByRole("button", { name: "Edit Heading block" }).click();
  await savedAfter(async () => {
    await page.getByLabel("Heading text").fill(`Fire safety ${suffix}`);
  });

  // --- add a quiz block ---
  await page.getByText("+ Add a block").click();
  await savedAfter(async () => {
    await page.getByRole("button", { name: "Quiz", exact: true }).click();
  });

  // --- point course completion at that quiz ---
  // "Page" tab now (Phase 3B authoring UI clarity pass) -- course-level
  // settings live there alongside page-level ones, not under a separate
  // "course" tab.
  await page.getByRole("button", { name: "Page", exact: true }).click();
  await savedAfter(async () => {
    await page.getByLabel("Course is complete when").selectOption("passedQuiz");
  });
  await expect(page.getByText("All changes saved")).toBeVisible();

  // --- the document on the server is what the editor showed ---
  const stored = await dbClient()
    .from("course_specifications")
    .select("spec, status")
    .eq("id", specId)
    .single();
  const spec = stored.data!.spec as {
    meta: { title: string };
    completion: { rule: string; quizBlockId: string };
    sections: { pages: { blocks: { id: string; type: string; text?: string }[] }[] }[];
  };
  const blocks = spec.sections[0].pages[0].blocks;
  expect(blocks.find((b) => b.type === "heading")?.text).toBe(`Fire safety ${suffix}`);
  const quizBlock = blocks.find((b) => b.type === "quiz");
  expect(quizBlock).toBeDefined();
  expect(spec.completion.rule).toBe("passedQuiz");
  // Choosing "passed a quiz" wires the rule to the quiz actually on the page,
  // rather than leaving a dangling reference the publish gate would reject.
  expect(spec.completion.quizBlockId).toBe(quizBlock!.id);

  // --- preview runs the real runtime against the draft ---
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByRole("heading", { name: `Fire safety ${suffix}` })).toBeVisible();
  await expect(page.getByText("Ask your question here.")).toBeVisible();
  await page.getByRole("button", { name: "Back to editing" }).click();

  // --- publish through the real workflow ---
  await page.getByRole("button", { name: "Send for review" }).click();
  await expect(page.getByText(/review · v/)).toBeVisible();
  await page.getByRole("button", { name: "Send for approval" }).click();
  await expect(page.getByText(/approval · v/)).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText(/published · v2/)).toBeVisible();

  // Published means read-only, and the editor says so rather than silently
  // dropping edits.
  await expect(page.getByText(/Published courses are read-only/)).toBeVisible();

  await context.close();

  // --- a snapshot was written, which is what pins in-progress learners ---
  const versions = await dbClient()
    .from("content_versions")
    .select("version_number, entity_type")
    .eq("entity_id", specId)
    .eq("entity_type", "course_specification");
  expect(versions.data!.length).toBeGreaterThan(0);

  // --- and the review trail recorded the transitions ---
  const reviews = await dbClient()
    .from("content_reviews")
    .select("decision")
    .eq("content_id", specId)
    .eq("content_type", "course_specification");
  expect(reviews.data!.map((r) => r.decision)).toContain("published");
});

test("a rejected edit is refused with its findings and never reaches the database", async () => {
  const api = await apiAs("org_admin");
  const created = await api.post("/api/v1/authoring/specs", { data: { title: `Invalid edit ${Date.now()}` } });
  expect(created.status()).toBe(201);
  const specId = (await created.json()).data.spec.id;

  const before = await api.get(`/api/v1/authoring/specs/${specId}`);
  const baseUpdatedAt = (await before.json()).data.spec.updated_at;

  // A heading level of 99 is outside the schema's 1-6 range.
  const res = await api.patch(`/api/v1/authoring/specs/${specId}`, {
    data: {
      baseUpdatedAt,
      patch: [{ op: "replace", path: "/sections/0/pages/0/blocks/0/level", value: 99 }],
    },
  });
  expect(res.status()).toBe(422);
  const body = await res.json();
  expect(body.error.code).toBe("INVALID_SPEC");
  expect(body.error.details.findings.length).toBeGreaterThan(0);

  // The stored document is untouched — validate-then-write, not write-then-regret.
  const after = await api.get(`/api/v1/authoring/specs/${specId}`);
  const spec = (await after.json()).data.spec;
  expect(spec.spec.sections[0].pages[0].blocks[0].level).not.toBe(99);
  expect(spec.updated_at).toBe(baseUpdatedAt);

  await api.dispose();
});

test("two authors saving from the same revision do not silently overwrite each other", async () => {
  const api = await apiAs("org_admin");
  const created = await api.post("/api/v1/authoring/specs", { data: { title: `Concurrent ${Date.now()}` } });
  const specId = (await created.json()).data.spec.id;

  const loaded = await api.get(`/api/v1/authoring/specs/${specId}`);
  const baseUpdatedAt = (await loaded.json()).data.spec.updated_at;

  const first = await api.patch(`/api/v1/authoring/specs/${specId}`, {
    data: { baseUpdatedAt, patch: [{ op: "replace", path: "/meta/title", value: "First writer wins" }] },
  });
  expect(first.status()).toBe(200);

  // The second author still holds the stale revision token.
  const second = await api.patch(`/api/v1/authoring/specs/${specId}`, {
    data: { baseUpdatedAt, patch: [{ op: "replace", path: "/meta/title", value: "Second writer clobbers" }] },
  });
  expect(second.status()).toBe(409);
  expect((await second.json()).error.code).toBe("CONFLICT");

  const after = await api.get(`/api/v1/authoring/specs/${specId}`);
  expect((await after.json()).data.spec.spec.meta.title).toBe("First writer wins");

  await api.dispose();
});

test("publishing is refused while the course has validation errors", async () => {
  const db = dbClient();
  // A spec whose completion rule points at a quiz that does not exist: valid
  // JSON, valid block shapes, and semantically broken — exactly the class the
  // publish gate is for.
  const { data: row } = await db
    .from("course_specifications")
    .insert({
      org_id: meta.org.id,
      title: `Broken ${Date.now()}`,
      spec_schema_version: "1.0.0",
      status: "approval",
      spec: {
        specSchemaVersion: "1.0.0",
        meta: { title: "Broken", locale: "en" },
        completion: { rule: "passedQuiz", quizBlockId: "no-such-quiz" },
        sections: [{ id: "s1", title: "S", pages: [{ id: "p1", title: "P", blocks: [] }] }],
      },
    })
    .select("id")
    .single();

  const api = await apiAs("org_admin");
  const res = await api.post(`/api/v1/authoring/specs/${row!.id}/publish`, { data: { status: "published" } });
  expect(res.status()).toBe(422);
  const body = await res.json();
  expect(body.error.code).toBe("NOT_PUBLISHABLE");
  expect(body.error.details.findings.length).toBeGreaterThan(0);

  // Still not published, and the refusal was recorded for the author to read.
  const after = await db.from("course_specifications").select("status").eq("id", row!.id).single();
  expect(after.data!.status).toBe("approval");

  const reports = await db
    .from("spec_validation_reports")
    .select("kind, severity")
    .eq("course_specification_id", row!.id);
  expect(reports.data!.length).toBeGreaterThan(0);
  expect(reports.data![0].severity).toBe("error");

  await api.dispose();
});

test("the authoring API is closed to learners and to other organizations", async () => {
  const db = dbClient();
  const { data: row } = await db
    .from("course_specifications")
    .insert({
      org_id: meta.org.id,
      title: `Private ${Date.now()}`,
      spec_schema_version: "1.0.0",
      spec: { specSchemaVersion: "1.0.0", meta: { title: "Private", locale: "en" }, sections: [] },
    })
    .select("id")
    .single();

  // A learner has no authoring surface at all.
  const learner = await apiAs("learner");
  expect((await learner.get("/api/v1/authoring/specs")).status()).toBe(403);
  expect((await learner.get(`/api/v1/authoring/specs/${row!.id}`)).status()).toBe(403);
  expect((await learner.post("/api/v1/authoring/specs", { data: { title: "nope" } })).status()).toBe(403);
  await learner.dispose();

  // Another org's admin has the role but not the row.
  const other = await apiAs("otherOrgOwner");
  expect((await other.get(`/api/v1/authoring/specs/${row!.id}`)).status()).toBe(404);
  const patch = await other.patch(`/api/v1/authoring/specs/${row!.id}`, {
    data: { baseUpdatedAt: new Date().toISOString(), patch: [{ op: "replace", path: "/meta/title", value: "stolen" }] },
  });
  expect(patch.status()).toBe(404);

  const listed = await other.get("/api/v1/authoring/specs");
  expect(listed.status()).toBe(200);
  const ids = (await listed.json()).data.specs.map((s: { id: string }) => s.id);
  expect(ids).not.toContain(row!.id);
  await other.dispose();
});

test("a saved block can be reused from the component library", async () => {
  const api = await apiAs("org_admin");
  const suffix = Date.now();

  const created = await api.post("/api/v1/authoring/components", {
    data: {
      name: `Safety callout ${suffix}`,
      category: "callouts",
      definition: {
        id: "reusable-callout",
        type: "statement",
        emphasis: "warning",
        content: { blocks: [{ kind: "paragraph", spans: [{ text: "Always check the exits." }] }] },
      },
    },
  });
  expect(created.status()).toBe(201);
  const componentId = (await created.json()).data.component.id;

  // The library refuses something that is not a valid block, rather than
  // storing it for the editor to choke on later.
  const bad = await api.post("/api/v1/authoring/components", {
    data: { name: "Nonsense", definition: { type: "notARealBlockType" } },
  });
  expect(bad.status()).toBe(422);
  expect((await bad.json()).error.code).toBe("INVALID_DEFINITION");

  const listed = await api.get("/api/v1/authoring/components");
  const names = (await listed.json()).data.components.map((c: { name: string }) => c.name);
  expect(names).toContain(`Safety callout ${suffix}`);

  const published = await api.post(`/api/v1/authoring/components/${componentId}/publish`, {
    data: { status: "review" },
  });
  expect(published.status()).toBe(200);

  await api.dispose();
});

test("a course can be saved as a template and used to start a new one", async () => {
  const api = await apiAs("org_admin");
  const suffix = Date.now();

  const source = await api.post("/api/v1/authoring/specs", { data: { title: `Template source ${suffix}` } });
  const sourceId = (await source.json()).data.spec.id;

  const template = await api.post("/api/v1/authoring/templates", {
    data: { name: `Onboarding shape ${suffix}`, fromSpecId: sourceId },
  });
  expect(template.status()).toBe(201);
  const templateId = (await template.json()).data.template.id;

  const fromTemplate = await api.post("/api/v1/authoring/specs", {
    data: { title: `Made from template ${suffix}`, templateId },
  });
  expect(fromTemplate.status()).toBe(201);
  const newSpecId = (await fromTemplate.json()).data.spec.id;

  // The copy carries the template's structure but its own title.
  const loaded = await api.get(`/api/v1/authoring/specs/${newSpecId}`);
  const spec = (await loaded.json()).data.spec;
  expect(spec.spec.meta.title).toBe(`Made from template ${suffix}`);
  expect(spec.spec.sections.length).toBeGreaterThan(0);

  await api.dispose();
});
