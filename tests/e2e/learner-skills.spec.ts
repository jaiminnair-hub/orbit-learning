import { expect, request as pwRequest, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Meta } from "./global-setup";
import { createLocalAdminClient } from "./local-supabase-admin";

const AUTH_DIR = path.join(__dirname, ".auth");
const meta = JSON.parse(readFileSync(path.join(AUTH_DIR, "meta.json"), "utf-8")) as Meta;

test("learner skill evidence and recommendations stay inside the signed-in organization", async ({ browser }) => {
  const admin = createLocalAdminClient();
  const marker = Date.now();
  const { data: skill, error: skillError } = await admin.from("skill_tags").insert({
    org_id: meta.org.id,
    name: `Active Listening ${marker}`,
    description: "Listen for meaning and confirm understanding.",
    external_ref: `ESCO:${marker}`,
  }).select("id, name").single();
  if (skillError) throw skillError;
  const { data: foreignSkill, error: foreignError } = await admin.from("skill_tags").insert({
    org_id: meta.otherOrg.id,
    name: `Foreign Skill ${marker}`,
  }).select("id, name").single();
  if (foreignError) throw foreignError;

  const { data: spec, error: specError } = await admin.from("course_specifications").insert({
    org_id: meta.org.id,
    title: `Listening specification ${marker}`,
    spec_schema_version: "1.0.0",
    status: "published",
    spec: { specSchemaVersion: "1.0.0", meta: { title: `Listening course ${marker}`, locale: "en" }, skillTagIds: [skill!.id], sections: [] },
  }).select("id").single();
  if (specError) throw specError;
  const { data: course, error: courseError } = await admin.from("courses").insert({
    org_id: meta.org.id,
    title: `Listening course ${marker}`,
    slug: `listening-course-${marker}`,
    status: "published",
    published_at: new Date().toISOString(),
  }).select("id, version").single();
  if (courseError) throw courseError;
  const { data: learningObject, error: objectError } = await admin.from("learning_objects").insert({
    org_id: meta.org.id,
    title: `Listening lesson ${marker}`,
    status: "published",
    source: "authored",
    course_specification_id: spec!.id,
  }).select("id").single();
  if (objectError) throw objectError;
  const { data: module, error: moduleError } = await admin.from("modules").insert({ org_id: meta.org.id, course_id: course!.id, title: "Listening", sequence: 0 }).select("id").single();
  if (moduleError) throw moduleError;
  const { data: lesson, error: lessonError } = await admin.from("lessons").insert({ org_id: meta.org.id, module_id: module!.id, title: "Listen", sequence: 0 }).select("id").single();
  if (lessonError) throw lessonError;
  const { error: linkError } = await admin.from("lesson_learning_objects").insert({ org_id: meta.org.id, lesson_id: lesson!.id, learning_object_id: learningObject!.id, sequence: 0 });
  if (linkError) throw linkError;
  const { error: enrollmentError } = await admin.from("enrollments").insert({ org_id: meta.org.id, user_id: meta.users.learner.userId, enrollable_type: "course", enrollable_id: course!.id, enrolled_version: course!.version });
  if (enrollmentError) throw enrollmentError;

  const api = await pwRequest.newContext({ baseURL: "http://localhost:3000", storageState: path.join(AUTH_DIR, "learner.json") });
  const response = await api.get("/api/v1/skills");
  expect(response.status()).toBe(200);
  const body = await response.json();
  const learnerSkill = body.data.skills.find((row: { id: string }) => row.id === skill!.id);
  expect(learnerSkill).toMatchObject({ state: "in_progress", recommendations: [{ id: course!.id, status: "continue" }] });
  expect(body.data.skills.some((row: { id: string }) => row.id === foreignSkill!.id)).toBe(false);
  await api.dispose();

  const context = await browser.newContext({ baseURL: "http://localhost:3000", storageState: path.join(AUTH_DIR, "learner.json") });
  const page = await context.newPage();
  await page.goto("/skills");
  await expect(page.getByRole("heading", { name: "Skills in your learning" })).toBeVisible();
  await expect(page.getByRole("heading", { name: skill!.name })).toBeVisible();
  await expect(page.getByRole("link", { name: /Continue/ })).toBeVisible();
  await expect(page.getByText(foreignSkill!.name)).toHaveCount(0);
  await context.close();
});
