import { expect, test } from "./fixtures";

/**
 * An import must outlive the room that started it.
 *
 * The run used to be owned by the Import page's component state, so leaving the
 * room unmounted it: the batches already sent were real records, the rest were
 * abandoned mid-flight, and the room you came back to was empty. A partial
 * import with nothing to show for it is the worst of both — hence these.
 */

/** 1,200 rows -> three batches of 500/500/200, so there is a middle to leave in. */
function bigCsv(): Buffer {
  const lines = ["Property ID,Property Name,City"];
  for (let i = 0; i < 1200; i++) {
    lines.push(`PR-${9000 + i},Property ${i},City ${i}`);
  }
  return Buffer.from(lines.join("\n"));
}

test("an import keeps going while you browse other modules", async ({ page }) => {
  test.setTimeout(180_000);

  const batches: number[] = [];
  await page.route("**/api/import/**", async (route) => {
    const body = route.request().postDataJSON() as { rows?: unknown[] };
    batches.push(body?.rows?.length ?? 0);
    // Slow enough that navigation lands mid-run.
    await new Promise((r) => setTimeout(r, 1500));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, created: body?.rows?.length ?? 0 }),
    });
  });

  await page.goto("/import");
  await page.locator("input[type=file]").setInputFiles({
    name: "properties.csv",
    mimeType: "text/csv",
    buffer: bigCsv(),
  });
  await page.locator(".import-actions .btn-primary").click();
  await expect(page.locator(".import-running")).toBeVisible({ timeout: 20_000 });
  console.log("started, batches so far:", batches.length);

  // Leave the room mid-import — the bug.
  await page.getByRole("link", { name: "Properties" }).click();
  await expect(page).toHaveURL(/properties/);
  const duringAway = batches.length;
  console.log("navigated away after", duringAway, "batch(es)");

  // It must keep writing while we are elsewhere.
  await expect
    .poll(() => batches.length, { timeout: 30_000 })
    .toBeGreaterThan(duringAway);
  console.log("kept going while away — batches now:", batches.length);

  // Come back: the room must show the run, not an empty dropzone.
  await page.getByRole("link", { name: "Import" }).click();
  await expect(page).toHaveURL(/import/);
  // The room is code-split; wait for the chunk to render before counting.
  await expect(page.locator("h2", { hasText: "Import" })).toBeVisible({ timeout: 20_000 });
  const dropzones = await page.locator(".dropzone").count();
  const progress = await page.locator(".import-running").count();
  console.log("back on /import — dropzone:", dropzones, "progress:", progress);
  expect(progress).toBe(1);

  // And it finishes.
  await expect(page.locator(".import-result")).toBeVisible({ timeout: 60_000 });
  console.log("result   :", JSON.stringify((await page.locator(".import-result").innerText()).split("\n").map((x) => x.trim()).filter(Boolean).join(" | ")));
  console.log("batches  :", JSON.stringify(batches), "total", batches.reduce((a, b) => a + b, 0));
  await page.screenshot({ path: "test-results/import-resumed.png", fullPage: true });
});

test("a finished import announces itself from another module", async ({ page }) => {
  test.setTimeout(180_000);
  await page.route("**/api/import/**", async (route) => {
    await new Promise((r) => setTimeout(r, 1200));
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.goto("/import");
  await page.locator("input[type=file]").setInputFiles({
    name: "properties.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Matter ID,Client Name\nMT-1,A\nMT-2,B"),
  });
  await page.locator(".import-actions .btn-primary").click();
  await page.getByRole("link", { name: "Owners" }).click();
  await expect(page).toHaveURL(/owners/);

  // The toast provider sits above the router, so this should still arrive.
  await expect(page.locator(".toast")).toBeVisible({ timeout: 30_000 });
  console.log("toast on /owners:", JSON.stringify(await page.locator(".toast").innerText()));
});
