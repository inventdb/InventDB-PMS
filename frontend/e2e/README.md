# End-to-end tests

135 Playwright tests covering the PMS UI. They run against the Vite dev server
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
| `navigation.spec.ts` | All 14 sidebar destinations, active state, history, unmatched routes |
| `dashboard.spec.ts` | Eight stat tiles, four charts, empty and error branches |
| `entity-list.spec.ts` | All ten modules; table rendering, badges, refs, search, sort |
| `entity-crud.spec.ts` | Create / edit / delete, payload coercion, modal behaviour |
| `reports.spec.ts` | Gallery, parameter seeding, render, refresh, iframe sandbox |
| `workflows.spec.ts` | Workflow cards, plan steps, run timeline, empty states |
| `settings.spec.ts` | Account, connection, theme, password change, sign-out |
| `errors.spec.ts` | 401 auto-logout, 5xx surfaces, network failure, recovery |
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
