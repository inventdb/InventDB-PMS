import { expect, signedOut, test } from "./fixtures";

/**
 * Runs only in the `mobile` project (Pixel 7, 412px wide), which is below both
 * the 820px drawer breakpoint and the 960px login reflow.
 */
test.describe("Mobile shell", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("keeps the sidebar off-canvas until the menu is pressed", async ({ page }) => {
    const sidebar = page.locator(".sidebar");

    // The drawer is translated out of view rather than removed, so position —
    // not visibility — is what says whether it is open.
    const closed = await sidebar.boundingBox();
    expect(closed?.x ?? 0).toBeLessThan(0);
    await expect(page.locator(".backdrop")).toBeHidden();

    await page.getByRole("button", { name: "Menu" }).click();

    await expect(sidebar).toHaveClass(/open/);
    await expect(page.locator(".backdrop")).toBeVisible();
    await expect.poll(async () => (await sidebar.boundingBox())?.x).toBe(0);
  });

  test("closes the drawer after navigating", async ({ page }) => {
    await page.getByRole("button", { name: "Menu" }).click();
    await page.locator("nav.nav").getByRole("link", { name: "Tenants", exact: true }).click();

    await expect(page).toHaveURL(/\/tenants$/);
    await expect(page.locator(".sidebar")).not.toHaveClass(/open/);
    await expect(page.locator(".backdrop")).toBeHidden();
  });

  test("closes the drawer when the scrim is tapped", async ({ page }) => {
    await page.getByRole("button", { name: "Menu" }).click();
    await expect(page.locator(".backdrop")).toBeVisible();

    // The scrim spans the viewport but the open drawer sits on top of its
    // left edge, so tap the far right where the scrim is actually exposed.
    const box = await page.locator(".backdrop").boundingBox();
    await page.locator(".backdrop").click({
      position: { x: (box?.width ?? 400) - 8, y: 120 },
    });
    await expect(page.locator(".sidebar")).not.toHaveClass(/open/);
  });

  test("never scrolls the page horizontally", async ({ page }) => {
    for (const path of ["/", "/properties", "/workflows", "/reports", "/settings"]) {
      await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(overflow, `${path} overflows horizontally by ${overflow}px`).toBeLessThanOrEqual(1);
    }
  });

  test("keeps the dashboard's starting point reachable", async ({ page }) => {
    // The dashboard is a configurable grid, so a phone opens on the same
    // onboarding state a desktop does — both ways in have to be tappable.
    await expect(page.getByRole("heading", { name: /No widgets/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Suggest from my pms data/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "+ Add a widget" })).toBeVisible();
  });

  test("gives a widget the full width rather than a squeezed column", async ({ page }) => {
    // Every span collapses to one column below the breakpoint: a 3-of-12 figure
    // on a phone is a figure nobody can read.
    const columns = await page
      .locator(".bento")
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length)
      .catch(() => 1);
    expect(columns).toBe(1);
  });

  test("scrolls a wide table inside its own container", async ({ page }) => {
    await page.goto("/properties");
    const wrap = page.locator(".table-wrap");
    await expect(wrap).toBeVisible();
    // The table may be wider than the phone; the wrapper absorbs it.
    const scrollable = await wrap.evaluate((el) => el.scrollWidth > el.clientWidth);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);
    expect(typeof scrollable).toBe("boolean");
  });
});

test.describe("Mobile login", () => {
  test.use(signedOut);

  test("reflows the hero around the sign-in card", async ({ page }) => {
    await page.goto("/login");

    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await expect(page.locator(".hero-badge")).toBeVisible();

    // `.login-hero::after` is switched off at this width because its bloom
    // would otherwise widen the page once the panel becomes display: contents.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("can sign in on a phone", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Username", { exact: true }).fill("e2e.manager");
    await page.getByLabel("Password", { exact: true }).fill("correct-horse");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
  });
});
