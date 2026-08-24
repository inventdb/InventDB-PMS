import type { Page } from "@playwright/test";

import { dialog, expect, test } from "./fixtures";

/**
 * Theming of the native controls.
 *
 * A `<select>`'s menu is drawn by the operating system, not by our stylesheet,
 * and it only follows the app's theme if the colours are stated on the OPTIONS
 * as well as on the control. An `<option>` with no background of its own falls
 * back to the platform's field colour — which is how a dark page opens a white
 * dropdown, and it is invisible in a screenshot of the closed control.
 *
 * So this asserts the invariant rather than the appearance: nowhere in the app
 * may a select, option or optgroup be left transparent, in either theme. The
 * bug it guards is a real one — for a while exactly one dropdown in the app set
 * its option colours and fourteen did not.
 */

/**
 * Choose the theme the way a returning user does.
 *
 * Not by stamping `data-theme` — index.html paints that from storage before
 * first render and ThemeContext writes it again on mount, so a stamp set from
 * the test is overwritten before the first assertion runs.
 */
async function usingTheme(page: Page, theme: "light" | "dark") {
  await page.addInitScript((t: string) => localStorage.setItem("pms.theme", t), theme);
}

interface Painted {
  /** `<select> › <node>`, so a failure names the control that regressed. */
  where: string;
  bg: string;
  alpha: number;
  color: string;
  checked: boolean;
}

/** Every select on the page, with the computed colours of its own options. */
async function dropdownColours(page: Page): Promise<Painted[]> {
  return page.evaluate(() => {
    const rgba = (value: string) => {
      const parts = value.match(/[\d.]+/g)?.map(Number) ?? [];
      return { rgb: `rgb(${parts.slice(0, 3).join(", ")})`, alpha: parts[3] ?? 1 };
    };
    return Array.from(document.querySelectorAll("select")).flatMap((select) => {
      const name = select.id || select.className || "(unclassed)";
      const nodes: Element[] = [
        select,
        ...Array.from(select.querySelectorAll("option, optgroup")),
      ];
      return nodes.map((node) => {
        const cs = getComputedStyle(node);
        const bg = rgba(cs.backgroundColor);
        return {
          where: `${name} › ${node.tagName.toLowerCase()}`,
          bg: bg.rgb,
          alpha: bg.alpha,
          color: rgba(cs.color).rgb,
          checked: node instanceof HTMLOptionElement && node.selected,
        };
      });
    });
  });
}

/** Surfaces that carry a dropdown, and how to get one on screen. */
const SURFACES: { name: string; open: (page: Page) => Promise<void> }[] = [
  {
    name: "a New <type> form",
    open: async (page) => {
      await page.goto("/properties");
      await page.getByRole("button", { name: "New Property" }).click();
      await expect(dialog(page)).toBeVisible();
    },
  },
  {
    name: "the Analyze ask bar",
    open: async (page) => {
      await page.goto("/analyze");
      await expect(page.locator(".an-ask .an-model select")).toBeVisible();
    },
  },
  {
    // A second module, because the dropdowns here are a different mix — a
    // reference picker and two choice lists rather than one model picker.
    name: "the Accounting form",
    open: async (page) => {
      await page.goto("/transactions");
      await page.getByRole("button", { name: "New Transaction" }).click();
      await expect(dialog(page).locator("select").first()).toBeVisible();
    },
  },
];

for (const theme of ["light", "dark"] as const) {
  const ink = theme === "dark" ? "rgb(243, 233, 250)" : "rgb(32, 30, 33)";

  test.describe(`${theme} theme`, () => {
    for (const surface of SURFACES) {
      test(`every dropdown on ${surface.name} is painted`, async ({ page }) => {
        await usingTheme(page, theme);
        await surface.open(page);

        const nodes = await dropdownColours(page);
        expect(nodes.length).toBeGreaterThan(0);

        for (const node of nodes) {
          // Transparent is the whole bug: it hands the menu to the OS palette.
          expect(node.alpha, `${node.where} background is transparent`).toBe(1);
          // An optgroup's label is deliberately quieter than its options, so
          // only the ink of the rows themselves is pinned.
          if (!node.where.endsWith("optgroup")) {
            expect(node.color, `${node.where} ink`).toBe(ink);
          }
        }
      });
    }

    test("a form dropdown uses the theme's own surfaces", async ({ page }) => {
      await usingTheme(page, theme);
      await page.goto("/properties");
      await page.getByRole("button", { name: "New Property" }).click();

      const nodes = (await dropdownColours(page)).filter((n) =>
        n.where.startsWith("f-status")
      );
      const surface = theme === "dark" ? "rgb(39, 36, 41)" : "rgb(255, 255, 255)";
      const chosen = theme === "dark" ? "rgb(48, 44, 51)" : "rgb(243, 233, 250)";

      for (const node of nodes) {
        expect(node.bg, node.where).toBe(node.checked ? chosen : surface);
      }
    });
  });
}
