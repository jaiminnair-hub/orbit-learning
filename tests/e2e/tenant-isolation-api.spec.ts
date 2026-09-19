import { test, expect, request as pwRequest } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Meta } from "./global-setup";
import { createLocalAdminClient } from "./local-supabase-admin";

// Tenant isolation at the API layer (docs/TESTING.md §4) — the
// data-layer half of this matrix already runs in tests/tenant-isolation.test.ts
// against direct Supabase sessions; this file exercises the same
// boundary through the actual HTTP routes real clients use.
const AUTH_DIR = path.join(__dirname, ".auth");
const meta = JSON.parse(readFileSync(path.join(AUTH_DIR, "meta.json"), "utf-8")) as Meta;

async function apiAs(key: keyof Meta["users"]) {
  return pwRequest.newContext({
    baseURL: "http://localhost:3000",
    storageState: path.join(AUTH_DIR, `${key}.json`),
  });
}

test("/api/v1/orgs/me never returns another org's data", async () => {
  const ownerCtx = await apiAs("org_owner");
  const ownerBody = await (await ownerCtx.get("/api/v1/orgs/me")).json();
  expect(ownerBody.data.org.id).toBe(meta.org.id);
  expect(ownerBody.data.org.id).not.toBe(meta.otherOrg.id);
  await ownerCtx.dispose();

  const otherCtx = await apiAs("otherOrgOwner");
  const otherBody = await (await otherCtx.get("/api/v1/orgs/me")).json();
  expect(otherBody.data.org.id).toBe(meta.otherOrg.id);
  expect(otherBody.data.org.id).not.toBe(meta.org.id);
  await otherCtx.dispose();
});

test("/api/v1/orgs/members never includes another org's users", async () => {
  const ctx = await apiAs("org_owner");
  const body = await (await ctx.get("/api/v1/orgs/members")).json();
  const ids: string[] = body.data.members.map((m: { id: string }) => m.id);
  expect(ids).not.toContain(meta.users.otherOrgOwner.userId);
  await ctx.dispose();
});

test("an org_admin cannot PATCH a member belonging to a different org", async () => {
  const ctx = await apiAs("org_admin");
  const res = await ctx.patch(`/api/v1/orgs/members/${meta.users.otherOrgOwner.userId}`, {
    data: { role: "manager" },
  });
  expect(res.status()).toBe(404);
  await ctx.dispose();
});

test("an invitation can only be accepted by the email it was sent to", async () => {
  const ownerCtx = await apiAs("org_owner");
  const createRes = await ownerCtx.post("/api/v1/orgs/invitations", {
    data: { email: "role-matrix-someone-specific@example.test", role: "learner" },
  });
  expect(createRes.status()).toBe(201);
  const { data } = await createRes.json();
  const token: string = data.invitation.token;
  await ownerCtx.dispose();

  // platformAdmin is org-less (so the accept route's precondition isn't
  // the thing under test) but has a different email than the invite.
  const wrongEmailCtx = await apiAs("platformAdmin");
  const wrongEmailRes = await wrongEmailCtx.post("/api/v1/orgs/invitations/accept", {
    data: { token },
  });
  expect(wrongEmailRes.status()).toBe(403);
  const body = await wrongEmailRes.json();
  expect(body.error.code).toBe("EMAIL_MISMATCH");
  await wrongEmailCtx.dispose();
});

// Phase 2, step 1 — the content layer's tenancy boundary, tested through
// the real routes the same way every Phase 1 table was.
test("content assets never leak across orgs, and an asset can't be registered under another org's path", async () => {
  const db = createLocalAdminClient();

  // A real asset row planted directly in the *other* org.
  const { data: foreignAsset, error: seedError } = await db
    .from("content_assets")
    .insert({
      org_id: meta.otherOrg.id,
      type: "pdf",
      storage_path: `${meta.otherOrg.id}/api-isolation-${Date.now()}.pdf`,
    })
    .select()
    .single();
  expect(seedError).toBeNull();

  const ctx = await apiAs("org_admin");

  const listBody = await (await ctx.get("/api/v1/content/assets")).json();
  const ids: string[] = listBody.data.assets.map((a: { id: string }) => a.id);
  expect(ids).not.toContain(foreignAsset!.id);

  // Registering an asset under another org's storage prefix is refused
  // before it ever reaches the database.
  const crossOrg = await ctx.post("/api/v1/content/assets", {
    data: { storagePath: `${meta.otherOrg.id}/stolen.pdf`, type: "pdf" },
  });
  expect(crossOrg.status()).toBe(400);
  expect((await crossOrg.json()).error.code).toBe("INVALID_INPUT");

  // A path in the caller's own org that was never actually uploaded is
  // also refused — the route verifies against Storage, not the client's word.
  const ghost = await ctx.post("/api/v1/content/assets", {
    data: { storagePath: `${meta.org.id}/never-uploaded.pdf`, type: "pdf" },
  });
  expect(ghost.status()).toBe(404);
  expect((await ghost.json()).error.code).toBe("UPLOAD_NOT_FOUND");

  await ctx.dispose();
  await db.from("content_assets").delete().eq("id", foreignAsset!.id);
});

// Security-audit finding (2026-09-16, Medium): registering an upload as
// `type: "image"` used to trust the client's word alone — an HTML file
// with an inline <script>, uploaded with its real Content-Type, could be
// registered as an "image" asset and handed a signed URL with no
// Content-Disposition. The route now checks the declared type against
// what Storage actually recorded for the object.
test("an asset's declared type must match what was actually uploaded", async () => {
  const ctx = await apiAs("org_admin");
  const filename = `fake-image-${Date.now()}.html`;

  const up = await ctx.post("/api/v1/content/upload-url", { data: { filename } });
  expect(up.status()).toBe(200);
  const { data: signed } = await up.json();
  const putRes = await ctx.fetch(signed.signedUrl, {
    method: "PUT",
    headers: { "Content-Type": "text/html" },
    data: Buffer.from("<html><body><script>alert(document.cookie)</script></body></html>"),
  });
  expect(putRes.ok()).toBe(true);

  const register = await ctx.post("/api/v1/content/assets", {
    data: { storagePath: signed.path, type: "image", mimeType: "image/png" },
  });
  expect(register.status()).toBe(400);
  expect((await register.json()).error.code).toBe("TYPE_MISMATCH");

  await ctx.dispose();
});

// Phase 2 — the full "Org A cannot read Org B's courses" row, through
// the real routes rather than only at the data layer.
test("courses, learning objects and search never cross the org boundary via the API", async () => {
  const db = createLocalAdminClient();
  const marker = `xenon${Date.now()}`;

  const { data: foreignCourse, error: cErr } = await db
    .from("courses")
    .insert({
      org_id: meta.otherOrg.id,
      title: `Other Org ${marker}`,
      slug: `other-${marker}`,
      description: "should never be visible",
      status: "published",
    })
    .select().single();
  expect(cErr).toBeNull();

  const { data: foreignLo, error: lErr } = await db
    .from("learning_objects")
    .insert({ org_id: meta.otherOrg.id, title: `Other object ${marker}` })
    .select().single();
  expect(lErr).toBeNull();

  const ctx = await apiAs("org_admin");

  // Course listing excludes it
  const courses = await (await ctx.get("/api/v1/content/courses")).json();
  expect(courses.data.courses.map((c: { id: string }) => c.id)).not.toContain(foreignCourse!.id);

  // Learning-object listing excludes it
  const los = await (await ctx.get("/api/v1/content/learning-objects")).json();
  expect(los.data.learningObjects.map((o: { id: string }) => o.id)).not.toContain(foreignLo!.id);

  // Search — the case that matters most, since a SELECT could otherwise
  // become a side channel
  const hits = await (await ctx.get(`/api/v1/content/search?q=${marker}`)).json();
  expect(hits.data.courses).toHaveLength(0);
  expect(hits.data.learningObjects).toHaveLength(0);

  // Reading the other org's course structure directly 404s
  const structure = await ctx.get(`/api/v1/content/courses/${foreignCourse!.id}/structure`);
  expect(structure.status()).toBe(404);

  // And enrolling into it is refused
  const enrol = await ctx.post("/api/v1/enrollments", { data: { courseId: foreignCourse!.id } });
  expect(enrol.status()).toBe(404);

  await ctx.dispose();
  await db.from("learning_objects").delete().eq("id", foreignLo!.id);
  await db.from("courses").delete().eq("id", foreignCourse!.id);
});

test("platform admin reads across both orgs; a normal org_owner cannot reach the platform-admin path", async () => {
  const adminCtx = await apiAs("platformAdmin");
  const res = await adminCtx.get("/api/v1/platform-admin/orgs");
  const requestedAt = new Date();
  const body = await res.json();
  const orgIds: string[] = body.data.orgs.map((org: { id: string }) => org.id);
  expect(orgIds).toContain(meta.org.id);
  expect(orgIds).toContain(meta.otherOrg.id);
  await adminCtx.dispose();

  const ownerCtx = await apiAs("org_owner");
  expect((await ownerCtx.get("/api/v1/platform-admin/orgs")).status()).toBe(403);
  await ownerCtx.dispose();

  // The read itself is RLS-permitted, not logged by RLS (it can't trigger
  // on SELECT) — the route writes the audit row separately via the
  // service-role client (docs/MULTI_TENANCY.md §4). Confirm that actually
  // happened rather than just trusting the route's own success response.
  const db = createLocalAdminClient();
  const { data: logRows, error } = await db
    .from("activity_log")
    .select("actor_id, event_type, is_platform_admin_action, metadata, created_at")
    .eq("actor_id", meta.users.platformAdmin.userId)
    .eq("event_type", "platform_admin.orgs.read")
    .order("created_at", { ascending: false })
    .limit(1);
  expect(error).toBeNull();
  expect(logRows).toHaveLength(1);
  expect(logRows![0].is_platform_admin_action).toBe(true);
  expect(new Date(logRows![0].created_at).getTime()).toBeGreaterThanOrEqual(requestedAt.getTime() - 5000);
});
