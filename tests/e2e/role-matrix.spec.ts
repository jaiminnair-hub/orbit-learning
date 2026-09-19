import { test, expect, request as pwRequest } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Meta } from "./global-setup";

// API-level role-matrix tests (docs/TESTING.md §3) — the automated
// counterpart to the manual role-matrix verification done by hand in
// docs/DEVELOPMENT_SEQUENCE.md steps 8-9. Each seeded user (see
// global-setup.ts) already has a real, logged-in session persisted via
// Playwright storageState; every request below goes through the real
// running route with real cookies, not a mocked session.
const AUTH_DIR = path.join(__dirname, ".auth");
const meta = JSON.parse(readFileSync(path.join(AUTH_DIR, "meta.json"), "utf-8")) as Meta;

async function apiAs(key: keyof Meta["users"]) {
  return pwRequest.newContext({
    baseURL: "http://localhost:3000",
    storageState: path.join(AUTH_DIR, `${key}.json`),
  });
}

test("GET /api/v1/orgs/me — every authenticated role gets 200", async () => {
  for (const role of ["learner", "manager", "org_admin", "org_owner"] as const) {
    const ctx = await apiAs(role);
    const res = await ctx.get("/api/v1/orgs/me");
    expect(res.status(), role).toBe(200);
    await ctx.dispose();
  }
});

test("GET /api/v1/orgs/members — requires at least manager", async () => {
  const learnerCtx = await apiAs("learner");
  expect((await learnerCtx.get("/api/v1/orgs/members")).status()).toBe(403);
  await learnerCtx.dispose();

  for (const role of ["manager", "org_admin", "org_owner"] as const) {
    const ctx = await apiAs(role);
    expect((await ctx.get("/api/v1/orgs/members")).status(), role).toBe(200);
    await ctx.dispose();
  }
});

test("POST /api/v1/orgs/invitations — requires at least org_admin, and cannot invite above your own rank", async () => {
  for (const role of ["learner", "manager"] as const) {
    const ctx = await apiAs(role);
    const res = await ctx.post("/api/v1/orgs/invitations", {
      data: { email: `role-matrix-invitee-${role}@example.test`, role: "learner" },
    });
    expect(res.status(), role).toBe(403);
    await ctx.dispose();
  }

  const adminCtx = await apiAs("org_admin");

  const aboveRank = await adminCtx.post("/api/v1/orgs/invitations", {
    data: { email: "role-matrix-invitee-above-rank@example.test", role: "org_owner" },
  });
  expect(aboveRank.status()).toBe(403);

  const withinRank = await adminCtx.post("/api/v1/orgs/invitations", {
    data: { email: "role-matrix-invitee-within-rank@example.test", role: "manager" },
  });
  expect(withinRank.status()).toBe(201);

  await adminCtx.dispose();
});

test("PATCH /api/v1/orgs/members/[id] — role assignment guard rails", async () => {
  const adminCtx = await apiAs("org_admin");

  const self = await adminCtx.patch(`/api/v1/orgs/members/${meta.users.org_admin.userId}`, {
    data: { role: "org_owner" },
  });
  expect(self.status()).toBe(403);

  const aboveRank = await adminCtx.patch(`/api/v1/orgs/members/${meta.users.patchTarget.userId}`, {
    data: { role: "org_owner" },
  });
  expect(aboveRank.status()).toBe(403);

  const withinRank = await adminCtx.patch(`/api/v1/orgs/members/${meta.users.patchTarget.userId}`, {
    data: { role: "manager" },
  });
  expect(withinRank.status()).toBe(200);
  const body = await withinRank.json();
  expect(body.data.member.role).toBe("manager");

  await adminCtx.dispose();

  const learnerCtx = await apiAs("learner");
  const asLearner = await learnerCtx.patch(`/api/v1/orgs/members/${meta.users.patchTarget.userId}`, {
    data: { role: "org_admin" },
  });
  expect(asLearner.status()).toBe(403);
  await learnerCtx.dispose();
});

// Phase 2, step 1 — the content routes join the same role matrix as
// every other route, rather than getting their own ad hoc coverage.
test("content routes require at least org_admin", async () => {
  for (const role of ["learner", "manager"] as const) {
    const ctx = await apiAs(role);
    expect((await ctx.get("/api/v1/content/assets")).status(), role).toBe(403);
    const uploadUrl = await ctx.post("/api/v1/content/upload-url", {
      data: { filename: "nope.pdf" },
    });
    expect(uploadUrl.status(), role).toBe(403);
    await ctx.dispose();
  }

  for (const role of ["org_admin", "org_owner"] as const) {
    const ctx = await apiAs(role);
    expect((await ctx.get("/api/v1/content/assets")).status(), role).toBe(200);
    const uploadUrl = await ctx.post("/api/v1/content/upload-url", {
      data: { filename: "allowed.pdf" },
    });
    expect(uploadUrl.status(), role).toBe(200);
    const body = await uploadUrl.json();
    // The signed path must be namespaced to the caller's own org.
    expect(body.data.path.startsWith(`${meta.org.id}/`)).toBe(true);
    await ctx.dispose();
  }
});

// Phase 2 — the content-authoring matrix. Authoring is org_admin+;
// consuming (listing courses, playing them, enrolling) is open to any
// authenticated org member, which is what makes a learner able to take
// a course at all.
test("content authoring requires org_admin; course consumption does not", async () => {
  for (const role of ["learner", "manager"] as const) {
    const ctx = await apiAs(role);

    // Cannot author
    expect((await ctx.post("/api/v1/content/learning-objects", {
      data: { title: "nope" },
    })).status(), role).toBe(403);
    expect((await ctx.post("/api/v1/content/courses", {
      data: { title: "nope" },
    })).status(), role).toBe(403);
    expect((await ctx.get("/api/v1/content/learning-objects")).status(), role).toBe(403);

    // But CAN consume
    expect((await ctx.get("/api/v1/content/courses")).status(), role).toBe(200);
    expect((await ctx.get("/api/v1/enrollments")).status(), role).toBe(200);
    expect((await ctx.get("/api/v1/content/search?q=anything")).status(), role).toBe(200);

    await ctx.dispose();
  }

  for (const role of ["org_admin", "org_owner"] as const) {
    const ctx = await apiAs(role);
    expect((await ctx.get("/api/v1/content/learning-objects")).status(), role).toBe(200);
    const created = await ctx.post("/api/v1/content/courses", {
      data: { title: `Matrix course ${role} ${Date.now()}` },
    });
    expect(created.status(), role).toBe(201);
    await ctx.dispose();
  }
});

test("search scope differs by role — authors see drafts, learners do not", async () => {
  const admin = await apiAs("org_admin");
  const marker = `zqx${Date.now()}`;
  const created = await admin.post("/api/v1/content/courses", {
    data: { title: `Draft ${marker}`, description: "unpublished" },
  });
  expect(created.status()).toBe(201);

  const adminHits = await (await admin.get(`/api/v1/content/search?q=${marker}`)).json();
  expect(adminHits.data.courses.length).toBeGreaterThan(0);
  await admin.dispose();

  const learner = await apiAs("learner");
  const learnerHits = await (await learner.get(`/api/v1/content/search?q=${marker}`)).json();
  expect(learnerHits.data.courses).toHaveLength(0);
  await learner.dispose();
});

test("GET /api/v1/platform-admin/orgs — only platform admins", async () => {
  for (const role of ["learner", "manager", "org_admin", "org_owner"] as const) {
    const ctx = await apiAs(role);
    expect((await ctx.get("/api/v1/platform-admin/orgs")).status(), role).toBe(403);
    await ctx.dispose();
  }

  const adminCtx = await apiAs("platformAdmin");
  const res = await adminCtx.get("/api/v1/platform-admin/orgs");
  expect(res.status()).toBe(200);
  const body = await res.json();
  const orgIds: string[] = body.data.orgs.map((org: { id: string }) => org.id);
  expect(orgIds).toContain(meta.org.id);
  expect(orgIds).toContain(meta.otherOrg.id);
  await adminCtx.dispose();
});
