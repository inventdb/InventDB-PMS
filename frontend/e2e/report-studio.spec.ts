import { expect, test } from "./fixtures";

/**
 * Report Studio — the authoring half.
 *
 * `reports.spec.ts` covers listing and rendering. What matters here is that a
 * report can be *changed*: renamed in place, rewritten by describing the
 * change, deleted, and — for a frozen snapshot — promoted into a live template.
 *
 * The edit stream is fulfilled as a real `text/event-stream`, so the page's own
 * SSE parser runs rather than being stubbed past. That parser deciding when an
 * edit has landed is the whole mechanism.
 */

const row = (page: import("@playwright/test").Page, name: string) =>
  page.locator(".rs-row").filter({ hasText: name });

test.describe("Report Studio", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/reports");
    await expect(page.locator(".rs-row").first()).toBeVisible();
  });

  test("says which reports are live and which are frozen", async ({ page }) => {
    // The difference decides whether the numbers on screen are current, so it
    // is stated on every row rather than left to be discovered.
    await expect(row(page, "Owner Statement").locator(".rs-tag")).toHaveText("Live");
    await expect(
      row(page, "Rent Roll — All Properties").locator(".rs-tag")
    ).toHaveText("Snapshot");
  });

  test("renames a report in place", async ({ page }) => {
    const renamed = page.waitForRequest(
      (r) => r.url().includes("/api/reports/templates/rpt-owner-statement") && r.method() === "PUT"
    );

    await page.locator(".rs-title").click();
    await page.locator(".rs-title-edit input").fill("Owner Statement 2026");
    await page.locator(".rs-title-edit input").press("Enter");

    const request = await renamed;
    expect(request.postDataJSON()).toEqual({ name: "Owner Statement 2026" });
    await expect(page.locator(".rs-title h3")).toHaveText("Owner Statement 2026");
  });

  test("refuses a name another report already has", async ({ page }) => {
    await page.locator(".rs-title").click();
    await page.locator(".rs-title-edit input").fill("Rent Roll");
    await page.locator(".rs-title-edit input").press("Enter");

    // Caught before the request goes out, while the input is still open.
    await expect(page.locator(".rs-title-error")).toContainText("already exists");
    await expect(page.locator(".rs-title-edit input")).toBeVisible();
  });

  test("edits a report by describing the change", async ({ page }) => {
    await expect(row(page, "Owner Statement")).toContainText("v3");

    const edited = page.waitForRequest(
      (r) =>
        r.url().includes("/api/reports/templates/rpt-owner-statement/edit/stream") &&
        r.method() === "POST"
    );

    await page.locator(".rs-tab", { hasText: "Edit" }).click();
    await page
      .locator(".rs-edit .an-composer-input")
      .fill("Add a payment-terms column");
    await page.locator(".rs-edit button[type=submit]").click();

    expect((await edited).postDataJSON().instruction).toBe(
      "Add a payment-terms column"
    );

    // The engine versions the edit; the studio reports which version landed.
    await expect(page.locator(".rs-edit .alert")).toContainText(
      "saved as version 4"
    );
    await expect(row(page, "Owner Statement")).toContainText("v4");
  });

  test("a follow-up edit carries the previous instruction", async ({ page }) => {
    await page.locator(".rs-tab", { hasText: "Edit" }).click();
    await page.locator(".rs-edit .an-composer-input").fill("Add a total row");
    await page.locator(".rs-edit button[type=submit]").click();
    await expect(page.locator(".rs-edit .alert")).toBeVisible();

    const second = page.waitForRequest(
      (r) => r.url().includes("/edit/stream") && r.method() === "POST"
    );
    await page.locator(".rs-edit .an-composer-input").fill("Now sort by amount");
    await page.locator(".rs-edit button[type=submit]").click();

    // Without the prior turn, "now sort by amount" has nothing to build on.
    expect((await second).postDataJSON().messages).toEqual([
      { role: "user", content: "Add a total row" },
    ]);
    await expect(page.locator(".rs-history li")).toHaveCount(2);
  });

  test("surfaces an edit that failed", async ({ page }) => {
    await page.route("**/edit/stream", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "The report agent is unavailable" }),
      })
    );

    await page.locator(".rs-tab", { hasText: "Edit" }).click();
    await page.locator(".rs-edit .an-composer-input").fill("Sort by amount");
    await page.locator(".rs-edit button[type=submit]").click();

    await expect(page.locator(".rs-edit .alert.error")).toContainText(
      "The report agent is unavailable"
    );
  });

  test("a snapshot offers conversion instead of editing", async ({ page }) => {
    await row(page, "Rent Roll — All Properties").locator(".rs-row-open").click();
    await page.locator(".rs-tab", { hasText: "Edit" }).click();

    // Its figures are frozen, so there is nothing to edit until it is live.
    await expect(page.locator(".rs-panel")).toContainText("saved snapshot");
    await expect(page.locator(".rs-edit")).toHaveCount(0);

    const promoted = page.waitForRequest((r) => r.url().includes("/promote"));
    await page.getByRole("button", { name: /Convert to live template/ }).click();
    await promoted;
  });

  test("deletes a report after confirming", async ({ page }) => {
    // Match the name element exactly: "Rent Roll" is also a prefix of the
    // "Rent Roll — All Properties" snapshot, so `hasText` alone hits both rows.
    const target = page
      .locator(".rs-row")
      .filter({ has: page.getByText("Rent Roll", { exact: true }) });
    await target.hover();
    await target.locator(".rs-row-del").click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("for everyone");
    const deleted = page.waitForRequest(
      (r) => r.url().includes("/api/reports/templates/") && r.method() === "DELETE"
    );
    await dialog.getByRole("button", { name: "Delete" }).click();
    await deleted;

    await expect(target).toHaveCount(0);
  });

  test("history shows the version and where the report came from", async ({ page }) => {
    await page.locator(".rs-tab", { hasText: "History" }).click();
    await expect(page.locator(".rs-panel")).toContainText("Current version");
    await expect(page.locator(".rs-panel")).toContainText("v3");

    await row(page, "Rent Roll — All Properties").locator(".rs-row-open").click();
    await page.locator(".rs-tab", { hasText: "History" }).click();
    await expect(page.locator(".rs-panel")).toContainText("Generated in Analyze");
  });

  test("shares a link that reopens the same report", async ({ page }) => {
    await page.locator(".rs-tab", { hasText: "Share" }).click();
    await expect(page.locator(".rs-share-url")).toContainText("/reports?open=t%3Arpt-owner-statement");
  });
});
