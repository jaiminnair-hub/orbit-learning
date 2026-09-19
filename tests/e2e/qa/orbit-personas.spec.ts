import { test, expect } from "@playwright/test";
import path from "node:path";

const AUTH_DIR = path.join(__dirname, "..");
const state = (persona: string) => path.join(AUTH_DIR, ".auth", `${persona}.json`);

test.describe("Admin Test Agent", () => {
  test("[Admin][Platform Control] platform administrator can open the protected command centre", async ({ browser }) => {
    const context = await browser.newContext({ baseURL: "http://localhost:3000", storageState: state("platformAdmin") });
    const page = await context.newPage();
    await page.goto("/platform");
    await expect(page.getByRole("heading", { name: /See what's live/i })).toBeVisible();
    await context.close();
  });

  test("[Admin][Orbit Learning] organization administrator reaches authoring without publishing", async ({ browser }) => {
    const context = await browser.newContext({ baseURL: "http://localhost:3000", storageState: state("org_admin") });
    const page = await context.newPage();
    await page.goto("/admin/authoring");
    await expect(page.getByRole("heading", { name: "New interactive course." })).toBeVisible();
    await expect(page.getByText("Generate with AI")).toBeVisible();
    await context.close();
  });

  test("[Admin][360 Feedback] feedback administrator opens the isolated 360 test workspace", async () => { test.skip(true, "Blocked until the dedicated 360 QA organization and test identity are provisioned."); });
  test("[Admin][Competencies] future-product boundary is reported as prepared", async () => { test.skip(true, "No Competencies workspace exists yet."); });
  test("[Admin][Orbit Growth] future-product boundary is reported as prepared", async () => { test.skip(true, "No Orbit Growth workspace exists yet."); });
});

test.describe("Learner Test Agent", () => {
  test("[Learner][Orbit Learning] learner reaches their learning dashboard", async ({ browser }) => {
    const context = await browser.newContext({ baseURL: "http://localhost:3000", storageState: state("learner") });
    const page = await context.newPage();
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByText(/My learning|Continue learning/i).first()).toBeVisible();
    await context.close();
  });

  test("[Learner][Platform Control] learner is denied administrator authoring access", async ({ browser }) => {
    const context = await browser.newContext({ baseURL: "http://localhost:3000", storageState: state("learner") });
    const page = await context.newPage();
    await page.goto("/admin/content");
    await expect(page.getByText(/don't have access/i)).toBeVisible();
    await context.close();
  });

  test("[Learner][360 Feedback] assigned reviewer submits synthetic feedback without report access", async () => { test.skip(true, "Blocked until a dedicated 360 QA cycle and reviewer identity are provisioned."); });
  test("[Learner][Competencies] future-product boundary is reported as prepared", async () => { test.skip(true, "No Competencies workspace exists yet."); });
  test("[Learner][Orbit Growth] future-product boundary is reported as prepared", async () => { test.skip(true, "No Orbit Growth workspace exists yet."); });
});
