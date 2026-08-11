import { expect, test } from "./fixtures";

/**
 * Inbox — the decisions automations are holding.
 *
 * Every item here was posted by a workflow run, and the ones with actions are
 * runs that are still going: they stopped at a step that is not the software's
 * decision. So the promises worth protecting are about *consequence*, not
 * layout:
 *
 *   - a decision that has not been answered is visibly holding something up;
 *   - answering it says what it did, and cannot be taken back by clicking the
 *     other button;
 *   - a notification with nothing to answer never claims to need you;
 *   - a body written by a stranger cannot run script in the manager's session.
 */

const list = (page: import("@playwright/test").Page) => page.locator(".nb-row");
const detail = (page: import("@playwright/test").Page) => page.locator(".nb-card");

test.describe("Inbox", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/inbox");
  });

  // =========================================================================
  // Seeing what is waiting
  // =========================================================================

  test("counts only the decisions that are actually outstanding", async ({ page }) => {
    // Four notifications are seeded: two waiting, one already answered, one
    // purely informational. Only the first two are holding a run open.
    await expect(list(page)).toHaveCount(4);
    await expect(page.locator(".count-pill")).toContainText("2 waiting on you");
  });

  test("waiting items sort above everything else, however old", async ({ page }) => {
    // The answered call-out is newer than the informational note but older than
    // both approvals; a purely chronological inbox would bury the approvals.
    await expect(list(page).nth(0)).toContainText("kitchen tap dripping");
    await expect(list(page).nth(1)).toContainText("front door lock jammed");
    await expect(list(page).nth(2)).toContainText("Approve overtime call-out");
    await expect(list(page).nth(3)).toContainText("Monthly owner statements sent");
  });

  test("a note with nothing to answer is not labelled as needing you", async ({ page }) => {
    const info = list(page).filter({ hasText: "Monthly owner statements sent" });
    await expect(info.locator(".badge")).toHaveCount(0);

    await info.click();
    await expect(detail(page).locator(".badge")).toHaveText("For information");
    // Nothing to press: it can never be resolved, so no buttons are offered.
    await expect(detail(page).locator(".nb-actions")).toHaveCount(0);
  });

  test("the parked decision says what it is holding up", async ({ page }) => {
    await expect(detail(page)).toContainText("Assign a contractor: kitchen tap dripping");
    await expect(detail(page).locator(".alert.warn")).toContainText(
      "Nothing further happens — no email, no assignment — until you answer"
    );
    // The recommendation, and the evidence for it, are on the card.
    await expect(detail(page)).toContainText("Coastal Plumbing");
    await expect(detail(page)).toContainText("12 Marine Drive, Mumbai");
  });

  test("each button says what pressing it will do", async ({ page }) => {
    // "Approve" alone does not convey that a contractor is about to be emailed.
    await expect(detail(page).locator(".nb-consequences")).toContainText(
      "Releases the run — it carries out the rest of its steps for real"
    );
    await expect(detail(page).locator(".nb-consequences")).toContainText(
      "The run skips the steps that were waiting on a yes"
    );
  });

  // =========================================================================
  // Answering
  // =========================================================================

  test("approving resumes the run and says so", async ({ page }) => {
    const posted: unknown[] = [];
    await page.route("**/api/notifications/*/resolve", async (route) => {
      posted.push(route.request().postDataJSON());
      await route.fallback();
    });

    await detail(page).getByRole("button", { name: "Assign the recommended contractor" }).click();

    await expect(page.locator(".toast")).toContainText("picked up where it left off");
    expect(posted).toEqual([{ action_id: "approve" }]);
    // No payload on a plain approve: an empty object is not nothing to a plan
    // branching on `${decision.payload.vendor}`.
    expect(Object.keys(posted[0] as object)).toEqual(["action_id"]);
  });

  test("an answered decision cannot be answered again", async ({ page }) => {
    await detail(page).getByRole("button", { name: "Assign the recommended contractor" }).click();
    await expect(page.locator(".toast")).toBeVisible();

    await expect(detail(page).locator(".badge").first()).toHaveText("Answered");
    // The buttons stay on screen — hiding them would erase the record of what
    // was decided — but none of them can be pressed.
    const buttons = detail(page).locator(".nb-actions button");
    await expect(buttons).toHaveCount(3);
    for (const button of await buttons.all()) {
      await expect(button).toBeDisabled();
    }
  });

  test("answering drops the count and the badge", async ({ page }) => {
    await expect(page.locator(".nav-badge")).toHaveText("2");

    await detail(page).getByRole("button", { name: "Assign the recommended contractor" }).click();
    await expect(page.locator(".toast")).toBeVisible();

    await expect(page.locator(".count-pill")).toContainText("1 waiting on you");
    await expect(page.locator(".nav-badge")).toHaveText("1");
    await expect(page.locator(".bell-count")).toHaveText("1");
  });

  test("naming a different contractor sends what was typed", async ({ page }) => {
    const posted: unknown[] = [];
    await page.route("**/api/notifications/*/resolve", async (route) => {
      posted.push(route.request().postDataJSON());
      await route.fallback();
    });

    await detail(page).getByRole("button", { name: "Assign a different contractor" }).click();
    await detail(page).getByLabel(/Contractor/).fill("Nimbus Air");
    await detail(page).getByRole("button", { name: "Submit and release the run" }).click();

    await expect(page.locator(".toast")).toContainText("resumed");
    expect(posted).toEqual([{ action_id: "choose", payload: { vendor: "Nimbus Air" } }]);
  });

  test("a form action cannot resume the run empty", async ({ page }) => {
    const posted: unknown[] = [];
    await page.route("**/api/notifications/*/resolve", async (route) => {
      posted.push(route.request().postDataJSON());
      await route.fallback();
    });

    await detail(page).getByRole("button", { name: "Assign a different contractor" }).click();
    await detail(page).getByRole("button", { name: "Submit and release the run" }).click();

    // The field is required, so the browser blocks the submit rather than
    // resuming a run with no contractor named.
    expect(posted).toEqual([]);
  });

  test("declining is offered as a real answer, not as a delete", async ({ page }) => {
    await detail(page).getByRole("button", { name: "Not now" }).click();

    await expect(page.locator(".toast")).toContainText("skipped the steps that needed a yes");
    await expect(detail(page).locator(".badge").first()).toHaveText("Answered");
  });

  test("a decision someone else answered first reports the conflict", async ({ page }) => {
    await page.route("**/api/notifications/*/resolve", (route) =>
      route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "notification already resolved" }),
      })
    );

    await detail(page).getByRole("button", { name: "Assign the recommended contractor" }).click();

    await expect(detail(page).locator(".alert.error")).toContainText("already resolved");
  });

  // =========================================================================
  // Checking the work
  // =========================================================================

  test("the run's trail shows what it did before it stopped", async ({ page }) => {
    await detail(page).getByRole("button", { name: "Show what the run has done" }).click();

    const trail = detail(page).locator(".wf-rsteps");
    // Not a summary of the plan — what this run actually executed.
    await expect(trail).toContainText("llm_extract");
    await expect(trail).toContainText("send_email");
    await expect(trail).toContainText("1 row");
  });

  // =========================================================================
  // Clearing
  // =========================================================================

  test("an outstanding decision cannot be cleared away", async ({ page }) => {
    // Clearing one would hide a run that is still parked, with nothing left in
    // the app to say so.
    await expect(detail(page).locator(".nb-clear")).toHaveCount(0);
  });

  test("a resolved item can be cleared", async ({ page }) => {
    await list(page).filter({ hasText: "Approve overtime call-out" }).click();
    await detail(page).locator(".nb-clear").click();

    await expect(page.locator(".toast")).toContainText("Cleared");
    await expect(list(page)).toHaveCount(3);
  });

  // =========================================================================
  // Safety
  // =========================================================================

  test("a body written by a stranger cannot run script", async ({ page }) => {
    // The issue text in an approval is a sentence someone emailed the office.
    // Injecting it as markup would run it on the screen where money is approved.
    await list(page).filter({ hasText: "front door lock jammed" }).click();
    await expect(detail(page).locator(".nb-body")).toContainText("lock jammed");

    await expect(detail(page).locator(".nb-body img")).toHaveCount(0);
    await expect(detail(page).locator(".nb-body a")).toHaveCount(0);
    await expect(detail(page).locator(".nb-body script")).toHaveCount(0);
    expect(await page.evaluate(() => (window as never as { __xss?: number }).__xss)).toBeUndefined();
  });

  test("the list preview never prints the script it stripped", async ({ page }) => {
    // `textContent` happily returns a <script>'s source, so the naive preview
    // prints the payload of the very attack the renderer defends against.
    const row = list(page).filter({ hasText: "front door lock jammed" });
    await expect(row).not.toContainText("window.__xss");
  });

  // =========================================================================
  // Empty and error states
  // =========================================================================

  test("an empty inbox explains what will land here", async ({ page }) => {
    await page.route("**/api/notifications", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ notifications: [] }),
      })
    );
    await page.reload();

    await expect(page.getByRole("heading", { name: "Nothing here yet" })).toBeVisible();
    await expect(page.locator(".count-pill")).toContainText("Nothing waiting on you");
    await expect(page.locator(".nav-badge")).toHaveCount(0);
  });

  test("a failed load says so rather than showing an empty inbox", async ({ page }) => {
    await page.route("**/api/notifications", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "InventDB is unreachable" }),
      })
    );
    await page.reload();

    await expect(page.locator(".alert.error")).toContainText("InventDB is unreachable");
  });

  test("the inbox can be searched", async ({ page }) => {
    await page.locator(".nb-search input").fill("statements");

    await expect(list(page)).toHaveCount(1);
    await expect(list(page).first()).toContainText("Monthly owner statements sent");
  });
});

test.describe("The bell", () => {
  test("shows the count from anywhere in the app", async ({ page }) => {
    await page.goto("/properties");

    await expect(page.locator(".bell-count")).toHaveText("2");
    await expect(page.locator(".topbar-bell")).toHaveAttribute(
      "aria-label",
      "Inbox — 2 waiting on you"
    );
  });

  test("goes to the inbox", async ({ page }) => {
    await page.goto("/properties");
    await page.locator(".topbar-bell").click();

    await expect(page).toHaveURL(/\/inbox/);
  });

  test("carries no count when nothing is waiting", async ({ page }) => {
    await page.route("**/api/notifications", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ notifications: [] }),
      })
    );
    await page.goto("/properties");

    await expect(page.locator(".bell-count")).toHaveCount(0);
    await expect(page.locator(".topbar-bell")).toHaveAttribute(
      "aria-label",
      "Inbox — nothing waiting"
    );
  });
});
