import { expect, test } from "./fixtures";

test("connection lookup fails", async ({ page }) => {
  await page.route("**/api/settings/connection", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: "Not authenticated" }),
    })
  );
  await page.goto("/settings");
  const input = page.locator("#base-url");
  await expect(input).toBeVisible();
  await page.waitForTimeout(500);

  console.log(
    JSON.stringify({
      disabled: await input.isDisabled(),
      editable: await input.isEditable(),
      value: await input.inputValue(),
      anyErrorShown: await page.locator(".card-pad", { hasText: "InventDB Connection" })
        .locator(".alert")
        .count(),
      saveDisabled: await page.getByRole("button", { name: /Save & reconnect/ }).isDisabled(),
    })
  );
});
