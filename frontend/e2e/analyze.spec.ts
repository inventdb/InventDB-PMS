import {
  AGENT_PROPOSAL_STEPS,
  AGENT_STEPS,
  AGENT_WORKFLOW_STEPS,
  expect,
  sseBody,
  test,
} from "./fixtures";

/**
 * Analyze — the AI canvas.
 *
 * The agent turn arrives as Server-Sent Events, so these specs fulfil a real
 * `text/event-stream` body and let the page's own parser run. That is the code
 * most worth covering: everything downstream (the timeline, which artifact wins,
 * the receipt) is decided from the frames it produces.
 *
 * The promises being protected here are the room's, not the model's:
 *   - the work is visible, and the query behind an answer can be opened;
 *   - a turn that would change data proposes and waits;
 *   - a running analysis survives navigating away.
 */

/** Fulfil `/api/analyze/chat/stream` with a scripted turn. */
async function scriptTurn(
  page: import("@playwright/test").Page,
  steps: Record<string, unknown>[],
  options: { chunked?: boolean } = {}
) {
  await page.route(/\/api\/analyze\/chat\/stream/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: sseBody(steps),
    });
  });
  void options;
}

test.describe("Analyze", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/analyze");
  });

  test("restores the saved threads", async ({ page }) => {
    // Threads live on the InventDB instance, not in this browser, so opening
    // the room on a new machine still finds your history.
    await expect(page.locator(".an-thread-row")).toHaveCount(1);
    await expect(page.locator(".an-thread-title")).toHaveText(
      "Rent roll by property type"
    );
    await expect(
      page.getByText("Single-family homes carry $48,200 of the monthly roll.")
    ).toBeVisible();
  });

  test("answers a question and shows its work", async ({ page }) => {
    await page.locator(".an-ask .an-composer-input").fill("Which cities do we own in?");
    await page.locator(".an-ask button[type=submit]").click();

    await expect(page.locator(".atl-answer")).toContainText(
      "Your three largest markets are Richmond (12), Norfolk (9) and Vienna (4)."
    );

    // Each step the agent took is a node on the rail, described in words the
    // person asking can read.
    const rail = page.locator(".an-exchange").first().locator(".atl-node");
    await expect(rail.filter({ hasText: "Reasoned through it" })).toBeVisible();
    await expect(rail.filter({ hasText: "Grouping properties by city" })).toBeVisible();
  });

  test("the query behind the answer can be opened", async ({ page }) => {
    await page.locator(".an-ask .an-composer-input").fill("Which cities do we own in?");
    await page.locator(".an-ask button[type=submit]").click();
    await expect(page.locator(".atl-answer")).toBeVisible();

    // This is the room's whole claim: you can check it.
    await page.getByRole("button", { name: "Show the query it ran" }).click();
    await expect(page.locator(".an-sql")).toContainText(
      "SELECT city, COUNT(*) AS cnt FROM pms.properties"
    );
    await expect(page.getByText("3 returned")).toBeVisible();
  });

  test("renders the chart the agent authored", async ({ page }) => {
    await page.locator(".an-ask .an-composer-input").fill("Which cities do we own in?");
    await page.locator(".an-ask button[type=submit]").click();

    const figure = page.locator(".an-figure");
    await expect(figure).toBeVisible();
    await expect(figure.locator(".an-figure-title")).toHaveText("Properties by City");
    await expect(figure.locator("svg.recharts-surface")).toBeVisible();
  });

  test("suppresses the result grid when a chart is the deliverable", async ({ page }) => {
    await page.locator(".an-ask .an-composer-input").fill("Which cities do we own in?");
    await page.locator(".an-ask button[type=submit]").click();
    await expect(page.locator(".an-figure")).toBeVisible();

    // The rows behind a chart are the assistant's working, not its answer —
    // showing both says the same thing twice.
    await expect(page.locator(".atl-node .an-table")).toHaveCount(0);
  });

  test("offers the follow-ups the model proposed", async ({ page }) => {
    await page.locator(".an-ask .an-composer-input").fill("Which cities do we own in?");
    await page.locator(".an-ask button[type=submit]").click();
    await expect(page.locator(".atl-answer")).toBeVisible();

    await expect(
      page.getByRole("button", { name: "Which city has the highest average rent?" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "✦ Email this breakdown to the owners" })
    ).toBeVisible();
  });

  test("a proposed change waits for approval", async ({ page }) => {
    await scriptTurn(page, AGENT_PROPOSAL_STEPS);
    await page.locator(".an-ask .an-composer-input").fill("Add Blue Ridge Roofing");
    await page.locator(".an-ask button[type=submit]").click();

    const card = page.locator(".an-card");
    await expect(card).toContainText("Create vendor");
    await expect(card).toContainText("Blue Ridge Roofing");
    // The assistant never applies its own proposal.
    await expect(card.getByText("NOT APPLIED YET")).toBeVisible();
    await expect(card.getByRole("button", { name: /Review & create/ })).toBeVisible();
  });

  test("a workflow the assistant builds arrives whole, step by step", async ({ page }) => {
    await scriptTurn(page, AGENT_WORKFLOW_STEPS);
    await page
      .locator(".an-ask .an-composer-input")
      .fill("Every month, email each owner their statement.");
    await page.locator(".an-ask button[type=submit]").click();

    const card = page.locator(".an-wf-card");
    await expect(card).toContainText("Monthly owner statements");

    // Every step the workflow will take, named — not a step count and a link
    // to go and read it somewhere else.
    const steps = card.locator(".wf-steps .wf-step");
    await expect(steps).toHaveCount(4); // the trigger, then its three steps
    await expect(card).toContainText("Render Owner Statement");
    await expect(card).toContainText("Email owners");
    await expect(card).toContainText("Runs the saved report for each owner.");

    // Its real state, from the live record — and the ladder that acts on it.
    await expect(card.locator(".badge", { hasText: "Active" })).toBeVisible();
    await expect(card.getByRole("button", { name: "Rehearse now" })).toBeVisible();

    // A plan InventDB accepted with reservations says so, next to the controls.
    await expect(card.locator(".alert.warn")).toContainText(
      "No recipients matched the filter yet."
    );
  });

  test("a built workflow's runs open onto what they actually did", async ({ page }) => {
    await scriptTurn(page, AGENT_WORKFLOW_STEPS);
    await page.locator(".an-ask .an-composer-input").fill("Build the statements workflow.");
    await page.locator(".an-ask button[type=submit]").click();

    const card = page.locator(".an-wf-card");
    await card.getByRole("tab", { name: /^Runs/ }).click();
    await card.locator(".wf-run").first().click();

    // The resolved call and its outcome — the run, not the definition.
    const timeline = card.locator(".wf-rsteps");
    await expect(timeline).toContainText("render_report");
    await expect(timeline).toContainText("send_email");
    await expect(timeline).toContainText("1 email sent");
  });

  test("a follow-up continues the same thread", async ({ page }) => {
    await page.locator(".an-ask .an-composer-input").fill("Which cities do we own in?");
    await page.locator(".an-ask button[type=submit]").click();
    await expect(page.locator(".atl-answer")).toBeVisible();

    await page
      .locator(".an-thread-card .an-composer-input")
      .fill("Now break that down by property type.");
    await page.locator(".an-thread-card button[type=submit]").click();

    await expect(page.locator(".an-exchange")).toHaveCount(2);
    await expect(
      page.getByText("Now break that down by property type.")
    ).toBeVisible();
  });

  test("a thread survives leaving the room and coming back", async ({ page }) => {
    await page.locator(".an-ask .an-composer-input").fill("Which cities do we own in?");
    await page.locator(".an-ask button[type=submit]").click();
    await expect(page.locator(".atl-answer")).toBeVisible();

    await page.locator("nav.nav").getByRole("link", { name: "Reports" }).click();
    await expect(page).toHaveURL("http://localhost:5173/reports");
    await page.locator("nav.nav").getByRole("link", { name: "Analyze" }).click();

    // Navigating away must not cancel or discard an analysis.
    await expect(page.locator(".atl-answer")).toContainText("Richmond");
  });

  test("web search is off until it is consented to", async ({ page }) => {
    const web = page.getByRole("button", { name: /^Web/ });
    await expect(web).toHaveAttribute("aria-pressed", "false");

    await web.click();
    // The question — not the data — leaves the instance, so it is asked for.
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Your question is sent to the search provider");
    await dialog.getByRole("button", { name: "Enable web search" }).click();

    await expect(web).toHaveAttribute("aria-pressed", "true");
  });

  test("a failed turn says so instead of going quiet", async ({ page }) => {
    await page.route(/\/api\/analyze\/chat\/stream/, (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "Anthropic credits are exhausted." }),
      })
    );

    await page.locator(".an-ask .an-composer-input").fill("Which cities do we own in?");
    await page.locator(".an-ask button[type=submit]").click();

    await expect(page.locator(".alert.error")).toContainText(
      "temporarily unavailable"
    );
  });

  test("a thread can be deleted", async ({ page }) => {
    await page.locator(".an-thread-row").first().hover();
    await page.locator(".an-thread-del").first().click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();

    await expect(page.locator(".an-thread-row")).toHaveCount(0);
  });

  test("a follow-up runs the agent exactly once", async ({ page }) => {
    // A turn is not a read — the agent writes as it goes. Running one twice
    // means two workflows, two report templates, two of whatever it was asked
    // to make. This is the regression guard for a follow-up that started its
    // stream from inside a `setThreads` updater: React may invoke an updater
    // more than once, so one question became three agent turns and three
    // identical workflows.
    let turns = 0;
    await page.route(/\/api\/analyze\/chat\/stream/, async (route) => {
      turns += 1;
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: sseBody(AGENT_STEPS),
      });
    });

    await page.locator(".an-ask .an-composer-input").fill("Which cities do we own in?");
    await page.locator(".an-ask button[type=submit]").click();
    await expect(page.locator(".atl-answer")).toBeVisible();
    expect(turns).toBe(1);

    // The follow-up chip the answer offered — the path that was duplicating.
    await page
      .getByRole("button", { name: "Which city has the highest average rent?" })
      .click();

    await expect(page.locator(".atl-answer")).toHaveCount(2);
    // A duplicate turn arrives a beat behind the first, so settling matters:
    // asserting the moment the answer lands would pass even while a second
    // stream was still on the wire.
    await page.waitForTimeout(600);
    expect(turns).toBe(2);
  });
});
