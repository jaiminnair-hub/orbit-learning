import { test, expect, request as pwRequest } from "@playwright/test";
import path from "node:path";
import type { Meta } from "./global-setup";

// docs/TESTING.md §6 flow #2: an admin builds a course from the content
// library, publishes it, and a learner enrols and completes it.
//
// The authoring half runs through the API (that's the admin's real
// path), but the learner half is driven through the actual rendered
// player in a browser — which is the part step 5 could not verify
// visually at the time, so this is where that gets proven.
const AUTH_DIR = path.join(__dirname, ".auth");

async function apiAs(key: keyof Meta["users"]) {
  return pwRequest.newContext({
    baseURL: "http://localhost:3000",
    storageState: path.join(AUTH_DIR, `${key}.json`),
  });
}

test("admin builds and publishes a course; a learner enrols, completes it, and the course is marked complete", async ({
  browser,
}) => {
  const admin = await apiAs("org_admin");
  const suffix = Date.now();

  // --- author two learning objects ---
  const loIds: string[] = [];
  for (const title of [`Welcome ${suffix}`, `Safety rules ${suffix}`]) {
    const res = await admin.post("/api/v1/content/learning-objects", { data: { title } });
    expect(res.status()).toBe(201);
    loIds.push((await res.json()).data.learningObject.id);
  }

  // --- build the course structure ---
  const courseRes = await admin.post("/api/v1/content/courses", {
    data: { title: `Onboarding ${suffix}`, description: "Golden path course." },
  });
  expect(courseRes.status()).toBe(201);
  const courseId = (await courseRes.json()).data.course.id;

  const modRes = await admin.post(`/api/v1/content/courses/${courseId}/structure`, {
    data: { kind: "module", title: "Module 1", sequence: 0 },
  });
  expect(modRes.status()).toBe(201);
  const moduleId = (await modRes.json()).data.module.id;

  const lessonRes = await admin.post(`/api/v1/content/courses/${courseId}/structure`, {
    data: { kind: "lesson", moduleId, title: "Lesson 1", sequence: 0 },
  });
  expect(lessonRes.status()).toBe(201);
  const lessonId = (await lessonRes.json()).data.lesson.id;

  for (const [i, loId] of loIds.entries()) {
    const attach = await admin.post(`/api/v1/content/courses/${courseId}/structure`, {
      data: { kind: "attach", lessonId, learningObjectId: loId, sequence: i },
    });
    expect(attach.status()).toBe(201);
  }

  // --- publish through the real state machine ---
  for (const status of ["review", "approval", "published"]) {
    const res = await admin.post(`/api/v1/content/courses/${courseId}/publish`, {
      data: { status },
    });
    expect(res.status(), status).toBe(200);
  }
  await admin.dispose();

  // --- learner side, through the real UI ---
  const context = await browser.newContext({
    baseURL: "http://localhost:3000",
    storageState: path.join(AUTH_DIR, "learner.json"),
  });
  const page = await context.newPage();

  await page.goto("/courses");
  // The catalogue card's title (courses-catalogue.tsx) is a plain <h3>, not
  // a link — only its "Explore/Continue/Review course →" action is. Scope
  // to the card containing the title, then use its own action link.
  const courseCard = page.locator("article", { hasText: `Onboarding ${suffix}` });
  await expect(courseCard.getByRole("heading", { name: `Onboarding ${suffix}` })).toBeVisible();
  await courseCard.getByRole("link").click();

  await expect(page).toHaveURL(new RegExp(`/courses/${courseId}`));
  await expect(page.getByRole("button", { name: "Enrol in this course" })).toBeVisible();
  await page.getByRole("button", { name: "Enrol in this course" }).click();
  await expect(page.getByText(/Enrolled/)).toBeVisible();

  // Work through both learning objects in the outline. Scoped to the
  // outline nav specifically (player.tsx's aria-labelled "Course
  // outline" aside): once the first item completes, its own title also
  // appears inside the page's "Next: {title} →" prompt, so an unscoped
  // page-wide button lookup for the second title's name matches both and
  // Playwright's strict mode correctly refuses to guess between them.
  const outline = page.getByRole("complementary", { name: "Course outline" });
  for (const title of [`Welcome ${suffix}`, `Safety rules ${suffix}`]) {
    await outline.getByRole("button", { name: new RegExp(title) }).click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await page.getByRole("button", { name: "Mark as complete" }).click();
    await expect(page.getByText("✓ Completed")).toBeVisible();
  }

  // The course percentage is derived from those completions. The player's
  // real markup (app/(app)/courses/[id]/player.tsx) shows the percent and
  // the word "complete" as separate text nodes ("100%" in its own
  // <strong>, "Enrolled · N of N complete" elsewhere) — never a single
  // "100% complete" string — so this checks the percent element directly.
  await expect(page.locator(".focus-player__outline-heading strong")).toHaveText("100%");

  await context.close();

  // --- and the enrolment itself is now completed, server-side ---
  const learnerApi = await apiAs("learner");
  const enrRes = await learnerApi.get("/api/v1/enrollments");
  const enrolments = (await enrRes.json()).data.enrollments;
  const thisEnrolment = enrolments.find(
    (e: { enrollable_id: string }) => e.enrollable_id === courseId
  );
  expect(thisEnrolment.status).toBe("completed");
  expect(thisEnrolment.completed_at).not.toBeNull();
  await learnerApi.dispose();
});
