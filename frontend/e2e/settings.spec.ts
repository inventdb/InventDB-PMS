import { expect, test } from "./fixtures";

const cardNamed = (page: import("@playwright/test").Page, heading: string) =>
  page
    .locator(".card")
    .filter({ has: page.getByRole("heading", { name: heading, exact: true }) });

test.describe("Settings", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/settings");
  });

  test("shows the signed-in account", async ({ page }) => {
    const account = cardNamed(page, "Account");
    await expect(account).toContainText("e2e.manager");
    await expect(account).toContainText("e2e.manager@inventdb.com");
    await expect(account).toContainText("manager");
  });

  test("reports the InventDB connection from /api/health", async ({ page }) => {
    const connection = cardNamed(page, "InventDB Connection");
    await expect(connection.locator(".badge")).toHaveText("Connected");
    await expect(connection.locator(".badge")).toHaveClass(/success/);
    // The base URL is an editable field now, so it lives in the input's value
    // rather than in the card's text.
    await expect(connection.locator("#base-url")).toHaveValue(
      "https://e2e.sandbox.inventdb.com"
    );
    await expect(connection).toContainText("pms");
    await expect(connection).toContainText("1.0.0");
  });

  test("warns when the API cannot be reached", async ({ page }) => {
    await page.route("**/api/health", (route) => route.abort("failed"));
    await page.reload();

    await expect(page.locator(".alert.error")).toHaveText("Could not reach the PMS API.");
  });

  test("switches theme from the appearance card", async ({ page }) => {
    const html = page.locator("html");
    await expect(html).toHaveAttribute("data-theme", "light");

    await page.getByRole("button", { name: "Switch to dark mode" }).click();
    await expect(html).toHaveAttribute("data-theme", "dark");
    expect(await page.evaluate(() => localStorage.getItem("pms.theme"))).toBe("dark");

    await page.getByRole("button", { name: "Switch to light mode" }).click();
    await expect(html).toHaveAttribute("data-theme", "light");
  });

  test("persists the theme across a reload", async ({ page }) => {
    await page.getByRole("button", { name: "Switch to dark mode" }).click();
    await page.reload();
    // index.html paints the stored theme before React mounts, so there is no
    // light flash to race against here.
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.getByRole("button", { name: "Switch to light mode" })).toBeVisible();
  });

  test("signs out from the account card", async ({ page }) => {
    await cardNamed(page, "Account").getByRole("button", { name: "Sign out" }).click();

    await expect(page).toHaveURL(/\/login$/);
    expect(await page.evaluate(() => localStorage.getItem("pms.token"))).toBeNull();
    expect(await page.evaluate(() => localStorage.getItem("pms.user"))).toBeNull();
  });
});

test.describe("Topbar controls", () => {
  test("toggles theme from the topbar", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    await page.getByRole("button", { name: "Toggle theme" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });

  test("signs out from the topbar", async ({ page }) => {
    await page.goto("/");
    await page.locator("header.topbar").getByRole("button", { name: "Sign out" }).click();

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  });

  test("shows the user's initials", async ({ page }) => {
    await page.goto("/");
    // "e2e.manager" splits on the dot, so the avatar reads EM.
    await expect(page.locator("header.topbar")).toContainText("EM");
  });
});
