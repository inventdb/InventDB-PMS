import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests for the InventDB PMS frontend.
 *
 * The suite runs against the Vite dev server with the `/api` surface mocked in
 * the browser (see `e2e/fixtures/mock-api.ts`), so it needs neither the Flask
 * backend nor a live InventDB instance. That keeps it deterministic and lets
 * it assert on failure paths — 401s, 500s, empty datasets — that a live
 * instance would never produce on demand.
 *
 * `locale` and `timezoneId` are pinned because the app formats currency and
 * dates with `toLocaleString`, so the rendered text is machine-dependent
 * otherwise.
 */
export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],

  timeout: 45_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: "http://localhost:5173",
    locale: "en-US",
    timezoneId: "UTC",
    // In this Playwright version reducedMotion is a context option rather
    // than a top-level one. The app honours prefers-reduced-motion, so this
    // removes the route-change animation from under the click assertions.
    contextOptions: { reducedMotion: "reduce" },
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    // Produces e2e/.auth/user.json, the signed-in storage state every other
    // project starts from.
    { name: "setup", testMatch: /auth\.setup\.ts/ },

    {
      name: "chromium",
      testIgnore: /mobile\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        storageState: "e2e/.auth/user.json",
      },
      dependencies: ["setup"],
    },

    // The layout collapses at 960px, where `.login-hero` and `.hero-copy`
    // become `display: contents` and the sidebar turns into a drawer. That is
    // distinct behaviour, so it gets its own project rather than a resize.
    {
      name: "mobile",
      testMatch: /mobile\.spec\.ts/,
      use: { ...devices["Pixel 7"], storageState: "e2e/.auth/user.json" },
      dependencies: ["setup"],
    },
  ],

  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
