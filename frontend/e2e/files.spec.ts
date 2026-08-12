import { expect, test } from "./fixtures";

/**
 * Files — the drive over attachments.
 *
 * The promises being covered are the room's:
 *   - the tree describes the whole drive, not the page currently on screen;
 *   - a folder means that folder and everything under it;
 *   - a file always says where it lives, and can be opened, read and rolled back;
 *   - deleting a folder is batched, counted, and cannot run away.
 */

const tree = (page: import("@playwright/test").Page) => page.locator(".fx-tree");
const rows = (page: import("@playwright/test").Page) => page.locator(".fx-row");
const dialog = (page: import("@playwright/test").Page) => page.locator(".modal");

test.describe("Files", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/files");
  });

  // =========================================================================
  // The drive
  // =========================================================================

  test("counts every file in the portfolio", async ({ page }) => {
    await expect(page.locator(".page-head .count-pill")).toContainText("3 files");
  });

  test("groups the tree by record type, then by folder", async ({ page }) => {
    // Type first, not path first: "2026" under leases and "2026" under
    // inspections are different folders and must not merge into one node.
    await expect(tree(page).locator(".fx-node--type")).toHaveCount(2);
    await expect(tree(page).getByRole("button", { name: "leases", exact: true })).toBeVisible();
    await expect(tree(page).getByRole("button", { name: "inspections", exact: true })).toBeVisible();
  });

  test("rolls a folder's count up into its type", async ({ page }) => {
    // leases holds one unfoldered file plus one in 2026.
    const leases = tree(page).locator(".fx-node--type").filter({ hasText: "leases" });
    await expect(leases.locator(".fx-node-count")).toHaveText("2");
  });

  test("nests a deep folder under its parent rather than flattening it", async ({ page }) => {
    await tree(page).getByRole("button", { name: "Expand inspections" }).click();
    await expect(tree(page).getByRole("button", { name: "2026", exact: true })).toBeVisible();

    await tree(page).getByRole("button", { name: "Expand 2026" }).click();
    await expect(tree(page).getByRole("button", { name: "photos", exact: true })).toBeVisible();
  });

  test("lists every file until a scope is picked", async ({ page }) => {
    await expect(rows(page)).toHaveCount(3);
  });

  test("scoping to a type shows only that type's files", async ({ page }) => {
    await tree(page).getByRole("button", { name: "leases", exact: true }).click();

    await expect(rows(page)).toHaveCount(2);
    await expect(page.getByText("kitchen.jpg")).toHaveCount(0);
    // Deep-linkable: the selection lives in the URL so Back works.
    await expect(page).toHaveURL(/type=leases/);
  });

  test("a folder means that folder and everything under it", async ({ page }) => {
    await tree(page).getByRole("button", { name: "Expand inspections" }).click();
    await tree(page).getByRole("button", { name: "2026", exact: true }).click();

    await expect(rows(page)).toHaveCount(1);
    await expect(page.getByText("kitchen.jpg")).toBeVisible();
  });

  test("All files resets the scope", async ({ page }) => {
    await tree(page).getByRole("button", { name: "leases", exact: true }).click();
    await expect(rows(page)).toHaveCount(2);

    await tree(page).getByRole("button", { name: "All files", exact: true }).click();

    await expect(rows(page)).toHaveCount(3);
    await expect(page).not.toHaveURL(/type=/);
  });

  test("a deep link opens straight into a folder", async ({ page }) => {
    await page.goto("/files?type=inspections&folder=2026/photos");

    await expect(rows(page)).toHaveCount(1);
    await expect(page.getByText("kitchen.jpg")).toBeVisible();
  });

  test("the tree keeps describing the whole drive while a scope is selected", async ({ page }) => {
    // The tree is built from a separate unscoped aggregation. Built from the
    // grid's scoped response instead, it would collapse to whatever is open.
    await tree(page).getByRole("button", { name: "leases", exact: true }).click();

    await expect(tree(page).locator(".fx-node--type")).toHaveCount(2);
    await expect(page.locator(".page-head .count-pill")).toContainText("3 files");
  });

  test("every row says where the file lives", async ({ page }) => {
    const row = rows(page).filter({ hasText: "signed-lease.pdf" });
    await expect(row).toContainText("leases › 2026");
  });

  // =========================================================================
  // Searching
  // =========================================================================

  test("searches file names", async ({ page }) => {
    await page.locator(".fx-search input").fill("kitchen");
    await page.locator(".fx-search input").press("Enter");

    await expect(rows(page)).toHaveCount(1);
    await expect(page.getByText("kitchen.jpg")).toBeVisible();
  });

  test("searching the text inside files finds one by its contents", async ({ page }) => {
    // "Marine Drive" is in the lease's extracted text, not in any file name —
    // a name search cannot find it, which is the whole point of the mode.
    await page.getByRole("tab", { name: "text" }).click();
    await page.locator(".fx-search input").fill("Marine Drive");
    await page.locator(".fx-search input").press("Enter");

    await expect(rows(page)).toHaveCount(1);
    await expect(page.getByText("signed-lease.pdf")).toBeVisible();
    // A ranked hit shows the passage that matched.
    await expect(page.locator(".fx-snippet")).toContainText("RESIDENTIAL LEASE");
  });

  test("says so when nothing matched", async ({ page }) => {
    await page.locator(".fx-search input").fill("nothing-like-this");
    await page.locator(".fx-search input").press("Enter");

    await expect(page.getByRole("heading", { name: "Nothing matched" })).toBeVisible();
  });

  // =========================================================================
  // One file
  // =========================================================================

  test("opening a file shows what it is and where it lives", async ({ page }) => {
    await rows(page).filter({ hasText: "signed-lease.pdf" }).click();

    const modal = dialog(page);
    await expect(modal.getByRole("heading", { name: "signed-lease.pdf" })).toBeVisible();

    await modal.getByRole("tab", { name: "Details" }).click();
    await expect(modal).toContainText("leases / lea-1");
    await expect(modal).toContainText("2026");
    await expect(modal).toContainText("application/pdf");
  });

  test("shows the text extracted from a file", async ({ page }) => {
    await rows(page).filter({ hasText: "signed-lease.pdf" }).click();
    await dialog(page).getByRole("tab", { name: "Extracted text" }).click();

    await expect(dialog(page).locator(".fx-text")).toContainText("RESIDENTIAL LEASE AGREEMENT");
  });

  test("keeps earlier versions rather than overwriting", async ({ page }) => {
    await rows(page).filter({ hasText: "signed-lease.pdf" }).click();
    await dialog(page).getByRole("tab", { name: "Versions" }).click();

    await expect(dialog(page).locator(".fx-version")).toHaveCount(2);
    await expect(dialog(page).locator(".fx-version-no").first()).toHaveText("v2");
    await expect(dialog(page).locator(".badge")).toHaveText("Current");
  });

  test("restoring an older version makes it current", async ({ page }) => {
    await rows(page).filter({ hasText: "signed-lease.pdf" }).click();
    await dialog(page).getByRole("tab", { name: "Versions" }).click();

    await dialog(page).getByRole("button", { name: /Restore/ }).click();

    await expect(page.locator(".toast")).toContainText("Version 1 is now current");
    // Nothing was discarded — both versions are still listed.
    await expect(dialog(page).locator(".fx-version")).toHaveCount(2);
  });

  test("deleting a file asks first, then removes it from the drive", async ({ page }) => {
    await rows(page).filter({ hasText: "kitchen.jpg" }).click();
    await dialog(page).getByRole("button", { name: "Delete" }).click();

    await expect(page.getByText("everything extracted from it are removed")).toBeVisible();
    await page.getByRole("button", { name: "Delete file" }).click();

    await expect(page.locator(".toast")).toContainText("Deleted");
    await expect(rows(page)).toHaveCount(2);
  });

  // =========================================================================
  // Giving a file a home
  // =========================================================================

  test("a file on a record says which record, and links to it", async ({ page }) => {
    await rows(page).filter({ hasText: "signed-lease.pdf" }).click();
    await dialog(page).getByRole("tab", { name: "Details" }).click();

    await expect(dialog(page).locator(".fx-attached")).toContainText("leases / lea-1");
    // No attach prompt on a file that already has a home.
    await expect(dialog(page).locator(".fx-attach")).toHaveCount(0);
  });

  test("an unattached file says so and offers to place it", async ({ page }) => {
    // rent-schedule.xlsx came in through the drive, so it sits in the leases
    // vault with no parent record.
    await rows(page).filter({ hasText: "rent-schedule.xlsx" }).click();
    await dialog(page).getByRole("tab", { name: "Details" }).click();

    await expect(dialog(page).locator(".fx-attach")).toContainText("isn’t on a record yet");
    await expect(dialog(page).getByRole("tab", { name: "Attach to a record" })).toBeVisible();
    await expect(dialog(page).getByRole("tab", { name: "Raise a work order" })).toBeVisible();
  });

  test("attaching puts the file on the record you pick", async ({ page }) => {
    let sent: Record<string, unknown> | null = null;
    await page.route("**/api/files/attach", async (route) => {
      sent = route.request().postDataJSON() as Record<string, unknown>;
      await route.fallback();
    });

    await rows(page).filter({ hasText: "rent-schedule.xlsx" }).click();
    await dialog(page).getByRole("tab", { name: "Details" }).click();
    await dialog(page).locator("#fx-attach-type").selectOption("work_orders");
    await dialog(page).locator("#fx-attach-record").selectOption("wo-1");
    await dialog(page).getByRole("button", { name: "Attach" }).click();

    await expect(page.locator(".toast")).toContainText("Now on work_orders / wo-1");
    // `move`, not `copy`: the file had no real parent, and now it has one.
    expect(sent).toEqual({
      attachment_id: "att-2",
      type: "work_orders",
      record_id: "wo-1",
      mode: "move",
    });

    // And the drive shows its new home.
    await expect(
      rows(page).filter({ hasText: "rent-schedule.xlsx" }).locator(".fx-where")
    ).toContainText("work_orders");
  });

  test("attaching without picking a record says so rather than doing nothing", async ({ page }) => {
    await rows(page).filter({ hasText: "rent-schedule.xlsx" }).click();
    await dialog(page).getByRole("tab", { name: "Details" }).click();
    await dialog(page).getByRole("button", { name: "Attach" }).click();

    await expect(dialog(page).locator(".alert.error")).toContainText(
      "Pick the record this file belongs to"
    );
  });

  test("raises a work order from a file and attaches it in one go", async ({ page }) => {
    // A photo of a burst pipe is a job waiting to be raised — creating the
    // work order and attaching the evidence should not be two errands.
    const posted: string[] = [];
    await page.route("**/api/work_orders", async (route) => {
      if (route.request().method() === "POST") posted.push("created");
      await route.fallback();
    });
    let attached: Record<string, unknown> | null = null;
    await page.route("**/api/files/attach", async (route) => {
      attached = route.request().postDataJSON() as Record<string, unknown>;
      await route.fallback();
    });

    await rows(page).filter({ hasText: "rent-schedule.xlsx" }).click();
    await dialog(page).getByRole("tab", { name: "Details" }).click();
    await dialog(page).getByRole("tab", { name: "Raise a work order" }).click();

    // The work-order form is the app's own — same fields as the module.
    await dialog(page).locator("#f-issue").fill("Burst pipe under the sink");
    await dialog(page).getByRole("button", { name: "Save" }).click();

    await expect(page.locator(".toast")).toContainText("attached this file to it");
    expect(posted).toHaveLength(1);
    expect(attached).toMatchObject({ type: "work_orders", mode: "move" });
  });

  // =========================================================================
  // Deleting a folder
  // =========================================================================

  test("deleting a type asks before removing anything", async ({ page }) => {
    await tree(page)
      .locator(".fx-node--type")
      .filter({ hasText: "leases" })
      .locator(".fx-node-del")
      .click({ force: true });

    await expect(page.getByText("Delete all 2 file(s) on leases?")).toBeVisible();
    await page.getByRole("button", { name: "Delete all files" }).click();

    await expect(page.locator(".toast")).toContainText("Deleted 2 files");
    await expect(rows(page)).toHaveCount(1);
  });

  test("cancelling the confirm leaves everything alone", async ({ page }) => {
    await tree(page)
      .locator(".fx-node--type")
      .filter({ hasText: "leases" })
      .locator(".fx-node-del")
      .click({ force: true });
    await page.getByRole("button", { name: "Cancel" }).click();

    await expect(rows(page)).toHaveCount(3);
  });

  test("deleting the folder you are standing in drops back to All files", async ({ page }) => {
    // Otherwise the grid sits on a scope that no longer exists.
    await page.goto("/files?type=leases&folder=2026");
    await expect(rows(page)).toHaveCount(1);

    await tree(page)
      .locator(".fx-node")
      .filter({ hasText: "2026" })
      .first()
      .locator(".fx-node-del")
      .click({ force: true });
    await page.getByRole("button", { name: "Delete folder" }).click();

    await expect(page).not.toHaveURL(/folder=/);
    await expect(rows(page)).toHaveCount(2);
  });

  // =========================================================================
  // Failure
  // =========================================================================

  test("surfaces a drive that will not load", async ({ page }) => {
    await page.route("**/api/files/search", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "Attachment service unavailable" }),
      })
    );
    await page.reload();

    await expect(page.locator(".alert.error").first()).toContainText(
      "Attachment service unavailable"
    );
  });

  test("says the drive is empty rather than looking broken", async ({ page }) => {
    await page.route("**/api/files/search", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ results: [], total_matches: 0, folders: [] }),
      })
    );
    await page.reload();

    await expect(page.getByRole("heading", { name: "No files here" })).toBeVisible();
    await expect(tree(page)).toContainText("No files yet");
  });
});
