import { MODULES, expect, rows, test } from "./fixtures";

/**
 * The ten modules are one generic component driven by `config/entities.ts`, so
 * these run the same contract across all of them. A module that renders at all
 * is a module whose config, route and API wiring all line up.
 */
test.describe("Entity modules", () => {
  for (const { name, label, plural } of MODULES) {
    test(`${plural} lists its records`, async ({ page, store }) => {
      await page.goto(`/${name}`);

      await expect(page.getByRole("heading", { name: plural, level: 1 })).toBeVisible();
      await expect(page.getByRole("heading", { name: plural, level: 2 })).toBeVisible();

      await expect(page.locator(".count-pill")).toHaveText(`${store[name].length} records`);
      await expect(rows(page)).toHaveCount(store[name].length);

      await expect(page.getByRole("button", { name: `New ${label}` })).toBeVisible();
      await expect(
        page.getByPlaceholder(`Search ${plural.toLowerCase()}…`)
      ).toBeVisible();
    });
  }
});

test.describe("List table", () => {
  test("shows the business key column for keyed modules", async ({ page }) => {
    await page.goto("/properties");
    const headers = page.locator("table.data thead th");
    await expect(headers.first()).toHaveText("property_id");
    await expect(headers.last()).toHaveText("Actions");
    await expect(page.getByRole("cell", { name: "P-001", exact: true })).toBeVisible();
  });

  test("hides the key column for daily tasks, which have no real id", async ({ page }) => {
    await page.goto("/daily_tasks");
    const headers = page.locator("table.data thead th");

    await expect(headers.first()).toHaveText("Date");
    // The raw key header would read `task` verbatim; the anchored regex keeps
    // it distinct from the "Task" column label, which is a real field.
    await expect(headers.filter({ hasText: /^task$/ })).toHaveCount(0);
    // Seven table fields plus Actions, and no leading key column.
    await expect(headers).toHaveCount(8);
  });

  test("renders status values as toned badges", async ({ page }) => {
    await page.goto("/properties");
    const occupied = page.locator("table.data .badge", { hasText: "Occupied" });
    await expect(occupied).toHaveClass(/success/);
    await expect(page.locator("table.data .badge", { hasText: "Vacant" })).toHaveClass(/warn|info|neutral|danger/);
  });

  test("resolves reference columns to a human title", async ({ page }) => {
    // tenants.property_id is a ref with `table: true`, so the cell should show
    // the property's title, not the raw P-001 key.
    await page.goto("/tenants");
    const meera = page.locator("table.data tbody tr", { hasText: "Meera" });
    await expect(meera).toContainText("12 Marine Drive Mumbai");
  });

  test("formats currency and date cells", async ({ page }) => {
    await page.goto("/leases");
    const active = page.locator("table.data tbody tr", { hasText: "Meera Iyer" });
    await expect(active).toContainText("$2,400");
    await expect(active).toContainText("Jun 1, 2023");
  });

  test("renders an em dash for missing values", async ({ page }) => {
    await page.goto("/work_orders");
    // WO-1001 has no actual_cost.
    const wo = page.locator("table.data tbody tr", { hasText: "Kitchen tap dripping" });
    await expect(wo).toContainText("—");
  });

  test("shows the empty state when a module has no records", async ({ page }) => {
    await page.route("**/api/vendors*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: [], total: 0, limit: 500, offset: 0 }),
      })
    );
    await page.goto("/vendors");

    await expect(page.getByRole("heading", { name: "No vendors yet" })).toBeVisible();
    await expect(page.getByText("Add your first vendor to get started.")).toBeVisible();
    // The empty state offers the same create action as the page head.
    await expect(page.getByRole("button", { name: "New Vendor" })).toHaveCount(2);
  });
});

test.describe("Search and sort", () => {
  test("filters the table with the debounced search box", async ({ page }) => {
    await page.goto("/properties");
    await expect(rows(page)).toHaveCount(3);

    await page.getByPlaceholder("Search properties…").fill("Kolkata");

    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText("9 Park Street");
    await expect(page.locator(".count-pill")).toHaveText("1 records");
  });

  test("sends the search term to the server rather than filtering locally", async ({ page }) => {
    await page.goto("/properties");

    const [request] = await Promise.all([
      page.waitForRequest(
        (r) => r.url().includes("/api/properties") && r.url().includes("q=Kolkata")
      ),
      page.getByPlaceholder("Search properties…").fill("Kolkata"),
    ]);
    expect(new URL(request.url()).searchParams.get("q")).toBe("Kolkata");
  });

  test("shows a distinct empty state when the search matches nothing", async ({ page }) => {
    await page.goto("/properties");
    await page.getByPlaceholder("Search properties…").fill("zzzznotfound");

    await expect(page.getByRole("heading", { name: "No matching records" })).toBeVisible();
    await expect(page.getByText("Try a different search term.")).toBeVisible();
    // No create shortcut here — the module isn't empty, the filter is.
    await expect(page.getByRole("button", { name: "New Property" })).toHaveCount(1);
  });

  test("toggles sort direction when a column header is clicked", async ({ page }) => {
    await page.goto("/properties");
    // Properties default to street ascending.
    await expect(rows(page).first()).toContainText("12 Marine Drive");

    await page.getByRole("columnheader", { name: "Street" }).click();
    await expect(rows(page).first()).toContainText("9 Park Street");

    await page.getByRole("columnheader", { name: "Street" }).click();
    await expect(rows(page).first()).toContainText("12 Marine Drive");
  });

  test("sorts by a different column and sends order_by", async ({ page }) => {
    await page.goto("/properties");

    const [request] = await Promise.all([
      page.waitForRequest((r) => r.url().includes("order_by=city")),
      page.getByRole("columnheader", { name: "City" }).click(),
    ]);

    const params = new URL(request.url()).searchParams;
    expect(params.get("order_by")).toBe("city");
    expect(params.get("order_dir")).toBe("asc");
    await expect(rows(page).first()).toContainText("Bengaluru");
  });
});
