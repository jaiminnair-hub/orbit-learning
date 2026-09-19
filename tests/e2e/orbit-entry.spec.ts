import { test, expect, request as pwRequest } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createLocalAdminClient } from "./local-supabase-admin";
import { mintEntryToken } from "../../lib/orbit/entry-token";

// Orbit Foundation integration — first safe slice, docs/ORBIT_LMS_INTEGRATION_PLAN.md.
// The data-layer guarantees (RLS on the three new tables) are covered in
// tests/tenant-isolation.test.ts; this file exercises the real route the
// same way tenant-isolation-api.spec.ts exercises other API-layer
// boundaries — through actual HTTP requests, not a mocked handler. Uses its
// own fresh throwaway orgs throughout rather than global-setup's shared
// meta.org, since orbit_organization_links is one-to-one per LMS org.
//
// Must match playwright.config.ts's localSupabaseEnv() ORBIT_ENTRY_TOKEN_SECRET
// exactly — that is the value the running server verifies tokens against.
process.env.ORBIT_ENTRY_TOKEN_SECRET = "e2e-local-orbit-entry-secret-do-not-use-in-production";

const admin = createLocalAdminClient();

async function apiCtx() {
  return pwRequest.newContext({ baseURL: "http://localhost:3000" });
}

function newOrbitOrgId() {
  return randomUUID();
}

// orbit_organization_links is one-to-one in both directions (docs/ORBIT_LMS_INTEGRATION_PLAN.md
// §3), so each test that needs "a linked org" gets its own fresh, throwaway
// LMS org rather than sharing global-setup's meta.org — reusing that across
// tests would collide on the table's own unique(lms_organization_id).
async function newLinkedOrbitOrg(): Promise<string> {
  const suffix = randomUUID().slice(0, 8);
  const { data: org, error: orgError } = await admin
    .from("organizations")
    .insert({ name: `Orbit E2E Org ${suffix}`, slug: `orbit-e2e-org-${suffix}` })
    .select("id")
    .single();
  if (orgError) throw orgError;

  const orbitOrgId = newOrbitOrgId();
  const { error: linkError } = await admin
    .from("orbit_organization_links")
    .insert({ orbit_organization_id: orbitOrgId, lms_organization_id: org.id });
  if (linkError) throw linkError;

  return orbitOrgId;
}

// Mirrors the real delivery mechanism (docs/ORBIT_LMS_INTEGRATION_PLAN.md
// §5): an auto-submitting HTML form POST, not fetch(). Completing the flow
// requires real browser JS execution (/orbit/complete's client-side
// verifyOtp() call) — a pure HTTP request client stops at that page's HTML
// without ever running it, which is why this needs Playwright's `page`
// fixture rather than the API-only `request` context used elsewhere in
// this file for the pure error-path cases.
async function submitEntryForm(page: import("@playwright/test").Page, token: string) {
  // page.setContent() alone leaves the page at "about:blank" — a relative
  // form action has no real origin to resolve against there, and the
  // submission silently goes nowhere. Navigating to a real same-origin page
  // first, then building and submitting the form via the DOM from that
  // page's own context, is what makes the relative action resolve to
  // localhost:3000 the way it would for a real Orbit-embedded form.
  await page.goto("/login");
  await page.evaluate((formToken) => {
    const form = document.createElement("form");
    form.method = "POST";
    form.action = "/api/orbit/entry";
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = "token";
    input.value = formToken;
    form.appendChild(input);
    document.body.appendChild(form);
    form.submit();
  }, token);
  await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
}

test("a learner-mapped entry token lands on a real session in the correct org", async ({ page }) => {
  const orbitOrgId = await newLinkedOrbitOrg();
  const email = `orbit-e2e-learner-${Date.now()}@example.test`;
  const token = mintEntryToken({
    jti: randomUUID(),
    orbitUserId: randomUUID(),
    orbitOrgId,
    email,
    orbitProductRoleKey: "learner",
  });

  await submitEntryForm(page, token);
  expect(page.url()).toContain("/dashboard");

  const me = await (await page.request.get("/api/v1/orgs/me")).json();
  expect(typeof me.data.org.id).toBe("string");
  expect(me.data.role).toBe("learner");

  // A learner-mapped Orbit user must not be able to reach an org_admin-gated
  // route — this is the explicit "unauthorized Orbit user cannot enter LMS
  // admin/content routes" check.
  const membersRes = await page.request.get("/api/v1/orgs/members");
  expect(membersRes.status()).toBe(403);
});

test("l_and_d_admin maps to org_admin and learning_manager maps to manager", async ({ page, browser }) => {
  const orbitOrgId = await newLinkedOrbitOrg();

  const adminToken = mintEntryToken({
    jti: randomUUID(),
    orbitUserId: randomUUID(),
    orbitOrgId,
    email: `orbit-e2e-lnd-${Date.now()}@example.test`,
    orbitProductRoleKey: "l_and_d_admin",
  });
  await submitEntryForm(page, adminToken);
  const adminMe = await (await page.request.get("/api/v1/orgs/me")).json();
  expect(adminMe.data.role).toBe("org_admin");
  // org_admin can reach the manager-gated route.
  expect((await page.request.get("/api/v1/orgs/members")).status()).toBe(200);

  // A second, independent browser context/session for the second user —
  // sharing `page`'s cookies would just re-authenticate as the admin above.
  const managerContext = await browser.newContext();
  const managerPage = await managerContext.newPage();
  const managerToken = mintEntryToken({
    jti: randomUUID(),
    orbitUserId: randomUUID(),
    orbitOrgId,
    email: `orbit-e2e-manager-${Date.now()}@example.test`,
    orbitProductRoleKey: "learning_manager",
  });
  await submitEntryForm(managerPage, managerToken);
  const managerMe = await (await managerPage.request.get("/api/v1/orgs/me")).json();
  expect(managerMe.data.role).toBe("manager");
  await managerContext.close();
});

test("content_author is denied LMS entry outright, never granted org_admin", async () => {
  const orbitOrgId = await newLinkedOrbitOrg();
  const token = mintEntryToken({
    jti: randomUUID(),
    orbitUserId: randomUUID(),
    orbitOrgId,
    email: `orbit-e2e-content-author-${Date.now()}@example.test`,
    orbitProductRoleKey: "content_author",
  });

  const ctx = await apiCtx();
  const res = await ctx.post("/api/orbit/entry", { data: { token } });
  expect(res.status()).toBe(403);
  const body = await res.json();
  expect(body.error.code).toBe("ROLE_NOT_SUPPORTED");
  await ctx.dispose();
});

test("an entry token for an unlinked Orbit org is rejected", async () => {
  const token = mintEntryToken({
    jti: randomUUID(),
    orbitUserId: randomUUID(),
    orbitOrgId: newOrbitOrgId(), // never linked
    email: `orbit-e2e-unlinked-${Date.now()}@example.test`,
    orbitProductRoleKey: "learner",
  });

  const ctx = await apiCtx();
  const res = await ctx.post("/api/orbit/entry", { data: { token } });
  expect(res.status()).toBe(403);
  const body = await res.json();
  expect(body.error.code).toBe("ORG_NOT_LINKED");
  await ctx.dispose();
});

test("a replayed entry token is rejected on the second attempt", async () => {
  const orbitOrgId = await newLinkedOrbitOrg();
  const token = mintEntryToken({
    jti: randomUUID(),
    orbitUserId: randomUUID(),
    orbitOrgId,
    email: `orbit-e2e-replay-${Date.now()}@example.test`,
    orbitProductRoleKey: "learner",
  });

  const first = await apiCtx();
  const firstRes = await first.post("/api/orbit/entry", { data: { token } });
  expect(firstRes.ok()).toBe(true);
  await first.dispose();

  const second = await apiCtx();
  const secondRes = await second.post("/api/orbit/entry", { data: { token } });
  expect(secondRes.status()).toBe(401);
  const body = await secondRes.json();
  expect(body.error.code).toBe("TOKEN_ALREADY_USED");
  await second.dispose();
});

test("a GET request to the entry route is rejected", async () => {
  const ctx = await apiCtx();
  const res = await ctx.get("/api/orbit/entry");
  expect(res.status()).toBe(405);
  await ctx.dispose();
});

test("/login and /signup remain fully functional and unaffected", async () => {
  const ctx = await apiCtx();
  const loginRes = await ctx.get("/login");
  expect(loginRes.status()).toBe(200);
  const signupRes = await ctx.get("/signup");
  expect(signupRes.status()).toBe(200);
  await ctx.dispose();
});
