import { test, expect } from "@playwright/test";
import { createLocalAdminClient } from "./local-supabase-admin";

// The Playwright golden path from docs/TESTING.md §6, flow #1: sign up →
// join an organization → invite a user → new user accepts and logs in.
//
// **Updated 2026-09-04** — this used to also drive self-serve org
// creation (a freshly signed-up user filling "Organization name" and
// clicking "Create organization" right on their own dashboard). That UI
// action was removed during the platform-owner-only org creation change
// (see docs/MULTI_TENANCY.md §"Org creation is now platform-owner-only"
// and MASTER_FEATURE_MATRIX.md reconciliation note 5, 2026-09-03):
// `POST /api/v1/orgs` no longer exists, and `create-org-form.tsx` no
// longer offers it. A brand-new signup now lands in the genuine "no org
// yet" state and waits to be placed into one — there is no UI action
// left for this test to drive there. What a platform owner's own
// org-creation flow does is covered separately, at the API level, by
// role-matrix.spec.ts's "GET /api/v1/platform-admin/orgs — only platform
// admins" test.
//
// So the org itself is seeded directly here (same convention
// tests/e2e/global-setup.ts already uses for its own users), standing in
// for "a platform owner already placed this person in an org," and this
// test keeps driving through the real UI everything that still is a real
// self-serve action: account signup, being invited into that org,
// accepting the invitation, and logging back in with a real credential.
// Runs against the local, disposable Supabase instance (playwright.config.ts
// wires the dev server to it), so local auth confirmations are disabled
// and signup logs the user straight in.
test("sign up, join an org, invite, accept, and log back in", async ({ page }) => {
  const suffix = Date.now();
  const password = "E2e-test-password-123!";
  const ownerEmail = `e2e-owner-${suffix}@example.test`;
  const inviteeEmail = `e2e-invitee-${suffix}@example.test`;

  const admin = createLocalAdminClient();
  const { data: org, error: orgError } = await admin
    .from("organizations")
    .insert({ name: `E2E Org ${suffix}`, slug: `e2e-org-${suffix}` })
    .select("id")
    .single();
  if (orgError) throw orgError;

  await page.goto("/signup");
  await page.getByLabel("Full name").fill("E2E Owner");
  await page.getByLabel("Email").fill(ownerEmail);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign up" }).click();

  await expect(page).toHaveURL(/\/dashboard|\/choose-workspace/);

  // Stands in for the platform owner's own placement action — the part
  // that's now genuinely owner-only and covered elsewhere (see header
  // comment). profiles.org_id/role change is service-role-only by design
  // (supabase/migrations/...150000_prevent_profile_privilege_escalation.sql),
  // so this goes through the admin client, exactly as that real grant would.
  const { data: ownerProfile, error: profileLookupError } = await admin
    .from("profiles")
    .select("id")
    .eq("email", ownerEmail)
    .single();
  if (profileLookupError) throw profileLookupError;
  const { error: placeError } = await admin
    .from("profiles")
    .update({ org_id: org.id, role: "org_owner" })
    .eq("id", ownerProfile.id);
  if (placeError) throw placeError;

  // A fresh navigation re-reads the session's org/role from the database
  // (lib/auth/session.ts) — no new login needed for the placement above
  // to take effect. Role is never shown as literal "Role: X" text
  // anywhere in the app — the real, persistent display is the header
  // identity badge's human-readable name (ProductShell.tsx's
  // `roleNames` map: org_owner → "Organisation owner", manager →
  // "Manager"), scoped to that badge since "Manager" alone could
  // otherwise match incidental body text.
  const identity = page.locator(".product-shell__identity");
  await page.goto("/dashboard");
  await expect(page.getByText(ownerEmail)).toBeVisible();
  await expect(identity.getByText("Organisation owner")).toBeVisible();

  await page.getByRole("link", { name: /Manage organization/ }).click();
  await expect(page).toHaveURL(/\/admin/);

  // The real field labels and button text (admin-console.tsx) — never
  // "Email"/"Role"/"Invite" as such.
  await page.getByLabel("Work email").fill(inviteeEmail);
  await page.getByLabel("Starting role").selectOption("manager");
  await page.getByRole("button", { name: "Create private invitation →" }).click();

  const inviteLinkInput = page.locator("input[readonly]");
  await expect(inviteLinkInput).toHaveValue(/\/invite\//);
  const inviteLink = await inviteLinkInput.inputValue();

  // Logout lives in the shared header now, so it's reachable from any
  // page — /dashboard here is just where the test happens to be.
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.goto("/signup");
  await page.getByLabel("Full name").fill("E2E Invitee");
  await page.getByLabel("Email").fill(inviteeEmail);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto(inviteLink);
  await page.getByRole("button", { name: "Accept invitation" }).click();
  await expect(page.getByText(/joined/i)).toBeVisible();
  // The real button text (accept-invite.tsx) — never "Go to dashboard".
  await page.getByRole("button", { name: "Go to learning home →" }).click();
  await expect(identity.getByText("Manager")).toBeVisible();

  // Log out and back in with a real credential-based login, not just the
  // still-live signup session, to prove the whole loop persists.
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Email").fill(inviteeEmail);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();

  // A manager+ login lands on /choose-workspace, not /dashboard directly
  // (lib/auth/actions.ts) — global-setup.ts's own seeded logins already
  // account for this. That page has no identity badge of its own, so
  // follow its real "My learning" card through to /dashboard, where the
  // credential-based session can actually be confirmed.
  await expect(page).toHaveURL(/\/dashboard|\/choose-workspace/);
  if (page.url().includes("/choose-workspace")) {
    await page.getByRole("link", { name: /Open learning home/ }).click();
  }
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(identity.getByText("Manager")).toBeVisible();
});
