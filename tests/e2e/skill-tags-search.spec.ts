import { test, expect, request as pwRequest } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Meta } from "./global-setup";
import { createLocalAdminClient } from "./local-supabase-admin";

/**
 * Phase 3 step 11 — LMS skill tagging and search.
 *
 * The claim worth proving end to end: a course is now findable by words an
 * author wrote *inside* it, not merely by its title. Step 4 shipped
 * title-only indexing with the body deferred; this is where that lands.
 */
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

test("skill tags are org-scoped, uniquely named, and editable", async () => {
  const api = await apiAs("org_admin");
  const name = `Extinguisher handling ${Date.now()}`;

  const created = await api.post("/api/v1/authoring/skill-tags", {
    data: { name, description: "Selecting and using the right extinguisher" },
  });
  expect(created.status()).toBe(201);
  const tag = (await created.json()).data.skillTag;
  expect(tag.name).toBe(name);

  // unique (org_id, name) surfaces as an ordinary authoring mistake.
  const duplicate = await api.post("/api/v1/authoring/skill-tags", { data: { name } });
  expect(duplicate.status()).toBe(409);
  expect((await duplicate.json()).error.code).toBe("ALREADY_EXISTS");

  const renamed = await api.patch(`/api/v1/authoring/skill-tags/${tag.id}`, {
    data: { name: `${name} (revised)` },
  });
  expect(renamed.status()).toBe(200);

  const listed = await api.get(`/api/v1/authoring/skill-tags?q=Extinguisher`);
  expect(listed.status()).toBe(200);
  const names = (await listed.json()).data.skillTags.map((t: { name: string }) => t.name);
  expect(names).toContain(`${name} (revised)`);

  await api.dispose();
});

test("skill tags never cross the organization boundary", async () => {
  const { data: foreign } = await dbClient()
    .from("skill_tags")
    .insert({ org_id: meta.otherOrg.id, name: `Other org skill ${Date.now()}` })
    .select("id, name")
    .single();

  const api = await apiAs("org_admin");

  const listed = await api.get("/api/v1/authoring/skill-tags");
  const ids = (await listed.json()).data.skillTags.map((t: { id: string }) => t.id);
  expect(ids).not.toContain(foreign!.id);

  expect((await api.patch(`/api/v1/authoring/skill-tags/${foreign!.id}`, { data: { name: "stolen" } })).status()).toBe(404);
  expect((await api.delete(`/api/v1/authoring/skill-tags/${foreign!.id}`)).status()).toBe(404);

  await api.dispose();
});

test("a learner has no skill-tag surface", async () => {
  const learner = await apiAs("learner");
  expect((await learner.get("/api/v1/authoring/skill-tags")).status()).toBe(403);
  expect((await learner.post("/api/v1/authoring/skill-tags", { data: { name: "nope" } })).status()).toBe(403);
  await learner.dispose();
});

test("an authored course is findable by words written inside it, not just its title", async () => {
  const api = await apiAs("org_admin");
  // A term that appears nowhere in the title, so a title-only index cannot
  // match it. This is the exact gap step 4 deferred.
  const marker = `zylophone${Date.now()}`;

  const created = await api.post("/api/v1/authoring/specs", {
    data: { title: `Body search course ${Date.now()}` },
  });
  expect(created.status()).toBe(201);
  const specId = (await created.json()).data.spec.id;

  const loaded = await api.get(`/api/v1/authoring/specs/${specId}`);
  const baseUpdatedAt = (await loaded.json()).data.spec.updated_at;

  // Write the marker into a text block deep in the document.
  const patched = await api.patch(`/api/v1/authoring/specs/${specId}`, {
    data: {
      baseUpdatedAt,
      patch: [
        {
          op: "replace",
          path: "/sections/0/pages/0/blocks/1/content",
          value: { blocks: [{ kind: "paragraph", spans: [{ text: `Handling a ${marker} safely at work.` }] }] },
        },
      ],
    },
  });
  expect(patched.status()).toBe(200);

  // The generated column must now cover the body.
  const stored = await dbClient()
    .from("course_specifications")
    .select("search_text")
    .eq("id", specId)
    .single();
  expect(stored.data!.search_text).toContain(marker);

  const results = await api.get(`/api/v1/content/search?q=${marker}`);
  expect(results.status()).toBe(200);
  const specs = (await results.json()).data.specifications;
  expect(specs.map((s: { id: string }) => s.id)).toContain(specId);

  await api.dispose();
});

test("search does not become a side channel past RLS", async () => {
  const marker = `krypton${Date.now()}`;

  // A specification planted directly in the other org, with the marker in
  // both its title and its indexed body.
  const { data: foreign } = await dbClient()
    .from("course_specifications")
    .insert({
      org_id: meta.otherOrg.id,
      title: `Other org ${marker}`,
      spec: { specSchemaVersion: "1.0.0", meta: { title: `Other org ${marker}`, locale: "en" }, sections: [] },
      spec_schema_version: "1.0.0",
      search_text: `Other org ${marker} confidential body text`,
    })
    .select("id")
    .single();

  const api = await apiAs("org_admin");
  const results = await api.get(`/api/v1/content/search?q=${marker}`);
  const body = (await results.json()).data;

  expect(body.specifications.map((s: { id: string }) => s.id)).not.toContain(foreign!.id);
  expect(body.specifications).toHaveLength(0);

  await api.dispose();
});

test("a learner's search never returns authored specifications", async () => {
  const learner = await apiAs("learner");
  const results = await learner.get("/api/v1/content/search?q=course");
  expect(results.status()).toBe(200);
  // Authored specifications are an authoring surface; the learner-scoped
  // response carries the key so clients need no special case, but empty.
  expect((await results.json()).data.specifications).toHaveLength(0);
  await learner.dispose();
});
