import { test, expect, request as pwRequest, type APIRequestContext } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Meta } from "./global-setup";
import { createLocalAdminClient } from "./local-supabase-admin";
import { buildScormPackage } from "./scorm-package-fixture";

/**
 * The claim under test: an uploaded SCORM package, played by a real
 * learner in a real browser, reports its own progress and completion —
 * and that completion advances the course.
 *
 * This is the gap that made "SCORM works" an overstatement. Extraction
 * and serving were already proven; what was missing was the API adapter
 * the content talks to, so a package rendered fine and recorded nothing.
 * These tests fail if the adapter is absent, mounted too late for the
 * content to find, or wired to the wrong window.
 */
const AUTH_DIR = path.join(__dirname, ".auth");
const meta = JSON.parse(readFileSync(path.join(AUTH_DIR, "meta.json"), "utf-8")) as Meta;

let cachedDb: ReturnType<typeof createLocalAdminClient> | null = null;
function dbClient() {
  if (!cachedDb) cachedDb = createLocalAdminClient();
  return cachedDb;
}

async function apiAs(key: keyof Meta["users"]) {
  return pwRequest.newContext({
    baseURL: "http://localhost:3000",
    storageState: path.join(AUTH_DIR, `${key}.json`),
  });
}

/** Uploads a package through the real two-step flow and registers it. */
async function uploadScorm(admin: APIRequestContext, version: "1.2" | "2004", title: string) {
  const zip = buildScormPackage(version, title);
  const filename = `${title.replace(/\s+/g, "-")}.zip`;

  const urlRes = await admin.post("/api/v1/content/upload-url", { data: { filename } });
  expect(urlRes.status()).toBe(200);
  const { path: storagePath, signedUrl } = (await urlRes.json()).data;

  const put = await admin.put(signedUrl, {
    headers: { "Content-Type": "application/zip" },
    data: zip,
  });
  expect(put.ok(), `storage upload failed: ${put.status()}`).toBeTruthy();

  const assetRes = await admin.post("/api/v1/content/assets", {
    data: { storagePath, type: "scorm", mimeType: "application/zip", fileSize: zip.length },
  });
  expect(assetRes.status()).toBe(201);
  const assetId = (await assetRes.json()).data.asset.id;

  const regRes = await admin.post("/api/v1/content/scorm", {
    data: { contentAssetId: assetId },
  });
  expect(regRes.status(), await regRes.text()).toBe(201);
  const body = (await regRes.json()).data;

  return { assetId, packageId: body.package.id as string, pkg: body.package };
}

/** Builds a one-object published course around an already-uploaded asset. */
async function publishCourseWith(admin: APIRequestContext, assetId: string, title: string) {
  const loRes = await admin.post("/api/v1/content/learning-objects", {
    data: { title: `${title} object`, assetIds: [assetId] },
  });
  expect(loRes.status()).toBe(201);
  const loId = (await loRes.json()).data.learningObject.id;

  const courseRes = await admin.post("/api/v1/content/courses", { data: { title } });
  expect(courseRes.status()).toBe(201);
  const courseId = (await courseRes.json()).data.course.id;

  const modRes = await admin.post(`/api/v1/content/courses/${courseId}/structure`, {
    data: { kind: "module", title: "Module 1", sequence: 0 },
  });
  const moduleId = (await modRes.json()).data.module.id;

  const lessonRes = await admin.post(`/api/v1/content/courses/${courseId}/structure`, {
    data: { kind: "lesson", moduleId, title: "Lesson 1", sequence: 0 },
  });
  const lessonId = (await lessonRes.json()).data.lesson.id;

  await admin.post(`/api/v1/content/courses/${courseId}/structure`, {
    data: { kind: "attach", lessonId, learningObjectId: loId, sequence: 0 },
  });

  for (const status of ["review", "approval", "published"]) {
    const res = await admin.post(`/api/v1/content/courses/${courseId}/publish`, {
      data: { status },
    });
    expect(res.status(), status).toBe(200);
  }

  return { courseId, loId, courseTitle: title };
}

test("the manifest parser reads a real 2004 package, not just a 1.2 one", async () => {
  // SCORM 2004 import was previously code-supported but never evidenced:
  // the parser discriminates on <schemaversion>, and nothing had ever put
  // a genuine 2004 package through it.
  const admin = await apiAs("org_admin");
  const { pkg } = await uploadScorm(admin, "2004", `Data protection ${Date.now()}`);
  expect(pkg.scorm_version).toBe("2004");
  expect(pkg.entry_point).toBe("index.html");
  await admin.dispose();
});

test("a SCORM 1.2 package finds the API, reports completion, and completes the course", async ({
  browser,
}) => {
  const admin = await apiAs("org_admin");
  const suffix = Date.now();
  const { assetId, packageId } = await uploadScorm(admin, "1.2", `Fire safety ${suffix}`);
  const { courseId } = await publishCourseWith(admin, assetId, `Fire safety course ${suffix}`);
  await admin.dispose();

  const context = await browser.newContext({
    baseURL: "http://localhost:3000",
    storageState: path.join(AUTH_DIR, "learner.json"),
  });
  const page = await context.newPage();

  await page.goto(`/courses/${courseId}`);
  await page.getByRole("button", { name: /Enrol in this course/ }).click();
  await page.getByRole("button", { name: /Fire safety course .* object/ }).click();

  const frame = page.frameLocator('[data-testid="scorm-frame"]');

  // If the adapter were missing or mounted after the iframe, the content
  // would say so here — this assertion is the whole point.
  await expect(frame.locator("#state")).toHaveText("initialized", { timeout: 15_000 });
  await expect(frame.locator("#entry")).toHaveText("entry: ab-initio");

  // The bookmark written at startup must reach the database.
  await expect
    .poll(
      async () => {
        const { data } = await dbClient()
          .from("scorm_progress")
          .select("cmi_data, lesson_status")
          .eq("scorm_package_id", packageId)
          .maybeSingle();
        return data?.cmi_data?.["cmi.core.lesson_location"] ?? null;
      },
      { timeout: 15_000 }
    )
    .toBe("page-2");

  await frame.locator("#finish").click();
  await expect(frame.locator("#state")).toHaveText("finished");

  await expect
    .poll(
      async () => {
        const { data } = await dbClient()
          .from("scorm_progress")
          .select("lesson_status, score_raw, total_time_sec, completed_at")
          .eq("scorm_package_id", packageId)
          .maybeSingle();
        return data;
      },
      { timeout: 15_000 }
    )
    .toMatchObject({ lesson_status: "passed", score_raw: 82 });

  // The bridge that was missing entirely: SCORM completion advancing the
  // enrolment, rather than the learner asserting it with a button.
  await expect
    .poll(
      async () => {
        const { data } = await dbClient()
          .from("enrollments")
          .select("status")
          .eq("enrollable_id", courseId)
          .eq("user_id", meta.users.learner.userId)
          .maybeSingle();
        return data?.status ?? null;
      },
      { timeout: 15_000 }
    )
    .toBe("completed");

  await context.close();
});

test("a SCORM 2004 package tracks through the 2004 API and resumes where it left off", async ({
  browser,
}) => {
  const admin = await apiAs("org_admin");
  const suffix = Date.now();
  const { assetId, packageId } = await uploadScorm(admin, "2004", `Data protection ${suffix}`);
  const { courseId } = await publishCourseWith(admin, assetId, `Data protection course ${suffix}`);
  await admin.dispose();

  const context = await browser.newContext({
    baseURL: "http://localhost:3000",
    storageState: path.join(AUTH_DIR, "learner.json"),
  });
  const page = await context.newPage();

  await page.goto(`/courses/${courseId}`);
  await page.getByRole("button", { name: /Enrol in this course/ }).click();
  await page.getByRole("button", { name: /Data protection course .* object/ }).click();

  const frame = page.frameLocator('[data-testid="scorm-frame"]');
  await expect(frame.locator("#state")).toHaveText("initialized", { timeout: 15_000 });
  await expect(frame.locator("#entry")).toHaveText("entry: ab-initio");

  await expect
    .poll(
      async () => {
        const { data } = await dbClient()
          .from("scorm_progress")
          .select("cmi_data")
          .eq("scorm_package_id", packageId)
          .maybeSingle();
        return data?.cmi_data?.["cmi.location"] ?? null;
      },
      { timeout: 15_000 }
    )
    .toBe("slide-3");

  // Leave and come back: the package must be told it is resuming, which
  // is what stops it replaying from the first slide.
  await page.goto(`/courses/${courseId}`);
  await page.getByRole("button", { name: /Data protection course .* object/ }).click();
  await expect(frame.locator("#entry")).toHaveText("entry: resume", { timeout: 15_000 });

  await frame.locator("#finish").click();

  // 2004 splits completion from success, and the scaled score is the only
  // score this package reports — both have to survive normalisation.
  await expect
    .poll(
      async () => {
        const { data } = await dbClient()
          .from("scorm_progress")
          .select("lesson_status, score_raw")
          .eq("scorm_package_id", packageId)
          .maybeSingle();
        return data;
      },
      { timeout: 15_000 }
    )
    .toMatchObject({ lesson_status: "passed", score_raw: 90 });

  await context.close();
});

test("SCORM progress never crosses the organization boundary", async () => {
  const admin = await apiAs("org_admin");
  const { packageId } = await uploadScorm(admin, "1.2", `Isolation ${Date.now()}`);
  await admin.dispose();

  // A learner in another org must not be able to read or write tracking
  // data against this package, even knowing its id.
  const outsider = await pwRequest.newContext({
    baseURL: "http://localhost:3000",
    storageState: path.join(AUTH_DIR, "otherOrgOwner.json"),
  });

  const read = await outsider.get(`/api/v1/content/scorm/${packageId}/progress`);
  const write = await outsider.put(`/api/v1/content/scorm/${packageId}/progress`, {
    data: { cmiData: {}, lessonStatus: "passed", scoreRaw: 100, totalTimeSec: 1 },
  });

  expect(write.status()).toBe(404);
  // The read is org-scoped by RLS rather than rejected outright, so the
  // meaningful assertion is that it yields nothing.
  if (read.status() === 200) {
    expect((await read.json()).data.progress).toBeNull();
  }

  await outsider.dispose();
});
