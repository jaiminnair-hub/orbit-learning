import { expect, request as pwRequest, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Meta } from "./global-setup";
import { createLocalAdminClient } from "./local-supabase-admin";

const AUTH_DIR = path.join(__dirname, ".auth");
const meta = JSON.parse(readFileSync(path.join(AUTH_DIR, "meta.json"), "utf-8")) as Meta;
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

async function learnerApi() {
  return pwRequest.newContext({ baseURL: BASE_URL, storageState: path.join(AUTH_DIR, "learner.json") });
}

test("learner search and transcript are authenticated, org-scoped product surfaces", async ({ browser }) => {
  const admin = createLocalAdminClient();
  const marker = `p0search${Date.now()}`;
  const { data: ownCourse, error: ownError } = await admin.from("courses").insert({
    org_id: meta.org.id,
    title: `Own ${marker}`,
    slug: `own-${marker}`,
    description: "Visible in the learner workspace search.",
    status: "published",
    published_at: new Date().toISOString(),
  }).select("id, version").single();
  if (ownError) throw ownError;
  const { error: otherError } = await admin.from("courses").insert({
    org_id: meta.otherOrg.id,
    title: `Other ${marker}`,
    slug: `other-${marker}`,
    description: "Must never cross the tenant boundary.",
    status: "published",
    published_at: new Date().toISOString(),
  });
  if (otherError) throw otherError;

  const api = await learnerApi();
  const search = await api.get(`/api/v1/search?q=${marker}`);
  expect(search.status()).toBe(200);
  const searchBody = await search.json();
  expect(searchBody.data.results.some((result: { id: string }) => result.id === ownCourse!.id)).toBe(true);
  expect(searchBody.data.results.some((result: { title: string }) => result.title.startsWith("Other"))).toBe(false);

  const transcript = await api.get("/api/v1/transcript");
  expect(transcript.status()).toBe(200);
  expect((await transcript.json()).data).toMatchObject({ summary: { certificates: expect.any(Number) } });
  await api.dispose();

  const context = await browser.newContext({ baseURL: BASE_URL, storageState: path.join(AUTH_DIR, "learner.json") });
  const page = await context.newPage();
  await page.goto(`/search?q=${marker}`);
  await expect(page.getByRole("heading", { name: `Own ${marker}` })).toBeVisible();
  await expect(page.getByRole("link", { name: /Transcript/ })).toBeVisible();
  await page.goto("/transcript");
  await expect(page.getByRole("heading", { name: "Your learning transcript" })).toBeVisible();
  await expect(page.getByLabel("Type")).toBeVisible();
  await context.close();
});

test("course player exposes the contextual Orbit Guide beside a published learning item", async ({ browser }) => {
  const admin = createLocalAdminClient();
  const label = Date.now();
  const { data: course, error: courseError } = await admin.from("courses").insert({
    org_id: meta.org.id,
    title: `Guide course ${label}`,
    slug: `guide-course-${label}`,
    status: "published",
    published_at: new Date().toISOString(),
  }).select("id, version").single();
  if (courseError) throw courseError;
  const { data: learningObject, error: objectError } = await admin.from("learning_objects").insert({
    org_id: meta.org.id,
    title: `Guide lesson ${label}`,
    description: "A published item used to verify the in-player Guide.",
    status: "published",
    source: "assets",
  }).select("id").single();
  if (objectError) throw objectError;
  const { data: module, error: moduleError } = await admin.from("modules").insert({ org_id: meta.org.id, course_id: course!.id, title: "Guide module", sequence: 0 }).select("id").single();
  if (moduleError) throw moduleError;
  const { data: lesson, error: lessonError } = await admin.from("lessons").insert({ org_id: meta.org.id, module_id: module!.id, title: "Guide lesson", sequence: 0 }).select("id").single();
  if (lessonError) throw lessonError;
  const { error: linkError } = await admin.from("lesson_learning_objects").insert({ org_id: meta.org.id, lesson_id: lesson!.id, learning_object_id: learningObject!.id, sequence: 0 });
  if (linkError) throw linkError;
  const { error: enrollmentError } = await admin.from("enrollments").insert({ org_id: meta.org.id, user_id: meta.users.learner.userId, enrollable_type: "course", enrollable_id: course!.id, enrolled_version: course!.version });
  if (enrollmentError) throw enrollmentError;

  const context = await browser.newContext({ baseURL: BASE_URL, storageState: path.join(AUTH_DIR, "learner.json") });
  const page = await context.newPage();
  await page.goto(`/courses/${course!.id}`);
  await page.getByRole("button", { name: new RegExp(`Guide lesson ${label}`) }).click();
  await expect(page.getByText("O · Orbit Guide")).toBeVisible();
  await page.getByText("O · Orbit Guide").click();
  await expect(page.getByRole("button", { name: "Explain this page" })).toBeVisible();
  await expect(page.getByLabel("Ask a question about this course")).toBeVisible();
  await context.close();
});
