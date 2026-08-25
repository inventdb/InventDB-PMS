import { expect, sseBody, test } from "./fixtures";
import type { Page } from "@playwright/test";

/** The layout the assistant returns for a described dashboard. */
const PROPOSED = [
  { kind: "kpi", title: "Overdue Rent", sql: "SELECT COUNT(*) AS v FROM pms.leases", span: 3 },
  { kind: "bar", title: "Arrears by Region", sql: "SELECT region, COUNT(*) AS v FROM pms.properties GROUP BY region", span: 6 },
];

/** Script the agent turn that `suggestWidgets` parses. */
async function scriptLayout(page: Page, widgets: unknown = PROPOSED) {
  await page.route(/\/api\/analyze\/chat\/stream/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: sseBody([{ type: "answer", content: JSON.stringify(widgets) }]),
    })
  );
}

/**
 * The Dashboard is InventDB SOAR's Today room: a live, configurable grid where
 * every widget is one query. Nothing is hardcoded, so a fresh instance opens on
 * the onboarding state rather than on figures nobody chose.
 *
 * What matters here is the promises the room makes about a person's layout: a
 * suggestion is a proposal until it is saved, editing is a mode you enter
 * deliberately, and clearing asks first.
 */
test.describe("Dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("greets the operator and says where the figures come from", async ({ page }) => {
    await expect(page.getByText("Today · PMS")).toBeVisible();
    await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening)/ })).toBeVisible();
    await expect(page.getByText(/Every figure shows the query behind it/)).toBeVisible();
  });

  test("opens on the onboarding state when nothing has been built yet", async ({ page }) => {
    await expect(page.getByRole("heading", { name: /No widgets on the pms dashboard yet/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Suggest from my pms data/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "+ Add a widget" })).toBeVisible();
  });

  test("offers no layout controls until there is a layout", async ({ page }) => {
    // With nothing on the grid, Refresh and Edit layout have nothing to act on
    // and the empty state is the single entry point — no duplicate calls to action.
    await expect(page.getByRole("button", { name: "Refresh" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Edit layout" })).toHaveCount(0);
  });

  test("never shows the assistant's token usage", async ({ page }) => {
    // The one deliberate divergence from SOAR's room.
    await expect(page.getByText(/\btokens?\b/i)).toHaveCount(0);
  });

  test.describe("adding a widget", () => {
    test("builds a one-query number and puts it on the grid", async ({ page }) => {
      await page.getByRole("button", { name: "+ Add a widget" }).click();

      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await dialog.getByRole("tab", { name: "Simple (one query)" }).click();
      await dialog.locator("#w-title").fill("Occupied Properties");
      await dialog.locator("#w-sql").fill("SELECT COUNT(*) AS v FROM pms.properties");
      await dialog.getByRole("button", { name: "Preview" }).click();
      await dialog.getByRole("button", { name: "Add widget" }).click();

      await expect(page.getByRole("heading", { name: "Occupied Properties" })).toBeVisible();
      // The figure comes from the query, not from anything the page assumed.
      await expect(page.locator(".wg-kpi-value")).toBeVisible();
    });

    test("refuses a widget with no query rather than adding an empty card", async ({ page }) => {
      await page.getByRole("button", { name: "+ Add a widget" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("tab", { name: "Simple (one query)" }).click();
      await dialog.locator("#w-title").fill("Nothing");
      await dialog.getByRole("button", { name: "Add widget" }).click();

      await expect(dialog.getByText("Add a query.")).toBeVisible();
      await expect(dialog).toBeVisible();
    });

    test("refuses a mini-report that was never built", async ({ page }) => {
      await page.getByRole("button", { name: "+ Add a widget" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.locator("#w-title").fill("Scorecard");
      await dialog.getByRole("button", { name: "Add widget" }).click();

      await expect(dialog.getByText(/Build the widget first/)).toBeVisible();
    });

    test("the quick-add tab targets a module rather than a free-text type", async ({ page }) => {
      await page.getByRole("button", { name: "+ Add a widget" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("tab", { name: "Quick-add form" }).click();

      await expect(dialog.locator("#w-ns")).toHaveValue("pms");
      await dialog.locator("#w-formtype").selectOption("properties");
      // The preview is the ACTUAL card, so what you approve is what you get.
      await expect(dialog.getByRole("button", { name: /New Property/ })).toBeVisible();
    });
  });

  test.describe("with a layout", () => {
    test.beforeEach(async ({ page }) => {
      await page.getByRole("button", { name: "+ Add a widget" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("tab", { name: "Simple (one query)" }).click();
      await dialog.locator("#w-title").fill("Properties by Status");
      await dialog.locator("#w-kind").selectOption("bar");
      await dialog
        .locator("textarea.we-sql")
        .fill("SELECT status, COUNT(*) AS v FROM pms.properties GROUP BY status");
      await dialog.getByRole("button", { name: "Add widget" }).click();
      await expect(page.getByRole("heading", { name: "Properties by Status" })).toBeVisible();
    });

    test("shows the toolbar once there is something to act on", async ({ page }) => {
      await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Edit layout" })).toBeVisible();
      await expect(page.getByRole("button", { name: /Suggest widgets/ })).toBeVisible();
    });

    test("carries the query behind every figure", async ({ page }) => {
      // The room's claim is that you can check where a number came from.
      await expect(page.locator(".wg-receipt").first()).toBeVisible();
    });

    test("keeps edit and remove out of the way until Edit layout is pressed", async ({ page }) => {
      await expect(page.getByRole("button", { name: "Remove" })).toHaveCount(0);
      await page.getByRole("button", { name: "Edit layout" }).click();
      await expect(page.getByRole("button", { name: "Remove" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Done" })).toBeVisible();
    });

    test("removes a widget", async ({ page }) => {
      await page.getByRole("button", { name: "Edit layout" }).click();
      await page.getByRole("button", { name: "Remove" }).click();
      await expect(page.getByRole("heading", { name: "Properties by Status" })).toHaveCount(0);
      await expect(page.getByRole("heading", { name: /No widgets/ })).toBeVisible();
    });

    test("asks before clearing the whole dashboard", async ({ page }) => {
      await page.getByRole("button", { name: "Edit layout" }).click();
      await page.getByRole("button", { name: "Clear dashboard" }).click();

      await expect(page.getByText(/Clear the pms dashboard\?/)).toBeVisible();
      await page.getByRole("button", { name: "Cancel" }).click();
      // Cancelling leaves the layout exactly as it was.
      await expect(page.getByRole("heading", { name: "Properties by Status" })).toBeVisible();
    });

    test("clears when confirmed", async ({ page }) => {
      await page.getByRole("button", { name: "Edit layout" }).click();
      await page.getByRole("button", { name: "Clear dashboard" }).click();
      await page.getByRole("button", { name: "Clear", exact: true }).click();
      await expect(page.getByRole("heading", { name: /No widgets/ })).toBeVisible();
    });

    test("rearranging never transforms a card mid-drag", async ({ page }) => {
      // Add a second widget so there is something to reorder.
      await page.getByRole("button", { name: "+ Add widget" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("tab", { name: "Simple (one query)" }).click();
      await dialog.locator("#w-title").fill("Second Widget");
      await dialog.locator("#w-sql").fill("SELECT COUNT(*) AS v FROM pms.owners");
      await dialog.getByRole("button", { name: "Add widget" }).click();
      await expect(page.getByRole("heading", { name: "Second Widget" })).toBeVisible();

      await page.getByRole("button", { name: "Edit layout" }).click();
      await expect(page.locator(".bento-slot")).toHaveCount(2);

      /**
       * A real drag fires `dragover` continuously, and it was every one of those
       * running the settle animation that made the grid flicker and pushed cards
       * off their slots. Playwright's mouse does not drive HTML5 drag, and by the
       * time a drag has ENDED the last run has tidied up — so the events are
       * dispatched directly and the grid is sampled WHILE the drag is live.
       */
      const result = await page.locator(".bento").evaluate(async (grid) => {
        const el = grid as HTMLElement;
        const cards = () => Array.from(el.querySelectorAll<HTMLElement>("[data-flip]"));
        // The draggable is the card itself, not the slot wrapping it.
        const source = cards()[0].querySelector(".wg") ?? cards()[0];
        const target = cards()[1].getBoundingClientRect();
        const fire = (node: Element, type: string, x?: number, y?: number) => {
          const ev = new Event(type, { bubbles: true, cancelable: true }) as MouseEvent & {
            clientX: number;
            clientY: number;
            dataTransfer: unknown;
          };
          Object.defineProperty(ev, "clientX", { value: x ?? 0 });
          Object.defineProperty(ev, "clientY", { value: y ?? 0 });
          Object.defineProperty(ev, "dataTransfer", { value: { setData() {}, getData: () => "" } });
          node.dispatchEvent(ev);
        };

        const before = cards().map((c) => c.dataset.flip).join("|");
        fire(source, "dragstart");
        let transformed = 0;
        // Sweep across the second card, sampling between moves.
        for (let i = 0; i <= 30; i++) {
          const x = target.left + (target.width * i) / 30;
          const y = target.top + target.height / 2;
          fire(el, "dragover", x, y);
          await new Promise((r) => requestAnimationFrame(() => r(null)));
          for (const c of cards()) {
            if (c.dataset.dragging === "true") continue;
            if (c.style.transform) transformed++;
          }
        }
        const after = cards().map((c) => c.dataset.flip).join("|");
        fire(el, "dragend");
        return { transformed, reordered: before !== after };
      });

      // While the pointer is still moving, the reflow IS the preview. Any
      // transform here is the settle animation firing at the wrong time.
      // If the drag never reached the handler the rest asserts nothing.
      expect(result.reordered, "the synthetic drag did not reorder anything").toBe(true);
      expect(result.transformed, "cards were transformed while the drag was still moving").toBe(0);

      // And nothing is lost or left behind once it settles.
      await page.waitForTimeout(400);
      await expect(page.getByRole("heading", { name: "Second Widget" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Properties by Status" })).toBeVisible();
      const leftover = await page
        .locator(".bento")
        .evaluate((g) =>
          Array.from(g.querySelectorAll<HTMLElement>("[data-flip]")).filter(
            (c) => c.style.transform
          ).length
        );
      expect(leftover, "a card was left mid-tween").toBe(0);
    });

    test("a card can be moved in EITHER direction, and lands where it is dropped", async ({
      page,
    }) => {
      // A real dashboard: mixed widths over more than one row, which is what
      // Suggest builds and where reordering used to go wrong.
      for (const [title, span] of [
        ["Kpi One", "3"], ["Kpi Two", "3"], ["Kpi Three", "3"], ["Chart Wide", "6"],
      ] as const) {
        await page.getByRole("button", { name: "+ Add widget" }).click();
        const d = page.getByRole("dialog");
        await d.getByRole("tab", { name: "Simple (one query)" }).click();
        await d.locator("#w-title").fill(title);
        await d.locator("#w-span").selectOption(span);
        await d.locator("#w-sql").fill("SELECT COUNT(*) AS v FROM pms.properties");
        await d.getByRole("button", { name: "Add widget" }).click();
        await expect(page.getByRole("heading", { name: title })).toBeVisible();
      }
      await page.getByRole("button", { name: "Edit layout" }).click();

      const order = () =>
        page
          .locator(".bento")
          .evaluate((g) => Array.from(g.querySelectorAll(".wg-title")).map((n) => n.textContent));

      /** Drop the card at `from` on the given half of the card at `to`. */
      async function move(from: number, to: number, side: "left" | "right") {
        const before = await order();
        const moved = before[from];
        const anchorName = before[to];
        const dst = page.locator(".bento-slot").nth(to);
        const box = (await dst.boundingBox())!;
        await page.locator(".bento-slot").nth(from).locator(".wg").dragTo(dst, {
          targetPosition: {
            x: side === "left" ? box.width * 0.2 : box.width * 0.8,
            y: box.height / 2,
          },
        });
        await page.waitForTimeout(200);
        const after = await order();
        return { got: after.indexOf(moved), anchor: after.indexOf(anchorName) };
      }

      // Rightward moved a card one slot and stopped: the hit test was strict
      // reading order against each card's top EDGE, so every card in the next
      // row claimed "insert before me" and pinned it at the end of its own row.
      for (const [from, to] of [
        [0, 4], [0, 2], [1, 3],
      ] as const) {
        const r = await move(from, to, "right");
        expect(r.got, `moving ${from} right of ${to}`).toBe(r.anchor + 1);
      }

      for (const [from, to] of [
        [4, 0], [3, 1], [4, 2],
      ] as const) {
        const r = await move(from, to, "left");
        expect(r.got, `moving ${from} left of ${to}`).toBe(r.anchor - 1);
      }
    });

    test("survives a reload — the layout is stored, not held in the tab", async ({ page }) => {
      await page.reload();
      await expect(page.getByRole("heading", { name: "Properties by Status" })).toBeVisible();
    });
  });

  test.describe("describing a whole layout", () => {
    test("builds several widgets from one plain-English brief", async ({ page }) => {
      await scriptLayout(page);
      await page.getByRole("button", { name: /New layout/ }).first().click();

      const dialog = page.getByRole("dialog");
      await dialog.locator("#w-layout").fill("a delinquency view");
      await dialog.getByRole("button", { name: /Build layout/ }).click();

      // The preview is the real grid, so what you approve is what you get.
      await expect(dialog.getByRole("heading", { name: "Overdue Rent" })).toBeVisible();
      await expect(dialog.getByRole("heading", { name: "Arrears by Region" })).toBeVisible();
      await expect(dialog.getByText(/2 widgets/)).toBeVisible();
    });

    test("writes nothing until Replace or Add is chosen", async ({ page }) => {
      await scriptLayout(page);
      await page.getByRole("button", { name: /New layout/ }).first().click();
      const dialog = page.getByRole("dialog");
      await dialog.locator("#w-layout").fill("a delinquency view");
      await dialog.getByRole("button", { name: /Build layout/ }).click();
      await expect(dialog.getByRole("heading", { name: "Overdue Rent" })).toBeVisible();

      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(page.getByRole("heading", { name: /No widgets/ })).toBeVisible();
    });

    test("replaces the dashboard", async ({ page }) => {
      await scriptLayout(page);
      await page.getByRole("button", { name: /New layout/ }).first().click();
      const dialog = page.getByRole("dialog");
      await dialog.locator("#w-layout").fill("a delinquency view");
      await dialog.getByRole("button", { name: /Build layout/ }).click();
      await dialog.getByRole("button", { name: "Replace my dashboard" }).click();

      await expect(page.getByRole("heading", { name: "Overdue Rent" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Arrears by Region" })).toBeVisible();
    });

    test("offers Replace and Add as separate answers", async ({ page }) => {
      // "Yes" means two different things for a whole layout, so it is two buttons.
      await scriptLayout(page);
      await page.getByRole("button", { name: /New layout/ }).first().click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByRole("button", { name: "Replace my dashboard" })).toBeDisabled();
      await expect(dialog.getByRole("button", { name: "Add to my dashboard" })).toBeDisabled();

      await dialog.locator("#w-layout").fill("a delinquency view");
      await dialog.getByRole("button", { name: /Build layout/ }).click();
      await expect(dialog.getByRole("button", { name: "Replace my dashboard" })).toBeEnabled();
      await expect(dialog.getByRole("button", { name: "Add to my dashboard" })).toBeEnabled();
    });

    test("adding keeps what is already there", async ({ page }) => {
      // Build one widget by hand first.
      await page.getByRole("button", { name: "+ Add a widget" }).click();
      let dialog = page.getByRole("dialog");
      await dialog.getByRole("tab", { name: "Simple (one query)" }).click();
      await dialog.locator("#w-title").fill("Kept Widget");
      await dialog.locator("#w-sql").fill("SELECT COUNT(*) AS v FROM pms.properties");
      await dialog.getByRole("button", { name: "Add widget" }).click();
      await expect(page.getByRole("heading", { name: "Kept Widget" })).toBeVisible();

      await scriptLayout(page);
      await page.getByRole("button", { name: /New layout/ }).first().click();
      dialog = page.getByRole("dialog");
      await dialog.locator("#w-layout").fill("a delinquency view");
      await dialog.getByRole("button", { name: /Build layout/ }).click();
      await dialog.getByRole("button", { name: "Add to my dashboard" }).click();

      await expect(page.getByRole("heading", { name: "Overdue Rent" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Kept Widget" })).toBeVisible();
    });

    test("leaves no reasoning trail once the layout has landed", async ({ page }) => {
      await scriptLayout(page);
      await page.getByRole("button", { name: /New layout/ }).first().click();
      const dialog = page.getByRole("dialog");
      await dialog.locator("#w-layout").fill("a delinquency view");
      await dialog.getByRole("button", { name: /Build layout/ }).click();
      await expect(dialog.getByRole("heading", { name: "Overdue Rent" })).toBeVisible();

      // The trace and its token count are progress, not a result.
      await expect(page.getByText(/tokens?/i)).toHaveCount(0);
      await expect(page.getByText("Reasoned through it")).toHaveCount(0);
    });

    test("is its own action beside Edit layout, not a tab inside Add widget", async ({ page }) => {
      await page.getByRole("button", { name: "+ Add a widget" }).click();
      const dialog = page.getByRole("dialog");
      // Adding one widget and describing a whole dashboard are different jobs.
      await expect(dialog.getByRole("tab", { name: /Whole layout/ })).toHaveCount(0);
      await expect(dialog.getByRole("tab")).toHaveCount(3);
      await dialog.getByRole("button", { name: "Cancel" }).click();
    });

    test("sits in the toolbar once there is a layout to sit beside", async ({ page }) => {
      await scriptLayout(page);
      await page.getByRole("button", { name: /New layout/ }).first().click();
      await page.getByRole("dialog").locator("#w-layout").fill("a delinquency view");
      await page.getByRole("dialog").getByRole("button", { name: /Build layout/ }).click();
      await page.getByRole("button", { name: "Replace my dashboard" }).click();
      await expect(page.getByRole("heading", { name: "Overdue Rent" })).toBeVisible();

      const toolbar = page.locator(".bento-toolbar");
      await expect(toolbar.getByRole("button", { name: /New layout/ })).toBeVisible();
      await expect(toolbar.getByRole("button", { name: "Edit layout" })).toBeVisible();
    });

  });
});

test.describe("Greeting", () => {
  // The browser is pinned to UTC by playwright.config.ts, so a `Z` time is also
  // the local hour the greeting reads.
  const cases = [
    { at: "2026-08-24T08:00:00Z", says: "Good morning" },
    { at: "2026-08-24T11:59:00Z", says: "Good morning" },
    { at: "2026-08-24T12:00:00Z", says: "Good afternoon" },
    { at: "2026-08-24T15:59:00Z", says: "Good afternoon" },
    { at: "2026-08-24T16:00:00Z", says: "Good evening" },
    // Half past five is the evening. Reported as a bug when it was not.
    { at: "2026-08-24T17:30:00Z", says: "Good evening" },
    { at: "2026-08-24T23:59:00Z", says: "Good evening" },
  ] as const;

  for (const { at, says } of cases) {
    test(`${at.slice(11, 16)} reads as “${says}”`, async ({ page }) => {
      await page.clock.setFixedTime(new Date(at));
      await page.goto("/");

      await expect(page.getByRole("heading", { name: says })).toBeVisible();
    });
  }
});
