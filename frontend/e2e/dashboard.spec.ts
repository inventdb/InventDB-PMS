import { expect, sseBody, test } from "./fixtures";
import type { Page } from "@playwright/test";

/** The layout the assistant returns for a described dashboard. */
const PROPOSED = [
  { kind: "kpi", title: "Overdue Rent", sql: "SELECT COUNT(*) AS v FROM pms.leases", span: 3 },
  { kind: "bar", title: "Arrears by Region", sql: "SELECT region, COUNT(*) AS v FROM pms.properties GROUP BY region", span: 6 },
];

/** Script the agent turn that `suggestWidgets` parses. */
async function scriptLayout(page: Page, widgets: unknown = PROPOSED) {
  await page.route(/\/api\/analyze\/chat\/stream/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: sseBody([{ type: "answer", content: JSON.stringify(widgets) }]),
    })
  );
}

/**
 * The Dashboard is InventDB SOAR's Today room: a live, configurable grid where
 * every widget is one query. Nothing is hardcoded, so a fresh instance opens on
 * the onboarding state rather than on figures nobody chose.
 *
 * What matters here is the promises the room makes about a person's layout: a
 * suggestion is a proposal until it is saved, editing is a mode you enter
 * deliberately, and clearing asks first.
 */
test.describe("Dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("greets the operator and says where the figures come from", async ({ page }) => {
    await expect(page.getByText("Today · PMS")).toBeVisible();
    await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening)/ })).toBeVisible();
    await expect(page.getByText(/Every figure shows the query behind it/)).toBeVisible();
  });

  test("opens on the onboarding state when nothing has been built yet", async ({ page }) => {
    await expect(page.getByRole("heading", { name: /No widgets on the pms dashboard yet/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Suggest from my pms data/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "+ Add a widget" })).toBeVisible();
  });

  test("offers no layout controls until there is a layout", async ({ page }) => {
    // With nothing on the grid, Refresh and Edit layout have nothing to act on
    // and the empty state is the single entry point — no duplicate calls to action.
    await expect(page.getByRole("button", { name: "Refresh" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Edit layout" })).toHaveCount(0);
  });

  test("never shows the assistant's token usage", async ({ page }) => {
    // The one deliberate divergence from SOAR's room.
    await expect(page.getByText(/\btokens?\b/i)).toHaveCount(0);
  });

  test.describe("adding a widget", () => {
    test("builds a one-query number and puts it on the grid", async ({ page }) => {
      await page.getByRole("button", { name: "+ Add a widget" }).click();

      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await dialog.getByRole("tab", { name: "Simple (one query)" }).click();
      await dialog.locator("#w-title").fill("Occupied Properties");
      await dialog.locator("#w-sql").fill("SELECT COUNT(*) AS v FROM pms.properties");
      await dialog.getByRole("button", { name: "Preview" }).click();
      await dialog.getByRole("button", { name: "Add widget" }).click();

      await expect(page.getByRole("heading", { name: "Occupied Properties" })).toBeVisible();
      // The figure comes from the query, not from anything the page assumed.
      await expect(page.locator(".wg-kpi-value")).toBeVisible();
    });

    test("refuses a widget with no query rather than adding an empty card", async ({ page }) => {
      await page.getByRole("button", { name: "+ Add a widget" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("tab", { name: "Simple (one query)" }).click();
      await dialog.locator("#w-title").fill("Nothing");
      await dialog.getByRole("button", { name: "Add widget" }).click();

      await expect(dialog.getByText("Add a query.")).toBeVisible();
      await expect(dialog).toBeVisible();
    });

    test("refuses a mini-report that was never built", async ({ page }) => {
      await page.getByRole("button", { name: "+ Add a widget" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.locator("#w-title").fill("Scorecard");
      await dialog.getByRole("button", { name: "Add widget" }).click();

      await expect(dialog.getByText(/Build the widget first/)).toBeVisible();
    });

    test("the quick-add tab targets a module rather than a free-text type", async ({ page }) => {
      await page.getByRole("button", { name: "+ Add a widget" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("tab", { name: "Quick-add form" }).click();

      await expect(dialog.locator("#w-ns")).toHaveValue("pms");
      await dialog.locator("#w-formtype").selectOption("properties");
      // The preview is the ACTUAL card, so what you approve is what you get.
      await expect(dialog.getByRole("button", { name: /New Property/ })).toBeVisible();
    });
  });

  test.describe("with a layout", () => {
    test.beforeEach(async ({ page }) => {
      await page.getByRole("button", { name: "+ Add a widget" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("tab", { name: "Simple (one query)" }).click();
      await dialog.locator("#w-title").fill("Properties by Status");
      await dialog.locator("#w-kind").selectOption("bar");
      await dialog
        .locator("textarea.we-sql")
        .fill("SELECT status, COUNT(*) AS v FROM pms.properties GROUP BY status");
      await dialog.getByRole("button", { name: "Add widget" }).click();
      await expect(page.getByRole("heading", { name: "Properties by Status" })).toBeVisible();
    });

    test("shows the toolbar once there is something to act on", async ({ page }) => {
      await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Edit layout" })).toBeVisible();
      await expect(page.getByRole("button", { name: /Suggest widgets/ })).toBeVisible();
    });

    test("carries the query behind every figure", async ({ page }) => {
      // The room's claim is that you can check where a number came from.
      await expect(page.locator(".wg-receipt").first()).toBeVisible();
    });

    test("keeps edit and remove out of the way until Edit layout is pressed", async ({ page }) => {
      await expect(page.getByRole("button", { name: "Remove" })).toHaveCount(0);
      await page.getByRole("button", { name: "Edit layout" }).click();
      await expect(page.getByRole("button", { name: "Remove" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Done" })).toBeVisible();
    });

    test("removes a widget", async ({ page }) => {
      await page.getByRole("button", { name: "Edit layout" }).click();
      await page.getByRole("button", { name: "Remove" }).click();
      await expect(page.getByRole("heading", { name: "Properties by Status" })).toHaveCount(0);
      await expect(page.getByRole("heading", { name: /No widgets/ })).toBeVisible();
    });

    test("asks before clearing the whole dashboard", async ({ page }) => {
      await page.getByRole("button", { name: "Edit layout" }).click();
      await page.getByRole("button", { name: "Clear dashboard" }).click();

      await expect(page.getByText(/Clear the pms dashboard\?/)).toBeVisible();
      await page.getByRole("button", { name: "Cancel" }).click();
      // Cancelling leaves the layout exactly as it was.
      await expect(page.getByRole("heading", { name: "Properties by Status" })).toBeVisible();
    });

    test("clears when confirmed", async ({ page }) => {
      await page.getByRole("button", { name: "Edit layout" }).click();
      await page.getByRole("button", { name: "Clear dashboard" }).click();
      await page.getByRole("button", { name: "Clear", exact: true }).click();
      await expect(page.getByRole("heading", { name: /No widgets/ })).toBeVisible();
    });

    test("survives a reload — the layout is stored, not held in the tab", async ({ page }) => {
      await page.reload();
      await expect(page.getByRole("heading", { name: "Properties by Status" })).toBeVisible();
    });
  });

  test.describe("describing a whole layout", () => {
    test("builds several widgets from one plain-English brief", async ({ page }) => {
      await scriptLayout(page);
      await page.getByRole("button", { name: "+ Add a widget" }).click();

      const dialog = page.getByRole("dialog");
      await dialog.getByRole("tab", { name: /Whole layout/ }).click();
      await dialog.locator("#w-layout").fill("a delinquency view");
      await dialog.getByRole("button", { name: /Build layout/ }).click();

      // The preview is the real grid, so what you approve is what you get.
      await expect(dialog.getByRole("heading", { name: "Overdue Rent" })).toBeVisible();
      await expect(dialog.getByRole("heading", { name: "Arrears by Region" })).toBeVisible();
      await expect(dialog.getByText(/2 widgets/)).toBeVisible();
    });

    test("writes nothing until Replace or Add is chosen", async ({ page }) => {
      await scriptLayout(page);
      await page.getByRole("button", { name: "+ Add a widget" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("tab", { name: /Whole layout/ }).click();
      await dialog.locator("#w-layout").fill("a delinquency view");
      await dialog.getByRole("button", { name: /Build layout/ }).click();
      await expect(dialog.getByRole("heading", { name: "Overdue Rent" })).toBeVisible();

      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(page.getByRole("heading", { name: /No widgets/ })).toBeVisible();
    });

    test("replaces the dashboard", async ({ page }) => {
      await scriptLayout(page);
      await page.getByRole("button", { name: "+ Add a widget" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("tab", { name: /Whole layout/ }).click();
      await dialog.locator("#w-layout").fill("a delinquency view");
      await dialog.getByRole("button", { name: /Build layout/ }).click();
      await dialog.getByRole("button", { name: "Replace my dashboard" }).click();

      await expect(page.getByRole("heading", { name: "Overdue Rent" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Arrears by Region" })).toBeVisible();
    });

    test("offers Replace and Add as separate answers", async ({ page }) => {
      // "Yes" means two different things for a whole layout, so it is two buttons.
      await scriptLayout(page);
      await page.getByRole("button", { name: "+ Add a widget" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("tab", { name: /Whole layout/ }).click();
      await expect(dialog.getByRole("button", { name: "Replace my dashboard" })).toBeDisabled();
      await expect(dialog.getByRole("button", { name: "Add to my dashboard" })).toBeDisabled();

      await dialog.locator("#w-layout").fill("a delinquency view");
      await dialog.getByRole("button", { name: /Build layout/ }).click();
      await expect(dialog.getByRole("button", { name: "Replace my dashboard" })).toBeEnabled();
      await expect(dialog.getByRole("button", { name: "Add to my dashboard" })).toBeEnabled();
    });

    test("adding keeps what is already there", async ({ page }) => {
      // Build one widget by hand first.
      await page.getByRole("button", { name: "+ Add a widget" }).click();
      let dialog = page.getByRole("dialog");
      await dialog.getByRole("tab", { name: "Simple (one query)" }).click();
      await dialog.locator("#w-title").fill("Kept Widget");
      await dialog.locator("#w-sql").fill("SELECT COUNT(*) AS v FROM pms.properties");
      await dialog.getByRole("button", { name: "Add widget" }).click();
      await expect(page.getByRole("heading", { name: "Kept Widget" })).toBeVisible();

      await scriptLayout(page);
      await page.getByRole("button", { name: "+ Add widget" }).click();
      dialog = page.getByRole("dialog");
      await dialog.getByRole("tab", { name: /Whole layout/ }).click();
      await dialog.locator("#w-layout").fill("a delinquency view");
      await dialog.getByRole("button", { name: /Build layout/ }).click();
      await dialog.getByRole("button", { name: "Add to my dashboard" }).click();

      await expect(page.getByRole("heading", { name: "Overdue Rent" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Kept Widget" })).toBeVisible();
    });

    test("leaves no reasoning trail once the layout has landed", async ({ page }) => {
      await scriptLayout(page);
      await page.getByRole("button", { name: "+ Add a widget" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("tab", { name: /Whole layout/ }).click();
      await dialog.locator("#w-layout").fill("a delinquency view");
      await dialog.getByRole("button", { name: /Build layout/ }).click();
      await expect(dialog.getByRole("heading", { name: "Overdue Rent" })).toBeVisible();

      // The trace and its token count are progress, not a result.
      await expect(page.getByText(/tokens?/i)).toHaveCount(0);
      await expect(page.getByText("Reasoned through it")).toHaveCount(0);
    });

    test("the tab is offered only when adding, never when editing one widget", async ({ page }) => {
      await page.getByRole("button", { name: "+ Add a widget" }).click();
      let dialog = page.getByRole("dialog");
      await dialog.getByRole("tab", { name: "Simple (one query)" }).click();
      await dialog.locator("#w-title").fill("One Widget");
      await dialog.locator("#w-sql").fill("SELECT COUNT(*) AS v FROM pms.properties");
      await dialog.getByRole("button", { name: "Add widget" }).click();

      await page.getByRole("button", { name: "Edit layout" }).click();
      await page.getByRole("button", { name: "Edit" }).click();
      dialog = page.getByRole("dialog");
      await expect(dialog.getByRole("tab", { name: /Whole layout/ })).toHaveCount(0);
    });
  });
});

test.describe("Greeting", () => {
  // The browser is pinned to UTC by playwright.config.ts, so a `Z` time is also
  // the local hour the greeting reads.
  const cases = [
    { at: "2026-08-24T08:00:00Z", says: "Good morning" },
    { at: "2026-08-24T11:59:00Z", says: "Good morning" },
    { at: "2026-08-24T12:00:00Z", says: "Good afternoon" },
    { at: "2026-08-24T15:59:00Z", says: "Good afternoon" },
    { at: "2026-08-24T16:00:00Z", says: "Good evening" },
    // Half past five is the evening. Reported as a bug when it was not.
    { at: "2026-08-24T17:30:00Z", says: "Good evening" },
    { at: "2026-08-24T23:59:00Z", says: "Good evening" },
  ] as const;

  for (const { at, says } of cases) {
    test(`${at.slice(11, 16)} reads as “${says}”`, async ({ page }) => {
      await page.clock.setFixedTime(new Date(at));
      await page.goto("/");

      await expect(page.getByRole("heading", { name: says })).toBeVisible();
    });
  }
});
