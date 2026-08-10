import type { Page, Route } from "@playwright/test";

import { backendResponse } from "./contract";
import {
  AUTH_TOKEN,
  AUTH_USER,
  DASHBOARD_CHARTS,
  DASHBOARD_SUMMARY,
  ENTITY_KEYS,
  HEALTH,
  OCCUPANCY,
  PNL,
  RENEWALS,
  RENT_ROLL,
  REPORT_DETAILS,
  REPORT_TEMPLATES,
  WORKFLOWS,
  WORKFLOW_RUNS,
  WORK_ORDERS_REPORT,
  reportHtml,
  type Rec,
  type Store,
} from "./data";

/**
 * A single handler owns every `/api/**` call and routes internally.
 *
 * One broad route rather than a dozen narrow ones is deliberate: Playwright
 * matches handlers in reverse registration order, so with many overlapping
 * patterns the effective order becomes hard to reason about. With one handler
 * installed here, a `page.route()` a test registers later always wins, which
 * is exactly the override semantics the specs want.
 *
 * Writes mutate the per-test `store`, so a create really does show up in the
 * list refetch that React Query fires afterwards — the assertions exercise the
 * full round trip rather than just the outgoing request.
 */
export interface MockOptions {
  /** Delay every API response by this many ms, to catch loading states. */
  latencyMs?: number;
}

const RESERVED = new Set(["q", "limit", "offset", "order_by", "order_dir"]);

/** The real backend's `/api/meta/entities` body — see ./contract.ts. */
const META_ENTITIES = backendResponse("meta-entities");

/**
 * Matches only same-origin calls whose path starts at `/api/`.
 *
 * The obvious glob, `** /api/** `, is wrong under Vite: the dev server serves
 * source files at their real paths, so `src/api/client.ts` and
 * `src/api/hooks.ts` match it too. Intercepting those hands the browser JSON
 * where it expects a module, and the app never boots.
 */
const API_ROUTE = /^https?:\/\/[^/]+\/api\//;

function json(route: Route, body: unknown, status = 200) {
  // Every failure the backend returns carries `ok: false` alongside `error` —
  // its ApiError/HTTPException handlers both build that envelope (see
  // backend/app/main.py). Adding it here rather than at each call site keeps
  // the mock honest without a dozen edits; `contract.spec.ts` checks it.
  const payload =
    status >= 400 && body !== null && typeof body === "object" && !Array.isArray(body)
      ? { ok: false, ...(body as Record<string, unknown>) }
      : body;

  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(payload),
  });
}

function compare(a: unknown, b: unknown): number {
  const an = typeof a === "number" ? a : Number(a);
  const bn = typeof b === "number" ? b : Number(b);
  if (Number.isFinite(an) && Number.isFinite(bn) && String(a).trim() !== "" && String(b).trim() !== "") {
    return an - bn;
  }
  return String(a ?? "").localeCompare(String(b ?? ""));
}

/** Mirrors the list/search/sort semantics of backend/app/routers/resources.py. */
export function listResponse(rows: Rec[], url: URL) {
  const params = url.searchParams;
  const q = params.get("q");
  const orderBy = params.get("order_by");
  const desc = (params.get("order_dir") ?? "asc").toLowerCase() === "desc";
  const limit = Math.max(1, Math.min(Number(params.get("limit") ?? 500) || 500, 5000));
  const offset = Math.max(0, Number(params.get("offset") ?? 0) || 0);

  let out = [...rows];

  for (const [key, value] of params) {
    if (RESERVED.has(key) || !value) continue;
    out = out.filter((r) => String(r[key] ?? "") === value);
  }

  if (q) {
    const needle = q.toLowerCase();
    out = out.filter((r) =>
      Object.entries(r).some(
        ([k, v]) => !k.startsWith("_") && String(v ?? "").toLowerCase().includes(needle)
      )
    );
  }

  if (orderBy) {
    out.sort((a, b) => compare(a[orderBy], b[orderBy]) * (desc ? -1 : 1));
  }

  return { items: out.slice(offset, offset + limit), total: out.length, limit, offset };
}

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-new-${idCounter}`;
}

export async function installMockApi(
  page: Page,
  store: Store,
  options: MockOptions = {}
): Promise<void> {
  // index.html pulls Poppins from Google Fonts. Serving an empty stylesheet
  // keeps the suite offline-capable and removes a slow third-party dependency
  // without the console noise an abort leaves behind; the app falls back to
  // its system stack, which no assertion depends on.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) =>
    route.fulfill({ status: 200, contentType: "text/css", body: "" })
  );

  await page.route(API_ROUTE, async (route) => {
    if (options.latencyMs) {
      await new Promise((resolve) => setTimeout(resolve, options.latencyMs));
    }

    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const segments = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
    const [head, ...rest] = segments;

    let body: Record<string, unknown> = {};
    if (method !== "GET" && method !== "DELETE") {
      try {
        body = (request.postDataJSON() ?? {}) as Record<string, unknown>;
      } catch {
        body = {};
      }
    }

    // ---- /api/health ------------------------------------------------------
    if (head === "health") return json(route, HEALTH);

    // ---- /api/auth/* ------------------------------------------------------
    if (head === "auth") {
      const action = rest[0];
      if (action === "login") {
        const username = String(body.username ?? "");
        const password = String(body.password ?? "");
        if (!username || !password) {
          return json(route, { error: "username and password are required" }, 400);
        }
        if (password !== "correct-horse") {
          return json(route, { error: "Invalid username or password" }, 401);
        }
        return json(route, {
          ok: true,
          token: AUTH_TOKEN,
          user: { ...AUTH_USER, username },
        });
      }
      if (action === "me") return json(route, AUTH_USER);
      if (action === "change-password") {
        if (body.current_password !== "correct-horse") {
          return json(route, { error: "Current password is incorrect" }, 400);
        }
        return json(route, { ok: true });
      }
      if (action === "forgot-password") return json(route, { ok: true });
      if (action === "health") return json(route, { ok: true, inventdb: HEALTH });
      return json(route, { error: "Not found" }, 404);
    }

    // ---- /api/dashboard/* -------------------------------------------------
    if (head === "dashboard") {
      if (rest[0] === "summary") return json(route, DASHBOARD_SUMMARY);
      if (rest[0] === "charts") return json(route, DASHBOARD_CHARTS);
      return json(route, { error: "Not found" }, 404);
    }

    // ---- /api/reports/* ---------------------------------------------------
    if (head === "reports") {
      if (rest[0] === "templates" && rest.length === 1) {
        return json(route, { templates: REPORT_TEMPLATES, count: REPORT_TEMPLATES.length });
      }
      if (rest[0] === "templates" && rest.length === 2) {
        const detail = REPORT_DETAILS[rest[1]];
        return detail
          ? json(route, detail)
          : json(route, { error: `No report ${rest[1]}` }, 404);
      }
      if (rest[0] === "templates" && rest[2] === "render") {
        const detail = REPORT_DETAILS[rest[1]] as { name?: string } | undefined;
        if (!detail) return json(route, { error: `No report ${rest[1]}` }, 404);
        return json(route, {
          html: reportHtml(String(detail.name)),
          meta: { elapsed_ms: 128, mode: "sql", bytes: 512 },
        });
      }
      if (rest[0] === "pnl") return json(route, PNL);
      if (rest[0] === "occupancy") return json(route, OCCUPANCY);
      if (rest[0] === "work-orders") return json(route, WORK_ORDERS_REPORT);
      if (rest[0] === "cashflow") return json(route, { cashflow: DASHBOARD_CHARTS.cashflow });
      if (rest[0] === "rent-roll") return json(route, RENT_ROLL);
      if (rest[0] === "renewals") return json(route, RENEWALS);
      return json(route, { error: "Not found" }, 404);
    }

    // ---- /api/workflows/* -------------------------------------------------
    if (head === "workflows") {
      if (rest.length === 0) return json(route, { workflows: WORKFLOWS });
      if (rest[0] === "runs") return json(route, { runs: WORKFLOW_RUNS });
      const wf = WORKFLOWS.find((w) => w._id === rest[0]);
      return wf ? json(route, wf) : json(route, { error: "Not found" }, 404);
    }

    // ---- /api/meta/* ------------------------------------------------------
    if (head === "meta") {
      // Served from the backend's own captured response rather than rebuilt
      // from ENTITY_KEYS: the hand-written version returned only `{name, key}`
      // and had been missing `label`, `label_plural`, `search_fields` and
      // `order_by` for as long as it existed, which nothing noticed because
      // the app reads its entity list from src/config/entities.ts instead.
      if (rest[0] === "entities") return json(route, META_ENTITIES);
      return json(route, { types: [] });
    }

    // ---- /api/<entity>[/<id>] --------------------------------------------
    const rows = store[head];
    if (!rows) return json(route, { error: `Unknown entity "${head}"` }, 404);
    const keyField = ENTITY_KEYS[head];
    const recordId = rest[0];

    if (method === "GET" && !recordId) {
      return json(route, listResponse(rows, url));
    }

    if (method === "GET" && recordId) {
      const found = rows.find((r) => r._id === recordId);
      return found ? json(route, found) : json(route, { error: "Not found" }, 404);
    }

    if (method === "POST") {
      const clean: Rec = { _id: nextId(head) };
      for (const [k, v] of Object.entries(body)) {
        if (!k.startsWith("_")) clean[k] = v;
      }
      if (!clean[keyField]) clean[keyField] = `${head.slice(0, 2).toUpperCase()}-${idCounter}`;
      rows.push(clean);
      return json(route, clean, 201);
    }

    if (method === "PUT" && recordId) {
      const index = rows.findIndex((r) => r._id === recordId);
      if (index === -1) return json(route, { error: "Not found" }, 404);
      const merged: Rec = { ...rows[index] };
      for (const [k, v] of Object.entries(body)) {
        if (!k.startsWith("_")) merged[k] = v;
      }
      rows[index] = merged;
      return json(route, merged);
    }

    if (method === "DELETE" && recordId) {
      const index = rows.findIndex((r) => r._id === recordId);
      if (index === -1) return json(route, { error: "Not found" }, 404);
      rows.splice(index, 1);
      return json(route, { ok: true, id: recordId });
    }

    return json(route, { error: "Not found" }, 404);
  });
}
