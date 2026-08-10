import { expect, test } from "./fixtures";

const card = (page: import("@playwright/test").Page, name: string) =>
  page.locator(".card-pad").filter({ hasText: name });

test.describe("Workflows", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/workflows");
  });

  test("summarises workflow and run counts", async ({ page }) => {
    await expect(page.locator(".count-pill")).toContainText("2 workflow(s) · 3 run(s)");
  });

  test("renders a card per workflow with its trigger", async ({ page }) => {
    const scheduled = card(page, "Monthly owner statements");
    await expect(scheduled.getByRole("heading", { name: "Monthly owner statements" })).toBeVisible();
    await expect(scheduled.locator(".badge")).toHaveText("Active");
    await expect(scheduled).toContainText("cron: 0 6 1 * * · Asia/Kolkata");
    await expect(scheduled).toContainText(
      "Render and email each owner their statement on the 1st."
    );

    const evented = card(page, "Emergency work order alert");
    await expect(evented.locator(".badge")).toHaveText("Paused");
    await expect(evented).toContainText("event");
  });

  test("lays out each workflow's plan as a step timeline", async ({ page }) => {
    const steps = card(page, "Monthly owner statements").locator(".wf-step");
    await expect(steps).toHaveCount(3);
    await expect(steps.nth(0)).toContainText("Render Owner Statement");
    await expect(steps.nth(0).locator(".wf-kind")).toHaveText("render_report");
    await expect(steps.nth(0)).toContainText("Runs the saved report for each owner.");
    await expect(steps.nth(1)).toContainText("Email owners");
    await expect(steps.nth(2)).toContainText("Done");
  });

  test("lists recent runs with their outcome and duration", async ({ page }) => {
    const scheduled = card(page, "Monthly owner statements");
    await expect(scheduled).toContainText("Recent runs");
    await expect(scheduled.getByText("succeeded")).toBeVisible();
    await expect(scheduled.getByText("failed")).toBeVisible();
    await expect(scheduled).toContainText("12.0 s");
  });

  test("plots the run timeline with an outcome legend", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Run Timeline" })).toBeVisible();
    await expect(page.getByText("Each point is a workflow run, coloured by outcome")).toBeVisible();
    await expect(page.locator(".wf-legend")).toContainText("Succeeded");
    await expect(page.locator(".wf-legend")).toContainText("Failed");
    await expect(page.locator(".wf-legend")).toContainText("Running");
    await expect(page.locator(".recharts-scatter-symbol")).toHaveCount(3);
  });

  test("says so when no runs have been recorded", async ({ page }) => {
    await page.route("**/api/workflows/runs", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ runs: [] }),
      })
    );
    await page.reload();

    await expect(page.getByText("No runs recorded yet.")).toBeVisible();
    await expect(page.locator(".wf-legend")).toHaveCount(0);
  });

  test("shows an empty state when the instance defines no workflows", async ({ page }) => {
    await page.route("**/api/workflows", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ workflows: [] }),
      })
    );
    await page.reload();

    await expect(page.getByRole("heading", { name: "No workflows yet" })).toBeVisible();
    await expect(page.locator(".card-pad")).toHaveCount(0);
  });

  test("surfaces a load failure", async ({ page }) => {
    await page.route("**/api/workflows", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "SOAR automation service unavailable" }),
      })
    );
    await page.reload();

    await expect(page.locator(".alert.error")).toHaveText("SOAR automation service unavailable");
  });
});
