import { expect, test } from "./fixtures";

const card = (page: import("@playwright/test").Page, name: string) =>
  page.locator(".card-pad").filter({ hasText: name });

const dialog = (page: import("@playwright/test").Page) => page.locator(".modal");

test.describe("Workflows", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/workflows");
  });

  // =========================================================================
  // Reading what is already running
  // =========================================================================

  test("summarises workflow and run counts", async ({ page }) => {
    // Four runs, not three: the seeded maintenance-intake run counts too. Its
    // workflow is a draft and so is hidden from the list above, which is the
    // real situation a run whose definition was never activated leaves behind.
    await expect(page.locator(".count-pill")).toContainText("2 workflows · 4 runs");
  });

  test("renders a card per workflow with its trigger", async ({ page }) => {
    const scheduled = card(page, "Monthly owner statements");
    await expect(scheduled.getByRole("heading", { name: "Monthly owner statements" })).toBeVisible();
    await expect(scheduled.locator(".badge")).toHaveText("Active");
    // The cron expression is read back as a sentence — "0 6 1 * *" tells a
    // property manager nothing about when this fires.
    await expect(scheduled).toContainText("On the 1st of each month at 06:00 · Asia/Kolkata");
    await expect(scheduled).toContainText(
      "Render and email each owner their statement on the 1st."
    );

    const evented = card(page, "Emergency work order alert");
    await expect(evented.locator(".badge").first()).toHaveText("Paused");
    // Read as a sentence, not as the engine's own vocabulary — the card said
    // "event" before, which is a trigger_kind, not something a manager says.
    await expect(evented).toContainText("When a record changes");
  });

  test("shows which workflows are still rehearsing", async ({ page }) => {
    // Whether a workflow fires and whether its side effects are real are
    // separate questions, so the card answers both.
    await expect(card(page, "Emergency work order alert").locator(".badge")).toHaveText([
      "Paused",
      "Rehearsing",
    ]);
    await expect(card(page, "Monthly owner statements").locator(".badge")).toHaveText(["Active"]);
  });

  test("lays out each workflow's plan as a step timeline", async ({ page }) => {
    const steps = card(page, "Monthly owner statements").locator(".wf-step");
    await expect(steps).toHaveCount(3);
    await expect(steps.nth(0)).toContainText("Render Owner Statement");
    await expect(steps.nth(0).locator(".wf-kind")).toHaveText("render_report");
    await expect(steps.nth(0)).toContainText("Runs the saved report for each owner.");
    await expect(steps.nth(1)).toContainText("Email owners");
    await expect(steps.nth(2)).toContainText("Done");
  });

  test("marks the variables a step binds and the conditions that skip one", async ({ page }) => {
    const steps = card(page, "Emergency work order alert").locator(".wf-step");
    await expect(steps.nth(0).locator(".wf-var")).toHaveText("$urgent");
    await expect(steps.nth(1).locator(".wf-when")).toHaveText("if ${urgent}");
  });

  test("lists recent runs with their outcome and duration", async ({ page }) => {
    const scheduled = card(page, "Monthly owner statements");
    await expect(scheduled).toContainText("Recent runs");
    await expect(scheduled.getByText("succeeded")).toBeVisible();
    await expect(scheduled.getByText("failed")).toBeVisible();
    await expect(scheduled).toContainText("12.0 s");
  });

  test("a workflow that has never run still renders, without a runs section", async ({ page }) => {
    await page.route("**/api/workflows/runs", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ runs: [] }),
      })
    );
    await page.reload();

    await expect(card(page, "Monthly owner statements")).toBeVisible();
    await expect(page.locator(".wf-card-runs")).toHaveCount(0);
    await expect(page.locator(".count-pill")).toContainText("0 runs");
  });

  test("shows an empty state when the instance defines no workflows", async ({ page }) => {
    await page.route("**/api/workflows", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ workflows: [] }),
      })
    );
    await page.reload();

    await expect(page.getByRole("heading", { name: "No workflows yet" })).toBeVisible();
    // No workflow cards — but the notifications and intake panels above are
    // about runs and setup, not about workflows existing, so they stay.
    await expect(page.locator(".wf-card")).toHaveCount(0);
    // Workflows are authored in Analyze or SOAR, so the empty state points
    // there rather than offering a builder this page does not have.
    await expect(page.locator(".empty")).toContainText("Describe the automation you want in Analyze");
  });

  test("offers no way to create a workflow from this page", async ({ page }) => {
    await expect(page.getByRole("button", { name: "New workflow" })).toHaveCount(0);
  });

  test("hides drafts, so only the workflows that exist are listed", async ({ page }) => {
    // An agent-authored workflow stays `pending_approval` until someone
    // activates it, so re-asks and abandoned attempts pile up as drafts with
    // the SAME name as the real one. Listing them beside the workflow that is
    // actually running makes the page ambiguous where it must be certain.
    await page.route("**/api/workflows", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          workflows: [
            {
              _id: "wf-live",
              name: "Monthly Payment Timing Report Email",
              trigger_kind: "cron",
              trigger_spec: { expr: "0 9 10 * *", tz: "Asia/Calcutta" },
              trigger_intent: "On the 10th of every month at 9:00 AM",
              active: true,
              pending_approval: false,
              plan: [{ idx: 0, kind: "render_report", label: "Render it", narration: "" }],
            },
            {
              _id: "wf-draft",
              name: "Monthly Payment Timing Report Email",
              trigger_kind: "cron",
              trigger_spec: { expr: "0 9 10 * *", tz: "Asia/Calcutta" },
              trigger_intent: "On the 10th of every month at 9:00 AM",
              active: false,
              pending_approval: true,
              plan: [],
            },
          ],
        }),
      })
    );
    await page.reload();

    await expect(page.locator(".wf-card")).toHaveCount(1);
    await expect(page.locator(".wf-card .badge").first()).toHaveText("Active");
    await expect(page.locator(".count-pill")).toContainText("1 workflow ·");
    // No unasked-for draft on the page.
    await expect(page.getByText("Draft")).toHaveCount(0);
  });

  test("an unactivated workflow is hidden until it is asked for by name", async ({ page }) => {
    // wf-3 is in the list the mock serves, but it has never been activated.
    await expect(card(page, "Monthly payment timing report")).toHaveCount(0);
    await expect(page.locator(".count-pill")).toContainText("2 workflows");
  });

  test("a draft asked for by name is shown, opened and can be activated", async ({ page }) => {
    // "Open in Workflows" from an Analyze thread links to `?id=`. A workflow
    // the assistant just built has not been activated, so the draft filter
    // would otherwise hide it from the very page the link points at.
    await page.goto("/workflows?id=wf-3");

    // Opened on arrival — activating is the reason the link exists.
    const modal = page.locator(".modal");
    await expect(modal).toBeVisible();
    // The name leads the console as the rename control, not as separate chrome:
    // drawn twice, only one of the two would actually change anything.
    await expect(modal.locator(".wf-rename")).toHaveText("Monthly payment timing report");
    await expect(modal.locator(".wf-state .badge").first()).toHaveText("Never activated");

    await modal.getByRole("button", { name: "Activate" }).click();
    await expect(page.locator(".toast")).toContainText("fires on its trigger");
    await expect(modal.locator(".wf-state .badge").first()).toHaveText("Active");

    // And it stays on the page once it is real — now on its own merits.
    await page.locator(".modal-head .btn-icon").click();
    await expect(card(page, "Monthly payment timing report")).toBeVisible();
    await expect(page.locator(".count-pill")).toContainText("3 workflows");
  });

  test("only the named draft is un-hidden, not every draft", async ({ page }) => {
    await page.route("**/api/workflows", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          workflows: [
            { _id: "wf-a", name: "Asked for", trigger_kind: "manual", pending_approval: true, plan: [] },
            { _id: "wf-b", name: "Leftover", trigger_kind: "manual", pending_approval: true, plan: [] },
          ],
        }),
      })
    );
    await page.goto("/workflows?id=wf-a");

    await expect(page.locator(".wf-card")).toHaveCount(1);
    await expect(card(page, "Asked for").locator(".badge").first()).toHaveText("Draft");
    await expect(card(page, "Leftover")).toHaveCount(0);
  });

  test("shows a card's steps even when the list omits the plan", async ({ page }) => {
    // InventDB's list response does not always carry each workflow's plan. The
    // card read it straight off the list entry and told the user "No steps yet"
    // about a workflow that had run successfully twice.
    await page.route("**/api/workflows", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          workflows: [
            {
              _id: "wf-1",
              name: "Monthly owner statements",
              trigger_kind: "cron",
              trigger_spec: { expr: "0 6 1 * *", tz: "Asia/Kolkata" },
              active: true,
              pending_approval: false,
              // no `plan` key at all
            },
          ],
        }),
      })
    );
    await page.reload();

    // Filled in from the detail query, which does carry the plan.
    await expect(card(page, "Monthly owner statements").locator(".wf-step")).toHaveCount(3);
    await expect(page.getByText("No steps")).toHaveCount(0);
  });

  test("surfaces a load failure", async ({ page }) => {
    await page.route("**/api/workflows", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "SOAR automation service unavailable" }),
      })
    );
    await page.reload();

    await expect(page.locator(".alert.error")).toHaveText("SOAR automation service unavailable");
  });

  // =========================================================================
  // The detail view
  // =========================================================================

  test.describe("opening a workflow", () => {
    test.beforeEach(async ({ page }) => {
      await card(page, "Monthly owner statements").getByRole("button", { name: "Open" }).click();
    });

    test("shows the trigger as the first node of the plan", async ({ page }) => {
      const steps = dialog(page).locator(".wf-step");
      await expect(steps).toHaveCount(4);
      await expect(steps.nth(0)).toContainText("On the 1st of each month at 06:00");
      await expect(steps.nth(0).locator(".wf-kind")).toHaveText("when");
      await expect(steps.nth(1)).toContainText("Render Owner Statement");
    });

    test("states both what it does and whether it is live", async ({ page }) => {
      await expect(dialog(page).locator(".wf-state .badge")).toHaveText(["Active", "Live"]);
      await expect(dialog(page)).toContainText("Next run");
    });

    test("lists every run of that workflow only", async ({ page }) => {
      await dialog(page).getByRole("tab", { name: /Runs/ }).click();
      // wf-1 owns two of the three seeded runs.
      await expect(dialog(page).locator(".wf-run")).toHaveCount(2);
      await expect(dialog(page).locator(".wf-run").first()).toContainText("succeeded");
    });

    test("a run opens onto what it actually did", async ({ page }) => {
      await dialog(page).getByRole("tab", { name: /Runs/ }).click();
      // The failed one: a status word cannot say which step broke, or on what.
      await dialog(page).locator(".wf-run").nth(1).click();

      const timeline = dialog(page).locator(".wf-rsteps");
      // The SQL as it really ran, with its placeholders already resolved.
      await expect(timeline).toContainText("SELECT _id, rent FROM pms.leases");
      await expect(timeline).toContainText("1 row");
      await expect(timeline).toContainText("SMTP timeout");
    });

    test("keeps earlier definitions so an edit can be undone", async ({ page }) => {
      await dialog(page).getByRole("tab", { name: "History" }).click();
      await expect(dialog(page).locator(".wf-version")).toHaveCount(1);
      await expect(dialog(page).locator(".wf-version-no")).toHaveText("v1");
      await expect(dialog(page).getByRole("button", { name: /Restore/ })).toBeVisible();
    });

    test("a live workflow can be paused, and says so", async ({ page }) => {
      await dialog(page).getByRole("button", { name: "Pause" }).click();

      await expect(page.locator(".toast")).toContainText("won’t fire until you resume");
      await expect(dialog(page).locator(".wf-state .badge").first()).toHaveText("Paused");
      await expect(dialog(page).getByRole("button", { name: "Resume" })).toBeVisible();
    });

    test("running it queues a run and shows it", async ({ page }) => {
      await dialog(page).getByRole("button", { name: "Run now" }).click();

      await expect(page.locator(".toast")).toContainText("Run queued");
      // Firing switches to Runs, because the run is the thing you now want.
      await expect(dialog(page).locator(".wf-run")).toHaveCount(3);
      await expect(dialog(page).locator(".wf-run").first()).toContainText("running");
    });
  });

  test("going live changes what it sends, not whether it fires", async ({ page }) => {
    await card(page, "Emergency work order alert").getByRole("button", { name: "Open" }).click();
    await expect(dialog(page).locator(".wf-state .badge")).toHaveText(["Paused", "Rehearsing"]);
    await expect(dialog(page).getByRole("button", { name: "Take it live" })).toBeVisible();
    // While it is mocking, "Run now" would be a lie — only Rehearse is offered.
    await expect(dialog(page).getByRole("button", { name: "Run now" })).toHaveCount(0);

    await dialog(page).getByRole("button", { name: "Take it live" }).click();

    await expect(page.locator(".toast")).toContainText("can now send for real");
    // Still paused. The two axes are independent, and quietly un-pausing a
    // workflow someone had deliberately stopped — as part of a click that says
    // "take it live" — is the conflation this UI exists to avoid.
    await expect(dialog(page).locator(".wf-state .badge")).toHaveText(["Paused", "Live"]);
  });

  test("a live workflow can be put back to rehearsing", async ({ page }) => {
    // The way out of a misfire. Without it the only route back to mocked side
    // effects is to pause, edit and re-save the whole definition.
    await card(page, "Monthly owner statements").getByRole("button", { name: "Open" }).click();
    await expect(dialog(page).locator(".wf-state .badge")).toHaveText(["Active", "Live"]);

    await dialog(page).getByRole("button", { name: "Back to rehearsing" }).click();

    await expect(page.locator(".toast")).toContainText("emails, texts and record changes are mocked");
    // It keeps firing on its trigger — it just stops sending for real.
    await expect(dialog(page).locator(".wf-state .badge")).toHaveText(["Active", "Rehearsing"]);
  });

  test("rehearsing from the card never sends for real", async ({ page }) => {
    const posted: unknown[] = [];
    await page.route("**/api/workflows/*/run", async (route) => {
      posted.push(route.request().postDataJSON());
      await route.fallback();
    });

    await card(page, "Monthly owner statements").getByRole("button", { name: "Rehearse" }).click();

    await expect(page.locator(".toast")).toContainText("Rehearsing");
    // Even though this workflow is live, the list-level button forces mocking:
    // one stray click beside a dozen cards should not email every owner.
    expect(posted).toEqual([{ sandbox_override: true }]);
  });

  test("deleting asks first, then removes the card", async ({ page }) => {
    await card(page, "Emergency work order alert").getByRole("button", { name: "Open" }).click();
    await dialog(page).getByRole("button", { name: "Delete" }).click();

    await expect(page.getByText("It stops running immediately")).toBeVisible();
    await page.getByRole("button", { name: "Delete workflow" }).click();

    await expect(page.locator(".toast")).toContainText("Deleted");
    await expect(card(page, "Emergency work order alert")).toHaveCount(0);
    await expect(page.locator(".count-pill")).toContainText("1 workflow ·");
  });

  // =========================================================================
  // Authoring
  // =========================================================================

  test.describe("editing a workflow", () => {
    test("opens with the saved definition already filled in", async ({ page }) => {
      await card(page, "Monthly owner statements").getByRole("button", { name: "Edit" }).click();

      const modal = dialog(page);
      await expect(modal.locator("#wf-name")).toHaveValue("Monthly owner statements");
      await expect(modal.locator("#wf-freq")).toHaveValue("monthly");
      await expect(modal.locator("#wf-dom")).toHaveValue("1");
      await expect(modal.locator("#wf-time")).toHaveValue("06:00");
      await expect(modal.locator(".wf-step-editor")).toHaveCount(3);
      // The trigger is fixed once a plan is written against it.
      await expect(modal).toContainText("What triggers it can’t be changed");
    });

    test("edits a record-change trigger's settings without changing its kind", async ({ page }) => {
      // The trigger kind is fixed, but which records it watches is not — and
      // InventDB rejects a record_event workflow whose spec loses `ns`/`type`,
      // so those have to survive the round trip.
      await page.route("**/api/workflows", async (route) => {
        if (route.request().method() !== "GET") return route.fallback();
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            workflows: [
              {
                _id: "wf-r",
                name: "Emergency escalation",
                trigger_kind: "record_event",
                trigger_intent: "When a work order is filed",
                trigger_spec: { ns: "pms", type: "work_orders", ops: ["create"] },
                plan: [{ idx: 0, kind: "notify_user", label: "Page", narration: "", title: "T", body: "B" }],
              },
            ],
          }),
        });
      });
      await page.reload();

      let sent: { trigger_spec?: Record<string, unknown> } | null = null;
      await page.route("**/api/workflows/wf-r", async (route) => {
        if (route.request().method() !== "PUT") return route.fallback();
        sent = route.request().postDataJSON() as { trigger_spec?: Record<string, unknown> };
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ _id: "wf-r", name: "Emergency escalation" }),
        });
      });

      await card(page, "Emergency escalation").getByRole("button", { name: "Edit" }).click();
      const modal = dialog(page);
      await expect(modal.getByLabel("Watch which records")).toHaveValue("work_orders");
      await modal.getByLabel("Watch which records").selectOption("leases");
      await modal.getByLabel("On", { exact: true }).fill("create, update");
      await modal.getByRole("button", { name: "Save changes" }).click();

      await expect.poll(() => sent).not.toBeNull();
      expect(sent!.trigger_spec).toEqual({
        ns: "pms",
        type: "leases",
        ops: ["create", "update"],
      });
      expect(sent).not.toHaveProperty("trigger_kind");
    });

    test("saves a changed step and a changed schedule together", async ({ page }) => {
      let sent: Record<string, unknown> | null = null;
      await page.route("**/api/workflows/wf-1", async (route) => {
        if (route.request().method() === "PUT") {
          sent = route.request().postDataJSON() as Record<string, unknown>;
        }
        await route.fallback();
      });

      await card(page, "Monthly owner statements").getByRole("button", { name: "Edit" }).click();
      const modal = dialog(page);
      await modal.locator("#wf-dom").fill("5");
      await modal.getByRole("button", { name: "Save changes" }).click();

      await expect(dialog(page).getByRole("tab", { name: "Steps" })).toBeVisible();
      expect(sent).toMatchObject({ trigger_spec: { expr: "0 6 5 * *", tz: "Asia/Kolkata" } });
      // The plan rides along unchanged rather than being dropped.
      expect((sent as unknown as { plan: unknown[] }).plan).toHaveLength(3);
    });

    test("reorders steps", async ({ page }) => {
      let sent: { plan: { kind: string }[] } | null = null;
      await page.route("**/api/workflows/wf-1", async (route) => {
        if (route.request().method() === "PUT") {
          sent = route.request().postDataJSON() as { plan: { kind: string }[] };
        }
        await route.fallback();
      });

      await card(page, "Monthly owner statements").getByRole("button", { name: "Edit" }).click();
      const modal = dialog(page);
      await modal.getByRole("button", { name: "Move step 2 up" }).click();
      await modal.getByRole("button", { name: "Save changes" }).click();

      await expect(dialog(page).getByRole("tab", { name: "Steps" })).toBeVisible();
      expect(sent!.plan.map((s) => s.kind)).toEqual([
        "send_email",
        "render_report",
        "finish",
      ]);
      // `idx` is rewritten to match the new order, not carried over.
      expect(sent!.plan.map((s) => (s as unknown as { idx: number }).idx)).toEqual([0, 1, 2]);
    });

    test("removes a step", async ({ page }) => {
      await card(page, "Monthly owner statements").getByRole("button", { name: "Edit" }).click();
      const modal = dialog(page);
      await modal.getByRole("button", { name: "Remove step 3" }).click();
      await expect(modal.locator(".wf-step-editor")).toHaveCount(2);
      await modal.getByRole("button", { name: "Save changes" }).click();

      await expect(dialog(page).locator(".wf-step")).toHaveCount(3); // trigger + 2
    });

    test("keeps a step kind it has no form for intact", async ({ page }) => {
      // A workflow authored in SOAR can use a step this editor does not model.
      // Editing something else must not silently delete it.
      await page.route("**/api/workflows", async (route) => {
        if (route.request().method() !== "GET") return route.fallback();
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            workflows: [
              {
                _id: "wf-x",
                name: "From SOAR",
                trigger_kind: "manual",
                trigger_intent: "On demand",
                plan: [
                  { idx: 0, kind: "quantum_leap", label: "Leap", narration: "", flux: 7 },
                ],
              },
            ],
          }),
        });
      });
      await page.reload();

      let sent: { plan: Record<string, unknown>[] } | null = null;
      await page.route("**/api/workflows/wf-x", async (route) => {
        if (route.request().method() === "PUT") {
          sent = route.request().postDataJSON() as { plan: Record<string, unknown>[] };
          return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ _id: "wf-x", name: "From SOAR" }),
          });
        }
        return route.fallback();
      });

      await card(page, "From SOAR").getByRole("button", { name: "Edit" }).click();
      const modal = dialog(page);
      await expect(modal.getByLabel("Step definition")).toContainText('"flux": 7');
      await modal.locator("#wf-name").fill("From SOAR, renamed");
      await modal.getByRole("button", { name: "Save changes" }).click();

      await expect.poll(() => sent).not.toBeNull();
      expect(sent!.plan[0]).toMatchObject({ kind: "quantum_leap", flux: 7, idx: 0 });
    });
  });
});
