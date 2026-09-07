# Report caching & freshness

How the Reports section decides when to re-render a report, what that costs,
and how to change it.

---

## Background: why caching exists here at all

The PMS does not compute reports. It lists the report templates saved on the
InventDB instance and asks InventDB to render them:

```
POST /api/report-templates/<id>/render
```

InventDB's report engine **re-executes the template's SQL on every call**. That
is the expensive step — a heavy report can take seconds regardless of anything
the PMS does. Round trips are not the problem (~90 ms to the instance); the
query pass is.

So the only lever the PMS has is *how often it asks*.

---

## Current behaviour (shipped)

Rendered output is cached per **(report, parameter set)** and never expires on
its own.

| What you do | What happens |
|---|---|
| Open a report the first time | Renders — you wait for InventDB |
| Switch to another report and back | **Instant** — served from cache |
| Return to Reports later in the session | **Instant** — served from cache |
| Click **Refresh** | Re-renders against live data |
| Reload the page | Cache is gone; renders fresh |

Set in [`frontend/src/api/hooks.ts`](../frontend/src/api/hooks.ts), in
`useRenderReport`:

```ts
staleTime: Infinity,      // never goes stale on its own
gcTime: 30 * 60_000,      // dropped after 30 min unused
```

Two neighbouring caches, same file:

- `useReportTemplate` — a report's definition and parameter pickers,
  `staleTime: 5 * 60_000`.
- `useReportTemplates` — the gallery list, on the client default of 15 s.

### What this means for changes made in SOAR

| Change in SOAR | Appears in the PMS |
|---|---|
| **New report added** | Automatically, next time you open the Reports section |
| **Report renamed / re-described** | Automatically, same as above |
| **Report deleted** | Automatically, same as above |
| **Report's SQL or layout edited** | **Only after Refresh** |
| **A report's parameters changed** | Within 5 minutes, or on reload |
| **Underlying data changed** (new transactions, etc.) | **Only after Refresh** |

The gallery updates on its own because the Reports page remounts on navigation
and its list is stale after 15 s. The *rendered sheet* does not, because that
is the expensive thing being cached.

The page says so plainly — "A report is rendered when you first open it and
kept until you Refresh" — and each sheet is stamped with the time its figures
were produced (`Rendered 16:04:22 · 63 ms`) so a cached result is never
mistaken for a live one.

> Note: `refetchOnWindowFocus` is off globally. Keeping SOAR in one tab and the
> PMS in another and switching between them refreshes nothing — you need to
> navigate within the app, or reload.

---

## The alternative: stale-while-revalidate

Opening a report shows the cached sheet **immediately**, then re-renders in the
background and swaps the fresh figures in when they land.

| What you do | What happens |
|---|---|
| Open a report the first time | Renders — you wait |
| Switch to another report and back | **Instant**, then quietly updates |
| Edit the report in SOAR, then revisit | **Picked up automatically** — no button |
| Click **Refresh** | Same thing, on demand |

Nobody ever waits on a cached report, and edits propagate without anyone
knowing to press anything.

### How to switch

Two values in [`frontend/src/api/hooks.ts`](../frontend/src/api/hooks.ts):

```ts
// useRenderReport
staleTime: Infinity,   →   staleTime: 0,

// useReportTemplate
staleTime: 5 * 60_000, →   staleTime: 0,
```

Then update the subtitle in
[`frontend/src/pages/Reports.tsx`](../frontend/src/pages/Reports.tsx) so the
copy stays true — something like *"Opening one shows the last result straight
away, then re-queries it against live data."*

Nothing else needs touching. The UI was built to work under either policy: the
loading state keys off `isPending` (no data at all) rather than `isFetching`,
so a background re-render leaves the sheet on screen — dimmed, with
"Re-querying against live data…" beneath it — instead of replacing it with a
spinner. This was verified end-to-end over CDP: with SWR enabled, a report
edited upstream was picked up on the next visit, and the previous sheet stayed
visible throughout.

### Trade-offs

| | Cached until Refresh (current) | Stale-while-revalidate |
|---|---|---|
| Wait on revisit | None | None |
| Edits in SOAR | Need Refresh | Appear on next visit |
| Data freshness | As of the timestamp shown | Refreshed on every visit |
| Load on InventDB | One render per report per session | **One render per visit** |
| Risk of acting on stale figures | Real — mitigated by the timestamp | Low |

The whole cost of SWR is the last row: every visit to a report triggers a full
SQL pass on the instance. That is load, not latency — the user never waits for
it — but on a busy instance with heavy reports it is real work. If several
people leave the Reports page open and click around, InventDB does that work
repeatedly.

### Middle ground

A finite `staleTime` gets most of both:

```ts
staleTime: 60_000,   // instant for a minute, then revalidates on next open
```

Reports opened moments apart cost nothing; anything older revalidates. Pick the
window from how quickly an edit needs to surface — 60 s is a reasonable start.

---

## If a first render is slow

Caching cannot help the first one. That time is inside InventDB:

- `meta.elapsed_ms` on the render response is the engine's own timing — check
  it before blaming the PMS.
- The template's SQL and its `max_rows` are the levers, both edited in SOAR.
- `INVENTDB_TIMEOUT` (backend `.env`, default **30 s**) caps how long the PMS
  waits. A report that legitimately runs longer returns a 502 — raise it there,
  and note the axios client allows 60 s
  ([`frontend/src/api/client.ts`](../frontend/src/api/client.ts)).
