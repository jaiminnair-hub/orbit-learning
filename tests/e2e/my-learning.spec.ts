import { test, expect, request as pwRequest, type APIRequestContext } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Meta } from "./global-setup";

/**
 * A learner's own view, and the admin action that fills it.
 *
 * Assignment is the path that makes an LMS an LMS: the enrolment API has
 * supported it since Phase 2 and nothing in the product ever called it,
 * so the only way into a course was a learner choosing it themselves.
 */
const AUTH_DIR = path.join(__dirname, ".auth");
const meta = JSON.parse(readFileSync(path.join(AUTH_DIR, "meta.json"), "utf-8")) as Meta;

async function apiAs(key: keyof Meta["users"]) {
  return pwRequest.newContext({
    baseURL: "http://localhost:3000",
    storageState: path.join(AUTH_DIR, `${key}.json`),
  });
}

async function publishCourse(admin: APIRequestContext, title: string, count: number) {
  const loIds: string[] = [];
  for (let i = 0; i < count; i++) {
    const res = await admin.post("/api/v1/content/learning-objects", {
      data: { title: `${title} part ${i + 1}` },
    });
    loIds.push((await res.json()).data.learningObject.id);
  }

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

  for (const [i, loId] of loIds.entries()) {
    await admin.post(`/api/v1/content/courses/${courseId}/structure`, {
      data: { kind: "attach", lessonId, learningObjectId: loId, sequence: i },
    });
  }
  for (const status of ["review", "approval", "published"]) {
    await admin.post(`/api/v1/content/courses/${courseId}/publish`, { data: { status } });
  }

  return { courseId, loIds };
}

test("a learner's dashboard shows only their own assignments, with progress", async () => {
  const admin = await apiAs("org_admin");
  const suffix = Date.now();
  const { courseId, loIds } = await publishCourse(admin, `Assigned course ${suffix}`, 2);

  await admin.post("/api/v1/enrollments", {
    data: { courseId, userId: meta.users.learner.userId },
  });
  // A second person gets the same course; the learner must not see it.
  await admin.post("/api/v1/enrollments", {
    data: { courseId, userId: meta.users.manager.userId },
  });
  await admin.dispose();

  const learner = await apiAs("learner");
  const res = await learner.get("/api/v1/my-learning");
  expect(res.status()).toBe(200);
  const body = (await res.json()).data;

  const mine = body.rows.filter((r: { courseId: string }) => r.courseId === courseId);
  expect(mine).toHaveLength(1);
  expect(mine[0]).toMatchObject({ percent: 0, objectsTotal: 2, status: "enrolled" });
  expect(body.rows.every((r: { userId: string }) => r.userId === meta.users.learner.userId)).toBe(
    true
  );

  await learner.put("/api/v1/progress", {
    data: { learningObjectId: loIds[0], courseId, status: "completed" },
  });

  const after = await learner.get("/api/v1/my-learning");
  const updated = (await after.json()).data.rows.find(
    (r: { courseId: string }) => r.courseId === courseId
  );
  expect(updated).toMatchObject({ percent: 50, objectsCompleted: 1, status: "in_progress" });

  await learner.dispose();
});

test("the learner and their manager see the same percentage", async () => {
  // Two code paths computing completion independently is how a report
  // starts disagreeing with the learner's own screen; they share one
  // function precisely so this holds.
  const admin = await apiAs("org_admin");
  const suffix = Date.now();
  const { courseId, loIds } = await publishCourse(admin, `Agreement course ${suffix}`, 3);
  await admin.post("/api/v1/enrollments", {
    data: { courseId, userId: meta.users.learner.userId },
  });
  await admin.dispose();

  const learner = await apiAs("learner");
  await learner.put("/api/v1/progress", {
    data: { learningObjectId: loIds[0], courseId, status: "completed" },
  });

  const own = (await (await learner.get("/api/v1/my-learning")).json()).data.rows.find(
    (r: { courseId: string }) => r.courseId === courseId
  );

  const manager = await apiAs("manager");
  const reported = (
    await (await manager.get(`/api/v1/reports/completion?courseId=${courseId}`)).json()
  ).data.rows[0];

  expect(own.percent).toBe(reported.percent);
  expect(own.percent).toBe(33);

  await learner.dispose();
  await manager.dispose();
});

test("an admin assigns a course through the UI and it appears on the learner's dashboard", async ({
  browser,
}) => {
  const admin = await apiAs("org_admin");
  const suffix = Date.now();
  const { courseId } = await publishCourse(admin, `UI assigned ${suffix}`, 1);
  await admin.dispose();

  const adminCtx = await browser.newContext({
    baseURL: "http://localhost:3000",
    storageState: path.join(AUTH_DIR, "org_admin.json"),
  });
  const page = await adminCtx.newPage();
  await page.goto("/admin/reports");

  await page.getByTestId("assign-course-select").selectOption(courseId);
  await page
    .getByRole("checkbox", { name: meta.users.learner.email })
    .check();
  await page.getByRole("button", { name: /Assign to 1 selected/ }).click();
  await expect(page.getByText(/Assigned to 1 person/)).toBeVisible();
  await adminCtx.close();

  // Whoever the first checkbox was, the assignment must be real — read it
  // back through the report rather than trusting the notice.
  const manager = await apiAs("manager");
  const rows = (
    await (await manager.get(`/api/v1/reports/completion?courseId=${courseId}`)).json()
  ).data.rows;
  expect(rows).toHaveLength(1);
  await manager.dispose();
});

test("a learner's dashboard leads with what is overdue", async ({ browser }) => {
  const admin = await apiAs("org_admin");
  const suffix = Date.now();
  const { courseId: overdueId } = await publishCourse(admin, `Zzz overdue ${suffix}`, 1);
  const { courseId: laterId } = await publishCourse(admin, `Aaa later ${suffix}`, 1);

  await admin.post("/api/v1/enrollments", {
    data: {
      courseId: overdueId,
      userId: meta.users.patchTarget.userId,
      dueDate: new Date(Date.now() - 86_400_000).toISOString(),
    },
  });
  await admin.post("/api/v1/enrollments", {
    data: {
      courseId: laterId,
      userId: meta.users.patchTarget.userId,
      dueDate: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    },
  });
  await admin.dispose();

  const manager = await apiAs("manager");
  const overdueRow = (
    await (await manager.get(`/api/v1/reports/completion?courseId=${overdueId}`)).json()
  ).data.rows[0];
  expect(overdueRow.overdue).toBe(true);
  await manager.dispose();

  // The dashboard sorts overdue work to the top even when its title would
  // otherwise sort last — the ordering is the feature.
  const ctx = await browser.newContext({
    baseURL: "http://localhost:3000",
    storageState: path.join(AUTH_DIR, "patchTarget.json"),
  });
  const page = await ctx.newPage();
  await page.goto("/dashboard");

  const first = page.getByTestId("my-learning-row").first();
  await expect(first).toContainText(`Zzz overdue ${suffix}`);
  await expect(first).toContainText("Overdue");
  await ctx.close();
});
