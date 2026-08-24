import { MODULES, expect, rows, test } from "./fixtures";

/**
 * Saved views — the named browse states at the head of every module.
 *
 * A view remembers a search and a sort, not a set of rows, so these assert on
 * the *effect* of applying one (the list narrows, the term returns to the
 * search box) rather than on what was stored.
 */

const trigger = ".view-switcher-trigger";
const palette = ".vs-palette";

/** One palette row by its visible name. `.vs-label` alone always also matches
 *  the "All <module>" row, so every row lookup has to be scoped. */
const row = (page: import("@playwright/test").Page, name: string) =>
  page.locator(".vs-row", { hasText: name });

/** How many rows the mock's search will leave — it matches `term` against every
 *  non-underscore field, so mirroring that keeps the assertions exact rather
 *  than racing the 300ms search debounce. */
const matching = (records: Record<string, unknown>[], term: string) =>
  records.filter((r) =>
    Object.entries(r).some(
      ([k, v]) => !k.startsWith("_") && String(v ?? "").toLowerCase().includes(term.toLowerCase())
    )
  ).length;

/** Open the palette and save the current search/sort under `name`. */
async function saveCurrentAs(page: import("@playwright/test").Page, name: string) {
  await page.locator(trigger).click();
  await page.getByRole("button", { name: "Save current" }).click();
  await page.locator("#view-name").fill(name);
  await page.getByRole("button", { name: "Save view" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
}

test.describe("View switcher", () => {
  test("every module offers one, defaulting to the full list", async ({ page }) => {
    for (const { name, plural } of MODULES) {
      await page.goto(`/${name}`);
      await expect(page.locator(trigger)).toHaveText(
        new RegExp(`All ${plural}`, "i")
      );
    }
  });

  test("starts with no saved views, so Manage has nothing to do", async ({ page }) => {
    await page.goto("/properties");
    await page.locator(trigger).click();

    await expect(page.locator(palette)).toBeVisible();
    await expect(page.locator(".vs-row")).toHaveCount(1); // just "All properties"
    await expect(page.getByRole("button", { name: "Manage" })).toBeDisabled();
  });

  test("saves the current search and makes it the current view", async ({ page, store }) => {
    await page.goto("/properties");
    const narrowed = matching(store.properties, "Mumbai");
    await page.getByPlaceholder("Search properties…").fill("Mumbai");
    await expect(rows(page)).toHaveCount(narrowed);

    await saveCurrentAs(page, "Mumbai stock");

    await expect(page.locator(trigger)).toHaveText(/Mumbai stock/);
    await expect(rows(page)).toHaveCount(narrowed);
  });

  test("switching back to All clears the view's filter", async ({ page, store }) => {
    await page.goto("/properties");
    await page.getByPlaceholder("Search properties…").fill("Mumbai");
    await saveCurrentAs(page, "Mumbai stock");

    await page.locator(trigger).click();
    await page.getByRole("button", { name: "All properties" }).click();

    await expect(page.locator(trigger)).toHaveText(/All properties/);
    await expect(page.getByPlaceholder("Search properties…")).toHaveValue("");
    await expect(rows(page)).toHaveCount(store.properties.length);
  });

  test("re-opening a view restores its search term", async ({ page }) => {
    await page.goto("/properties");
    await page.getByPlaceholder("Search properties…").fill("Mumbai");
    await saveCurrentAs(page, "Mumbai stock");

    await page.locator(trigger).click();
    await page.getByRole("button", { name: "All properties" }).click();
    await expect(page.getByPlaceholder("Search properties…")).toHaveValue("");

    await page.locator(trigger).click();
    await page.getByRole("button", { name: "Mumbai stock" }).click();

    await expect(page.getByPlaceholder("Search properties…")).toHaveValue("Mumbai");
  });

  test("filters the palette as you type", async ({ page }) => {
    await page.goto("/properties");
    await page.getByPlaceholder("Search properties…").fill("Mumbai");
    await saveCurrentAs(page, "Mumbai stock");
    await page.getByPlaceholder("Search properties…").fill("");
    await saveCurrentAs(page, "Everything");

    await page.locator(trigger).click();
    await page.getByPlaceholder("Search views…").fill("mumbai");

    await expect(page.locator(".vs-row")).toHaveCount(1);
    await expect(row(page, "Mumbai stock")).toBeVisible();
  });

  test("a view is scoped to its own module", async ({ page }) => {
    await page.goto("/properties");
    await page.getByPlaceholder("Search properties…").fill("Mumbai");
    await saveCurrentAs(page, "Mumbai stock");

    await page.goto("/tenants");
    await page.locator(trigger).click();

    await expect(page.locator(".vs-row")).toHaveCount(1);
    await expect(page.locator(palette)).not.toContainText("Mumbai stock");
  });
});

test.describe("Defaults", () => {
  test("a pinned view opens the module", async ({ page, store }) => {
    await page.goto("/properties");
    await page.getByPlaceholder("Search properties…").fill("Mumbai");
    await saveCurrentAs(page, "Mumbai stock");
    const narrowed = matching(store.properties, "Mumbai");
    await expect(rows(page)).toHaveCount(narrowed);

    await page.locator(trigger).click();
    await page.locator(".vs-star").first().click();
    await page.keyboard.press("Escape");

    // Leave and come back: the module should land on the pinned view rather
    // than the full list.
    await page.goto("/tenants");
    await page.goto("/properties");

    await expect(page.locator(trigger)).toHaveText(/Mumbai stock/);
    await expect(rows(page)).toHaveCount(narrowed);
  });

  test("clicking the star again unpins it", async ({ page, store }) => {
    await page.goto("/properties");
    await page.getByPlaceholder("Search properties…").fill("Mumbai");
    await saveCurrentAs(page, "Mumbai stock");

    await page.locator(trigger).click();
    await page.locator(".vs-star").first().click();
    await expect(page.locator(".vs-star.is-on")).toBeVisible();
    await page.locator(".vs-star").first().click();
    await expect(page.locator(".vs-star.is-on")).toHaveCount(0);
    await page.keyboard.press("Escape");

    await page.goto("/tenants");
    await page.goto("/properties");

    await expect(page.locator(trigger)).toHaveText(/All properties/);
    await expect(rows(page)).toHaveCount(store.properties.length);
  });

  test("only one view can be the default", async ({ page }) => {
    await page.goto("/properties");
    await saveCurrentAs(page, "First");
    await saveCurrentAs(page, "Second");

    await page.locator(trigger).click();
    // Rows are alphabetical, so First then Second.
    await page.locator(".vs-row", { hasText: "First" }).locator(".vs-star").click();
    await expect(page.locator(".vs-star.is-on")).toHaveCount(1);

    await page.locator(".vs-row", { hasText: "Second" }).locator(".vs-star").click();
    await expect(page.locator(".vs-star.is-on")).toHaveCount(1);
    await expect(
      page.locator(".vs-row", { hasText: "Second" }).locator(".vs-star.is-on")
    ).toBeVisible();
  });
});

test.describe("Manage", () => {
  test("renames a view in place", async ({ page }) => {
    await page.goto("/properties");
    await saveCurrentAs(page, "Old name");

    await page.locator(trigger).click();
    await page.getByRole("button", { name: "Manage" }).click();
    await row(page, "Old name").locator(".vs-label").click();
    await page.locator(".vs-rename").fill("New name");
    await page.locator(".vs-rename").press("Enter");

    await expect(row(page, "New name")).toBeVisible();
    await expect(page.locator(palette)).not.toContainText("Old name");
  });

  test("deletes the selected views", async ({ page }) => {
    await page.goto("/properties");
    await saveCurrentAs(page, "Keep me");
    await saveCurrentAs(page, "Delete me");

    await page.locator(trigger).click();
    await page.getByRole("button", { name: "Manage" }).click();
    await row(page, "Delete me").locator(".vs-check").check();
    await page.locator(".vs-foot").getByRole("button", { name: "Delete 1" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete 1" }).click();

    await expect(page.locator(palette)).not.toContainText("Delete me");
    await expect(row(page, "Keep me")).toBeVisible();
  });

  test("deleting the current view falls back to the full list", async ({ page, store }) => {
    await page.goto("/properties");
    await page.getByPlaceholder("Search properties…").fill("Mumbai");
    await expect(rows(page)).toHaveCount(matching(store.properties, "Mumbai"));
    await saveCurrentAs(page, "Mumbai stock");
    await expect(page.locator(trigger)).toHaveText(/Mumbai stock/);

    await page.locator(trigger).click();
    await page.getByRole("button", { name: "Manage" }).click();
    await page.locator(".vs-check").first().check();
    await page.locator(".vs-foot").getByRole("button", { name: "Delete 1" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete 1" }).click();

    await expect(page.locator(trigger)).toHaveText(/All properties/);
    await expect(rows(page)).toHaveCount(store.properties.length);
  });
});

test.describe("New view — the designer", () => {
  const designer = '[data-testid="view-designer"]';

  test("opens from the switcher and describes rather than captures", async ({ page }) => {
    await page.goto("/properties");
    await page.locator(trigger).click();
    await page.getByRole("button", { name: "New view" }).click();

    await expect(page.locator(designer)).toBeVisible();
    await expect(page.getByRole("button", { name: "Design view" })).toBeVisible();
    // Nothing is named or saved until there is something to look at.
    await expect(page.getByRole("button", { name: "Save view" })).toBeHidden();
  });

  test("previews the generated layout before anything is saved", async ({ page }) => {
    await page.goto("/properties");
    await page.locator(trigger).click();
    await page.getByRole("button", { name: "New view" }).click();

    await page.getByLabel("Describe the view").fill("a card per property");
    await page.getByRole("button", { name: "Design view" }).click();

    await expect(page.locator(`${designer} iframe`)).toBeVisible();
    await expect(page.getByRole("button", { name: "Save view" })).toBeVisible();
    // Still not a view — the switcher has gained nothing.
    await page.locator(trigger).click();
    await expect(page.locator(".vs-row")).toHaveCount(1);
  });

  test("a further instruction amends the design instead of restarting", async ({ page }) => {
    await page.goto("/properties");
    await page.locator(trigger).click();
    await page.getByRole("button", { name: "New view" }).click();

    await page.getByLabel("Describe the view").fill("a card per property");
    await page.getByRole("button", { name: "Design view" }).click();
    await expect(page.getByRole("button", { name: "Apply change" })).toBeVisible();

    await page.getByLabel("Describe the view").fill("make the rent bold");
    await page.getByRole("button", { name: "Apply change" }).click();

    // Both instructions stay on the record so either can be reused.
    await expect(page.locator(".vd-history-row")).toHaveCount(2);
  });

  test("saving turns the design into a view that renders in the list", async ({ page }) => {
    await page.goto("/properties");
    await page.locator(trigger).click();
    await page.getByRole("button", { name: "New view" }).click();

    await page.getByLabel("Describe the view").fill("a card per property");
    await page.getByRole("button", { name: "Design view" }).click();
    await page.locator("#designed-view-name").fill("Property cards");
    await page.getByRole("button", { name: "Save view" }).click();

    await expect(page.locator(designer)).toBeHidden();
    await expect(page.locator(trigger)).toHaveText(/Property cards/);
    // The layout replaces the grid — this view is not a narrowed table.
    await expect(page.locator(".custom-view iframe")).toBeVisible();
    await expect(page.locator("table.data")).toHaveCount(0);
  });

  test("switching away from a custom view brings the table back", async ({ page, store }) => {
    await page.goto("/properties");
    await page.locator(trigger).click();
    await page.getByRole("button", { name: "New view" }).click();
    await page.getByLabel("Describe the view").fill("a card per property");
    await page.getByRole("button", { name: "Design view" }).click();
    await page.locator("#designed-view-name").fill("Property cards");
    await page.getByRole("button", { name: "Save view" }).click();
    await expect(page.locator(".custom-view iframe")).toBeVisible();

    await page.locator(trigger).click();
    await page.getByRole("button", { name: "All properties" }).click();

    await expect(page.locator(".custom-view")).toHaveCount(0);
    await expect(rows(page)).toHaveCount(store.properties.length);
  });

  test("cancelling leaves no view behind", async ({ page }) => {
    await page.goto("/properties");
    await page.locator(trigger).click();
    await page.getByRole("button", { name: "New view" }).click();
    await page.getByLabel("Describe the view").fill("a card per property");
    await page.getByRole("button", { name: "Design view" }).click();
    await expect(page.locator(`${designer} iframe`)).toBeVisible();

    await page.getByRole("button", { name: "Cancel" }).click();

    await expect(page.locator(designer)).toBeHidden();
    await page.locator(trigger).click();
    await expect(page.locator(".vs-row")).toHaveCount(1);
  });

  test("an empty description cannot be submitted", async ({ page }) => {
    await page.goto("/properties");
    await page.locator(trigger).click();
    await page.getByRole("button", { name: "New view" }).click();

    await expect(page.getByRole("button", { name: "Design view" })).toBeDisabled();
  });
});
