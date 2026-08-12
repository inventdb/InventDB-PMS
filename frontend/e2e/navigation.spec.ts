import { expect, test } from "./fixtures";

/**
 * Every sidebar destination, with the title Layout's `pageTitle()` should put
 * in the topbar. `transactions` is the interesting one — its route segment and
 * its label deliberately disagree.
 */
const DESTINATIONS = [
  { link: "Dashboard", path: "/", title: "Dashboard" },
  { link: "Properties", path: "/properties", title: "Properties" },
  { link: "Owners", path: "/owners", title: "Owners" },
  { link: "Tenants", path: "/tenants", title: "Tenants" },
  { link: "Leases", path: "/leases", title: "Leases" },
  { link: "Work Orders", path: "/work_orders", title: "Work Orders" },
  { link: "Vendors", path: "/vendors", title: "Vendors" },
  { link: "Inspections", path: "/inspections", title: "Inspections" },
  { link: "Compliance", path: "/compliance", title: "Compliance" },
  { link: "Daily Tasks", path: "/daily_tasks", title: "Daily Tasks" },
  { link: "Accounting", path: "/transactions", title: "Accounting" },
  { link: "Analyze", path: "/analyze", title: "Analyze" },
  { link: "Workflows", path: "/workflows", title: "Workflows" },
  { link: "Reports", path: "/reports", title: "Reports" },
  { link: "Files", path: "/files", title: "Files" },
  { link: "Settings", path: "/settings", title: "Settings" },
] as const;

test.describe("Sidebar navigation", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("renders every section and destination", async ({ page }) => {
    const nav = page.locator("nav.nav");
    for (const section of [
      "Portfolio",
      "Leasing",
      "Operations",
      "Compliance & Tasks",
      "Finance",
      "Automation & Insights",
    ]) {
      await expect(nav.locator(".nav-section", { hasText: section })).toBeVisible();
    }
    await expect(nav.getByRole("link")).toHaveCount(DESTINATIONS.length);
  });

  for (const { link, path, title } of DESTINATIONS) {
    test(`navigates to ${link}`, async ({ page }) => {
      // Located by href rather than accessible name. An entry that carries a
      // count badge — Workflows, when a run is parked — has that count in its
      // name by design ("Workflows, 2 waiting on you"), which is right for a
      // screen reader and fatal to an exact-name match.
      const entry = page.locator("nav.nav").locator(`a[href="${path}"]`);
      await expect(entry).toContainText(link);
      await entry.click();

      await expect(page).toHaveURL(`http://localhost:5173${path}`);
      // The topbar h1 is the only heading guaranteed on every page; entity
      // pages repeat the same text in an h2, so the level matters.
      await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
    });
  }

  test("marks the current destination active", async ({ page }) => {
    const nav = page.locator("nav.nav");
    await expect(nav.locator(".nav-item.active")).toHaveText("Dashboard");

    await nav.getByRole("link", { name: "Vendors", exact: true }).click();
    await expect(nav.locator(".nav-item.active")).toHaveText("Vendors");

    // Dashboard's link is `end`, so a child route must not light it up too.
    await expect(nav.locator(".nav-item.active")).toHaveCount(1);
  });

  test("survives a full reload on a deep route", async ({ page }) => {
    await page.goto("/work_orders");
    await page.reload();
    await expect(page.getByRole("heading", { name: "Work Orders", level: 1 })).toBeVisible();
    await expect(page.getByRole("row")).toHaveCount(3);
  });

  test("supports browser back and forward", async ({ page }) => {
    await page.locator("nav.nav").getByRole("link", { name: "Tenants", exact: true }).click();
    await expect(page).toHaveURL(/\/tenants$/);

    await page.goBack();
    await expect(page).toHaveURL("http://localhost:5173/");
    await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();

    await page.goForward();
    await expect(page).toHaveURL(/\/tenants$/);
  });
});

test.describe("Unmatched routes", () => {
  test("shows Unknown module for a single unknown segment", async ({ page }) => {
    // `:entity` outranks the `*` splat for a one-segment path, so this lands
    // on EntityListPage with no matching config rather than redirecting.
    await page.goto("/not-a-module");
    await expect(page.getByRole("heading", { name: "Unknown module" })).toBeVisible();
    await expect(page.getByText('No module named "not-a-module".')).toBeVisible();
  });

  test("redirects a deep unknown path back to the dashboard", async ({ page }) => {
    await page.goto("/deep/unknown/path");
    await expect(page).toHaveURL("http://localhost:5173/");
    await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
  });
});
