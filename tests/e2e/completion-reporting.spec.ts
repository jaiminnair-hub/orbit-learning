import { test, expect, request as pwRequest, type APIRequestContext } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Meta } from "./global-setup";

/**
 * The completion report — the question an organisation buys an LMS to
 * answer. Until now progress existed per learner in the player sidebar
 * and nowhere else, so nobody could see who had finished what.
 */
const AUTH_DIR = path.join(__dirname, ".auth");
const meta = JSON.parse(readFileSync(path.join(AUTH_DIR, "meta.json"), "utf-8")) as Meta;

async function apiAs(key: keyof Meta["users"]) {
  return pwRequest.newContext({
    baseURL: "http://localhost:3000",
    storageState: path.join(AUTH_DIR, `${key}.json`),
  });
}

/** Publishes a course with `count` learning objects and returns their ids. */
async function publishCourse(admin: APIRequestContext, title: string, count: number) {
  const loIds: string[] = [];
  for (let i = 0; i < count; i++) {
    const res = await admin.post("/api/v1/content/learning-objects", {
      data: { title: `${title} part ${i + 1}` },
    });
    expect(res.status()).toBe(201);
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
    const res = await admin.post(`/api/v1/content/courses/${courseId}/publish`, {
      data: { status },
    });
    expect(res.status(), status).toBe(200);
  }

  return { courseId, loIds };
}

test("a manager sees assignment and progress; a learner cannot open the report at all", async () => {
  const admin = await apiAs("org_admin");
  const suffix = Date.now();
  const { courseId, loIds } = await publishCourse(admin, `Reported course ${suffix}`, 2);

  // An admin assigns the course rather than the learner self-enrolling —
  // the path that matters to an organisation, and one the API supported
  // long before anything in the product used it.
  const assign = await admin.post("/api/v1/enrollments", {
    data: {
      courseId,
      userId: meta.users.learner.userId,
      dueDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    },
  });
  expect(assign.status()).toBe(201);
  await admin.dispose();

  const manager = await apiAs("manager");
  const before = await manager.get(`/api/v1/reports/completion?courseId=${courseId}`);
  expect(before.status()).toBe(200);
  const beforeBody = (await before.json()).data;

  expect(beforeBody.rows).toHaveLength(1);
  expect(beforeBody.rows[0]).toMatchObject({
    learnerEmail: meta.users.learner.email,
    status: "enrolled",
    percent: 0,
    objectsTotal: 2,
    objectsCompleted: 0,
    score: null,
    overdue: false,
  });
  expect(beforeBody.summary).toMatchObject({ total: 1, completed: 0, notStarted: 1 });

  // --- the learner finishes one of two objects ---
  const learner = await apiAs("learner");
  const first = await learner.put("/api/v1/progress", {
    data: { learningObjectId: loIds[0], courseId, status: "completed", score: 80 },
  });
  expect(first.status()).toBe(200);

  const half = await manager.get(`/api/v1/reports/completion?courseId=${courseId}`);
  expect((await half.json()).data.rows[0]).toMatchObject({
    status: "in_progress",
    percent: 50,
    objectsCompleted: 1,
    score: 80,
  });

  // --- and then the second ---
  await learner.put("/api/v1/progress", {
    data: { learningObjectId: loIds[1], courseId, status: "completed", score: 90 },
  });

  const done = await manager.get(`/api/v1/reports/completion?courseId=${courseId}`);
  const doneBody = (await done.json()).data;
  expect(doneBody.rows[0]).toMatchObject({
    status: "completed",
    percent: 100,
    objectsCompleted: 2,
    // Averaged across scored objects, not the last one written.
    score: 85,
  });
  expect(doneBody.rows[0].completedAt).not.toBeNull();
  expect(doneBody.summary).toMatchObject({ total: 1, completed: 1, averagePercent: 100 });

  // A learner has no reporting surface — their own progress is visible in
  // the player, but other people's is not their business.
  expect((await learner.get("/api/v1/reports/completion")).status()).toBe(403);

  await learner.dispose();
  await manager.dispose();
});

test("the report never includes another organization's enrolments", async () => {
  const admin = await apiAs("org_admin");
  const { courseId } = await publishCourse(admin, `Isolated course ${Date.now()}`, 1);
  await admin.post("/api/v1/enrollments", {
    data: { courseId, userId: meta.users.learner.userId },
  });
  await admin.dispose();

  const outsider = await apiAs("otherOrgOwner");
  const res = await outsider.get("/api/v1/reports/completion");
  expect(res.status()).toBe(200);

  const rows = (await res.json()).data.rows as { courseId: string }[];
  expect(rows.some((r) => r.courseId === courseId)).toBe(false);

  // And asking for the course by id directly returns nothing rather than
  // leaking its enrolments.
  const targeted = await outsider.get(`/api/v1/reports/completion?courseId=${courseId}`);
  expect((await targeted.json()).data.rows).toHaveLength(0);

  await outsider.dispose();
});

test("an overdue assignment is flagged, and filtering by status narrows the report", async () => {
  const admin = await apiAs("org_admin");
  const suffix = Date.now();
  const { courseId } = await publishCourse(admin, `Overdue course ${suffix}`, 1);

  await admin.post("/api/v1/enrollments", {
    data: {
      courseId,
      userId: meta.users.learner.userId,
      dueDate: new Date(Date.now() - 86_400_000).toISOString(),
    },
  });
  await admin.dispose();

  const manager = await apiAs("manager");
  const res = await manager.get(`/api/v1/reports/completion?courseId=${courseId}`);
  const body = (await res.json()).data;

  expect(body.rows[0].overdue).toBe(true);
  expect(body.summary.overdue).toBe(1);

  // Filtering is applied to the enrolment query, so a status that matches
  // nothing must return an empty report rather than everything.
  const filtered = await manager.get(
    `/api/v1/reports/completion?courseId=${courseId}&status=completed`
  );
  expect((await filtered.json()).data.rows).toHaveLength(0);

  await manager.dispose();
});

test("the reports page renders for a manager and redirects a learner away", async ({ browser }) => {
  const admin = await apiAs("org_admin");
  const suffix = Date.now();
  const { courseId } = await publishCourse(admin, `Visible course ${suffix}`, 1);
  await admin.post("/api/v1/enrollments", {
    data: { courseId, userId: meta.users.learner.userId },
  });
  await admin.dispose();

  const managerCtx = await browser.newContext({
    baseURL: "http://localhost:3000",
    storageState: path.join(AUTH_DIR, "manager.json"),
  });
  const page = await managerCtx.newPage();
  await page.goto("/admin/reports");

  // The page's own <h1> is "Assign & Track" (renamed from "Reports" during
  // the role-remap consolidation, MASTER_FEATURE_MATRIX.md reconciliation
  // note 5, 2026-09-03), but the nav *link* label depends on role — a
  // plain manager (this session) sees ProductShell's managerLinks entry,
  // labelled "Team insights"; "Assign & Track" is org_admin+ only
  // (adminLinks). Checked against the real component, not assumed.
  await expect(page.getByRole("heading", { name: "Assign & Track" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: `Visible course ${suffix}` })).toBeVisible();
  await expect(page.getByRole("link", { name: "Team insights" })).toBeVisible();
  await managerCtx.close();

  const learnerCtx = await browser.newContext({
    baseURL: "http://localhost:3000",
    storageState: path.join(AUTH_DIR, "learner.json"),
  });
  const learnerPage = await learnerCtx.newPage();
  await learnerPage.goto("/admin/reports");
  await expect(learnerPage).toHaveURL(/\/dashboard/);
  await expect(learnerPage.getByRole("link", { name: "Team insights" })).toHaveCount(0);
  await learnerCtx.close();
});
