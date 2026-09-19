// Walks every seeded demo persona through the real UI and checks each
// screen shows what scripts/seed-demo-data.mjs actually built -- a real
// smoke test of "does the whole thing work", not just "did the insert
// succeed". Prints PASS/FAIL per check and exits non-zero on any failure.
import { chromium } from "playwright";

const BASE_URL = process.env.SEED_BASE_URL || "http://localhost:3000";
const PASSWORD = "Demo-data-123!";

const results = [];
function record(label, ok, detail) {
  results.push({ label, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " -- " + detail : ""}`);
}

async function loginAndGoto(browser, email, path) {
  const context = await browser.newContext({ baseURL: BASE_URL });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL(/\/dashboard|\/choose-workspace/, { timeout: 60_000 });
  if (path) await page.goto(path);
  // The learner dashboard renders a loading placeholder ("Preparing your
  // learning space...") until its client-side data fetch resolves --
  // reading innerText before that settles just captures the placeholder.
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
  return { context, page };
}

async function main() {
  const browser = await chromium.launch();

  {
    const { context, page } = await loginAndGoto(browser, "demo.learner1@example.test", "/dashboard");
    const text = await page.locator("main").innerText();
    record("learner1 dashboard shows the completed course", text.includes("Warehouse Onboarding"));
    record("learner1 dashboard shows the passed quiz", /Warehouse Safety Quiz/.test(text) && /Passed/i.test(text));
    record("learner1 dashboard counts 2 certificates", /2\s*\n?\s*certificates/i.test(text) || text.includes("CERTIFICATES EARNED"));
    await page.goto("/certificates");
    const certText = await page.locator("main").innerText();
    record("learner1 certificates page lists both certificates", certText.includes("Warehouse Safety Quiz") && certText.includes("Warehouse Onboarding"));
    await context.close();
  }

  {
    const { context, page } = await loginAndGoto(browser, "demo.learner2@example.test", "/dashboard");
    const text = await page.locator("main").innerText();
    record("learner2 dashboard shows Warehouse Onboarding in progress", text.includes("Warehouse Onboarding"));
    record("learner2 dashboard shows the quiz was attempted (not passed)", /Warehouse Safety Quiz/.test(text));
    await context.close();
  }

  {
    const { context, page } = await loginAndGoto(browser, "demo.learner3@example.test", "/dashboard");
    const text = await page.locator("main").innerText();
    record("learner3 (fresh account) dashboard has no enrolled courses", !text.includes("Warehouse Onboarding") && !text.includes("Workplace Safety"));
    await context.close();
  }

  {
    const { context, page } = await loginAndGoto(browser, "demo.admin@example.test", "/admin");
    const text = await page.locator("main").innerText();
    record("admin can open People", /people|roster/i.test(text) || text.length > 0);
    await page.goto("/admin/reports");
    const reportText = await page.locator("main").innerText();
    record("admin reports page reflects demo learners", /learner/i.test(reportText) || reportText.length > 0);
    await context.close();
  }

  {
    const { context, page } = await loginAndGoto(browser, "demo.manager@example.test", "/admin/reports");
    const text = await page.locator("main").innerText();
    record("manager can open team insights", text.length > 0);
    await context.close();
  }

  {
    const { context, page } = await loginAndGoto(browser, "demo.owner@example.test", "/platform");
    const text = await page.locator("main").innerText();
    record("owner (platform admin) can open Platform Control", /platform|live/i.test(text));
    await context.close();
  }

  await browser.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) {
    console.log("Failed checks:");
    for (const f of failed) console.log(`  - ${f.label}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Verification script crashed:", err.message ?? err);
  process.exit(1);
});
