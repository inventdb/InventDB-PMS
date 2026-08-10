import { expect, signedOut, test } from "./fixtures";

test.use(signedOut);

test.describe("Login page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
  });

  test("renders the brand story and the sign-in card", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "Property management, modernised." })
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await expect(page.getByText("Properties, units, tenants & leases in one place")).toBeVisible();
    await expect(page.getByText("Powered by InventDB SOAR — secure & real-time")).toBeVisible();
  });

  test("signs in and lands on the dashboard", async ({ page }) => {
    await page.getByLabel("Username", { exact: true }).fill("e2e.manager");
    await page.getByLabel("Password", { exact: true }).fill("correct-horse");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL("http://localhost:5173/");
    await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("pms.token"))).toBe("e2e-test-token");
  });

  test("trims whitespace off the username before sending it", async ({ page }) => {
    await page.getByLabel("Username", { exact: true }).fill("   e2e.manager   ");
    await page.getByLabel("Password", { exact: true }).fill("correct-horse");

    const [request] = await Promise.all([
      page.waitForRequest((r) => r.url().includes("/api/auth/login") && r.method() === "POST"),
      page.getByRole("button", { name: "Sign in" }).click(),
    ]);

    expect(request.postDataJSON()).toEqual({
      username: "e2e.manager",
      password: "correct-horse",
    });
  });

  test("surfaces the server's error message on bad credentials", async ({ page }) => {
    await page.getByLabel("Username", { exact: true }).fill("e2e.manager");
    await page.getByLabel("Password", { exact: true }).fill("wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.locator(".alert.error")).toHaveText("Invalid username or password");
    await expect(page).toHaveURL(/\/login/);
    expect(await page.evaluate(() => localStorage.getItem("pms.token"))).toBeNull();
  });

  test("keeps the user on the page when a field is empty", async ({ page }) => {
    // Both inputs are `required`, so the browser blocks submission before any
    // request goes out.
    let requested = false;
    page.on("request", (r) => {
      if (r.url().includes("/api/auth/login")) requested = true;
    });

    await page.getByLabel("Username", { exact: true }).fill("e2e.manager");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/login/);
    expect(requested).toBe(false);
  });

  test("toggles password visibility", async ({ page }) => {
    const password = page.getByLabel("Password", { exact: true });
    await expect(password).toHaveAttribute("type", "password");

    await page.getByRole("button", { name: "Show password" }).click();
    await expect(password).toHaveAttribute("type", "text");

    await page.getByRole("button", { name: "Hide password" }).click();
    await expect(password).toHaveAttribute("type", "password");
  });

  test("points registration at InventDB in a new tab", async ({ page }) => {
    const link = page.getByRole("link", { name: /Register on InventDB/ });
    await expect(link).toHaveAttribute("href", "https://www.inventdb.com");
    await expect(link).toHaveAttribute("target", "_blank");
    // Without noopener the opened tab can reach back through window.opener.
    await expect(link).toHaveAttribute("rel", /noopener/);
  });

  test("shows a spinner state while the request is in flight", async ({ page }) => {
    await page.route("**/api/auth/login", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, token: "e2e-test-token", user: { username: "e2e.manager" } }),
      });
    });

    await page.getByLabel("Username", { exact: true }).fill("e2e.manager");
    await page.getByLabel("Password", { exact: true }).fill("correct-horse");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByRole("button", { name: /Signing in/ })).toBeDisabled();
    await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
  });

  test("reports a network failure instead of hanging", async ({ page }) => {
    await page.route("**/api/auth/login", (route) => route.abort("failed"));

    await page.getByLabel("Username", { exact: true }).fill("e2e.manager");
    await page.getByLabel("Password", { exact: true }).fill("correct-horse");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.locator(".alert.error")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });
});

test.describe("Route protection", () => {
  for (const path of ["/", "/properties", "/reports", "/workflows", "/settings"]) {
    test(`redirects ${path} to the login page when signed out`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login$/);
      await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    });
  }
});
