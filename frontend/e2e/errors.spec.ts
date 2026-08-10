import { expect, rows, test } from "./fixtures";

test.describe("API failure handling", () => {
  test("shows the server's message when a list call fails", async ({ page }) => {
    await page.route("**/api/properties*", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Namespace pms is not reachable" }),
      })
    );
    await page.goto("/properties");

    await expect(page.locator(".alert.error")).toHaveText("Namespace pms is not reachable");
  });

  test("falls back to a readable message when the body has no error field", async ({ page }) => {
    await page.route("**/api/owners*", (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: "{}" })
    );
    await page.goto("/owners");

    await expect(page.locator(".alert.error")).toContainText(/500|Request failed/);
  });

  test("renders a network-level failure rather than an empty table", async ({ page }) => {
    await page.route("**/api/vendors*", (route) => route.abort("connectionrefused"));
    await page.goto("/vendors");

    await expect(page.locator(".alert.error")).toBeVisible();
  });

  test("logs the user out when any call returns 401", async ({ page }) => {
    await page.goto("/properties");
    await expect(rows(page)).toHaveCount(3);

    // The response interceptor in api/client.ts turns any 401 into a logout,
    // which drops ProtectedLayout back to the login route.
    await page.route("**/api/properties*", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "token expired" }),
      })
    );
    await page.reload();

    await expect(page).toHaveURL(/\/login$/);
    expect(await page.evaluate(() => localStorage.getItem("pms.token"))).toBeNull();
  });

  test("a 401 during a write also ends the session", async ({ page }) => {
    await page.goto("/properties");
    await page.getByRole("button", { name: "New Property" }).click();
    await page.locator("#f-street").fill("Doomed Street");

    await page.route("**/api/properties", (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      return route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "token expired" }),
      });
    });

    await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("recovers when the API comes back", async ({ page }) => {
    let failing = true;
    await page.route("**/api/tenants*", async (route) => {
      if (failing) {
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "temporarily unavailable" }),
        });
      }
      return route.fallback();
    });

    await page.goto("/tenants");
    await expect(page.locator(".alert.error")).toBeVisible();

    failing = false;
    await page.reload();
    await expect(rows(page)).toHaveCount(2);
    await expect(page.locator(".alert.error")).toHaveCount(0);
  });
});
