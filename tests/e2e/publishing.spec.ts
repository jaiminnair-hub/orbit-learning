import { test, expect, request as pwRequest } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Meta } from "./global-setup";
import { createLocalAdminClient } from "./local-supabase-admin";

// Phase 3 step 9 — the publishing pipeline.
//
// The claim: a published course becomes a real zip in the private bucket that
// only its own org can download. Step 3 already proved the *package format* is
// accepted by a real third-party LMS; this proves the *pipeline* that produces
// one from authored content.
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

function spec(label: string) {
  return {
    specSchemaVersion: "1.0.0",
    meta: { title: `Packaged course ${label}`, locale: "en" },
    completion: { rule: "passedQuiz", quizBlockId: "quiz1" },
    sections: [
      {
        id: "s1",
        title: "Section 1",
        pages: [
          {
            id: "page1",
            title: "Intro",
            blocks: [
              { id: "h1", type: "heading", text: `Packaged heading ${label}`, level: 1 },
              { id: "t1", type: "text", content: { blocks: [{ kind: "paragraph", spans: [{ text: "Exported body copy." }] }] } },
            ],
          },
          {
            id: "page2",
            title: "Check",
            blocks: [
              {
                id: "quiz1",
                type: "quiz",
                passingScorePercent: 100,
                items: [
                  {
                    id: "q1",
                    kind: "trueFalse",
                    prompt: { blocks: [{ kind: "paragraph", spans: [{ text: "Is this exported?" }] }] },
                    answer: true,
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

async function seedPublishedSpec(label: string) {
  const { data, error } = await dbClient()
    .from("course_specifications")
    .insert({
      org_id: meta.org.id,
      title: `Packaged course ${label}`,
      spec: spec(label),
      spec_schema_version: "1.0.0",
      status: "published",
      version: 2,
    })
    .select("id, version")
    .single();
  if (error) throw error;
  return data!;
}

/** Polls the job until it leaves the queued/running states. */
async function awaitJob(api: Awaited<ReturnType<typeof apiAs>>, jobId: string) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const res = await api.get(`/api/v1/publishing/jobs/${jobId}`);
    const job = (await res.json()).data.job;
    if (job.status !== "queued" && job.status !== "running") return job;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Package job never finished");
}

test("a published course builds into a downloadable SCORM 2004 package", async () => {
  const seeded = await seedPublishedSpec(`scorm-${Date.now()}`);
  const api = await apiAs("org_admin");

  const start = await api.post("/api/v1/publishing/packages", {
    data: { specId: seeded.id, format: "scorm2004" },
  });
  // Accepted, not completed — the build runs after the response.
  expect(start.status()).toBe(202);
  const jobId = (await start.json()).data.job.id;

  const job = await awaitJob(api, jobId);
  expect(job.status, JSON.stringify(job.error)).toBe("succeeded");
  expect(job.output.packageId).toBeTruthy();
  expect(job.output.fileSize).toBeGreaterThan(0);

  // The row records which spec version produced it — the provenance the
  // published_packages table exists for.
  const { data: pkg } = await dbClient()
    .from("published_packages")
    .select("id, org_id, format, spec_version, storage_path, file_size, manifest")
    .eq("id", job.output.packageId)
    .single();
  expect(pkg!.format).toBe("scorm2004");
  expect(pkg!.spec_version).toBe(seeded.version);
  expect(pkg!.storage_path.startsWith(`${meta.org.id}/`)).toBe(true);
  expect(pkg!.manifest.pageCount).toBe(2);
  expect(pkg!.manifest.quizBlockIds).toEqual(["quiz1"]);

  // And the bytes genuinely landed in the private bucket.
  const { data: files } = await dbClient().storage
    .from("published-packages")
    .list(`${meta.org.id}/${seeded.id}`);
  expect((files ?? []).length).toBeGreaterThan(0);

  const download = await api.get(`/api/v1/publishing/packages/${job.output.packageId}/download`);
  expect(download.status()).toBe(200);
  const body = (await download.json()).data;
  expect(body.url).toContain("published-packages");
  expect(body.fileSize).toBeGreaterThan(0);

  await api.dispose();
});

test("the same course also builds as SCORM 1.2", async () => {
  const seeded = await seedPublishedSpec(`scorm12-${Date.now()}`);
  const api = await apiAs("org_admin");

  const start = await api.post("/api/v1/publishing/packages", {
    data: { specId: seeded.id, format: "scorm12" },
  });
  expect(start.status()).toBe(202);
  const job = await awaitJob(api, (await start.json()).data.job.id);

  expect(job.status, JSON.stringify(job.error)).toBe("succeeded");
  const { data: pkg } = await dbClient()
    .from("published_packages")
    .select("format, manifest")
    .eq("id", job.output.packageId)
    .single();
  expect(pkg!.format).toBe("scorm12");
  expect(pkg!.manifest.pageCount).toBe(2);

  await api.dispose();
});

test("the same course also builds as cmi5", async () => {
  const seeded = await seedPublishedSpec(`cmi5-${Date.now()}`);
  const api = await apiAs("org_admin");

  const start = await api.post("/api/v1/publishing/packages", {
    data: { specId: seeded.id, format: "cmi5" },
  });
  expect(start.status()).toBe(202);
  const job = await awaitJob(api, (await start.json()).data.job.id);

  expect(job.status, JSON.stringify(job.error)).toBe("succeeded");
  const { data: pkg } = await dbClient()
    .from("published_packages")
    .select("format")
    .eq("id", job.output.packageId)
    .single();
  expect(pkg!.format).toBe("cmi5");

  await api.dispose();
});

test("the same course also builds as an xAPI (Tin Can) package", async () => {
  const seeded = await seedPublishedSpec(`xapi-${Date.now()}`);
  const api = await apiAs("org_admin");

  const start = await api.post("/api/v1/publishing/packages", {
    data: { specId: seeded.id, format: "xapi" },
  });
  expect(start.status()).toBe(202);
  const job = await awaitJob(api, (await start.json()).data.job.id);

  expect(job.status, JSON.stringify(job.error)).toBe("succeeded");
  const { data: pkg } = await dbClient()
    .from("published_packages")
    .select("format, manifest")
    .eq("id", job.output.packageId)
    .single();
  expect(pkg!.format).toBe("xapi");
  expect(pkg!.manifest.pageCount).toBe(2);

  await api.dispose();
});

test("an unpublished course is refused rather than packaged", async () => {
  const { data: draft } = await dbClient()
    .from("course_specifications")
    .insert({
      org_id: meta.org.id,
      title: `Draft ${Date.now()}`,
      spec: spec("draft"),
      spec_schema_version: "1.0.0",
      status: "draft",
    })
    .select("id")
    .single();

  const api = await apiAs("org_admin");
  const res = await api.post("/api/v1/publishing/packages", {
    data: { specId: draft!.id, format: "scorm2004" },
  });
  // Exporting a draft would put unreviewed content into someone else's LMS,
  // where our workflow gate no longer applies.
  expect(res.status()).toBe(409);
  expect((await res.json()).error.code).toBe("NOT_PUBLISHED");

  await api.dispose();
});

test("an unsupported format value is rejected cleanly, rather than failing obscurely", async () => {
  const seeded = await seedPublishedSpec(`fmt-${Date.now()}`);
  const api = await apiAs("org_admin");

  // UNIMPLEMENTED_FORMATS is empty now that xapi shipped (all four package
  // formats are built) — "aicc" is a real, meaningful bogus value here: it
  // was a genuine format this product removed entirely (2026-09-03), not an
  // arbitrary made-up string.
  const res = await api.post("/api/v1/publishing/packages", {
    data: { specId: seeded.id, format: "aicc" },
  });
  expect(res.status()).toBe(400);
  expect((await res.json()).error.message).toContain("format must be one of");

  await api.dispose();
});

test("packages never cross the organization boundary, including the signed download", async () => {
  const seeded = await seedPublishedSpec(`iso-${Date.now()}`);
  const owner = await apiAs("org_admin");
  const start = await owner.post("/api/v1/publishing/packages", {
    data: { specId: seeded.id, format: "scorm2004" },
  });
  const job = await awaitJob(owner, (await start.json()).data.job.id);
  expect(job.status).toBe("succeeded");
  await owner.dispose();

  const other = await apiAs("otherOrgOwner");

  // The specific leak PHASE3_DATA_MODEL.md §7 flagged: a signed URL must
  // never be issuable for another org's package.
  expect((await other.get(`/api/v1/publishing/packages/${job.output.packageId}/download`)).status()).toBe(404);
  expect((await other.get(`/api/v1/publishing/jobs/${job.id}`)).status()).toBe(404);

  const listed = await other.get("/api/v1/publishing/packages");
  expect(listed.status()).toBe(200);
  const ids = (await listed.json()).data.packages.map((p: { id: string }) => p.id);
  expect(ids).not.toContain(job.output.packageId);

  await other.dispose();
});

test("a learner has no publishing surface at all", async () => {
  const learner = await apiAs("learner");
  expect((await learner.get("/api/v1/publishing/packages")).status()).toBe(403);
  expect(
    (await learner.post("/api/v1/publishing/packages", { data: { specId: "x", format: "scorm2004" } })).status()
  ).toBe(403);
  await learner.dispose();
});
