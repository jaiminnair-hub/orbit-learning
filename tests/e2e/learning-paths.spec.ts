import { test, expect, request as pwRequest } from "@playwright/test";
import path from "node:path";
import type { Meta } from "./global-setup";

// A learning path sequences published courses into one enrollable unit
// (enrollments.enrollable_type = 'learning_path', reserved since Phase 2,
// first used 2026-09-04). Mirrors course-lifecycle.spec.ts's structure:
// authoring runs through the API (the admin's real path), the learner's
// course completion runs through the real rendered player, so the path's
// own auto-completion — wired into app/api/v1/progress/route.ts's PUT
// handler — is proven end to end, not just at the lib-function level.
const AUTH_DIR = path.join(__dirname, ".auth");

async function apiAs(key: keyof Meta["users"]) {
  return pwRequest.newContext({
    baseURL: "http://localhost:3000",
    storageState: path.join(AUTH_DIR, `${key}.json`),
  });
}

async function buildPublishedCourse(admin: Awaited<ReturnType<typeof apiAs>>, title: string, loTitle: string) {
  const loRes = await admin.post("/api/v1/content/learning-objects", { data: { title: loTitle } });
  expect(loRes.status()).toBe(201);
  const loId = (await loRes.json()).data.learningObject.id;

  const courseRes = await admin.post("/api/v1/content/courses", { data: { title, description: "Path member course." } });
  expect(courseRes.status()).toBe(201);
  const courseId = (await courseRes.json()).data.course.id;

  const modRes = await admin.post(`/api/v1/content/courses/${courseId}/structure`, { data: { kind: "module", title: "Module 1", sequence: 0 } });
  const moduleId = (await modRes.json()).data.module.id;
  const lessonRes = await admin.post(`/api/v1/content/courses/${courseId}/structure`, { data: { kind: "lesson", moduleId, title: "Lesson 1", sequence: 0 } });
  const lessonId = (await lessonRes.json()).data.lesson.id;
  const attach = await admin.post(`/api/v1/content/courses/${courseId}/structure`, { data: { kind: "attach", lessonId, learningObjectId: loId, sequence: 0 } });
  expect(attach.status()).toBe(201);

  for (const status of ["review", "approval", "published"]) {
    const res = await admin.post(`/api/v1/content/courses/${courseId}/publish`, { data: { status } });
    expect(res.status(), status).toBe(200);
  }

  return { courseId, loTitle };
}

test("an admin sequences two courses into a learning path; a learner completes both and the path auto-completes", async ({ browser }) => {
  const admin = await apiAs("org_admin");
  const suffix = Date.now();

  const courseA = await buildPublishedCourse(admin, `Path Course A ${suffix}`, `Intro A ${suffix}`);
  const courseB = await buildPublishedCourse(admin, `Path Course B ${suffix}`, `Intro B ${suffix}`);

  const pathRes = await admin.post("/api/v1/content/learning-paths", {
    data: { title: `Onboarding Journey ${suffix}`, description: "Two-course path." },
  });
  expect(pathRes.status()).toBe(201);
  const pathId = (await pathRes.json()).data.learningPath.id;

  for (const { courseId } of [courseA, courseB]) {
    const attachRes = await admin.post(`/api/v1/content/learning-paths/${pathId}/structure`, { data: { courseId } });
    expect(attachRes.status()).toBe(201);
  }

  // A draft path lists its courses; the structure GET is what both the
  // editor and the learner page read.
  const structureBefore = await admin.get(`/api/v1/content/learning-paths/${pathId}/structure`);
  const beforeJson = (await structureBefore.json()).data;
  expect(beforeJson.courses.map((c: { course: { id: string } }) => c.course.id)).toEqual([courseA.courseId, courseB.courseId]);

  const publishRes = await admin.post(`/api/v1/content/learning-paths/${pathId}/publish`);
  expect(publishRes.status()).toBe(200);
  expect((await publishRes.json()).data.learningPath.status).toBe("published");

  // Assign the path to the learner — the enrollments-table row that makes
  // it show up on their worklist, separate from enrolling in either course.
  const membersRes = await admin.get("/api/v1/orgs/members");
  const learner = (await membersRes.json()).data.members.find((m: { email: string }) => m.email.includes("learner"));
  const assignRes = await admin.post(`/api/v1/learning-paths/${pathId}/assign`, { data: { userId: learner.id } });
  expect(assignRes.status()).toBe(201);
  await admin.dispose();

  // --- learner side, through the real UI ---
  const context = await browser.newContext({ baseURL: "http://localhost:3000", storageState: path.join(AUTH_DIR, "learner.json") });
  const page = await context.newPage();

  await page.goto(`/paths/${pathId}`);
  await expect(page.getByRole("heading", { name: `Onboarding Journey ${suffix}` })).toBeVisible();
  await expect(page.getByText("0 of 2 courses complete")).toBeVisible();

  const rowA = page.locator(".learning-path-page__course", { hasText: `Path Course A ${suffix}` });
  const rowB = page.locator(".learning-path-page__course", { hasText: `Path Course B ${suffix}` });
  await expect(rowA).toBeVisible();
  await expect(rowB).toBeVisible();

  // Complete course A through the real player.
  await rowA.getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`/courses/${courseA.courseId}`));
  await page.getByRole("button", { name: "Enrol in this course" }).click();
  await expect(page.getByText(/Enrolled/)).toBeVisible();
  const outlineA = page.getByRole("complementary", { name: "Course outline" });
  await outlineA.getByRole("button", { name: new RegExp(courseA.loTitle) }).click();
  await page.getByRole("button", { name: "Mark as complete" }).click();
  await expect(page.getByText("✓ Completed")).toBeVisible();

  // Back on the path page, one course should now read complete.
  await page.goto(`/paths/${pathId}`);
  await expect(page.getByText("1 of 2 courses complete")).toBeVisible();

  // Complete course B the same way.
  await page.locator(".learning-path-page__course", { hasText: `Path Course B ${suffix}` }).getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`/courses/${courseB.courseId}`));
  await page.getByRole("button", { name: "Enrol in this course" }).click();
  await expect(page.getByText(/Enrolled/)).toBeVisible();
  const outlineB = page.getByRole("complementary", { name: "Course outline" });
  await outlineB.getByRole("button", { name: new RegExp(courseB.loTitle) }).click();
  await page.getByRole("button", { name: "Mark as complete" }).click();
  await expect(page.getByText("✓ Completed")).toBeVisible();

  await page.goto(`/paths/${pathId}`);
  await expect(page.getByText("2 of 2 courses complete")).toBeVisible();
  await context.close();

  // --- and the path's own enrollment is genuinely completed, server-side ---
  const learnerApi = await apiAs("learner");
  const workRes = await learnerApi.get("/api/v1/my-work");
  const rows = (await workRes.json()).data.rows;
  const pathRow = rows.find((r: { kind: string; refId: string }) => r.kind === "learning_path" && r.refId === pathId);
  expect(pathRow).toBeTruthy();
  expect(pathRow.status).toBe("completed");
  expect(pathRow.percent).toBe(100);
  await learnerApi.dispose();
});

test("a learning path cannot be published with no courses, and a draft path cannot be assigned", async () => {
  const admin = await apiAs("org_admin");
  const suffix = Date.now();

  const pathRes = await admin.post("/api/v1/content/learning-paths", { data: { title: `Empty Path ${suffix}` } });
  const pathId = (await pathRes.json()).data.learningPath.id;

  const publishRes = await admin.post(`/api/v1/content/learning-paths/${pathId}/publish`);
  expect(publishRes.status()).toBe(409);
  expect((await publishRes.json()).error.code).toBe("NO_COURSES");

  const membersRes = await admin.get("/api/v1/orgs/members");
  const learner = (await membersRes.json()).data.members.find((m: { email: string }) => m.email.includes("learner"));
  const assignRes = await admin.post(`/api/v1/learning-paths/${pathId}/assign`, { data: { userId: learner.id } });
  expect(assignRes.status()).toBe(409);
  expect((await assignRes.json()).error.code).toBe("NOT_PUBLISHED");

  await admin.dispose();
});

test("a learner has no learning-path authoring surface", async () => {
  const learnerApi = await apiAs("learner");
  const createRes = await learnerApi.post("/api/v1/content/learning-paths", { data: { title: "Should be refused" } });
  expect(createRes.status()).toBe(403);
  await learnerApi.dispose();
});
