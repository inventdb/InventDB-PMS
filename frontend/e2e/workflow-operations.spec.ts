import { WORKFLOWS, WORKFLOW_LONG, expect, test } from "./fixtures";

/**
 * Operating workflows — the rest of what SOAR's Operate room can do.
 *
 * Finding one in a long list, clearing several out at once, renaming without
 * opening the editor, stopping a run that is going nowhere, reading and
 * managing the version history, and asking the assistant to repair a plan that
 * failed.
 *
 * The recurring promise across all of it: a destructive or expensive step says
 * what it will do and asks first, and a partial failure is reported as partial
 * rather than smoothed into success.
 */

const card = (page: import("@playwright/test").Page, name: string) =>
  page.locator(".wf-card").filter({ hasText: name });

const dialog = (page: import("@playwright/test").Page) => page.locator(".modal");

test.describe("The workflow list", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/workflows");
  });

  test("finds a workflow by name or by what it does", async ({ page }) => {
    await page.locator(".wf-filter input").fill("statements");
    await expect(page.locator(".wf-card")).toHaveCount(1);
    await expect(page.locator(".wf-card")).toContainText("Monthly owner statements");

    // The intent is searchable too — nobody remembers what a workflow is called.
    await page.locator(".wf-filter input").fill("on-call manager");
    await expect(page.locator(".wf-card")).toHaveCount(1);
    await expect(page.locator(".wf-card")).toContainText("Emergency work order alert");
  });

  test("narrows to what is actually live", async ({ page }) => {
    await page.locator(".wf-chip", { hasText: "Active" }).click();
    await expect(page.locator(".wf-card")).toHaveCount(1);
    await expect(page.locator(".wf-card")).toContainText("Monthly owner statements");

    await page.locator(".wf-chip", { hasText: "Rehearsing" }).click();
    await expect(page.locator(".wf-card")).toHaveCount(1);
    await expect(page.locator(".wf-card")).toContainText("Emergency work order alert");
  });

  test("a search that matches nothing offers a way back", async ({ page }) => {
    await page.locator(".wf-filter input").fill("nothing like this exists");
    await expect(page.getByRole("heading", { name: "Nothing matches that" })).toBeVisible();

    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(page.locator(".wf-card")).toHaveCount(2);
  });

  test("deletes several at once, and asks first", async ({ page }) => {
    await page.getByLabel("Select Monthly owner statements").check();
    await page.getByLabel("Select Emergency work order alert").check();

    await page.getByRole("button", { name: "Delete 2 selected" }).click();
    const confirm = page.getByRole("dialog");
    await expect(confirm).toContainText("They stop running immediately");
    await confirm.getByRole("button", { name: "Delete 2" }).click();

    await expect(page.locator(".toast")).toContainText("Deleted 2 workflows");
    await expect(page.locator(".wf-card")).toHaveCount(0);
  });

  test("a partial bulk delete says how partial, and keeps the failures selected", async ({
    page,
  }) => {
    await page.route("**/api/workflows/wf-2", (route) =>
      route.request().method() === "DELETE"
        ? route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({ ok: false, error: "upstream exploded" }),
          })
        : route.fallback()
    );

    await page.getByLabel("Select Monthly owner statements").check();
    await page.getByLabel("Select Emergency work order alert").check();
    await page.getByRole("button", { name: "Delete 2 selected" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete 2" }).click();

    // Honest about what actually happened, rather than reporting success.
    await expect(page.locator(".toast")).toContainText("Deleted 1 of 2");
    await expect(page.locator(".wf-card")).toHaveCount(1);
    // Retrying must not re-attempt the one that already went.
    await expect(page.getByRole("button", { name: "Delete 1 selected" })).toBeVisible();
  });

  test("carries the ask across to Analyze", async ({ page }) => {
    // Asserted on the link, because Analyze consumes `?q=` on arrival and
    // clears it — by the time the page settles the URL is bare again.
    const href = await page.getByRole("link", { name: "New workflow" }).getAttribute("href");
    expect(href).toContain("/analyze?q=");
    // Dropping someone into an empty chat makes them invent the wording, and
    // the wording decides whether they get something rehearsable.
    expect(decodeURIComponent(href ?? "")).toContain("rehearse");

    await page.getByRole("link", { name: "New workflow" }).click();
    await expect(page).toHaveURL(/\/analyze/);
  });
});

test.describe("One workflow, opened", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/workflows");
    await card(page, "Monthly owner statements").getByRole("button", { name: "Open" }).click();
  });

  test("renames in place, without opening the editor", async ({ page }) => {
    const sent: unknown[] = [];
    await page.route("**/api/workflows/wf-1", async (route) => {
      if (route.request().method() === "PUT") sent.push(route.request().postDataJSON());
      await route.fallback();
    });

    await dialog(page).getByRole("button", { name: "Rename workflow" }).click();
    await dialog(page).getByLabel("Rename workflow").fill("Owner statements, monthly");
    await dialog(page).getByRole("button", { name: "Save name" }).click();

    await expect(page.locator(".toast")).toContainText("Renamed");
    // Only the name goes up. Sending the plan too would mint a version, making
    // the history a record of typos rather than of definition changes.
    expect(sent).toEqual([{ name: "Owner statements, monthly" }]);
  });

  test("a failed rename keeps what was typed", async ({ page }) => {
    await page.route("**/api/workflows/wf-1", (route) =>
      route.request().method() === "PUT"
        ? route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({ ok: false, error: "nope" }),
          })
        : route.fallback()
    );

    await dialog(page).getByRole("button", { name: "Rename workflow" }).click();
    await dialog(page).getByLabel("Rename workflow").fill("A better name");
    await dialog(page).getByRole("button", { name: "Save name" }).click();

    // Losing someone's typing to a network hiccup is the outcome worth
    // designing out — the draft stays put so it can just be retried.
    await expect(dialog(page).getByLabel("Rename workflow")).toHaveValue("A better name");
    await expect(dialog(page).locator(".wf-rename-error")).toBeVisible();
  });

  test("cancels a run that is going nowhere", async ({ page }) => {
    // Both seeded runs for wf-1 have finished, so fire one to get a live one.
    await dialog(page).getByRole("button", { name: "Rehearse now" }).click();
    await expect(page.locator(".toast")).toBeVisible();

    const running = dialog(page).locator(".wf-run-item").filter({ hasText: "running" });
    await running.getByRole("button", { name: "Cancel" }).click();

    // `.last()` — the rehearse toast is still on screen behind this one.
    await expect(page.locator(".toast").last()).toContainText("Run cancelled");
    await expect(dialog(page).locator(".wf-run-item").first()).toContainText("cancelled");
  });

  test("a finished run offers no cancel", async ({ page }) => {
    await dialog(page).getByRole("tab", { name: /^Runs/ }).click();
    const finished = dialog(page).locator(".wf-run-item").filter({ hasText: "succeeded" });

    await expect(finished.getByRole("button", { name: "Cancel" })).toHaveCount(0);
  });

  test("reads an old version's plan without restoring it", async ({ page }) => {
    await dialog(page).getByRole("tab", { name: "History" }).click();
    await dialog(page).locator(".wf-version-open").first().click();

    // The whole plan, fetched only once it is opened.
    await expect(dialog(page).locator(".wf-version-plan .wf-step").first()).toBeVisible();
    // Reading is not restoring — the workflow is untouched.
    await expect(dialog(page).locator(".wf-state .badge").first()).toHaveText("Active");
  });

  test("rehearses an old version rather than running it for real", async ({ page }) => {
    const posted: unknown[] = [];
    await page.route("**/api/workflows/*/run", async (route) => {
      posted.push(route.request().postDataJSON());
      await route.fallback();
    });

    await dialog(page).getByRole("tab", { name: "History" }).click();
    await dialog(page).locator(".wf-version-actions").first().getByRole("button", { name: "Rehearse" }).click();

    await expect(page.locator(".toast")).toContainText("Rehearsing v1");
    // Firing a superseded plan for real, from a history list, is not something
    // to put one click away.
    expect(posted).toEqual([{ sandbox_override: true, version: 1 }]);
  });

  test("deletes one version, asking first", async ({ page }) => {
    await dialog(page).getByRole("tab", { name: "History" }).click();
    await dialog(page).getByRole("button", { name: "Delete version 1" }).click();

    const confirm = page.getByRole("dialog").last();
    await expect(confirm).toContainText("past runs keep their own record");
    await confirm.getByRole("button", { name: "Delete version" }).click();

    await expect(page.locator(".toast")).toContainText("Deleted v1");
    await expect(dialog(page).getByRole("heading", { name: "No earlier versions" })).toBeVisible();
  });

  test("clears the whole history in one go", async ({ page }) => {
    await dialog(page).getByRole("tab", { name: "History" }).click();
    await dialog(page).getByRole("button", { name: "Clear history" }).click();

    const confirm = page.getByRole("dialog").last();
    await expect(confirm).toContainText("nothing left to restore");
    await confirm.getByRole("button", { name: "Clear history" }).click();

    await expect(page.locator(".toast")).toContainText("Version history cleared");
  });
});

test.describe("A run's timeline", () => {
  test("reads in the order things actually happened", async ({ page }) => {
    // The engine orders run steps `BY idx ASC` and nothing else, while writing
    // several rows at one idx — the call, any recovery it needed, then the
    // result. Rendered as received, a step's result can appear above the call
    // it belongs to and the run reads as though it did things out of order.
    await page.goto("/workflows");
    await page.locator(".nb-card").getByRole("button", { name: "Show what the run has done" }).click();

    const times = await page.locator(".wf-rsteps .wf-rstep-time").allTextContents();
    expect(times.length).toBeGreaterThan(1);
    expect([...times]).toEqual([...times].sort());
  });
});

test.describe("Cards with plans of different lengths", () => {
  test.beforeEach(async ({ page }) => {
    // A twelve-step automation beside the two short seeded ones. Composed from
    // the fixtures rather than by re-fetching: `route.fetch()` bypasses page
    // routes and would go to the dev server, where there is no API.
    await page.route("**/api/workflows", (route) =>
      route.request().method() === "GET"
        ? route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ workflows: [...WORKFLOWS, WORKFLOW_LONG] }),
          })
        : route.fallback()
    );
    await page.goto("/workflows");
  });

  test("a long plan is summarised rather than drawn in full", async ({ page }) => {
    const long = card(page, "Maintenance email intake & dispatch");

    // Five steps and a count, not twelve. Drawn in full, this one card set the
    // height of its whole grid row.
    await expect(long.locator(".wf-step")).toHaveCount(6); // 5 steps + the "more" row
    await expect(long.locator(".wf-more-link")).toHaveText("7 more steps");
    await expect(long).toContainText("Read the request");
    await expect(long).not.toContainText("Confirm with the tenant");
  });

  test("the rest of the plan is one click away", async ({ page }) => {
    await card(page, "Maintenance email intake & dispatch")
      .locator(".wf-more-link")
      .click();

    // Opened, the plan is uncapped — the detail view is where a plan IS the
    // content, so nothing is hidden there.
    await expect(dialog(page)).toContainText("Confirm with the tenant");
    await expect(dialog(page).locator(".wf-more-link")).toHaveCount(0);
  });

  test("a short card is not stretched to match a long one", async ({ page }) => {
    // Wait for the cards before measuring — an empty list measures as "all the
    // same height" and the assertion passes for the wrong reason.
    await expect(page.locator(".wf-card")).toHaveCount(3);
    const heights = await page
      .locator(".wf-card")
      .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height)));

    // Cards size to their own content. Equal heights would mean the short ones
    // are carrying dead space to line their action rows up with the tall one.
    expect(new Set(heights).size).toBeGreaterThan(1);
  });

  test("a plan short enough to fit is shown whole", async ({ page }) => {
    const short = card(page, "Emergency work order alert");
    await expect(short.locator(".wf-step")).toHaveCount(2);
    await expect(short.locator(".wf-more-link")).toHaveCount(0);
  });
});
