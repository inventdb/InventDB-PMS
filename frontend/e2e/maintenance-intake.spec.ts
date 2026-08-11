import { expect, test } from "./fixtures";

/**
 * Maintenance intake — the automation that fills the inbox.
 *
 * The promises here are about what it does *before* anyone presses anything:
 * it must be honest about who it could actually send, it must not go live off a
 * button press, and it must not be installable twice — a second intake means
 * every tenant gets two acknowledgements for one email.
 */

const panel = (page: import("@playwright/test").Page) => page.locator(".mi-panel");

test.describe("Maintenance intake", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/inbox");
  });

  test("explains the flow, and where it stops", async ({ page }) => {
    const flow = panel(page).locator(".mi-flow li");
    await expect(flow).toHaveCount(6);
    await expect(flow.nth(0)).toContainText("Reads the email");
    await expect(flow.nth(1)).toContainText("Acknowledges it");
    await expect(flow.nth(2)).toContainText("Opens a work order");
    await expect(flow.nth(3)).toContainText("Shortlists a contractor");
    // The pause is the point: everything above it commits nobody.
    await expect(flow.nth(4)).toContainText("Stops and asks you");
    await expect(flow.nth(4)).toContainText("no cost is committed until you answer");
    await expect(flow.nth(5)).toContainText("Assigns and briefs them");
  });

  test("names the categories it could not staff", async ({ page }) => {
    // An intake that reads the mailbox perfectly and finds nobody to send is
    // not working. Say so now, not when the first request parks empty.
    await expect(panel(page).locator(".alert.warn")).toContainText(
      "No contractor on file for Electrical, Roofing"
    );
    await expect(panel(page).getByRole("link", { name: "Vendors" })).toHaveAttribute(
      "href",
      "/vendors"
    );
  });

  test("previews who it would put forward, and why", async ({ page }) => {
    const shortlist = panel(page).locator(".mi-shortlist li");
    await expect(shortlist).toHaveCount(1);
    await expect(shortlist.first()).toContainText("Coastal Plumbing");
    // The reason, not just a score — "4.6" is not a reason to send someone.
    await expect(shortlist.first()).toContainText(
      "Plumbing specialist, certificate of insurance on file, rated 4.6"
    );
  });

  test("flags an uninsured recommendation in the preview", async ({ page }) => {
    await panel(page).getByLabel("Who it would put forward for").selectOption("HVAC");

    const shortlist = panel(page).locator(".mi-shortlist li");
    await expect(shortlist.first()).toContainText("Nimbus Air");
    await expect(shortlist.first().locator(".badge")).toHaveText("No COI");
  });

  test("says plainly when a category has nobody", async ({ page }) => {
    await panel(page).getByLabel("Who it would put forward for").selectOption("Roofing");

    await expect(panel(page)).toContainText("Nobody on file does");
  });

  test("installs as a rehearsal, never live", async ({ page }) => {
    const posted: unknown[] = [];
    await page.route("**/api/maintenance/intake", async (route) => {
      if (route.request().method() === "POST") posted.push(route.request().postDataJSON());
      await route.fallback();
    });

    await panel(page).getByRole("button", { name: "Set up intake" }).click();

    await expect(page.locator(".toast")).toContainText("created as a rehearsal");
    expect(posted).toEqual([{}]);
    // It reads a live mailbox and emails real people; a button press must not
    // be able to start that.
    await expect(page.locator(".wf-step")).toContainText(["Read the request"]);
  });

  test("a label narrows what it will read", async ({ page }) => {
    const posted: unknown[] = [];
    await page.route("**/api/maintenance/intake", async (route) => {
      if (route.request().method() === "POST") posted.push(route.request().postDataJSON());
      await route.fallback();
    });

    await panel(page).getByLabel("Only read mail labelled (optional)").fill("Maintenance");
    await panel(page).getByRole("button", { name: "Set up intake" }).click();

    await expect(page.locator(".toast")).toBeVisible();
    expect(posted).toEqual([{ gmail_label: "Maintenance" }]);
  });

  test("once installed it collapses to a line, and says it is not live yet", async ({ page }) => {
    await panel(page).getByRole("button", { name: "Set up intake" }).click();
    await expect(page.locator(".toast")).toBeVisible();
    await page.reload();

    const strip = page.locator(".mi-strip");
    await expect(strip).toContainText("has never been activated");
    // The setup form does not stay at the top of a working inbox forever.
    await expect(page.locator(".mi-flow")).toHaveCount(0);
    // But the gap it cannot fix stays visible.
    await expect(strip.locator(".badge")).toContainText("2 categories unstaffed");
  });

  test("the installed intake opens in Workflows to be activated", async ({ page }) => {
    await panel(page).getByRole("button", { name: "Set up intake" }).click();
    await expect(page.locator(".toast")).toBeVisible();

    await page.getByRole("link", { name: "Open in Workflows" }).click();

    await expect(page).toHaveURL(/\/workflows\?id=wf-intake/);
    await expect(page.locator(".modal")).toContainText("Maintenance request intake");
    // The same ladder every other workflow climbs.
    await expect(page.locator(".modal").getByRole("button", { name: "Activate" })).toBeVisible();
  });

  test("installing twice does not create a second intake", async ({ page }) => {
    await panel(page).getByRole("button", { name: "Set up intake" }).click();
    await expect(page.locator(".toast")).toBeVisible();
    await page.reload();
    await page.locator(".mi-strip").getByRole("button", { name: "Details" }).click();

    // No second Set-up button is even offered once one exists.
    await expect(page.getByRole("button", { name: "Set up intake" })).toHaveCount(0);

    await page.goto("/workflows");
    await expect(
      page.locator(".wf-card").filter({ hasText: "Maintenance request intake" })
    ).toHaveCount(0); // still a draft, and the Workflows page hides drafts
  });

  test("a failed status read hides the panel rather than breaking the inbox", async ({ page }) => {
    await page.route("**/api/maintenance/intake", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "unreachable" }),
      })
    );
    await page.reload();

    await expect(page.locator(".mi-panel, .mi-strip")).toHaveCount(0);
    // The inbox itself is unaffected — the panel is not what the page is for.
    await expect(page.locator(".nb-row")).toHaveCount(4);
  });
});
