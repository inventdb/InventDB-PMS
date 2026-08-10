import { DASHBOARD_CHARTS_EMPTY, expect, test } from "./fixtures";

/** Label → rendered value, derived from DASHBOARD_SUMMARY in the fixtures. */
const STATS = [
  { label: "Occupancy Rate", value: "33.3%", sub: "1 occupied · 1 vacant" },
  { label: "Properties", value: "3", sub: "1 occupied · 1 vacant" },
  { label: "Active Leases", value: "1", sub: "1 expiring within 90 days" },
  { label: "Tenants", value: "2", sub: "Across all properties" },
  { label: "Net Income (mo.)", value: "$1,985", sub: "$2,400 in · $415 out" },
  { label: "Open Maintenance", value: "2", sub: "1 open · 1 in progress" },
  { label: "Expected Rent (mo.)", value: "$4,200", sub: "From active leases" },
  { label: "Total Leases", value: "2", sub: "All statuses" },
] as const;

test.describe("Dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("shows all eight portfolio stats with formatted values", async ({ page }) => {
    const grid = page.locator(".stat-grid");
    await expect(grid.locator(".stat")).toHaveCount(8);

    for (const { label, value, sub } of STATS) {
      // Match the label exactly rather than by substring: the Tenants card's
      // sub-line reads "Across all properties", which a loose `hasText`
      // treats as a second match for the Properties card.
      const card = grid
        .locator(".stat")
        .filter({ has: page.getByText(label, { exact: true }) });
      await expect(card.locator(".stat-value")).toHaveText(value);
      await expect(card.locator(".stat-sub")).toHaveText(sub);
    }
  });

  test("renders the four chart cards", async ({ page }) => {
    for (const title of [
      "Cash Flow",
      "Expense Breakdown",
      "Maintenance by Status",
      "Property Status",
    ]) {
      await expect(page.getByRole("heading", { name: title, level: 3 })).toBeVisible();
    }
    await expect(page.getByText("Income vs. expenses over the last 6 months")).toBeVisible();
    // Recharts draws into SVG; asserting the charts mounted is the honest
    // check here — the numbers themselves are covered by the stat assertions.
    // Count wrappers, not `.recharts-surface`: legend icons are surfaces too.
    await expect(page.locator(".chart-card .recharts-wrapper")).toHaveCount(4);
  });

  test("labels cash flow series in the legend so colour is never the only cue", async ({ page }) => {
    const cashflow = page.locator(".chart-card").filter({ hasText: "Cash Flow" });
    await expect(cashflow.getByText("Income", { exact: true })).toBeVisible();
    await expect(cashflow.getByText("Expense", { exact: true })).toBeVisible();
  });

  test("falls back to 'No data yet' when a breakdown is empty", async ({ page }) => {
    await page.route("**/api/dashboard/charts", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(DASHBOARD_CHARTS_EMPTY),
      })
    );
    await page.reload();

    // Three of the four cards guard with ChartOrEmpty; Cash Flow always draws
    // its axes, so it is not one of them.
    await expect(page.getByText("No data yet")).toHaveCount(3);
  });

  test("surfaces an error when the summary call fails", async ({ page }) => {
    await page.route("**/api/dashboard/summary", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "InventDB is unreachable" }),
      })
    );
    await page.reload();

    await expect(page.locator(".alert.error")).toHaveText("InventDB is unreachable");
    await expect(page.locator(".stat-grid")).toHaveCount(0);
  });

  test("shows a spinner before the data lands", async ({ page }) => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/dashboard/summary", async (route) => {
      await gate;
      await route.fallback();
    });

    await page.goto("/");
    await expect(page.getByRole("status", { name: "Loading" })).toBeVisible();

    release();
    await expect(page.locator(".stat-grid")).toBeVisible();
  });

  test("links through to the reports page", async ({ page }) => {
    await page.getByRole("button", { name: "View full reports" }).click();
    await expect(page).toHaveURL(/\/reports$/);
    await expect(page.getByRole("heading", { name: "Reports", level: 1 })).toBeVisible();
  });
});
