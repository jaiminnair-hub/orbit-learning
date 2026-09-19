import { test, expect, request as pwRequest, type APIRequestContext } from "@playwright/test";
import path from "node:path";
import type { Meta } from "../e2e/global-setup";
import { createLocalAdminClient } from "../e2e/local-supabase-admin";
import { buildScormPackage } from "../e2e/scorm-package-fixture";
import { buildIsolationProbePackage } from "./isolation-fixture";

/**
 * The proof this whole plan exists to produce
 * (docs/SCORM_CONTENT_ISOLATION_ARCHITECTURE.md): SCORM content now
 * runs on a genuinely different origin, and that origin boundary is
 * real in a real browser — not just correct by inspection of the code.
 *
 * Run with: npx playwright test --config=playwright.isolation.config.ts
 */
const AUTH_DIR = path.join(__dirname, "..", "e2e", ".auth");
const CONTENT_ORIGIN = "http://localhost:3100";

let cachedDb: ReturnType<typeof createLocalAdminClient> | null = null;
function dbClient() {
  if (!cachedDb) cachedDb = createLocalAdminClient();
  return cachedDb;
}

async function apiAs(key: keyof Meta["users"] & string) {
  return pwRequest.newContext({ baseURL: "http://localhost:3000", storageState: path.join(AUTH_DIR, `${key}.json`) });
}

async function uploadAndPublish(admin: APIRequestContext, zip: Buffer, title: string) {
  const urlRes = await admin.post("/api/v1/content/upload-url", { data: { filename: `${title}.zip` } });
  const { path: storagePath, signedUrl } = (await urlRes.json()).data;
  await admin.put(signedUrl, { headers: { "Content-Type": "application/zip" }, data: zip });

  const assetRes = await admin.post("/api/v1/content/assets", {
    data: { storagePath, type: "scorm", mimeType: "application/zip", fileSize: zip.length },
  });
  const assetId = (await assetRes.json()).data.asset.id;

  const regRes = await admin.post("/api/v1/content/scorm", { data: { contentAssetId: assetId } });
  expect(regRes.status(), await regRes.text()).toBe(201);
  const packageId = (await regRes.json()).data.package.id as string;

  const loRes = await admin.post("/api/v1/content/learning-objects", {
    data: { title: `${title} object`, assetIds: [assetId] },
  });
  const loId = (await loRes.json()).data.learningObject.id;

  const courseRes = await admin.post("/api/v1/content/courses", { data: { title } });
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
    await admin.post(`/api/v1/content/courses/${courseId}/publish`, { data: { status } });
  }

  return { courseId, packageId };
}

test("the SCORM iframe is served from a genuinely different origin", async ({ browser }) => {
  const admin = await apiAs("org_admin");
  const suffix = Date.now();
  const { courseId } = await uploadAndPublish(admin, buildScormPackage("1.2"), `Origin check ${suffix}`);
  await admin.dispose();

  const context = await browser.newContext({ baseURL: "http://localhost:3000", storageState: path.join(AUTH_DIR, "learner.json") });
  const page = await context.newPage();
  await page.goto(`/courses/${courseId}`);
  await page.getByRole("button", { name: /Enrol in this course/ }).click();
  await page.getByRole("button", { name: /Origin check .* object/ }).click();

  const frame = page.frameLocator('[data-testid="scorm-frame"]');
  await expect(frame.locator("body")).toBeVisible({ timeout: 15_000 });

  const frameSrc = await page.getAttribute('[data-testid="scorm-frame"]', "src");
  expect(frameSrc).toContain(CONTENT_ORIGIN);

  await context.close();
});

test("tracking (bookmark, completion, score) still works end to end through the bridge", async ({ browser }) => {
  const admin = await apiAs("org_admin");
  const suffix = Date.now();
  const { courseId, packageId } = await uploadAndPublish(admin, buildScormPackage("1.2"), `Bridge tracking ${suffix}`);
  await admin.dispose();

  const context = await browser.newContext({ baseURL: "http://localhost:3000", storageState: path.join(AUTH_DIR, "learner.json") });
  const page = await context.newPage();
  await page.goto(`/courses/${courseId}`);
  await page.getByRole("button", { name: /Enrol in this course/ }).click();
  await page.getByRole("button", { name: /Bridge tracking .* object/ }).click();

  const bridgeFrame = page.frameLocator('[data-testid="scorm-frame"]');
  const contentFrame = bridgeFrame.frameLocator("iframe");
  await expect(contentFrame.locator("#state")).toHaveText("initialized", { timeout: 15_000 });

  await expect
    .poll(async () => {
      const { data } = await dbClient().from("scorm_progress").select("cmi_data").eq("scorm_package_id", packageId).maybeSingle();
      return data?.cmi_data?.["cmi.core.lesson_location"] ?? null;
    }, { timeout: 15_000 })
    .toBe("page-2");

  await contentFrame.locator("#finish").click();

  await expect
    .poll(async () => {
      const { data } = await dbClient().from("scorm_progress").select("lesson_status, score_raw").eq("scorm_package_id", packageId).maybeSingle();
      return data;
    }, { timeout: 15_000 })
    .toMatchObject({ lesson_status: "passed", score_raw: 82 });

  await context.close();
});

test("the origin boundary holds in a real browser: the content cannot read the app's cookie or top location", async ({ browser }) => {
  const admin = await apiAs("org_admin");
  const suffix = Date.now();
  const { courseId, packageId } = await uploadAndPublish(admin, buildIsolationProbePackage(), `Isolation probe ${suffix}`);
  await admin.dispose();

  const context = await browser.newContext({ baseURL: "http://localhost:3000", storageState: path.join(AUTH_DIR, "learner.json") });
  const page = await context.newPage();

  const requestsToContentOrigin: string[] = [];
  const cookieHeadersSeen: (string | undefined)[] = [];
  page.on("request", (req) => {
    if (req.url().startsWith(CONTENT_ORIGIN)) {
      requestsToContentOrigin.push(req.url());
      cookieHeadersSeen.push(req.headers()["cookie"]);
    }
  });

  await page.goto(`/courses/${courseId}`);
  await page.getByRole("button", { name: /Enrol in this course/ }).click();
  await page.getByRole("button", { name: /Isolation probe .* object/ }).click();

  const bridgeFrame = page.frameLocator('[data-testid="scorm-frame"]');
  const contentFrame = bridgeFrame.frameLocator("iframe");
  await expect(contentFrame.locator("#state")).toHaveText("probed", { timeout: 15_000 });

  // The content genuinely ran, genuinely found the API (proving the
  // window.parent walk works within content-origin), and reports what
  // happened when it reached for the real app's top window.
  const readSuspendData = async () => {
    const { data } = await dbClient()
      .from("scorm_progress")
      .select("cmi_data")
      .eq("scorm_package_id", packageId)
      .maybeSingle();
    return (data?.cmi_data?.["cmi.suspend_data"] as string | undefined) ?? null;
  };

  await expect.poll(readSuspendData, { timeout: 15_000 }).not.toBeNull();
  const suspendData = await readSuspendData();

  expect(suspendData).toContain("cookie=BLOCKED:");
  expect(suspendData).toContain("location=BLOCKED:");

  // The network-level guarantee, independent of what the content itself
  // reports: no request this browser made to the content origin ever
  // carried this session's cookie — there is nothing to steal even if a
  // future bug reintroduced a same-origin assumption somewhere.
  expect(requestsToContentOrigin.length).toBeGreaterThan(0);
  for (const cookieHeader of cookieHeadersSeen) {
    expect(cookieHeader).toBeUndefined();
  }

  await context.close();
});
