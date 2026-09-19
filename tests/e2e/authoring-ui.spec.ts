import { test, expect, request as pwRequest, type APIRequestContext } from "@playwright/test";
import path from "node:path";

// Drives the Admin Authoring UI — the screens built over Phase 2's
// backend, exercised the way an author actually uses them.
//
// Split into focused tests rather than one long journey: a single
// end-to-end pass against a dev server that compiles routes on first hit
// is slow and gives poor failure signal. Each test here drives one screen
// and seeds its prerequisites through the API, which is also how the
// other API-level specs work.
const AUTH_DIR = path.join(__dirname, ".auth");
const adminState = path.join(AUTH_DIR, "org_admin.json");

test.use({ storageState: adminState });

async function adminApi(): Promise<APIRequestContext> {
  return pwRequest.newContext({
    baseURL: "http://localhost:3000",
    storageState: adminState,
  });
}

test("content library: a real file upload lands in Storage and is listed", async ({ page }) => {
  const suffix = Date.now();

  await page.goto("/admin/content/assets");
  // The page's real h1 (app/(app)/admin/content/assets/page.tsx) — this
  // assertion predates the "Orbit Studio" content-page copy and was never
  // updated to match.
  await expect(page.getByRole("heading", { name: "Bring your learning materials into one place." })).toBeVisible();

  await page.setInputFiles("#asset-file", {
    name: `handbook-${suffix}.pdf`,
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 handbook uploaded from the authoring UI\n"),
  });
  // The real submit button label (assets-console.tsx) — never bare
  // "Upload".
  await page.getByRole("button", { name: "Add to library →" }).click();

  // The confirmation only appears after the signed URL was issued, the
  // bytes were PUT to Storage, and the row was created.
  await expect(page.getByText(/Uploaded handbook-/)).toBeVisible();
  // Scoped to the table cell rather than a bare getByText: the upload
  // toast above is a substring match on the same filename, so an
  // unscoped locator resolves two elements under Playwright's strict
  // mode and fails immediately regardless of timing. A cell locator
  // also asserts something stronger — that the row actually landed in
  // the list, not just that the filename appears somewhere on the page.
  await expect(page.getByRole("cell", { name: `handbook-${suffix}.pdf` })).toBeVisible();
});

test("learning object: create, attach content, edit, and publish through the workflow", async ({
  page,
}) => {
  const suffix = Date.now();
  const api = await adminApi();

  // Seed one asset so there's something to attach.
  const up = await api.post("/api/v1/content/upload-url", {
    data: { filename: `attachable-${suffix}.pdf` },
  });
  const { data: signed } = await up.json();
  await api.fetch(signed.signedUrl, {
    method: "PUT",
    headers: { "Content-Type": "application/pdf" },
    data: Buffer.from("%PDF-1.4 attachable\n"),
  });
  await api.post("/api/v1/content/assets", {
    data: { storagePath: signed.path, type: "pdf", mimeType: "application/pdf", fileSize: 20 },
  });
  await api.dispose();

  await page.goto("/admin/content/learning-objects");
  await page.getByLabel("Title").fill(`Code of Conduct ${suffix}`);
  await page.getByRole("button", { name: "Create" }).click();

  const link = page.getByRole("link", { name: `Code of Conduct ${suffix}` });
  await expect(link).toBeVisible();
  // Navigate by href: the list re-renders right after create, so a click
  // can race that re-render.
  await page.goto((await link.getAttribute("href"))!);

  await expect(page.getByRole("heading", { name: "Attached content" })).toBeVisible();
  await page.getByLabel("Attach from the content library").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Attach" }).click();
  await expect(page.getByRole("button", { name: "Detach" })).toBeVisible();

  await page.getByLabel("Description").fill("Read this before your first shift.");
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByText("Saved")).toBeVisible();

  // Each transition is confirmed landed before the next is attempted —
  // the buttons are disabled while one is in flight.
  await expect(page.getByText("draft", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Move to review" }).click();
  await expect(page.getByText("review", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Move to approval" }).click();
  await expect(page.getByText("approval", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("published", { exact: true }).first()).toBeVisible();

  // Publishing wrote an immutable snapshot, surfaced in version history.
  await expect(page.getByRole("heading", { name: "Version history" })).toBeVisible();
  await expect(page.getByRole("button", { name: "View snapshot" }).first()).toBeVisible();
});

test("course: build structure, reuse a learning object, publish, and preview", async ({ page }) => {
  const suffix = Date.now();
  const api = await adminApi();

  // Seed the learning object this course will reuse — the UI aspect
  // under test is the structure builder and the reuse picker.
  const loRes = await api.post("/api/v1/content/learning-objects", {
    data: { title: `Shared object ${suffix}` },
  });
  expect(loRes.status()).toBe(201);
  await api.dispose();

  await page.goto("/admin/content/courses");
  await page.getByLabel("Title").fill(`Onboarding ${suffix}`);
  // The submit button's real label (courses-console.tsx) — never "Create
  // course" as such; this assertion was stale from the start.
  await page.getByRole("button", { name: "Open course studio →" }).click();

  const courseLink = page.getByRole("link", { name: `Onboarding ${suffix}` });
  await expect(courseLink).toBeVisible();
  const courseHref = (await courseLink.getAttribute("href"))!;
  const courseId = courseHref.split("/").pop()!;
  await page.goto(courseHref);
  await expect(page.getByRole("heading", { name: `Onboarding ${suffix}` })).toBeVisible();

  await page.getByPlaceholder("New module title").fill("Module 1");
  await page.getByRole("button", { name: "Add module" }).click();
  await expect(page.getByText("Module 1 module")).toBeVisible();

  await page.getByPlaceholder("New lesson title").fill("Lesson 1");
  await page.getByRole("button", { name: "Add lesson" }).click();
  await expect(page.getByText("Lesson 1", { exact: true })).toBeVisible();

  // Reuse: pick an existing learning object rather than authoring a copy.
  await page
    .getByRole("combobox")
    .last()
    .selectOption({ label: `[content] Shared object ${suffix}` });
  await page.getByRole("button", { name: "Add to lesson" }).click();
  await expect(page.getByRole("link", { name: `Shared object ${suffix}` })).toBeVisible();

  await page.getByRole("button", { name: "Move to review" }).click();
  await expect(page.getByText("review", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Move to approval" }).click();
  await expect(page.getByText("approval", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("published", { exact: true }).first()).toBeVisible();

  // The course snapshot captured the structure that was just built.
  await page.getByRole("button", { name: "View snapshot" }).first().click();
  await expect(page.getByText(/"modules"/)).toBeVisible();

  // Preview opens the same player a learner uses.
  await page.goto(`/courses/${courseId}`);
  await expect(page.getByRole("button", { name: `Shared object ${suffix}` })).toBeVisible();
});

test("the same learning object can be reused by a second course", async ({ page }) => {
  const suffix = Date.now();
  const api = await adminApi();

  const loRes = await api.post("/api/v1/content/learning-objects", {
    data: { title: `Reused twice ${suffix}` },
  });
  const loId = (await loRes.json()).data.learningObject.id;

  // Two courses, each with a lesson, built through the API; the UI step
  // under test is attaching the SAME object to both via the picker.
  const courseIds: string[] = [];
  for (const name of [`First ${suffix}`, `Second ${suffix}`]) {
    const c = await api.post("/api/v1/content/courses", { data: { title: name } });
    const id = (await c.json()).data.course.id;
    const m = await api.post(`/api/v1/content/courses/${id}/structure`, {
      data: { kind: "module", title: "M", sequence: 0 },
    });
    const moduleId = (await m.json()).data.module.id;
    await api.post(`/api/v1/content/courses/${id}/structure`, {
      data: { kind: "lesson", moduleId, title: "L", sequence: 0 },
    });
    courseIds.push(id);
  }
  await api.dispose();

  for (const id of courseIds) {
    await page.goto(`/admin/content/courses/${id}`);
    await expect(page.getByText("M module")).toBeVisible();
    await page
      .getByRole("combobox")
      .last()
      .selectOption({ label: `[content] Reused twice ${suffix}` });
    await page.getByRole("button", { name: "Add to lesson" }).click();
    await expect(page.getByRole("link", { name: `Reused twice ${suffix}` })).toBeVisible();
  }

  // One object, two courses, no duplication.
  const verify = await adminApi();
  const res = await verify.get(`/api/v1/content/learning-objects/${loId}`);
  expect(res.status()).toBe(200);
  await verify.dispose();
});

test("a learner cannot reach the authoring area", async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: "http://localhost:3000",
    storageState: path.join(AUTH_DIR, "learner.json"),
  });
  const page = await context.newPage();

  await page.goto("/admin/content");
  await expect(page.getByText(/don't have access/i)).toBeVisible();

  await context.close();
});

test("AI Course Builder: an org_admin reaches the panel and sees the honest unconfigured state", async ({
  page,
}) => {
  // No provider is configured in this environment (docs/DEFINITION_OF_DONE_PHASE3.md:
  // "the AI gateway has never called a real provider"), so this exercises the
  // real, current deployment state — not a mocked one. The panel must say so
  // plainly rather than silently letting the deterministic test adapter stand
  // in for AI, and must not offer a form that would only fail on submit.
  await page.goto("/admin/authoring");

  await expect(page.getByText("Generate with AI")).toBeVisible();
  await expect(page.getByText(/not configured for this workspace/i)).toBeVisible();
  await expect(page.getByPlaceholder(/Paste source material here/i)).not.toBeVisible();

  // The rest of the authoring area — manual course creation — is unaffected.
  await expect(page.getByRole("heading", { name: "New interactive course." })).toBeVisible();
});
