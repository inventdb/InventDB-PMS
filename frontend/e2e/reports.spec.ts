import { expect, reportParam, test } from "./fixtures";

const galleryItem = (page: import("@playwright/test").Page, name: string) =>
  page.locator(".rs-row").filter({ hasText: name });

test.describe("Reports gallery", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/reports");
  });

  test("lists live templates and stored snapshots in one library", async ({ page }) => {
    // Three saved templates plus one frozen snapshot — the split is real at
    // the engine level, so the library states which is which rather than
    // leaving "why are these numbers stale?" to be discovered.
    await expect(page.locator(".count-pill")).toHaveText("4 reports");
    await expect(page.locator(".rs-row")).toHaveCount(4);
    await expect(galleryItem(page, "Owner Statement")).toContainText("Live");
    await expect(galleryItem(page, "Rent Roll — All Properties")).toContainText(
      "Snapshot"
    );
  });

  test("opens the first report automatically", async ({ page }) => {
    await expect(galleryItem(page, "Owner Statement")).toHaveClass(/active/);
    await expect(page.locator(".rs-title h3")).toHaveText("Owner Statement");
  });

  test("filters the library across both kinds", async ({ page }) => {
    // One search box over the whole library, so you don't hunt across two
    // screens — "rent" finds the live template and the stored snapshot.
    await page.getByPlaceholder("Search reports…").fill("rent");
    await expect(page.locator(".rs-row")).toHaveCount(2);
    await expect(galleryItem(page, "Rent Roll").first()).toBeVisible();
    await expect(galleryItem(page, "Rent Roll — All Properties")).toBeVisible();

    await page.getByPlaceholder("Search reports…").fill("owner");
    await expect(page.locator(".rs-row")).toHaveCount(1);
  });

  test("says so when nothing matches", async ({ page }) => {
    await page.getByPlaceholder("Search reports…").fill("zzzz");
    await expect(page.locator(".report-note").first()).toContainText("No report matches");
    await expect(page.locator(".rs-row")).toHaveCount(0);
  });

  test("switches the stage when another report is picked", async ({ page }) => {
    await galleryItem(page, "Rent Roll").first().locator(".rs-row-open").click();
    await expect(galleryItem(page, "Rent Roll").first()).toHaveClass(/active/);
    await expect(page.locator(".rs-title h3")).toHaveText("Rent Roll");
    // Scope to the stage: the same description also renders in the gallery
    // card, so an unscoped text match is ambiguous.
    await expect(
      page.locator(".rs-stage").getByText("Every active lease with contract and market rent.")
    ).toBeVisible();
  });

  test("shows an empty state when the instance has no saved reports", async ({ page }) => {
    // Both kinds have to be empty: a snapshot is a report too, so templates
    // alone going away is not an empty library.
    await page.route("**/api/reports/templates", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ templates: [], count: 0 }),
      })
    );
    await page.route("**/api/reports/snapshots", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ snapshots: [], count: 0 }),
      })
    );
    await page.reload();

    await expect(page.getByRole("heading", { name: "No reports yet" })).toBeVisible();
    await expect(page.locator(".count-pill")).toHaveCount(0);
  });

  test("surfaces a gallery load failure", async ({ page }) => {
    await page.route("**/api/reports/templates", (route) =>
      route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ error: "SOAR report service is down" }),
      })
    );
    await page.reload();

    await expect(page.locator(".alert.error")).toHaveText("SOAR report service is down");
  });
});

test.describe("Rendering a report", () => {
  test("renders a parameterless report straight into the frame", async ({ page }) => {
    await page.goto("/reports");
    await galleryItem(page, "Rent Roll").first().locator(".rs-row-open").click();

    // Rent Roll declares no inputs, so there is no parameter card at all.
    await expect(page.locator(".report-params")).toHaveCount(0);

    const frame = page.frameLocator("iframe.report-frame");
    await expect(frame.getByRole("heading", { name: "Rent Roll" })).toBeVisible();
    await expect(frame.getByRole("cell", { name: "P-001" })).toBeVisible();
    await expect(page.locator(".report-rendered-note")).toContainText("128 ms");
  });

  test("seeds pickers from their defaults and renders on open", async ({ page }) => {
    await page.goto("/reports");

    // Owner Statement's picker has no default, so ReportSheet seeds the first
    // option and the report renders without any interaction.
    await expect(reportParam(page, "owner_id")).toHaveValue("O-001");
    await expect(reportParam(page, "as_of")).toHaveValue("2025-11-30");
    await expect(
      page.frameLocator("iframe.report-frame").getByRole("heading", { name: "Owner Statement" })
    ).toBeVisible();
  });

  test("waits for input when a required parameter cannot be seeded", async ({ page }) => {
    await page.goto("/reports");
    await galleryItem(page, "Region Audit").first().locator(".rs-row-open").click();

    await expect(page.getByRole("heading", { name: "Set the inputs above" })).toBeVisible();
    await expect(page.locator("iframe.report-frame")).toHaveCount(0);
  });

  test("names the missing input when Render is pressed too early", async ({ page }) => {
    await page.goto("/reports");
    await galleryItem(page, "Region Audit").first().locator(".rs-row-open").click();
    await page.getByRole("button", { name: "Render report" }).click();

    await expect(page.getByText("Fill required inputs: Region")).toBeVisible();
    await expect(page.locator("iframe.report-frame")).toHaveCount(0);
  });

  test("renders once the required input is supplied", async ({ page }) => {
    await page.goto("/reports");
    await galleryItem(page, "Region Audit").first().locator(".rs-row-open").click();
    await reportParam(page, "region").fill("South");

    const [request] = await Promise.all([
      page.waitForRequest(
        (r) => r.method() === "POST" && r.url().includes("/rpt-region-audit/render")
      ),
      page.getByRole("button", { name: "Render report" }).click(),
    ]);
    expect(request.postDataJSON()).toEqual({ params: { region: "South" } });

    await expect(
      page.frameLocator("iframe.report-frame").getByRole("heading", { name: "Region Audit" })
    ).toBeVisible();
  });

  test("Refresh re-queries the same parameter set", async ({ page }) => {
    await page.goto("/reports");
    await expect(page.locator("iframe.report-frame")).toBeVisible();

    const [request] = await Promise.all([
      page.waitForRequest(
        (r) => r.method() === "POST" && r.url().includes("/rpt-owner-statement/render")
      ),
      page.getByRole("button", { name: "Refresh" }).click(),
    ]);
    expect(request.postDataJSON()).toMatchObject({ params: { owner_id: "O-001" } });
  });

  test("keeps the previous sheet on screen while refreshing", async ({ page }) => {
    await page.goto("/reports");
    const frame = page.frameLocator("iframe.report-frame");
    await expect(frame.getByRole("heading", { name: "Owner Statement" })).toBeVisible();

    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/render", async (route) => {
      await gate;
      await route.fallback();
    });

    await page.getByRole("button", { name: "Refresh" }).click();

    // isFetching, not isPending — the sheet must not blank out under a reader.
    await expect(page.locator(".report-paper.is-refreshing")).toBeVisible();
    await expect(frame.getByRole("heading", { name: "Owner Statement" })).toBeVisible();
    await expect(page.locator(".report-rendered-note")).toContainText(
      "Re-querying against live data"
    );

    release();
    await expect(page.locator(".report-paper.is-refreshing")).toHaveCount(0);
  });

  test("shows elapsed-time progress on the first render", async ({ page }) => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/render", async (route) => {
      await gate;
      await route.fallback();
    });

    await page.goto("/reports");
    await expect(page.getByText(/Rendering “Owner Statement”/)).toBeVisible();
    await expect(page.getByRole("status", { name: "Rendering" })).toBeVisible();

    release();
    await expect(
      page.frameLocator("iframe.report-frame").getByRole("heading", { name: "Owner Statement" })
    ).toBeVisible();
  });

  test("Print stays disabled until a sheet exists", async ({ page }) => {
    await page.goto("/reports");
    await galleryItem(page, "Region Audit").first().locator(".rs-row-open").click();
    await expect(page.getByRole("button", { name: "Print / PDF" })).toBeDisabled();

    await reportParam(page, "region").fill("South");
    await page.getByRole("button", { name: "Render report" }).click();
    await expect(page.getByRole("button", { name: "Print / PDF" })).toBeEnabled();
  });

  test("sandboxes the report frame without allow-scripts", async ({ page }) => {
    await page.goto("/reports");
    const iframe = page.locator("iframe.report-frame");
    await expect(iframe).toBeVisible();

    // Report HTML is authored elsewhere; letting it run scripts would give it
    // the app's session. The frame must never gain allow-scripts.
    const sandbox = await iframe.getAttribute("sandbox");
    expect(sandbox).toBe("allow-same-origin allow-modals");
  });

  test("surfaces a render failure without killing the page", async ({ page }) => {
    await page.route("**/render", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "SQL error in template" }),
      })
    );
    await page.goto("/reports");

    await expect(page.locator(".alert.error")).toHaveText("SQL error in template");
    await expect(page.locator(".rs-row")).toHaveCount(4);
  });
});
