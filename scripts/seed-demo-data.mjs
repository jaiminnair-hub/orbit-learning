// Builds a real, persistent "Demo Org" in the LOCAL Supabase instance only,
// with real courses, enrollments at different progress states, a real
// assessment (passed and failed attempts), and the certificates each
// produces -- so the app can be clicked through with something on screen
// instead of the "0 items / nothing due" empty states.
//
// Everything is created through the same HTTP APIs the real UI calls (real
// browser logins via Playwright, real fetches with those session cookies),
// not raw SQL -- so it exercises real validation and real RLS, and so it
// can never accidentally run against a project that isn't local.
//
// Rerunnable: deletes any previous demo org (fixed slug) before rebuilding,
// so `node scripts/seed-demo-data.mjs` always gives a clean, known state.
import { execSync } from "node:child_process";
import { chromium, request as pwRequest } from "playwright";
import { createClient } from "@supabase/supabase-js";

const BASE_URL = process.env.SEED_BASE_URL || "http://localhost:3000";
const PASSWORD = "Demo-data-123!";
const DEMO_SLUG = "demo-org";
const DEMO_NAME = "Demo Org";

function readLocalStatus() {
  const raw = execSync("npx supabase status -o json", { encoding: "utf-8" });
  const jsonStart = raw.indexOf("{");
  if (jsonStart < 0) throw new Error(`No JSON in supabase status output: ${raw.slice(0, 200)}`);
  const status = JSON.parse(raw.slice(jsonStart));
  if (!/127\.0\.0\.1|localhost/.test(status.API_URL)) {
    throw new Error(`Refusing to seed a non-local Supabase project: ${status.API_URL}`);
  }
  return status;
}

async function waitForServer() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(BASE_URL);
      if (res.ok || res.status < 500) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Dev server at ${BASE_URL} never became ready. Start it first (npm run dev).`);
}

async function wipeExistingDemoOrg(admin) {
  const { data: org } = await admin.from("organizations").select("id").eq("slug", DEMO_SLUG).maybeSingle();
  if (!org) return;
  const { data: profiles } = await admin.from("profiles").select("id").eq("org_id", org.id);
  for (const p of profiles ?? []) {
    await admin.auth.admin.deleteUser(p.id).catch(() => {});
  }
  await admin.from("organizations").delete().eq("id", org.id);
  console.log(`Removed previous demo org (${(profiles ?? []).length} user(s)).`);
}

async function createOrgAndUsers(admin) {
  const { data: org, error: orgError } = await admin
    .from("organizations")
    .insert({ name: DEMO_NAME, slug: DEMO_SLUG })
    .select("id, name, slug")
    .single();
  if (orgError) throw orgError;

  async function makeUser(label, role, { platformAdmin = false } = {}) {
    const email = `demo.${label}@example.test`;
    const { data: userRes, error } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    if (error) throw error;
    const userId = userRes.user.id;
    const { error: profileError } = await admin
      .from("profiles")
      .update({ org_id: org.id, role, full_name: label[0].toUpperCase() + label.slice(1).replace(/\d+$/, (n) => ` ${n}`) })
      .eq("id", userId);
    if (profileError) throw profileError;
    if (platformAdmin) {
      await admin.from("platform_admins").insert({ user_id: userId }).select().single();
    }
    return { email, userId, role };
  }

  const users = {
    owner: await makeUser("owner", "org_owner", { platformAdmin: true }),
    admin: await makeUser("admin", "org_admin"),
    manager: await makeUser("manager", "manager"),
    learner1: await makeUser("learner1", "learner"),
    learner2: await makeUser("learner2", "learner"),
    learner3: await makeUser("learner3", "learner"),
  };

  return { org, users };
}

async function loginAs(browser, email) {
  const context = await browser.newContext({ baseURL: BASE_URL });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL(/\/dashboard|\/choose-workspace/, { timeout: 60_000 });
  const storageState = await context.storageState();
  await context.close();
  return pwRequest.newContext({ baseURL: BASE_URL, storageState });
}

async function expectOk(res, label) {
  if (!res.ok()) {
    const body = await res.text().catch(() => "");
    throw new Error(`${label} failed (${res.status()}): ${body}`);
  }
  return res.json();
}

async function buildCourse(adminApi, title, description, loTitles) {
  const loIds = [];
  for (const t of loTitles) {
    const res = await adminApi.post("/api/v1/content/learning-objects", { data: { title: t } });
    const json = await expectOk(res, `create learning object "${t}"`);
    loIds.push(json.data.learningObject.id);
  }

  const courseRes = await adminApi.post("/api/v1/content/courses", { data: { title, description } });
  const courseJson = await expectOk(courseRes, `create course "${title}"`);
  const courseId = courseJson.data.course.id;

  const modRes = await adminApi.post(`/api/v1/content/courses/${courseId}/structure`, {
    data: { kind: "module", title: "Module 1", sequence: 0 },
  });
  const moduleId = (await expectOk(modRes, "create module")).data.module.id;

  const lessonRes = await adminApi.post(`/api/v1/content/courses/${courseId}/structure`, {
    data: { kind: "lesson", moduleId, title: "Lesson 1", sequence: 0 },
  });
  const lessonId = (await expectOk(lessonRes, "create lesson")).data.lesson.id;

  for (const [i, loId] of loIds.entries()) {
    const attachRes = await adminApi.post(`/api/v1/content/courses/${courseId}/structure`, {
      data: { kind: "attach", lessonId, learningObjectId: loId, sequence: i },
    });
    await expectOk(attachRes, `attach learning object ${i}`);
  }

  for (const status of ["review", "approval", "published"]) {
    const res = await adminApi.post(`/api/v1/content/courses/${courseId}/publish`, { data: { status } });
    await expectOk(res, `publish course to ${status}`);
  }

  return { courseId, loIds };
}

async function buildAssessment(adminApi, title) {
  const createRes = await adminApi.post("/api/v1/assessments", {
    data: { title, passPercent: 70, maxAttempts: 2 },
  });
  const assessmentId = (await expectOk(createRes, "create assessment")).data.assessment.id;

  const q1Res = await adminApi.post(`/api/v1/assessments/${assessmentId}/questions`, {
    data: {
      kind: "multipleChoice",
      prompt: "Which of these is a required PPE item on the warehouse floor?",
      choices: [
        { text: "Steel-toe boots", correct: true },
        { text: "Flip-flops", correct: false },
        { text: "Sandals", correct: false },
      ],
    },
  });
  await expectOk(q1Res, "create question 1");

  const q2Res = await adminApi.post(`/api/v1/assessments/${assessmentId}/questions`, {
    data: { kind: "trueFalse", prompt: "It is safe to prop open a fire exit during a shift.", answer: false },
  });
  await expectOk(q2Res, "create question 2");

  await expectOk(await adminApi.post(`/api/v1/assessments/${assessmentId}/publish`), "publish assessment");

  return { assessmentId };
}

async function assignAndAttempt(adminApi, learnerApi, assessmentId, userId, { pass }) {
  await expectOk(
    await adminApi.post(`/api/v1/assessments/${assessmentId}/assign`, { data: { userId } }),
    "assign assessment"
  );
  const startJson = await expectOk(await learnerApi.post(`/api/v1/assessments/${assessmentId}/start`), "start assessment");
  const answers = {};
  for (const q of startJson.data.questions) {
    const item = q.item;
    if (item.kind === "multipleChoice") {
      const correct = item.choices.find((c) => c.correct);
      answers[q.id] = pass ? correct.id : item.choices.find((c) => c.id !== correct.id).id;
    } else if (item.kind === "trueFalse") {
      answers[q.id] = pass ? item.answer : !item.answer;
    }
  }
  return expectOk(
    await learnerApi.post(`/api/v1/assessments/${assessmentId}/submit`, { data: { answers } }),
    "submit assessment"
  );
}

async function completeLearningObjects(learnerApi, courseId, loIds) {
  for (const loId of loIds) {
    await expectOk(
      await learnerApi.put("/api/v1/progress", { data: { learningObjectId: loId, courseId, status: "completed" } }),
      `complete learning object ${loId}`
    );
  }
}

async function enroll(adminApi, courseId, userId) {
  await expectOk(
    await adminApi.post("/api/v1/enrollments", { data: { courseId, userId } }),
    `enroll ${userId} in ${courseId}`
  );
}

async function main() {
  console.log(`Seeding demo data against ${BASE_URL} (local Supabase only)...`);
  const status = readLocalStatus();
  const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  await waitForServer();
  await wipeExistingDemoOrg(admin);
  const { org, users } = await createOrgAndUsers(admin);
  console.log(`Created "${DEMO_NAME}" (${org.slug}) with ${Object.keys(users).length} users.`);

  const browser = await chromium.launch();
  const adminApi = await loginAs(browser, users.admin.email);
  const learner1Api = await loginAs(browser, users.learner1.email);
  const learner2Api = await loginAs(browser, users.learner2.email);
  await browser.close();

  const course1 = await buildCourse(adminApi, "Warehouse Onboarding", "Everything new hires need before their first shift.", [
    "Welcome to the warehouse",
    "Where things are kept",
  ]);
  const course2 = await buildCourse(adminApi, "Workplace Safety", "Core safety rules for every site.", [
    "Personal protective equipment",
    "Reporting a hazard",
  ]);
  console.log("Built and published 2 courses.");

  await enroll(adminApi, course1.courseId, users.learner1.userId);
  await completeLearningObjects(learner1Api, course1.courseId, course1.loIds);
  console.log("learner1: completed Warehouse Onboarding.");

  await enroll(adminApi, course1.courseId, users.learner2.userId);
  await completeLearningObjects(learner2Api, course1.courseId, [course1.loIds[0]]);
  await enroll(adminApi, course2.courseId, users.learner2.userId);
  console.log("learner2: partway through Warehouse Onboarding, not started on Workplace Safety.");

  console.log("learner3: no enrollments (fresh account).");

  const assessment = await buildAssessment(adminApi, "Warehouse Safety Quiz");
  const passResult = await assignAndAttempt(adminApi, learner1Api, assessment.assessmentId, users.learner1.userId, { pass: true });
  console.log(`learner1: passed Warehouse Safety Quiz (${passResult.data.scorePercent}%), certificate ${passResult.data.certificateId ?? "(none)"}.`);
  const failResult = await assignAndAttempt(adminApi, learner2Api, assessment.assessmentId, users.learner2.userId, { pass: false });
  console.log(`learner2: attempted Warehouse Safety Quiz and scored ${failResult.data.scorePercent}% (attempts remaining: ${failResult.data.attemptsRemaining}).`);

  await adminApi.dispose();
  await learner1Api.dispose();
  await learner2Api.dispose();

  console.log("\nDemo org ready. Log in at " + BASE_URL + "/login with password: " + PASSWORD);
  console.log("  demo.owner@example.test    -- org owner + platform admin");
  console.log("  demo.admin@example.test    -- org admin (authoring, reports)");
  console.log("  demo.manager@example.test  -- manager (team insights)");
  console.log("  demo.learner1@example.test -- completed a course, passed the quiz, has a certificate");
  console.log("  demo.learner2@example.test -- mid-course, failed the quiz once, one attempt left");
  console.log("  demo.learner3@example.test -- brand-new account, nothing yet");
  console.log("\nNot covered in this pass: learning paths, SCORM/xAPI packages, AI tutor, competencies, 360 feedback.");
  console.log("Rerun any time with: node scripts/seed-demo-data.mjs");
}

main().catch((err) => {
  console.error("\nSeed failed:", err.message ?? err);
  process.exit(1);
});
