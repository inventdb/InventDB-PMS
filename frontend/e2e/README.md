# End-to-end tests

408 Playwright tests covering the PMS UI. They run against the Vite dev server
with the `/api` surface mocked **in the browser**, so they need neither the
Flask backend nor a live InventDB instance.

```bash
npm run test:e2e          # headless, all projects
npm run test:e2e:ui       # UI mode — watch, time-travel, pick locators
npm run test:e2e:headed   # desktop project, visible browser
npm run test:e2e:mobile   # Pixel 7 project only
npm run test:e2e:report   # open the last HTML report
npm run typecheck:e2e     # type-check the suite (not part of `npm run build`)
```

## Layout

| File | Covers |
| --- | --- |
| `auth.setup.ts` | Signs in once; every project starts from the saved state |
| `login.spec.ts` | Login form, validation, error paths, route protection |
| `navigation.spec.ts` | All 16 sidebar destinations, active state, history, unmatched routes |
| `dashboard.spec.ts` | Eight stat tiles, four charts, empty and error branches |
| `entity-list.spec.ts` | All ten modules; table rendering, badges, refs, search, sort |
| `entity-crud.spec.ts` | Create / edit / delete, payload coercion, modal behaviour |
| `reports.spec.ts` | Gallery, parameter seeding, render, refresh, iframe sandbox |
| `workflows.spec.ts` | Workflow cards, plan steps, empty states; the detail view (runs, versions, activate/pause/run); and the editor — reordering, removing, schedule and trigger-setting edits, validation errors, and preserving step kinds it has no form for |
| `report-studio.spec.ts` | Renaming in place, edit-by-instruction over a real SSE body, snapshot promotion, delete, history and share. |
| `analyze.spec.ts` | The AI canvas: a scripted agent stream, the work rail, the query receipt, chart vs grid, a change proposal awaiting approval, thread retention |
| `files.spec.ts` | The drive: type-then-folder tree, folder subtree scoping, deep links, name/text search, preview, extracted text, version restore, batched folder delete |
| `connection.spec.ts` | Editing the InventDB base URL: the confirm, the refusals, and the sign-out that follows a reconnect. |
| `settings.spec.ts` | Account, connection, theme, password change, sign-out |
| `errors.spec.ts` | 401 auto-logout, 5xx surfaces, network failure, recovery |
| `table-scroll.spec.ts` | The sideways-scroll rail — when it appears, and that the thumb reports and reaches the whole range by drag, click and keyboard — and the locked column heads, including the fill layout that makes them possible |
| `mobile.spec.ts` | Drawer, login reflow, horizontal-overflow guard (Pixel 7) |

## How the mocking works

`fixtures/mock-api.ts` installs **one** route handler for every same-origin
`/api/` call and dispatches internally. Writes mutate a per-test copy of
`fixtures/data.ts`, so a create really does appear in the list refetch React
Query fires afterwards — the assertions exercise the round trip, not just the
outgoing request.

Because Playwright matches handlers in reverse registration order, a
`page.route()` a spec registers later always wins. That is how the failure-path
tests override a single endpoint:

```ts
await page.route("**/api/dashboard/summary", (route) =>
  route.fulfill({ status: 500, contentType: "application/json",
                  body: JSON.stringify({ error: "InventDB is unreachable" }) })
);
```

Call `route.fallback()` inside an override to defer to the mock for the
requests you did not mean to change (e.g. overriding only `POST`).

## Running against the real backend

Set `liveApi` to skip mocking for a spec, then point Vite at a running Flask
API (`VITE_PROXY_TARGET`, default `http://localhost:8000`):

```ts
test.use({ liveApi: true });
```

That path needs a configured `backend/.env` and a reachable InventDB instance,
so keep it to a separate smoke spec rather than the main suite.
