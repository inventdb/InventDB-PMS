import { expect, test } from "./fixtures";

/**
 * Keyboard movement through the module rail.
 *
 * Tab and Shift+Tab open each type as they reach it, so stepping through the
 * practice with the keyboard shows the data rather than only lighting up a
 * name. The second test is the guard rail: that behaviour is scoped to the
 * rail, because Tab is also how you move between fields, and a form that threw
 * you into another module halfway through would be far worse than the problem
 * being solved.
 */

test("Tab through the rail opens each type as it goes", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/properties");
  await page.locator("a.nav-item[href='/properties']").focus();

  const seen: string[] = [];
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("Tab");
    await page.waitForTimeout(150);
    seen.push(new URL(page.url()).pathname);
  }
  console.log("Tab      :", JSON.stringify(seen));

  const back: string[] = [];
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press("Shift+Tab");
    await page.waitForTimeout(150);
    back.push(new URL(page.url()).pathname);
  }
  console.log("Shift+Tab:", JSON.stringify(back));

  // The focused link and the open page must agree.
  const focused = await page.evaluate(() =>
    (document.activeElement as HTMLAnchorElement)?.getAttribute("href")
  );
  console.log("focus    :", focused, "url:", new URL(page.url()).pathname);
  expect(focused).toBe(new URL(page.url()).pathname);
});

test("Tab in a form still moves between fields", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/properties");
  await page.getByRole("button", { name: /New Property/i }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  const before = new URL(page.url()).pathname;
  await dialog.locator("input, select, textarea").first().focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press("Tab");
  await page.waitForTimeout(150);
  console.log("form url before:", before, "after:", new URL(page.url()).pathname);
  expect(new URL(page.url()).pathname).toBe(before);
  await expect(dialog).toBeVisible();
});
