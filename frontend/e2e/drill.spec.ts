import type { Page, Request } from "@playwright/test";

import { expect, field, row, sseBody, test } from "./fixtures";

/**
 * The drill-down panel — the right-hand view a click on any record, result row
 * or chart mark opens.
 *
 * The promises it makes, and that these specs hold it to:
 *   - a click VIEWS: the panel opens read-only, and editing is a separate,
 *     deliberate press of Edit;
 *   - Edit is only offered when the server says this person may change THIS
 *     record, and a row rule that refuses the save turns the panel read-only
 *     with the reason;
 *   - a record shows the records it points at (links up) and every module that
 *     points at it (paged grids down), and each of those opens one level deeper,
 *     with Back / Esc stepping out a level at a time;
 *   - a grouped row or chart mark lists the records BEHIND it — the query's own
 *     filter narrowed to what was clicked.
 */

const panel = (page: Page) => page.locator("aside.drill-panel");
const section = (page: Page, name: string) => panel(page).getByRole("region", { name, exact: true });

test.describe("module list", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/properties");
    await expect(row(page, "12 Marine Drive")).toBeVisible();
  });

  test("a row opens its record read-only, with what points at it", async ({ page }) => {
    await row(page, "12 Marine Drive").getByText("Mumbai").click();

    await expect(page.getByRole("dialog", { name: "Property details" })).toBeVisible();
    await expect(panel(page).getByRole("heading", { level: 2 })).toHaveText("12 Marine Drive Mumbai");
    // View, not edit: no form until Edit is pressed.
    await expect(field(page, "street")).toHaveCount(0);
    await expect(panel(page).getByRole("button", { name: "Edit" })).toBeVisible();

    // Up: the owner it points at, named.
    await expect(section(page, "Details").getByRole("button", { name: /O-001 · Harbourline Holdings/ })).toBeVisible();
    // Down: every module that points at this property, each a grid.
    await expect(section(page, "Tenants")).toContainText("Meera");
    await expect(section(page, "Leases")).toContainText("L-001");
    await expect(section(page, "Work Orders")).toContainText("WO-1001");
    await expect(section(page, "Inspections")).toContainText("I-001");
    await expect(section(page, "Leases")).not.toContainText("L-002"); // P-003's
  });

  test("Edit and Delete in the row act on their own, without opening the panel", async ({ page }) => {
    await row(page, "12 Marine Drive").getByRole("button", { name: "Edit" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(page.getByRole("dialog", { name: "Edit Property" })).toBeVisible();
  });

  test("Enter on a focused row opens it too", async ({ page }) => {
    await row(page, "9 Park Street").focus();
    await page.keyboard.press("Enter");
    await expect(panel(page).getByRole("heading", { level: 2 })).toHaveText("9 Park Street Kolkata");
  });

  test("drills deeper, and Back / Esc step out one level at a time", async ({ page }) => {
    await row(page, "12 Marine Drive").getByText("Mumbai").click();
    await section(page, "Leases").getByRole("row", { name: /L-001/ }).click();

    await expect(page.getByRole("dialog", { name: "Lease details" })).toBeVisible();
    await expect(panel(page).getByRole("heading", { level: 2 })).toHaveText("Meera Iyer");
    const crumbs = panel(page).getByRole("navigation", { name: "Drill-down path" });
    await expect(crumbs).toContainText("12 Marine Drive Mumbai");
    await expect(crumbs).toContainText("Meera Iyer");

    // One more level: the lease's tenant, then back out.
    await section(page, "Details").getByRole("button", { name: /T-001/ }).click();
    await expect(page.getByRole("dialog", { name: "Tenant details" })).toBeVisible();

    await panel(page).getByRole("button", { name: "Back" }).click();
    await expect(page.getByRole("dialog", { name: "Lease details" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Property details" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel(page)).toHaveCount(0);
  });

  test("an owner lists every property it owns, and each opens", async ({ page }) => {
    await row(page, "12 Marine Drive").getByText("Mumbai").click();
    await section(page, "Details").getByRole("button", { name: /O-001/ }).click();

    await expect(page.getByRole("dialog", { name: "Owner details" })).toBeVisible();
    const props = section(page, "Properties");
    await expect(props.locator(".drill-count")).toHaveText("2");
    await props.getByRole("row", { name: /44 Residency Road/ }).click();
    await expect(panel(page).getByRole("heading", { level: 2 })).toHaveText("44 Residency Road Bengaluru");
  });

  test("related grids page through everything on the server", async ({ page, store }) => {
    for (let i = 0; i < 7; i++) {
      store.transactions.push({
        _id: `txn-x${i}`,
        reference: `TX-90${i}`,
        date: `2026-0${(i % 9) + 1}-01`,
        type: "Income",
        account_category: "Rent",
        amount: 100 + i,
        property_id: "P-001",
      });
    }
    await row(page, "12 Marine Drive").getByText("Mumbai").click();

    const ledger = section(page, "Accounting");
    await expect(ledger.locator(".drill-count")).toHaveText("8");
    await expect(ledger.locator("tbody tr")).toHaveCount(5);
    await expect(ledger).toContainText("1–5 of 8");
    await ledger.getByRole("button", { name: "Next page" }).click();
    await expect(ledger).toContainText("6–8 of 8");
    await expect(ledger.locator("tbody tr")).toHaveCount(3);
  });

  test("clicking outside closes it", async ({ page }) => {
    await row(page, "12 Marine Drive").getByText("Mumbai").click();
    await expect(panel(page)).toBeVisible();
    await page.mouse.click(20, 400);
    await expect(panel(page)).toHaveCount(0);
  });
});

test.describe("view, then edit only where allowed", () => {
  test("an editor edits in the panel and sees the change", async ({ page, store }) => {
    await page.goto("/properties");
    await row(page, "12 Marine Drive").getByText("Mumbai").click();
    await panel(page).getByRole("button", { name: "Edit" }).click();

    await expect(field(page, "city")).toHaveValue("Mumbai");
    await field(page, "city").fill("Navi Mumbai");
    await panel(page).getByRole("button", { name: "Save" }).click();

    await expect(page.locator(".toast.success")).toHaveText("Property updated");
    await expect(field(page, "city")).toHaveCount(0); // back to view
    await expect(panel(page).getByRole("heading", { level: 2 })).toHaveText("12 Marine Drive Navi Mumbai");
    expect(store.properties.find((p) => p._id === "prop-1")?.city).toBe("Navi Mumbai");
  });

  test("a reader gets the record without an Edit button", async ({ page }) => {
    await page.route(/\/api\/drill\/[^/]+\/[^/]+\/access$/, (route) =>
      route.fulfill({
        json: { can_view: true, can_edit: false, reason: "You can view properties but not change them.", row_rules: "n/a" },
      })
    );
    await page.goto("/properties");
    await row(page, "12 Marine Drive").getByText("Mumbai").click();

    await expect(panel(page).getByText("View only — You can view properties but not change them.")).toBeVisible();
    await expect(panel(page).getByRole("button", { name: "Edit" })).toHaveCount(0);
  });

  test("a row rule that refuses the save turns the record read-only, with its reason", async ({ page, store }) => {
    const reason = "Row-level rule denies write on pms.properties for this record (none of your grants' row rules match it).";
    await page.route(/\/api\/properties\/prop-1$/, (route) =>
      route.request().method() === "PUT"
        ? route.fulfill({ status: 403, json: { ok: false, error: reason } })
        : route.fallback()
    );
    await page.goto("/properties");
    await row(page, "12 Marine Drive").getByText("Mumbai").click();
    await panel(page).getByRole("button", { name: "Edit" }).click();
    await field(page, "city").fill("Pune");
    await panel(page).getByRole("button", { name: "Save" }).click();

    await expect(panel(page).getByText(`View only — ${reason}`)).toBeVisible();
    await expect(panel(page).getByRole("button", { name: "Edit" })).toHaveCount(0);
    expect(store.properties.find((p) => p._id === "prop-1")?.city).toBe("Mumbai");
  });

  test("a record hidden from this person says so instead of failing", async ({ page }) => {
    await page.goto("/leases?focus=lea-gone");
    await expect(panel(page).getByRole("alert")).toContainText("isn't available");
  });
});

test.describe("links into a record", () => {
  test("?focus= opens the record in the panel, not an edit form", async ({ page }) => {
    await page.goto("/leases?focus=lea-1");
    await expect(page.getByRole("dialog", { name: "Lease details" })).toBeVisible();
    await expect(panel(page).getByRole("heading", { level: 2 })).toHaveText("Meera Iyer");
    await expect(field(page, "tenant_name")).toHaveCount(0);
    await expect(page).toHaveURL(/\/leases$/); // consumed
  });

  test("leaving the page puts the panel away", async ({ page }) => {
    await page.goto("/properties");
    await page.locator("nav.nav").getByRole("link", { name: "Leases" }).click();
    await row(page, "Meera Iyer").getByText("L-001").click();
    await expect(panel(page)).toBeVisible();
    // The backdrop covers the sidebar, so Back is the way off the page.
    await page.goBack();
    await expect(page).toHaveURL(/\/properties$/);
    await expect(panel(page)).toHaveCount(0);
  });
});

/* ── Analyze ─────────────────────────────────────────────────────────────── */

async function scriptTurn(page: Page, steps: Record<string, unknown>[]) {
  await page.route(/\/api\/analyze\/chat\/stream/, (route) =>
    route.fulfill({ status: 200, contentType: "text/event-stream", body: sseBody(steps) })
  );
}

async function ask(page: Page, question: string) {
  await page.locator(".an-ask .an-composer-input").fill(question);
  await page.locator(".an-ask button[type=submit]").click();
}

function drillBodies(page: Page): Record<string, unknown>[] {
  const bodies: Record<string, unknown>[] = [];
  page.on("request", (r: Request) => {
    if (r.method() === "POST" && /\/api\/drill\/[a-z_]+$/.test(r.url())) {
      bodies.push({ entity: r.url().split("/").pop(), ...(r.postDataJSON() as object) });
    }
  });
  return bodies;
}

const GROUPED_SQL = "SELECT status, COUNT(*) AS n FROM pms.work_orders WHERE est_cost > 0 GROUP BY status";

test.describe("Analyze", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/analyze");
  });

  test("a grouped row lists the records behind it", async ({ page }) => {
    const bodies = drillBodies(page);
    await scriptTurn(page, [
      { type: "sql", content: "Executing query...", sql: GROUPED_SQL },
      { type: "result", content: "2 rows", sql: GROUPED_SQL, data: [{ status: "Open", n: 1 }, { status: "In Progress", n: 1 }] },
      { type: "done", content: "One open and one in progress." },
    ]);
    await ask(page, "Work orders by status");

    await expect(page.getByText("click a row to see what is behind it")).toBeVisible();
    await page.locator(".an-table tbody tr", { hasText: "Open" }).click();

    await expect(page.getByRole("dialog", { name: "Behind this number" })).toBeVisible();
    await expect(panel(page).getByRole("heading", { level: 2 })).toHaveText("Work Orders · Open");
    await expect(panel(page).locator("tbody tr")).toHaveCount(1);
    await expect(panel(page)).toContainText("Kitchen tap dripping");
    // The query's own filter, narrowed to the group clicked.
    expect(bodies.at(-1)).toMatchObject({ entity: "work_orders", where: "(est_cost > 0) AND status = 'Open'" });

    // …and each record behind it opens one level deeper.
    await panel(page).getByRole("row", { name: /WO-1001/ }).click();
    await expect(page.getByRole("dialog", { name: "Work Order details" })).toBeVisible();
  });

  test("a chart bar lists the records behind it", async ({ page }) => {
    const bodies = drillBodies(page);
    await scriptTurn(page, [
      { type: "sql", content: "Executing query...", sql: GROUPED_SQL },
      { type: "result", content: "2 rows", sql: GROUPED_SQL, data: [{ status: "Open", n: 1 }, { status: "In Progress", n: 1 }] },
      {
        type: "chart",
        content: "Work orders by status",
        chart: { data: [{ type: "bar", x: ["Open", "In Progress"], y: [1, 1] }], layout: { title: "Work orders by status" } },
      },
      { type: "done", content: "Charted." },
    ]);
    await ask(page, "Chart work orders by status");

    const figure = page.locator(".an-figure");
    await expect(figure.getByText("Click a bar to see the records behind it.")).toBeVisible();
    await figure.locator(".recharts-bar-rectangle").nth(1).click();

    await expect(panel(page).getByRole("heading", { level: 2 })).toHaveText("Work Orders · In Progress");
    await expect(panel(page)).toContainText("AC not cooling");
    expect(bodies.at(-1)).toMatchObject({ where: "(est_cost > 0) AND status = 'In Progress'" });
  });

  test("a record row opens that record", async ({ page }) => {
    const sql = "SELECT _id, wo, issue FROM pms.work_orders WHERE status = 'Open'";
    await scriptTurn(page, [
      { type: "result", content: "1 row", sql, data: [{ _id: "wo-1", wo: "WO-1001", issue: "Kitchen tap dripping" }] },
      { type: "done", content: "One." },
    ]);
    await ask(page, "Open work orders");

    await expect(page.getByText("click a row to open it")).toBeVisible();
    await page.locator(".an-table tbody tr", { hasText: "WO-1001" }).click();
    await expect(page.getByRole("dialog", { name: "Work Order details" })).toBeVisible();
    await expect(panel(page).getByRole("heading", { level: 2 })).toHaveText("Kitchen tap dripping");
    await expect(section(page, "Details").getByRole("button", { name: /P-001/ })).toBeVisible();
  });

  test("a joined result maps to no single module, so it isn't clickable", async ({ page }) => {
    const sql = "SELECT l.lease_id, p.city FROM pms.leases l JOIN pms.properties p ON l.property_id = p.property_id";
    await scriptTurn(page, [
      { type: "result", content: "2 rows", sql, data: [{ lease_id: "L-001", city: "Mumbai" }, { lease_id: "L-002", city: "Bengaluru" }] },
      { type: "done", content: "Two." },
    ]);
    await ask(page, "Leases with cities");

    await expect(page.locator(".an-table tbody tr")).toHaveCount(2);
    await expect(page.locator(".an-table tbody tr.is-clickable")).toHaveCount(0);
    await page.locator(".an-table tbody tr").first().click();
    await expect(panel(page)).toHaveCount(0);
  });
});

/* ── Dashboard ───────────────────────────────────────────────────────────── */

test.describe("Dashboard", () => {
  const WIDGETS = [
    { kind: "kpi", title: "Open Work Orders", sql: "SELECT COUNT(*) AS v FROM pms.work_orders WHERE status = 'Open'", span: 3 },
    { kind: "pie", title: "Properties by Status", sql: "SELECT status, COUNT(*) AS v FROM pms.properties GROUP BY status", span: 6 },
  ];

  test.beforeEach(async ({ page }) => {
    await page.route(/\/api\/analyze\/chat\/stream/, (route) =>
      route.fulfill({ status: 200, contentType: "text/event-stream", body: sseBody([{ type: "answer", content: JSON.stringify(WIDGETS) }]) })
    );
    await page.goto("/");
    await page.getByRole("button", { name: /New layout/ }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.locator("#w-layout").fill("ops");
    await dialog.getByRole("button", { name: /Build layout/ }).click();
    await dialog.getByRole("button", { name: "Replace my dashboard" }).click();
    await expect(page.getByRole("heading", { name: "Open Work Orders" })).toBeVisible();
  });

  test("a KPI lists every record behind the number", async ({ page }) => {
    await page.getByTitle("See the records behind this number").click();
    await expect(page.getByRole("dialog", { name: "Behind this number" })).toBeVisible();
    await expect(panel(page).getByRole("heading", { level: 2 })).toHaveText("Open Work Orders");
    await expect(panel(page).locator("tbody tr")).toHaveCount(1);
    await expect(panel(page)).toContainText("Kitchen tap dripping");
  });

  test("a slice lists the records in that group", async ({ page }) => {
    // The fixture's widget rows are {_id: wr-1|wr-2, status: occupied|vacant},
    // and the legend labels by the first text column — the second entry is the
    // vacant row. What opens is decided by the row's GROUP BY column, status.
    await page.locator(".wg-legend-row").nth(1).click();
    await expect(panel(page).getByRole("heading", { level: 2 })).toHaveText("Properties · vacant");
    await expect(panel(page).locator("tbody tr")).toHaveCount(1);
    await expect(panel(page)).toContainText("9 Park Street");
  });

  test("nothing drills while the layout is being edited", async ({ page }) => {
    await page.getByRole("button", { name: "Edit layout" }).click();
    await expect(page.getByTitle("See the records behind this number")).toHaveCount(0);
    await page.locator(".wg-legend-row").nth(1).click();
    await expect(panel(page)).toHaveCount(0);
  });
});
