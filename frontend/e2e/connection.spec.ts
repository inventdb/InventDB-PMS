import { expect, signIn, test } from "./fixtures";

/**
 * Settings → InventDB Connection.
 *
 * The base URL is editable because pointing the app at your own instance
 * shouldn't need a redeploy. It is also the address every login goes to, so the
 * behaviours worth protecting are the guard rails rather than the typing:
 * the change is confirmed before it happens, a bad address is refused with a
 * reason, and saving signs you out because your session belongs to the instance
 * you just left.
 */

test.describe("InventDB connection", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/settings");
    await expect(page.locator("#base-url")).toHaveValue("https://e2e.cloud.inventdb.com");
  });

  test("Save stays disabled until the URL actually changes", async ({ page }) => {
    const save = page.getByRole("button", { name: "Save & reconnect" });
    await expect(save).toBeDisabled();

    await page.locator("#base-url").fill("https://acme.inventdb.com");
    await expect(save).toBeEnabled();

    // A trailing slash is the same instance, not a change.
    await page.locator("#base-url").fill("https://e2e.cloud.inventdb.com/");
    await expect(save).toBeDisabled();
  });

  test("changing it asks first, and says what it will cost", async ({ page }) => {
    await page.locator("#base-url").fill("https://acme.inventdb.com");
    await page.getByRole("button", { name: "Save & reconnect" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("https://acme.inventdb.com");
    await expect(dialog).toContainText("You'll be signed out");

    // Backing out leaves the app where it was.
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator("#base-url")).toHaveValue("https://acme.inventdb.com");
  });

  test("connecting signs you out, because the session belongs to the old one", async ({
    page,
  }) => {
    await page.locator("#base-url").fill("https://acme.inventdb.com");
    await page.getByRole("button", { name: "Save & reconnect" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Connect" }).click();

    await expect(page).toHaveURL(/\/login$/);
    // The token was minted by the instance we just left; leaving it in place
    // would look signed-in while every call failed.
    expect(await page.evaluate(() => localStorage.getItem("pms.token"))).toBeNull();
  });

  test("refuses an address that would put the password on the wire", async ({ page }) => {
    await page.locator("#base-url").fill("http://acme.inventdb.com");
    await page.getByRole("button", { name: "Save & reconnect" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Connect" }).click();

    await expect(page.locator(".alert.error")).toContainText("Use https://");
    // Nothing changed, and the user is still signed in to fix it.
    await expect(page).toHaveURL(/\/settings$/);
  });

  test("refuses an address that doesn't answer", async ({ page }) => {
    await page.locator("#base-url").fill("https://unreachable.inventdb.com");
    await page.getByRole("button", { name: "Save & reconnect" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Connect" }).click();

    // A typo here would strand everyone with no way back through the UI.
    await expect(page.locator(".alert.error")).toContainText("Couldn't reach");
    await expect(page).toHaveURL(/\/settings$/);
  });

  test("offers a way back once the app has been repointed", async ({ page }) => {
    await expect(page.getByRole("button", { name: "Reset to configured" })).toHaveCount(0);

    await page.locator("#base-url").fill("https://acme.inventdb.com");
    await page.getByRole("button", { name: "Save & reconnect" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Connect" }).click();
    await expect(page).toHaveURL(/\/login$/);

    // Sign back in — the app is now bound to the new instance, and the offer
    // to go back is what stops a wrong address being a one-way door.
    await signIn(page);
    await page.goto("/settings");
    await expect(page.locator("#base-url")).toHaveValue("https://acme.inventdb.com");
    await expect(page.getByRole("button", { name: "Reset to configured" })).toBeVisible();
  });

  test("still reports the connection status alongside the field", async ({ page }) => {
    await expect(page.locator(".badge.success")).toHaveText("Connected");
    await expect(page.getByText("pms", { exact: true })).toBeVisible();
  });
});
