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

  /** A history long enough to need more than one page in the rail. */
  async function withThreads(page: import("@playwright/test").Page, count: number) {
    await page.route("**/api/analyze/threads", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          threads: Array.from({ length: count }, (_, i) => ({
            id: `t-${i}`,
            label: `Thread ${i}`,
            created: "2026-08-01T00:00:00Z",
            exchanges: [
              {
                question: `A tenant at 3027 Crepe Myrtle Ln asked something long, ${i}`,
                steps: [{ type: "done", content: "Answer." }],
                ts: "2026-08-01T00:00:00Z",
              },
            ],
          })),
        }),
      })
    );
    await page.reload();
    await page.locator(".an-thread-row").first().waitFor();
  }

  test("New question stays reachable however long the history is", async ({ page }) => {
    // It sits above the list rather than after it, so reaching it never means
    // travelling past the whole history first.
    await withThreads(page, 20);

    const rail = await page.locator(".an-threads").boundingBox();
    const button = await page.locator(".an-new-thread").boundingBox();
    const list = await page.locator(".an-thread-list").boundingBox();
    expect(rail).not.toBeNull();
    expect(button).not.toBeNull();

    expect(button!.y).toBeLessThan(list!.y);
    // And still inside the card, not hanging off its bottom edge.
    expect(button!.y + button!.height).toBeLessThanOrEqual(rail!.y + rail!.height);

    // Left edges line up with the rest of the rail.
    const search = await page.locator(".input-icon").boundingBox();
    expect(Math.round(button!.x)).toBe(Math.round(search!.x));
    expect(Math.round(button!.width)).toBe(Math.round(search!.width));
  });

  test("the rail pages a long history rather than scrolling on", async ({ page }) => {
    await withThreads(page, 20);

    await expect(page.locator(".an-thread-row")).toHaveCount(8);
    await expect(page.locator(".an-thread-pager")).toContainText("1 / 3");

    await page.getByLabel("Next page of threads").click();
    await expect(page.locator(".an-thread-row")).toHaveCount(8);
    await expect(page.locator(".an-thread-pager")).toContainText("2 / 3");

    await page.getByLabel("Next page of threads").click();
    await expect(page.locator(".an-thread-row")).toHaveCount(4);
    await expect(page.getByLabel("Next page of threads")).toBeDisabled();

    await page.getByLabel("Previous page of threads").click();
    await expect(page.locator(".an-thread-pager")).toContainText("2 / 3");
  });

  test("a short history needs no pager at all", async ({ page }) => {
    await withThreads(page, 3);

    await expect(page.locator(".an-thread-row")).toHaveCount(3);
    await expect(page.locator(".an-thread-pager")).toHaveCount(0);
  });

  test("searching returns to the first page of its own results", async ({ page }) => {
    await withThreads(page, 20);
    await page.getByLabel("Next page of threads").click();
    await expect(page.locator(".an-thread-pager")).toContainText("2 / 3");

    // A search is a new result set; showing page 2 of it would be showing the
    // middle of something the reader has not seen the start of.
    await page.getByPlaceholder("Search threads…").fill("something long, 1");

    await expect(page.locator(".an-thread-pager")).toContainText("1 / ");
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

  test.describe("naming a thread", () => {
    const row = (page: import("@playwright/test").Page) =>
      page.locator(".an-thread-row").first();

    test("renames it in the rail", async ({ page }) => {
      await row(page).getByRole("button", { name: "Rename this analysis" }).click();
      const field = page.getByLabel("Thread name");
      await field.fill("Q2 rent review");
      await field.press("Enter");

      await expect(row(page).getByText("Q2 rent review")).toBeVisible();
    });

    test("keeps the name after a reload — it is stored, not held in the tab", async ({ page }) => {
      await row(page).getByRole("button", { name: "Rename this analysis" }).click();
      const field = page.getByLabel("Thread name");
      await field.fill("Q2 rent review");
      await field.press("Enter");
      await expect(row(page).getByText("Q2 rent review")).toBeVisible();

      await page.reload();
      await expect(page.getByText("Q2 rent review")).toBeVisible();
    });

    test("Escape abandons the edit and keeps the old name", async ({ page }) => {
      const before = (await row(page).locator(".an-thread-title").textContent()) ?? "";
      await row(page).getByRole("button", { name: "Rename this analysis" }).click();
      const field = page.getByLabel("Thread name");
      await field.fill("Something else entirely");
      await field.press("Escape");

      await expect(row(page).locator(".an-thread-title")).toHaveText(before);
    });

    test("an empty name is refused rather than blanking the row", async ({ page }) => {
      const before = (await row(page).locator(".an-thread-title").textContent()) ?? "";
      await row(page).getByRole("button", { name: "Rename this analysis" }).click();
      const field = page.getByLabel("Thread name");
      await field.fill("   ");
      await field.press("Enter");

      await expect(row(page).locator(".an-thread-title")).toHaveText(before);
    });

    test("a renamed thread is findable by its new name", async ({ page }) => {
      await row(page).getByRole("button", { name: "Rename this analysis" }).click();
      const field = page.getByLabel("Thread name");
      await field.fill("Zebra audit");
      await field.press("Enter");
      await expect(row(page).getByText("Zebra audit")).toBeVisible();

      await page.getByPlaceholder(/Search/i).first().fill("zebra");
      await expect(page.locator(".an-thread-row")).toHaveCount(1);
      await expect(page.getByText("Zebra audit")).toBeVisible();
    });

    test("double-clicking the name starts a rename", async ({ page }) => {
      // The habit people bring from every other list of named things.
      await row(page).locator(".an-thread-open").dblclick();
      await expect(page.getByLabel("Thread name")).toBeVisible();
    });

    test("the row keeps its size while being renamed", async ({ page }) => {
      // A title may run to two lines and the field is one, so the name sits in a
      // fixed slot — otherwise the row shrinks under the pointer the moment you
      // start typing, and every row below it jumps.
      const idle = (await row(page).boundingBox())!.height;
      await row(page).getByRole("button", { name: "Rename this analysis" }).click();
      const editing = (await row(page).boundingBox())!.height;
      expect(Math.abs(idle - editing)).toBeLessThanOrEqual(4);
    });

    test("renaming does not open or switch the thread", async ({ page }) => {
      // The pencil sits inside the row, which is itself the way in — pressing it
      // must not count as pressing the row.
      const active = page.locator(".an-thread-row.active");
      const activeTitle = (await active.locator(".an-thread-title").textContent()) ?? "";
      await page.locator(".an-thread-row").last()
        .getByRole("button", { name: "Rename this analysis" }).click();
      await page.getByLabel("Thread name").press("Escape");
      await expect(active.locator(".an-thread-title")).toHaveText(activeTitle);
    });
  });
});
