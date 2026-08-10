import { dialog, expect, field, row, rows, test } from "./fixtures";

test.describe("Create", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/properties");
    await expect(rows(page)).toHaveCount(3);
  });

  test("creates a record and shows it in the table", async ({ page }) => {
    await page.getByRole("button", { name: "New Property" }).click();
    await expect(dialog(page).getByRole("heading", { name: "New Property" })).toBeVisible();

    await field(page, "street").fill("77 Residency Road");
    await field(page, "city").fill("Bengaluru");
    await field(page, "type").selectOption("Condo");
    await field(page, "status").selectOption("Vacant");
    await field(page, "beds").fill("2");
    await field(page, "market_rent").fill("1950");

    const [request] = await Promise.all([
      page.waitForRequest((r) => r.url().endsWith("/api/properties") && r.method() === "POST"),
      dialog(page).getByRole("button", { name: "Save" }).click(),
    ]);

    // Numeric and currency fields are coerced out of their string form before
    // sending; untouched fields are omitted rather than sent as "".
    expect(request.postDataJSON()).toEqual({
      street: "77 Residency Road",
      city: "Bengaluru",
      type: "Condo",
      status: "Vacant",
      beds: 2,
      market_rent: 1950,
    });

    await expect(page.locator(".toast.success")).toHaveText("Property created");
    await expect(dialog(page)).toHaveCount(0);
    await expect(rows(page)).toHaveCount(4);
    await expect(row(page, "77 Residency Road")).toContainText("$1,950");
    await expect(page.locator(".count-pill")).toHaveText("4 records");
  });

  test("blocks submission while a required field is empty", async ({ page }) => {
    let posted = false;
    page.on("request", (r) => {
      if (r.method() === "POST" && r.url().includes("/api/properties")) posted = true;
    });

    await page.getByRole("button", { name: "New Property" }).click();
    await field(page, "city").fill("Chennai");
    await dialog(page).getByRole("button", { name: "Save" }).click();

    await expect(dialog(page)).toBeVisible();
    // The required field is flagged inline rather than via a browser tooltip.
    await expect(field(page, "street")).toHaveAttribute("style", /border-color/);
    expect(posted).toBe(false);
  });

  test("populates reference dropdowns from the referenced module", async ({ page }) => {
    await page.getByRole("button", { name: "New Property" }).click();

    await expect(field(page, "owner_id").locator("option")).toHaveText([
      "— None —",
      "O-001 — Harbourline Holdings",
      "O-002 — Devraj Family Trust",
    ]);

    await field(page, "owner_id").selectOption("O-002");
    await field(page, "street").fill("5 Lake View");

    const [request] = await Promise.all([
      page.waitForRequest((r) => r.method() === "POST" && r.url().includes("/api/properties")),
      dialog(page).getByRole("button", { name: "Save" }).click(),
    ]);
    expect(request.postDataJSON()).toMatchObject({ owner_id: "O-002" });
  });

  test("offers the same create action from the empty state", async ({ page }) => {
    await page.route("**/api/properties*", (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: [], total: 0, limit: 500, offset: 0 }),
      });
    });
    await page.reload();

    await page.locator(".empty").getByRole("button", { name: "New Property" }).click();
    await expect(dialog(page).getByRole("heading", { name: "New Property" })).toBeVisible();
  });

  test("reports a server-side create failure as a toast, keeping the form open", async ({ page }) => {
    await page.route("**/api/properties", (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      return route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: "street must be unique" }),
      });
    });

    await page.getByRole("button", { name: "New Property" }).click();
    await field(page, "street").fill("12 Marine Drive");
    await dialog(page).getByRole("button", { name: "Save" }).click();

    await expect(page.locator(".toast.error")).toHaveText("street must be unique");
    await expect(dialog(page)).toBeVisible();
    await expect(rows(page)).toHaveCount(3);
  });
});

test.describe("Edit", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/properties");
    await expect(rows(page)).toHaveCount(3);
  });

  test("prefills the form from the record", async ({ page }) => {
    await row(page, "12 Marine Drive").getByRole("button", { name: "Edit" }).click();

    await expect(dialog(page).getByRole("heading", { name: "Edit Property" })).toBeVisible();
    await expect(field(page, "street")).toHaveValue("12 Marine Drive");
    await expect(field(page, "city")).toHaveValue("Mumbai");
    await expect(field(page, "type")).toHaveValue("Condo");
    await expect(field(page, "status")).toHaveValue("Occupied");
    await expect(field(page, "beds")).toHaveValue("3");
    await expect(field(page, "acq_date")).toHaveValue("2019-04-15");
  });

  test("saves changes and refreshes the table", async ({ page }) => {
    await row(page, "12 Marine Drive").getByRole("button", { name: "Edit" }).click();
    await field(page, "city").fill("Navi Mumbai");
    await field(page, "market_rent").fill("2600");

    const [request] = await Promise.all([
      page.waitForRequest(
        (r) => r.method() === "PUT" && r.url().includes("/api/properties/prop-1")
      ),
      dialog(page).getByRole("button", { name: "Save" }).click(),
    ]);

    expect(request.postDataJSON()).toMatchObject({
      street: "12 Marine Drive",
      city: "Navi Mumbai",
      market_rent: 2600,
    });

    await expect(page.locator(".toast.success")).toHaveText("Property updated");
    await expect(row(page, "12 Marine Drive")).toContainText("Navi Mumbai");
    await expect(row(page, "12 Marine Drive")).toContainText("$2,600");
    await expect(rows(page)).toHaveCount(3);
  });

  test("discards edits when the modal is cancelled", async ({ page }) => {
    await row(page, "9 Park Street").getByRole("button", { name: "Edit" }).click();
    await field(page, "city").fill("Howrah");
    await dialog(page).getByRole("button", { name: "Cancel" }).click();

    await expect(dialog(page)).toHaveCount(0);
    await expect(row(page, "9 Park Street")).toContainText("Kolkata");
  });
});

test.describe("Delete", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/properties");
    await expect(rows(page)).toHaveCount(3);
  });

  test("asks for confirmation naming the record", async ({ page }) => {
    await row(page, "9 Park Street").getByRole("button", { name: "Delete" }).click();

    await expect(dialog(page).getByRole("heading", { name: "Delete Property" })).toBeVisible();
    // recordTitle joins the configured titleFields, street + city here.
    await expect(dialog(page)).toContainText('delete "9 Park Street Kolkata"');
    await expect(dialog(page)).toContainText("This cannot be undone.");
  });

  test("cancelling leaves the record alone", async ({ page }) => {
    let deleted = false;
    page.on("request", (r) => {
      if (r.method() === "DELETE") deleted = true;
    });

    await row(page, "9 Park Street").getByRole("button", { name: "Delete" }).click();
    await dialog(page).getByRole("button", { name: "Cancel" }).click();

    await expect(dialog(page)).toHaveCount(0);
    await expect(rows(page)).toHaveCount(3);
    expect(deleted).toBe(false);
  });

  test("confirming removes the row and updates the count", async ({ page }) => {
    await row(page, "9 Park Street").getByRole("button", { name: "Delete" }).click();

    const [request] = await Promise.all([
      page.waitForRequest((r) => r.method() === "DELETE"),
      dialog(page).getByRole("button", { name: "Delete" }).click(),
    ]);
    expect(request.url()).toContain("/api/properties/prop-2");

    await expect(page.locator(".toast.success")).toHaveText("Property deleted");
    await expect(rows(page)).toHaveCount(2);
    await expect(row(page, "9 Park Street")).toHaveCount(0);
    await expect(page.locator(".count-pill")).toHaveText("2 records");
  });

  test("keeps the dialog open and toasts when the delete fails", async ({ page }) => {
    await page.route("**/api/properties/*", (route) => {
      if (route.request().method() !== "DELETE") return route.fallback();
      return route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ error: "Property has an active lease" }),
      });
    });

    await row(page, "9 Park Street").getByRole("button", { name: "Delete" }).click();
    await dialog(page).getByRole("button", { name: "Delete" }).click();

    await expect(page.locator(".toast.error")).toHaveText("Property has an active lease");
    await expect(dialog(page)).toBeVisible();
    await expect(rows(page)).toHaveCount(3);
  });
});

test.describe("Modal behaviour", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/properties");
    await page.getByRole("button", { name: "New Property" }).click();
    await expect(dialog(page)).toBeVisible();
  });

  test("closes on Escape", async ({ page }) => {
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
  });

  test("closes via the header close button", async ({ page }) => {
    await dialog(page).getByRole("button", { name: "Close" }).click();
    await expect(dialog(page)).toHaveCount(0);
  });

  test("closes when the backdrop is pressed", async ({ page }) => {
    // The dialog is centred, so click a corner of the scrim rather than its
    // middle, which would land on the dialog itself.
    await page.locator(".modal-backdrop").click({ position: { x: 5, y: 5 } });
    await expect(dialog(page)).toHaveCount(0);
  });

  test("stays open when the dialog body is pressed", async ({ page }) => {
    await dialog(page).locator(".modal-head").click();
    await expect(dialog(page)).toBeVisible();
  });

  test("locks page scrolling while open", async ({ page }) => {
    await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
    await page.keyboard.press("Escape");
    await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
  });

  test("does not leak form state between modules", async ({ page }) => {
    await field(page, "street").fill("Scratch value");
    await page.keyboard.press("Escape");

    await page.locator("nav.nav").getByRole("link", { name: "Owners", exact: true }).click();
    await page.getByRole("button", { name: "New Owner" }).click();
    await expect(field(page, "name")).toHaveValue("");

    await page.keyboard.press("Escape");
    await page.locator("nav.nav").getByRole("link", { name: "Properties", exact: true }).click();
    await page.getByRole("button", { name: "New Property" }).click();
    await expect(field(page, "street")).toHaveValue("");
  });
});

test.describe("Cross-module CRUD", () => {
  // A second module confirms the generic form handles a different field mix —
  // booleans, emails and a numeric rating rather than currency and selects.
  test("creates a vendor with a boolean field", async ({ page }) => {
    await page.goto("/vendors");
    await page.getByRole("button", { name: "New Vendor" }).click();

    await field(page, "company").fill("Summit Roofing");
    await field(page, "trade").fill("Roofing");
    await field(page, "email").fill("hello@summitroofing.example");
    await field(page, "rating").fill("4.8");
    await field(page, "w_9_on_file").selectOption("true");

    const [request] = await Promise.all([
      page.waitForRequest((r) => r.method() === "POST" && r.url().includes("/api/vendors")),
      dialog(page).getByRole("button", { name: "Save" }).click(),
    ]);

    expect(request.postDataJSON()).toEqual({
      company: "Summit Roofing",
      trade: "Roofing",
      email: "hello@summitroofing.example",
      rating: 4.8,
      w_9_on_file: true,
    });
    await expect(row(page, "Summit Roofing")).toBeVisible();
  });

  test("creates a daily task, which has no business key column", async ({ page }) => {
    await page.goto("/daily_tasks");
    await page.getByRole("button", { name: "New Daily Task" }).click();

    await field(page, "task").fill("Chase overdue rent for P-002");
    await field(page, "date").fill("2025-11-12");
    await field(page, "priority").selectOption("High");
    await field(page, "status").selectOption("Todo");

    await dialog(page).getByRole("button", { name: "Save" }).click();

    await expect(page.locator(".toast.success")).toHaveText("Daily Task created");
    await expect(row(page, "Chase overdue rent for P-002")).toContainText("Nov 12, 2025");
  });
});
