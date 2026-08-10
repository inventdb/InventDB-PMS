import { expect, test as setup } from "./fixtures";

const STATE_FILE = "e2e/.auth/user.json";

/**
 * Signs in once and saves the resulting storage state for every other project.
 *
 * This goes through the real form rather than writing `pms.token` directly, so
 * the state the suite runs on is whatever AuthContext actually produces — if
 * the login contract changes, this fails here instead of silently handing 60
 * tests a shape the app no longer accepts.
 *
 * It also pins `pms.theme` to light, which keeps the theme-dependent
 * assertions independent of the machine's colour-scheme preference.
 */
setup("authenticate", async ({ page }) => {
  await page.goto("/login");

  await page.getByLabel("Username", { exact: true }).fill("e2e.manager");
  await page.getByLabel("Password", { exact: true }).fill("correct-horse");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();

  await page.evaluate(() => localStorage.setItem("pms.theme", "light"));

  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("pms.token")))
    .not.toBeNull();

  await page.context().storageState({ path: STATE_FILE });
});
