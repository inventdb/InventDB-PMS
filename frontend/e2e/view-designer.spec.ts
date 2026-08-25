import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";

/**
 * Designed views, end to end, on every module.
 *
 * A view is InventDB's designer building a layout from a description, so what
 * matters is not one screenshot but that the whole loop holds for the shapes a
 * property manager actually asks for: the preview appears before anything is
 * saved, the saved view renders at full height with nothing clipped, it pages,
 * it can be changed by describing the change, and it can be removed.
 *
 * The fixture layout deliberately declares `height:100vh` and an inner
 * `overflow-y:auto` — which is what a model emits unprompted, and what used to
 * trap the rows inside a 320px frame nobody could scroll.
 */

/** What a property manager asks each module to look like, day to day. */
const VIEWS: { entity: string; label: string; ask: string; edit: string }[] = [
  {
    entity: "properties",
    label: "Properties",
    ask: "a card per unit with the address, status badge and market rent",
    edit: "group them by region and show the beds and baths",
  },
  {
    entity: "owners",
    label: "Owners",
    ask: "a card per owner with contact, payout method and management fee",
    edit: "add the W-9 status as a badge",
  },
  {
    entity: "tenants",
    label: "Tenants",
    ask: "a card per resident with the unit, phone and move-in date",
    edit: "show the emergency contact too",
  },
  {
    entity: "leases",
    label: "Leases",
    ask: "a renewals board — lease end, contract rent and market rent per lease",
    edit: "put the ones ending soonest first and flag them",
  },
  {
    entity: "work_orders",
    label: "Work Orders",
    ask: "a job card per work order with priority, vendor and estimated cost",
    edit: "make the priority a badge and show the property",
  },
  {
    entity: "vendors",
    label: "Vendors",
    ask: "a trades directory card with the trade, phone and COI status",
    edit: "add the rating and sort by it",
  },
  {
    entity: "transactions",
    label: "Accounting",
    ask: "a compact table of date, type, account, party and amount",
    edit: "right-align the amounts and total them",
  },
  {
    entity: "inspections",
    label: "Inspections",
    ask: "a card per inspection with the type, date and result",
    edit: "highlight the ones that raised a follow-up",
  },
  {
    entity: "compliance",
    label: "Compliance",
    ask: "a card per policy with carrier, coverage and expiry",
    edit: "flag anything expiring within 60 days",
  },
  {
    entity: "daily_tasks",
    label: "Daily Tasks",
    ask: "a checklist card per task with category, priority and due date",
    edit: "group by category",
  },
];

const TRIGGER = ".view-switcher-trigger";
const designer = (page: Page) => page.locator('[data-testid="view-designer"]');
const frame = (page: Page) => page.locator(".custom-view iframe.report-frame");

const openSwitcher = (page: Page) => page.locator(TRIGGER).click();

async function describeNewView(page: Page, ask: string) {
  await openSwitcher(page);
  await page.getByRole("button", { name: "New view" }).click();
  await expect(designer(page)).toBeVisible();
  await page.getByLabel("Describe the view").fill(ask);
  await page.getByRole("button", { name: "Design view" }).click();
}

/** Height of the rendered document versus the frame showing it. */
async function frameFit(page: Page) {
  return frame(page).evaluate((el: Element) => {
    const f = el as HTMLIFrameElement;
    const d = f.contentDocument!;
    return {
      frameH: Math.round(f.getBoundingClientRect().height),
      contentH: Math.round(d.documentElement.scrollHeight),
      cards: d.querySelectorAll(".vk-card").length,
      innerScroller: Array.from(d.querySelectorAll<HTMLElement>("body *")).some(
        (n) => n.scrollHeight > n.clientHeight + 2 && getComputedStyle(n).overflowY === "auto"
      ),
    };
  });
}

test.describe("Designed views", () => {
  test("the preview appears before anything is saved", async ({ page }) => {
    await page.goto("/properties");
    await describeNewView(page, VIEWS[0].ask);

    // The preview is the real layout rendered over real rows — and it is on
    // screen while the view is still unsaved.
    await expect(designer(page).locator("iframe")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save view" })).toBeVisible();

    // Nothing has been saved: the module is still showing its own table.
    await expect(page.locator("table.data")).toBeVisible();
  });

  test("a described change amends the design instead of starting over", async ({ page }) => {
    await page.goto("/properties");
    await describeNewView(page, VIEWS[0].ask);
    await expect(designer(page).locator("iframe")).toBeVisible();

    await page.getByLabel("Describe the view").fill("now group them by region");
    await page.getByRole("button", { name: "Apply change" }).click();

    // Both instructions stay on the record, so it reads as one conversation.
    await expect(page.locator(".vd-history-row")).toHaveCount(2);
  });

  test("cancelling a design leaves the module exactly as it was", async ({ page }) => {
    await page.goto("/properties");
    await describeNewView(page, VIEWS[0].ask);
    await page.getByRole("button", { name: "Cancel" }).first().click();
    await expect(designer(page)).toHaveCount(0);
    await expect(page.locator("table.data")).toBeVisible();
  });
});

/* Every module, the same loop. */
for (const v of VIEWS) {
  test.describe(`${v.label} view`, () => {
    test(`is designed, saved, rendered, paged, edited and removed`, async ({ page }) => {
      const name = `${v.label} cards`;
      await page.goto(`/${v.entity}`);

      // ---- design + preview ------------------------------------------------
      await describeNewView(page, v.ask);
      await expect(designer(page).locator("iframe")).toBeVisible();

      // ---- save -------------------------------------------------------------
      await page.locator("#designed-view-name").fill(name);
      await page.getByRole("button", { name: "Save view" }).click();
      await expect(designer(page)).toHaveCount(0);

      // ---- renders at full height, nothing clipped, nothing trapped --------
      await expect(frame(page)).toBeVisible();
      await page.waitForTimeout(500);
      const fit = await frameFit(page);
      expect(fit.cards, "the layout rendered records").toBeGreaterThan(0);
      expect(
        fit.frameH,
        `frame ${fit.frameH}px is shorter than its ${fit.contentH}px of content`
      ).toBeGreaterThanOrEqual(fit.contentH - 4);
      expect(fit.innerScroller, "rows are trapped in a nested scroller").toBe(false);

      // ---- the page never scrolls sideways ---------------------------------
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(overflow, "the page scrolls horizontally").toBeLessThanOrEqual(1);

      // ---- pages ------------------------------------------------------------
      const pager = page.locator("nav.pager");
      await expect(pager, "a custom view still needs its pager").toBeVisible();
      const firstTitle = await frame(page).evaluate((el: Element) => (el as HTMLIFrameElement).contentDocument!.querySelector(".vk-title")?.textContent
      );
      await pager.getByRole("button", { name: "Next page" }).click();
      await expect(pager.getByText(/Page 2 of/)).toBeVisible();
      await page.waitForTimeout(400);
      const secondTitle = await frame(page).evaluate((el: Element) => (el as HTMLIFrameElement).contentDocument!.querySelector(".vk-title")?.textContent
      );
      expect(secondTitle, "page 2 shows the same rows as page 1").not.toBe(firstTitle);

      // ---- edit it by describing the change --------------------------------
      await openSwitcher(page);
      await page.getByRole("button", { name: "Manage" }).click();
      await page.getByRole("button", { name: `Edit ${name}` }).click();
      await expect(designer(page)).toBeVisible();
      // It opens on THIS view — its name is already in the box.
      await expect(page.locator("#designed-view-name")).toHaveValue(name);
      await page.getByLabel("Describe the view").fill(v.edit);
      await page.getByRole("button", { name: "Apply change" }).click();
      await expect(designer(page).locator("iframe")).toBeVisible();
      await page.getByRole("button", { name: "Save changes" }).click();
      await expect(designer(page)).toHaveCount(0);

      // Still ONE view — an edit is not a second view that looks like it.
      await openSwitcher(page);
      await expect(page.locator(".vs-row", { hasText: name })).toHaveCount(1);

      // ---- remove it --------------------------------------------------------
      await page.getByRole("button", { name: "Manage" }).click();
      await page.locator(".vs-row", { hasText: name }).getByRole("checkbox").check();
      await page.getByRole("button", { name: /^Delete/ }).click();
      const confirm = page.getByRole("dialog");
      if (await confirm.isVisible().catch(() => false)) {
        await confirm.getByRole("button", { name: /Delete/ }).click();
      }
      await expect(page.locator(".vs-row", { hasText: name })).toHaveCount(0);
    });
  });
}
