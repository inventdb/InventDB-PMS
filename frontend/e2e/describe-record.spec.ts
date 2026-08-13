import {
  DESCRIBE_FENCED_STEPS,
  DESCRIBE_PROPERTY_STEPS,
  DESCRIBE_UNRESOLVED_STEPS,
  MODULES,
  dialog,
  expect,
  field,
  row,
  sseBody,
  test,
} from "./fixtures";

/**
 * "Describe it" — plain English into a New <type> form.
 *
 * The model is scripted here, which is the point: what these specs protect is
 * everything *around* the model. A description is only useful if what comes
 * back is translated honestly into the form — a lowercase choice snapped to a
 * real one, an owner named rather than keyed resolved against the records on
 * file, "$2,100" landing as a number — and if the parts that could not be
 * translated are said out loud instead of dropped.
 *
 * The other promise is a boundary: the assistant fills, the manager saves.
 * Nothing here writes a record on its own.
 */

/** Fulfil `/api/analyze/chat/stream` with a scripted turn. */
async function scriptFill(
  page: import("@playwright/test").Page,
  steps: Record<string, unknown>[]
) {
  await page.route(/\/api\/analyze\/chat\/stream/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: sseBody(steps),
    })
  );
}

async function describeIt(page: import("@playwright/test").Page, text: string) {
  await page.locator("#describe-record").fill(text);
  await page.getByRole("button", { name: "Fill the form" }).click();
}

test.describe("Describing a record", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/properties");
    await page.getByRole("button", { name: "New Property" }).click();
    await expect(dialog(page)).toBeVisible();
  });

  test("fills the form, then leaves saving to the manager", async ({ page }) => {
    await scriptFill(page, DESCRIBE_PROPERTY_STEPS);
    await describeIt(
      page,
      "Vacant 3-bed townhouse at 44 Cedar Lane, Richmond VA. Harbourline own it, market rent $2,100."
    );

    await expect(field(page, "street")).toHaveValue("44 Cedar Lane");
    await expect(field(page, "city")).toHaveValue("Richmond");
    // A lowercase word snaps to the module's own choice list…
    await expect(field(page, "type")).toHaveValue("Townhouse");
    await expect(field(page, "status")).toHaveValue("Vacant");
    // …an owner named rather than keyed resolves against the owners on file…
    await expect(field(page, "owner_id")).toHaveValue("O-001");
    // …money and separators survive the trip as plain numbers…
    await expect(field(page, "market_rent")).toHaveValue("2100");
    await expect(field(page, "sqft")).toHaveValue("1650");
    // …and a date written out in words becomes one the control accepts.
    await expect(field(page, "acq_date")).toHaveValue("2026-03-04");

    await expect(page.locator(".dsc-filled")).toContainText("Filled 14 fields");
    await expect(page.locator(".dsc-filled")).toContainText("Check them before saving");
    await expect(page.locator(".field.is-ai")).toHaveCount(14);

    // Nothing has been written yet — the record exists only once Save is pressed.
    const [request] = await Promise.all([
      page.waitForRequest(
        (r) => r.method() === "POST" && r.url().endsWith("/api/properties")
      ),
      dialog(page).getByRole("button", { name: "Save" }).click(),
    ]);

    // `not_a_field` is in the scripted answer and absent here: a key the module
    // never declared is an invention, and inventing a column writes a record
    // nothing else in the portfolio can read.
    expect(request.postDataJSON()).toEqual({
      street: "44 Cedar Lane",
      city: "Richmond",
      state: "VA",
      zip: "23220",
      region: "Mid-Atlantic",
      owner_id: "O-001",
      type: "Townhouse",
      status: "Vacant",
      beds: 3,
      baths: 2,
      sqft: 1650,
      year_built: 1998,
      market_rent: 2100,
      acq_date: "2026-03-04",
    });

    await expect(page.locator(".toast.success")).toHaveText("Property created");
    await expect(row(page, "44 Cedar Lane")).toContainText("$2,100");
  });

  test("says what it could not place rather than dropping it", async ({ page }) => {
    await scriptFill(page, DESCRIBE_UNRESOLVED_STEPS);
    await describeIt(page, "8 Kestrel Way, under offer, Wexford Partners are the owners.");

    await expect(field(page, "street")).toHaveValue("8 Kestrel Way");

    // A status that isn't a status and an owner nobody has on file are left for
    // a human — and named, so the manager knows the description was only
    // partly transcribed.
    const notes = page.locator(".dsc-unresolved");
    await expect(notes).toHaveCount(2);
    await expect(notes.filter({ hasText: "Under offer" })).toContainText(
      "isn’t one of the Status choices"
    );
    await expect(notes.filter({ hasText: "Wexford Partners" })).toContainText(
      "No owner on file matches"
    );
    await expect(field(page, "status")).toHaveValue("");
    await expect(field(page, "owner_id")).toHaveValue("");
  });

  test("reads the answer even when it arrives wrapped in prose", async ({ page }) => {
    // The prompt asks for bare JSON; a model that adds a sentence and a code
    // fence has still done the work, and throwing it away would read as
    // flakiness for a reason nobody can see or fix.
    await scriptFill(page, DESCRIBE_FENCED_STEPS);
    await describeIt(page, "3 Beacon Row in Norfolk.");

    await expect(field(page, "street")).toHaveValue("3 Beacon Row");
    await expect(field(page, "city")).toHaveValue("Norfolk");
  });

  test("keeps what was typed by hand", async ({ page }) => {
    await scriptFill(page, DESCRIBE_PROPERTY_STEPS);
    await field(page, "garage").fill("Single, detached");
    await describeIt(page, "Vacant townhouse at 44 Cedar Lane.");

    await expect(field(page, "street")).toHaveValue("44 Cedar Lane");
    // The description never mentioned the garage, so the fill has no business
    // clearing it.
    await expect(field(page, "garage")).toHaveValue("Single, detached");
  });

  test("a second description refines the form instead of restarting it", async ({
    page,
  }) => {
    await scriptFill(page, DESCRIBE_PROPERTY_STEPS);
    await describeIt(page, "Vacant townhouse at 44 Cedar Lane.");
    await expect(field(page, "street")).toHaveValue("44 Cedar Lane");

    const [request] = await Promise.all([
      page.waitForRequest(
        (r) => r.method() === "POST" && r.url().includes("/analyze/chat/stream")
      ),
      describeIt(page, "Actually it's a condo."),
    ]);

    const prompt = String(request.postDataJSON().messages[0].content);
    expect(prompt).toContain("ALREADY ON THE FORM");
    expect(prompt).toContain("44 Cedar Lane");
    expect(prompt).toContain("Actually it's a condo.");
    // A one-shot fill must not inherit whatever was last asked in Analyze.
    expect(request.postDataJSON().conversation_mode).toBe(false);
  });

  test("clears a field's mark once it has been looked at", async ({ page }) => {
    await scriptFill(page, DESCRIBE_PROPERTY_STEPS);
    await describeIt(page, "Vacant townhouse at 44 Cedar Lane.");
    await expect(page.locator(".field.is-ai")).toHaveCount(14);

    await field(page, "city").fill("Petersburg");
    // Editing the value IS the review the mark was asking for.
    await expect(page.locator(".field.is-ai")).toHaveCount(13);
  });

  test("reports a model outage as an outage", async ({ page }) => {
    await scriptFill(page, [
      { type: "error", content: "Anthropic credits are exhausted." },
    ]);
    await describeIt(page, "Vacant townhouse at 44 Cedar Lane.");

    await expect(page.locator(".dsc-error")).toContainText("temporarily unavailable");
    await expect(page.locator(".dsc-error")).toContainText("Your data is unaffected");
    await expect(field(page, "street")).toHaveValue("");
  });

  test("will not run on an empty description", async ({ page }) => {
    await expect(page.getByRole("button", { name: "Fill the form" })).toBeDisabled();
    await page.locator("#describe-record").fill("A townhouse");
    await expect(page.getByRole("button", { name: "Fill the form" })).toBeEnabled();
  });
});

test.describe("Where it is offered", () => {
  // One test per module rather than one loop over all ten: every module gets
  // to fail by name, and none of them waits behind the other nine.
  for (const module of MODULES) {
    test(`a new ${module.label.toLowerCase()} can be described`, async ({ page }) => {
      await page.goto(`/${module.name}`);
      await page.getByRole("button", { name: `New ${module.label}` }).click();

      const composer = dialog(page).locator(".dsc");
      await expect(composer).toBeVisible();
      await expect(composer.getByRole("heading", { name: "Describe it" })).toBeVisible();

      // Each module carries its own example: a shared one would tell nobody how
      // much detail is worth typing about *this* kind of record.
      const placeholder = await page
        .locator("#describe-record")
        .getAttribute("placeholder");
      expect(placeholder?.length ?? 0).toBeGreaterThan(30);
    });
  }

  test("editing an existing record keeps the form it has always had", async ({
    page,
  }) => {
    await page.goto("/properties");
    await row(page, "12 Marine Drive").getByRole("button", { name: "Edit" }).click();

    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).locator(".dsc")).toHaveCount(0);
    await expect(field(page, "street")).toHaveValue("12 Marine Drive");
  });
});
