import { test, expect, request as pwRequest } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Meta } from "./global-setup";
import { createLocalAdminClient } from "./local-supabase-admin";

/**
 * Phase 3 step 10 — accessibility gates, end to end.
 *
 * Two things are proven here that a unit test cannot: that the publish route
 * actually refuses a course with accessibility errors, and that a learner
 * using only a keyboard can get through the runtime. The second is the half
 * that is easy to claim and hard to evidence, so it is driven with real Tab
 * presses against real rendered output.
 */
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

const IMAGE_ASSET = "11111111-1111-4111-8111-111111111111";

function specWithImage(label: string, altText?: string, profile?: string) {
  return {
    specSchemaVersion: "1.0.0",
    meta: {
      title: `A11y ${label}`,
      locale: "en",
      ...(profile ? { accessibilityProfile: profile } : {}),
    },
    completion: { rule: "allPagesVisited" },
    sections: [
      {
        id: "s1",
        title: "Section 1",
        pages: [
          {
            id: "page1",
            title: "Intro",
            blocks: [
              { id: "h1", type: "heading", text: `A11y heading ${label}`, level: 1 },
              {
                id: "img1",
                type: "image",
                assetId: IMAGE_ASSET,
                ...(altText ? { a11y: { altText } } : {}),
              },
            ],
          },
        ],
      },
    ],
  };
}

async function seedSpec(label: string, spec: unknown, status = "approval") {
  const { data, error } = await dbClient()
    .from("course_specifications")
    .insert({
      org_id: meta.org.id,
      title: `A11y ${label}`,
      spec,
      spec_schema_version: "1.0.0",
      status,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data!.id as string;
}

test("publishing is refused when an image has no alt text", async () => {
  const specId = await seedSpec(`no-alt-${Date.now()}`, specWithImage(`no-alt-${Date.now()}`));
  const api = await apiAs("org_admin");

  const res = await api.post(`/api/v1/authoring/specs/${specId}/publish`, { data: { status: "published" } });
  expect(res.status()).toBe(422);

  const body = await res.json();
  expect(body.error.code).toBe("NOT_PUBLISHABLE");
  const codes = body.error.details.findings.map((f: { code: string }) => f.code);
  expect(codes).toContain("ALT_TEXT_MISSING");

  // Still not published, and the refusal was recorded for the author to read.
  const after = await dbClient().from("course_specifications").select("status").eq("id", specId).single();
  expect(after.data!.status).toBe("approval");

  const reports = await dbClient()
    .from("spec_validation_reports")
    .select("kind, severity")
    .eq("course_specification_id", specId);
  expect(reports.data!.length).toBeGreaterThan(0);

  await api.dispose();
});

test("the same course publishes once the alt text is supplied", async () => {
  const label = `with-alt-${Date.now()}`;
  const specId = await seedSpec(label, specWithImage(label, "A clearly marked fire exit"));
  const api = await apiAs("org_admin");

  const res = await api.post(`/api/v1/authoring/specs/${specId}/publish`, { data: { status: "published" } });
  expect(res.status(), JSON.stringify(await res.json())).toBe(200);

  const after = await dbClient().from("course_specifications").select("status").eq("id", specId).single();
  expect(after.data!.status).toBe("published");

  await api.dispose();
});

test("a course that opts out of the profile is reported on but not blocked", async () => {
  const label = `opted-out-${Date.now()}`;
  // Same missing alt text as the first test — only the declared profile differs.
  const specId = await seedSpec(label, specWithImage(label, undefined, "none"));
  const api = await apiAs("org_admin");

  const res = await api.post(`/api/v1/authoring/specs/${specId}/publish`, { data: { status: "published" } });
  expect(res.status()).toBe(200);

  // Opting out of the gate is not opting out of being told: the finding is
  // still recorded, at a severity that does not block.
  const reports = await dbClient()
    .from("spec_validation_reports")
    .select("findings")
    .eq("course_specification_id", specId)
    .limit(1)
    .single();
  const codes = (reports.data!.findings as Array<{ code: string; severity: string }>).map((f) => f.code);
  expect(codes).toContain("ALT_TEXT_MISSING");

  await api.dispose();
});

test("saving is never blocked by an accessibility problem, only publishing", async () => {
  const label = `save-${Date.now()}`;
  const specId = await seedSpec(label, specWithImage(label), "draft");
  const api = await apiAs("org_admin");

  const loaded = await api.get(`/api/v1/authoring/specs/${specId}`);
  const baseUpdatedAt = (await loaded.json()).data.spec.updated_at;

  // An edit that leaves the accessibility error in place must still save —
  // a gate that fired on every keystroke would be switched off within a week.
  const patched = await api.patch(`/api/v1/authoring/specs/${specId}`, {
    data: {
      baseUpdatedAt,
      patch: [{ op: "replace", path: "/sections/0/pages/0/blocks/0/text", value: "Edited heading" }],
    },
  });
  expect(patched.status()).toBe(200);

  // And the response tells the author what is still outstanding.
  const validation = (await patched.json()).data.validation;
  const codes = validation.findings.map((f: { code: string }) => f.code);
  expect(codes).toContain("ALT_TEXT_MISSING");

  await api.dispose();
});

test("a learner can reach and operate the runtime with the keyboard alone", async ({ browser }) => {
  const label = `kbd-${Date.now()}`;
  const spec = {
    specSchemaVersion: "1.0.0",
    meta: { title: `Keyboard ${label}`, locale: "en" },
    navigation: { showMenu: true },
    completion: { rule: "passedQuiz", quizBlockId: "quiz1" },
    sections: [
      {
        id: "s1",
        title: "S1",
        pages: [
          {
            id: "page1",
            title: "Intro",
            blocks: [
              { id: "h1", type: "heading", text: `Keyboard heading ${label}`, level: 1 },
              {
                id: "acc1",
                type: "accordion",
                items: [{ id: "a1", title: "Expandable section", content: { blocks: [{ kind: "paragraph", spans: [{ text: "Revealed." }] }] } }],
              },
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
                    prompt: { blocks: [{ kind: "paragraph", spans: [{ text: "Reachable by keyboard?" }] }] },
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

  const specId = await seedSpec(label, spec, "published");

  const { data: lo } = await dbClient()
    .from("learning_objects")
    .insert({
      org_id: meta.org.id,
      title: `Keyboard LO ${label}`,
      status: "published",
      source: "authored",
      course_specification_id: specId,
    })
    .select("id")
    .single();

  const { data: course } = await dbClient()
    .from("courses")
    .insert({
      org_id: meta.org.id,
      title: `Keyboard Course ${label}`,
      slug: `keyboard-course-${label}`,
      status: "published",
      published_at: new Date().toISOString(),
    })
    .select("id, version")
    .single();

  const { data: mod } = await dbClient()
    .from("modules").insert({ org_id: meta.org.id, course_id: course!.id, title: "M", sequence: 0 }).select("id").single();
  const { data: lesson } = await dbClient()
    .from("lessons").insert({ org_id: meta.org.id, module_id: mod!.id, title: "L", sequence: 0 }).select("id").single();
  await dbClient()
    .from("lesson_learning_objects")
    .insert({ org_id: meta.org.id, lesson_id: lesson!.id, learning_object_id: lo!.id, sequence: 0 });
  await dbClient().from("enrollments").insert({
    org_id: meta.org.id,
    user_id: meta.users.learner.userId,
    enrollable_type: "course",
    enrollable_id: course!.id,
    enrolled_version: course!.version,
  });

  const context = await browser.newContext({
    baseURL: "http://localhost:3000",
    storageState: path.join(AUTH_DIR, "learner.json"),
  });
  const page = await context.newPage();
  await page.goto(`/courses/${course!.id}`);

  /** Tabs forward until `predicate` matches the focused element, or gives up. */
  async function tabUntil(predicate: () => Promise<boolean>, limit = 60) {
    for (let i = 0; i < limit; i++) {
      if (await predicate()) return true;
      await page.keyboard.press("Tab");
    }
    return predicate();
  }

  const focusedText = () => page.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
  const focusedTag = () => page.evaluate(() => document.activeElement?.tagName ?? "");

  // Wait for the outline to exist before tabbing. Tabbing through a page that
  // is still loading finds nothing and reports it as an accessibility
  // failure — which is a race in the test, not a keyboard trap in the product.
  await expect(page.getByRole("button", { name: new RegExp(`Keyboard LO ${label}`) })).toBeVisible();

  // The course outline entry must be reachable without a mouse.
  await page.keyboard.press("Tab");
  const reachedLo = await tabUntil(async () => (await focusedText()).includes(`Keyboard LO ${label}`));
  expect(reachedLo, "the learning object was never focusable by keyboard").toBe(true);
  await page.keyboard.press("Enter");

  await expect(page.getByRole("heading", { name: `Keyboard heading ${label}` })).toBeVisible();

  // The accordion is a real <summary>, so it is focusable and operable.
  const reachedAccordion = await tabUntil(async () => (await focusedText()).includes("Expandable section"));
  expect(reachedAccordion, "the accordion was never focusable by keyboard").toBe(true);
  await page.keyboard.press("Enter");
  await expect(page.getByText("Revealed.")).toBeVisible();

  // Advance to the quiz page using the keyboard only.
  const reachedNext = await tabUntil(async () => (await focusedText()).startsWith("Next:"));
  expect(reachedNext, "the next-page control was never focusable by keyboard").toBe(true);
  await page.keyboard.press("Enter");
  await expect(page.getByText("Reachable by keyboard?")).toBeVisible();

  // Answer and submit without touching the mouse.
  const reachedRadio = await tabUntil(async () => (await focusedTag()) === "INPUT");
  expect(reachedRadio, "the answer input was never focusable by keyboard").toBe(true);
  await page.keyboard.press("Space");

  const reachedSubmit = await tabUntil(async () => (await focusedText()) === "Submit");
  expect(reachedSubmit, "the submit button was never focusable by keyboard").toBe(true);
  await page.keyboard.press("Enter");

  await expect(page.getByText(/Score: 100%/)).toBeVisible();

  await context.close();
});

test("authored heading levels survive into real heading elements in the runtime", async ({ browser }) => {
  // Scoped to heading semantics on purpose. Alt text reaching a rendered
  // <img> is already asserted at the renderer level in
  // tests/runtime/blocks.test.ts (runtime) and tests/export/render.test.ts
  // (export), both of which can seed a resolved asset URL directly. Repeating
  // it here would need a real uploaded file and would then be testing the
  // asset-serving pipeline rather than accessibility.
  //
  // Heading level is different: it only becomes real when the renderer maps
  // `level` onto an actual <h1>-<h6>, and that mapping is what screen-reader
  // heading navigation depends on. Worth proving in a real browser.
  const label = `sr-${Date.now()}`;
  const specId = await seedSpec(label, specWithImage(label, "A clearly marked fire exit"), "published");

  const context = await browser.newContext({
    baseURL: "http://localhost:3000",
    storageState: path.join(AUTH_DIR, "org_admin.json"),
  });
  const page = await context.newPage();

  // Preview renders the real learner runtime, not a separate preview path.
  await page.goto(`/admin/authoring/${specId}`);
  await page.getByRole("button", { name: "Preview" }).click();

  await expect(page.getByRole("heading", { level: 1, name: `A11y heading ${label}` })).toBeVisible();

  await context.close();
});
