import { test, expect, request as pwRequest } from "@playwright/test";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Meta } from "./global-setup";
import { createLocalAdminClient } from "./local-supabase-admin";

// Phase 3 step 5 — the runtime interpreter and native player, proven in a
// real browser against a real database.
//
// Setup is seeded **directly into the database**, not driven through the
// content API. That is deliberate: the API path (create course -> module ->
// lesson -> attach -> three publish transitions) is already fully covered by
// course-lifecycle.spec.ts and role-matrix.spec.ts, and re-driving it here
// added ~8 sequential round trips to the front of the first-running spec —
// paying the whole suite's cold-compile cost before the runtime was even
// reached, which is what made this file flaky rather than any runtime
// behaviour. What this file is for is the runtime; everything upstream of it
// is fixture, so it is built as fixture.
const AUTH_DIR = path.join(__dirname, ".auth");
const meta = JSON.parse(readFileSync(path.join(AUTH_DIR, "meta.json"), "utf-8")) as Meta;

async function apiAs(key: keyof Meta["users"]) {
  return pwRequest.newContext({ baseURL: "http://localhost:3000", storageState: path.join(AUTH_DIR, `${key}.json`) });
}

/**
 * One admin client for the whole file.
 *
 * createLocalAdminClient() shells out to `npx supabase status` through
 * execSync, which blocks Node's event loop for ~8 seconds. Calling it
 * mid-test — particularly just after a navigation, while the player's
 * keepalive save is still settling — stalls Playwright's own driver at
 * exactly the wrong moment. Resolved once, up front, where the cost is
 * harmless.
 */
let cachedDb: ReturnType<typeof createLocalAdminClient> | null = null;
function dbClient() {
  if (!cachedDb) cachedDb = createLocalAdminClient();
  return cachedDb;
}

function buildSpec(label: string) {
  return {
    specSchemaVersion: "1.0.0", // mirrors lib/spec/version.ts's SPEC_SCHEMA_VERSION
    meta: { title: `Runtime E2E ${label}`, locale: "en" },
    navigation: { showMenu: true },
    completion: { rule: "passedQuiz", quizBlockId: "quiz1" },
    sections: [
      {
        id: "s1",
        title: "Section 1",
        pages: [
          {
            id: "page1",
            title: "Welcome",
            blocks: [
              { id: "h1", type: "heading", text: `Runtime playback proof ${label}`, level: 1 },
              {
                id: "t1",
                type: "text",
                content: { blocks: [{ kind: "paragraph", spans: [{ text: "Interpreted straight from the spec, not hardcoded." }] }] },
              },
            ],
          },
          {
            id: "page2",
            title: "Quiz",
            blocks: [
              {
                id: "quiz1",
                type: "quiz",
                title: "Final Check",
                passingScorePercent: 100,
                items: [
                  {
                    id: "q1",
                    kind: "trueFalse",
                    prompt: { blocks: [{ kind: "paragraph", spans: [{ text: "Is this rendered by the runtime interpreter?" }] }] },
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
}

interface SeededCourse {
  courseId: string;
  specId: string;
  loTitle: string;
  label: string;
}

/**
 * Builds a published course whose single learning object is authored
 * content backed by a course_specifications row, plus the learner's
 * enrolment — the exact state the runtime player expects to be launched
 * into. One batch of inserts, no HTTP.
 */
async function seedAuthoredCourse(label: string): Promise<SeededCourse> {
  const db = dbClient();
  const spec = buildSpec(label);

  const { data: specRow, error: specError } = await db
    .from("course_specifications")
    .insert({ org_id: meta.org.id, title: spec.meta.title, spec, spec_schema_version: "1.0.0", status: "published" })
    .select("id")
    .single();
  if (specError) throw specError;

  const loTitle = `Authored LO ${label}`;
  const { data: loRow, error: loError } = await db
    .from("learning_objects")
    .insert({
      org_id: meta.org.id,
      title: loTitle,
      status: "published",
      source: "authored",
      course_specification_id: specRow!.id,
    })
    .select("id")
    .single();
  if (loError) throw loError;

  const { data: courseRow, error: courseError } = await db
    .from("courses")
    .insert({
      org_id: meta.org.id,
      title: `Runtime Course ${label}`,
      slug: `runtime-course-${label}`,
      description: "Authored runtime proof.",
      status: "published",
      published_at: new Date().toISOString(),
    })
    .select("id, version")
    .single();
  if (courseError) throw courseError;

  const { data: moduleRow, error: moduleError } = await db
    .from("modules")
    .insert({ org_id: meta.org.id, course_id: courseRow!.id, title: "Module 1", sequence: 0 })
    .select("id")
    .single();
  if (moduleError) throw moduleError;

  const { data: lessonRow, error: lessonError } = await db
    .from("lessons")
    .insert({ org_id: meta.org.id, module_id: moduleRow!.id, title: "Lesson 1", sequence: 0 })
    .select("id")
    .single();
  if (lessonError) throw lessonError;

  const { error: linkError } = await db
    .from("lesson_learning_objects")
    .insert({ org_id: meta.org.id, lesson_id: lessonRow!.id, learning_object_id: loRow!.id, sequence: 0 });
  if (linkError) throw linkError;

  // Seeded rather than clicked: the "Enrol" button is course-lifecycle
  // .spec.ts's subject, and an unenrolled player hides the progress
  // affordances this file needs to assert on.
  const { error: enrolError } = await db.from("enrollments").insert({
    org_id: meta.org.id,
    user_id: meta.users.learner.userId,
    enrollable_type: "course",
    enrollable_id: courseRow!.id,
    enrolled_version: courseRow!.version,
  });
  if (enrolError) throw enrolError;

  return { courseId: courseRow!.id, specId: specRow!.id, loTitle, label };
}

async function learnerPage(browser: import("@playwright/test").Browser) {
  const context = await browser.newContext({
    baseURL: "http://localhost:3000",
    storageState: path.join(AUTH_DIR, "learner.json"),
  });
  return { context, page: await context.newPage() };
}

test("a learner plays an authored course: spec-driven rendering, quiz scoring, and completion roll-up", async ({ browser }) => {
  const seeded = await seedAuthoredCourse(`play-${Date.now()}`);
  const { context, page } = await learnerPage(browser);

  await page.goto(`/courses/${seeded.courseId}`);
  await page.getByRole("button", { name: new RegExp(seeded.loTitle) }).click();

  // This content exists nowhere but inside the `spec` jsonb column — seeing
  // it on screen means the interpreter walked the block tree and the
  // renderers turned it into DOM.
  await expect(page.getByRole("heading", { name: `Runtime playback proof ${seeded.label}` })).toBeVisible();
  await expect(page.getByText("Interpreted straight from the spec, not hardcoded.")).toBeVisible();

  await page.getByRole("button", { name: "Next: Quiz" }).click();
  await expect(page.getByText("Is this rendered by the runtime interpreter?")).toBeVisible();

  await page.getByRole("radio", { name: "True" }).check();
  await page.getByRole("button", { name: "Submit" }).click();

  await expect(page.getByText(/Score: 100%/)).toBeVisible();
  await expect(page.getByText("Passed")).toBeVisible();
  await expect(page.getByText("✓ Course complete")).toBeVisible();

  // The course-level percentage comes from the existing Phase 2 progress
  // rollup, reached through the same PUT /api/v1/progress that asset and
  // SCORM content already use — proving the runtime's completion signal
  // lands in Phase 2's untouched logic rather than a parallel one. The
  // player's real markup (app/(app)/courses/[id]/player.tsx) shows the
  // percent and the word "complete" as separate text nodes, never a
  // single "100% complete" string, so this checks the percent element
  // directly.
  await expect(page.locator(".focus-player__outline-heading strong")).toHaveText("100%");

  await context.close();

  const db = dbClient();

  const { data: runtimeState, error: rsErr } = await db
    .from("course_runtime_state")
    .select("completed_at, current_page_id, spec_version, block_states")
    .eq("org_id", meta.org.id)
    .eq("course_specification_id", seeded.specId)
    .eq("user_id", meta.users.learner.userId)
    .single();
  expect(rsErr).toBeNull();
  expect(runtimeState!.completed_at).not.toBeNull();
  expect(runtimeState!.current_page_id).toBe("page2");
  expect(runtimeState!.block_states.visitedPages).toEqual(["page1", "page2"]);
  expect(runtimeState!.block_states.quizAttempts.quiz1.scorePercent).toBe(100);

  const { data: statements, error: stErr } = await db
    .from("xapi_statements")
    .select("verb, result, actor")
    .eq("org_id", meta.org.id)
    // object.id carries an optional ":<blockId>" suffix depending on the verb
    // (see lib/runtime/xapi.ts's buildStatement), so match the spec-id prefix
    // rather than exact equality — the latter only ever matches the
    // no-suffix statements and silently misses `answered`/`passed`.
    .ilike("object->>id", `urn:lms:course-specification:${seeded.specId}%`);
  expect(stErr).toBeNull();

  const verbIds = (statements ?? []).map((s: { verb: { id?: string } }) => s.verb?.id ?? "");
  for (const verb of ["initialized", "progressed", "answered", "completed", "passed"]) {
    expect(verbIds.some((v) => v.endsWith(`/${verb}`)), verb).toBe(true);
  }

  // Every statement is attributed to the real learner, never to whatever a
  // client might have claimed.
  for (const s of statements ?? []) {
    expect((s.actor as { mbox?: string }).mbox).toBe(`mailto:${meta.users.learner.email}`);
  }

  const enrRes = await (await apiAs("learner")).get("/api/v1/enrollments");
  const enrolments = (await enrRes.json()).data.enrollments;
  const thisEnrolment = enrolments.find((e: { enrollable_id: string }) => e.enrollable_id === seeded.courseId);
  expect(thisEnrolment.status).toBe("completed");
});

test("a learner resuming after a reload lands back mid-course, not at the start", async ({ browser }) => {
  const seeded = await seedAuthoredCourse(`resume-${Date.now()}`);
  const { context, page } = await learnerPage(browser);

  await page.goto(`/courses/${seeded.courseId}`);
  await page.getByRole("button", { name: new RegExp(seeded.loTitle) }).click();
  await expect(page.getByRole("heading", { name: `Runtime playback proof ${seeded.label}` })).toBeVisible();

  // Arm the wait *before* the click: the player autosaves on a debounce, and
  // asserting on the reloaded page without knowing the write landed is a
  // race against it rather than a test of resume.
  const saved = page.waitForResponse(
    (r) => r.url().includes(`/runtime/courses/${seeded.specId}/state`) && r.request().method() === "PUT"
  );
  await page.getByRole("button", { name: "Next: Quiz" }).click();
  await expect(page.getByText("Is this rendered by the runtime interpreter?")).toBeVisible();
  await saved;

  // Leave without finishing, then come back.
  await page.reload();
  await page.getByRole("button", { name: new RegExp(seeded.loTitle) }).click();

  await expect(page.getByText("Is this rendered by the runtime interpreter?")).toBeVisible();
  await expect(page.getByRole("heading", { name: `Runtime playback proof ${seeded.label}` })).not.toBeVisible();

  await context.close();

  const db = dbClient();
  const { data: row } = await db
    .from("course_runtime_state")
    .select("current_page_id, completed_at")
    .eq("org_id", meta.org.id)
    .eq("course_specification_id", seeded.specId)
    .eq("user_id", meta.users.learner.userId)
    .single();
  expect(row!.current_page_id).toBe("page2");
  expect(row!.completed_at).toBeNull(); // resumed, not completed
});

test("a learner who leaves immediately after advancing does not lose their position to the autosave debounce", async ({ browser }) => {
  // Regression test for a real defect this suite caught: the player batches
  // state writes on an 800ms debounce, and a learner who advanced a page and
  // then left inside that window had the write cancelled by the page
  // teardown — silently losing the position they had just reached. The fix
  // flushes pending state on pagehide/visibilitychange/unmount via
  // navigator.sendBeacon, so leaving *is* a save.
  //
  // Note this only fails on a warm server: cold, the click-to-navigate
  // sequence takes longer than the 800ms debounce, so the ordinary save
  // path covers for the missing flush and the test passes for the wrong
  // reason. That is precisely how the original defect hid — do not "fix" a
  // future failure here by slowing the test down.
  const seeded = await seedAuthoredCourse(`flush-${Date.now()}`);
  const { context, page } = await learnerPage(browser);

  await page.goto(`/courses/${seeded.courseId}`);
  await page.getByRole("button", { name: new RegExp(seeded.loTitle) }).click();
  await expect(page.getByRole("heading", { name: `Runtime playback proof ${seeded.label}` })).toBeVisible();

  // Advance and leave at once — deliberately NOT waiting for the debounce.
  //
  // Leaving is a real navigation rather than context.close(): closing the
  // context destroys the whole browser process, which takes any in-flight
  // keepalive request with it. That is harsher than anything a learner does
  // — closing a tab, following a link, backgrounding the app all leave the
  // browser alive to finish the send — so it would test the harness, not the
  // behaviour.
  await page.getByRole("button", { name: "Next: Quiz" }).click();
  await expect(page.getByText("Is this rendered by the runtime interpreter?")).toBeVisible();
  await page.goto("/dashboard");

  const db = dbClient();
  const deadline = Date.now() + 10_000;
  let currentPageId: string | null = null;
  while (Date.now() < deadline) {
    const { data } = await db
      .from("course_runtime_state")
      .select("current_page_id")
      .eq("org_id", meta.org.id)
      .eq("course_specification_id", seeded.specId)
      .eq("user_id", meta.users.learner.userId)
      .maybeSingle();
    currentPageId = data?.current_page_id ?? null;
    if (currentPageId === "page2") break;
    await new Promise((r) => setTimeout(r, 250));
  }
  expect(currentPageId).toBe("page2");

  await context.close();
});

test("the runtime routes never serve another org's course specification or its state", async () => {
  const seeded = await seedAuthoredCourse(`isolation-${Date.now()}`);

  const otherCtx = await apiAs("otherOrgOwner");

  expect((await otherCtx.get(`/api/v1/runtime/courses/${seeded.specId}`)).status()).toBe(404);
  expect((await otherCtx.get(`/api/v1/runtime/courses/${seeded.specId}/state`)).status()).toBe(404);

  const statePut = await otherCtx.put(`/api/v1/runtime/courses/${seeded.specId}/state`, {
    data: { current_page_id: "page1", variables: {}, block_states: {}, completed: false },
  });
  expect(statePut.status()).toBe(404);

  await otherCtx.dispose();
});

test("an unpublished specification is refused to a learner but served to an author previewing it", async () => {
  const db = dbClient();
  const spec = buildSpec(`draft-${Date.now()}`);
  const { data: draft } = await db
    .from("course_specifications")
    .insert({ org_id: meta.org.id, title: spec.meta.title, spec, spec_schema_version: "1.0.0", status: "draft" })
    .select("id")
    .single();

  const learnerCtx = await apiAs("learner");
  // Not published: refused outright, and adding the preview flag must not
  // change that for someone without the authoring role.
  expect((await learnerCtx.get(`/api/v1/runtime/courses/${draft!.id}`)).status()).toBe(403);
  expect((await learnerCtx.get(`/api/v1/runtime/courses/${draft!.id}?preview=true`)).status()).toBe(403);
  await learnerCtx.dispose();

  const adminCtx = await apiAs("org_admin");
  expect((await adminCtx.get(`/api/v1/runtime/courses/${draft!.id}`)).status()).toBe(403);
  const preview = await adminCtx.get(`/api/v1/runtime/courses/${draft!.id}?preview=true`);
  expect(preview.status()).toBe(200);
  expect((await preview.json()).data.status).toBe("draft");
  await adminCtx.dispose();
});

test("the xAPI statements route always stamps the caller's own identity, ignoring a client-supplied actor", async () => {
  const admin = await apiAs("org_admin");
  const statementId = randomUUID();

  const res = await admin.post("/api/v1/runtime/xapi/statements", {
    data: {
      statements: [
        {
          id: statementId,
          actor: { objectType: "Agent", mbox: "mailto:spoofed@example.test" },
          verb: { id: "http://adlnet.gov/expapi/verbs/experienced" },
          object: { id: "urn:lms:course-specification:test", objectType: "Activity" },
          timestamp: new Date().toISOString(),
        },
      ],
    },
  });
  expect(res.status()).toBe(201);
  await admin.dispose();

  const db = dbClient();
  const { data: row, error } = await db.from("xapi_statements").select("actor").eq("id", statementId).single();
  expect(error).toBeNull();
  expect(row!.actor.mbox).toBe(`mailto:${meta.users.org_admin.email}`);
  expect(row!.actor.mbox).not.toBe("mailto:spoofed@example.test");

  await db.from("xapi_statements").delete().eq("id", statementId);
});
