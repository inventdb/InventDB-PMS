import { test as base, expect, type Locator, type Page } from "@playwright/test";

import { createStore, type Store } from "./data";
import { installMockApi } from "./mock-api";

export * from "./data";
export { listResponse } from "./mock-api";

interface Options {
  /** Set true in a spec to skip mocking and hit the real Flask API. */
  liveApi: boolean;
  /** Artificial per-request latency, for asserting on loading states. */
  apiLatency: number;
}

interface Fixtures {
  /** The mutable dataset backing the mocked API for this test. */
  store: Store;
  /** Installs the mock routes. Auto-applied; specs never request it. */
  mockApi: void;
}

/**
 * The mock installation is an `auto` fixture, so it runs before every test
 * body and the routes are in place ahead of the first navigation — a spec just
 * imports `test` from here and gets a signed-in app on a working fake API.
 *
 * `store` deliberately does not depend on `page`; making it do so would put
 * `page -> store -> page` in the graph once `mockApi` needs both.
 */
export const test = base.extend<Options & Fixtures>({
  liveApi: [false, { option: true }],
  apiLatency: [0, { option: true }],

  store: async ({}, use) => {
    await use(createStore());
  },

  mockApi: [
    async ({ page, store, liveApi, apiLatency }, use) => {
      if (!liveApi) {
        await installMockApi(page, store, { latencyMs: apiLatency });
      }
      await use();
    },
    { auto: true },
  ],
});

export { expect };

// ---- Locator helpers ------------------------------------------------------

/**
 * A field inside EntityForm by its underlying field name.
 *
 * `getByLabel` is awkward here: required labels render as `Street*`, so exact
 * matching misses them, and loose matching makes `Phone` ambiguous with
 * `Emergency Phone`. EntityForm gives every control `id="f-<name>"`, which is
 * both unambiguous and stable.
 */
export function field(page: Page, name: string): Locator {
  return page.locator(`#f-${name}`);
}

/** A report parameter input, which ParamField ids as `p-<name>`. */
export function reportParam(page: Page, name: string): Locator {
  return page.locator(`#p-${name}`);
}

/** The open Modal / ConfirmDialog. */
export function dialog(page: Page): Locator {
  return page.getByRole("dialog");
}

/** A data-table row containing the given text. */
export function row(page: Page, text: string): Locator {
  return page.locator("table.data tbody tr").filter({ hasText: text });
}

/** Every data row currently rendered. */
export function rows(page: Page): Locator {
  return page.locator("table.data tbody tr");
}

/** Sign in through the real form (used by specs that start signed out). */
export async function signIn(page: Page, username = "e2e.manager"): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill("correct-horse");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("http://localhost:5173/");
}

/** Wipe the signed-in storage state for a spec that must start anonymous. */
export const signedOut = { storageState: { cookies: [], origins: [] } };
