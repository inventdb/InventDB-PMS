import type { Page, Route } from "@playwright/test";

import { backendResponse } from "./contract";
import {
  AGENT_STEPS,
  ANALYZE_MODELS,
  ANALYZE_THREADS,
  AUTH_TOKEN,
  AUTH_USER,
  DASHBOARD_CHARTS,
  DASHBOARD_SUMMARY,
  ENTITY_KEYS,
  FILES,
  FILE_FOLDERS,
  FILE_TEXT,
  FILE_VERSIONS,
  HEALTH,
  INTAKE_RUN,
  INTAKE_RUN_STEPS,
  NOTIFICATIONS,
  OCCUPANCY,
  PNL,
  RENEWALS,
  RENT_ROLL,
  createReportStore,
  WORKFLOWS,
  WORKFLOW_DRAFT,
  WORKFLOW_RUNS,
  WORKFLOW_RUN_STEPS,
  WORKFLOW_VERSIONS,
  WORK_ORDERS_REPORT,
  reportEditSse,
  reportHtml,
  type ReportStore,
  sseBody,
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
  options: MockOptions = {},
  reports: ReportStore = createReportStore()
): Promise<void> {
  // Per-test, like the report library: repointing the app mutates it.
  // Derived from HEALTH so the two never disagree about which instance this
  // app is pointed at — they describe the same fact.
  const connection = {
    base_url: HEALTH.inventdb_base_url,
    namespace: HEALTH.namespace,
    app: "pms",
    configured_base_url: HEALTH.inventdb_base_url,
    overridden: false,
  };
  // index.html pulls Poppins from Google Fonts. Serving an empty stylesheet
  // keeps the suite offline-capable and removes a slow third-party dependency
  // without the console noise an abort leaves behind; the app falls back to
  // its system stack, which no assertion depends on.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) =>
    route.fulfill({ status: 200, contentType: "text/css", body: "" })
  );

  // Workflows live outside `store` — they are not PMS entities but records on
  // the InventDB instance — so they get their own per-test copies. Cloned
  // rather than shared, so one spec's create or delete cannot leak into the
  // next.
  // The draft rides along in the list exactly as InventDB would return it. The
  // page filters it out, so it does not disturb the counts other specs assert —
  // which is itself the point: a draft the user did not ask for is invisible.
  const workflows: Rec[] = JSON.parse(JSON.stringify([...WORKFLOWS, WORKFLOW_DRAFT]));
  const runs: Rec[] = JSON.parse(JSON.stringify(WORKFLOW_RUNS));
  const runSteps: { [runId: string]: Rec[] } = JSON.parse(
    JSON.stringify(WORKFLOW_RUN_STEPS)
  );
  const versions: { [workflowId: string]: Rec[] } = JSON.parse(
    JSON.stringify(WORKFLOW_VERSIONS)
  );
  /** Version history for one workflow, created on first use. */
  const versionsOf = (id: string): Rec[] => (versions[id] ??= []);

  // The drive, per test — uploads and deletes mutate it, so it cannot be
  // shared between specs any more than the entity store can.
  const files: Rec[] = JSON.parse(JSON.stringify(FILES));
  const fileFolders = JSON.parse(JSON.stringify(FILE_FOLDERS));
  const fileVersions: { [id: string]: Rec[] } = JSON.parse(JSON.stringify(FILE_VERSIONS));
  const fileText: { [id: string]: string } = JSON.parse(JSON.stringify(FILE_TEXT));

  // The inbox and the intake are per-test for the same reason as the workflows
  // above: a spec that approves something, or installs the intake, must not
  // leave that state behind for the next one.
  const notifications: Rec[] = JSON.parse(JSON.stringify(NOTIFICATIONS));
  runs.push(JSON.parse(JSON.stringify(INTAKE_RUN)));
  runSteps["run-intake"] = JSON.parse(JSON.stringify(INTAKE_RUN_STEPS));

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
        return json(route, { templates: reports.templates, count: reports.templates.length });
      }
      // ---- Report Studio authoring ---------------------------------------
      if (rest[0] === "snapshots" && rest.length === 1) {
        return json(route, {
          snapshots: reports.snapshots,
          count: reports.snapshots.length,
        });
      }
      if (rest[0] === "snapshots" && rest.length === 2 && method === "DELETE") {
        return json(route, { ok: true, record_id: rest[1], deleted: 2 });
      }
      if (rest[0] === "snapshots" && rest.length === 3 && method === "GET") {
        return json(route, { html: reportHtml("Rent Roll — All Properties") });
      }
      if (rest[0] === "snapshots" && rest[3] === "promote") {
        return json(route, { ok: true, id: "tpl-promoted" });
      }
      if (rest[0] === "templates" && rest.length === 2 && method === "PUT") {
        const detail = reports.details[rest[1]] as { name?: string } | undefined;
        if (detail && typeof body.name === "string") detail.name = body.name;
        const summary = reports.templates.find((t) => t.id === rest[1]);
        if (summary && typeof body.name === "string") summary.name = body.name;
        return json(route, { ok: true, id: rest[1], ...body });
      }
      if (rest[0] === "templates" && rest.length === 2 && method === "DELETE") {
        const at = reports.templates.findIndex((t) => t.id === rest[1]);
        if (at >= 0) reports.templates.splice(at, 1);
        return json(route, { ok: true, id: rest[1] });
      }
      // The edit stream, fulfilled as a real `text/event-stream` so the page's
      // own SSE parser runs — the part most likely to break.
      if (rest[0] === "templates" && rest[2] === "edit" && rest[3] === "stream") {
        const summary = reports.templates.find((t) => t.id === rest[1]);
        const next = Number(summary?.version ?? 1) + 1;
        if (summary) summary.version = next;
        return route.fulfill({
          status: 200,
          contentType: "text/event-stream",
          body: reportEditSse(String(rest[1]), next),
        });
      }
      if (rest[0] === "templates" && rest.length === 2) {
        const detail = reports.details[rest[1]];
        return detail
          ? json(route, detail)
          : json(route, { error: `No report ${rest[1]}` }, 404);
      }
      if (rest[0] === "templates" && rest[2] === "render") {
        const detail = reports.details[rest[1]] as { name?: string } | undefined;
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
    // Stateful, like the entity routes below: a workflow created or edited in
    // a spec shows up in the refetch that follows, so the assertions cover the
    // round trip rather than only the outgoing request.
    // ---- /api/notifications/* ---------------------------------------------
    // Stateful, because the behaviour worth covering is what happens *after* an
    // answer: the item flips to resolved, the badge drops, and the buttons stay
    // visible but dead. A stub that always returned the seed would show none of
    // that.
    // ---- /api/files/* -----------------------------------------------------
    // Stateful, and it really filters: the grid's scope, the search modes and
    // the delete batching are all mechanics that only show up when the mock
    // behaves like the drive rather than returning the seed every time.
    if (head === "files") {
      const [first, second, third, fourth, fifth] = rest;

      if (first === "search" && method === "POST") {
        const types = Array.isArray(body.types) ? (body.types as string[]) : null;
        const folder = typeof body.folder === "string" ? body.folder : null;
        const query = String(body.query ?? "*");
        const mode = String(body.search_type ?? "keyword");

        let matched = files.filter((f) => {
          if (types && !types.includes(String(f.record_type))) return false;
          if (folder === null) return true;
          const path = String(f.folder_path ?? "");
          // A folder selects itself and everything beneath it.
          return folder === "" ? path === "" : path === folder || path.startsWith(`${folder}/`);
        });

        if (query && query !== "*") {
          const needle = query.toLowerCase();
          matched = matched.filter((f) =>
            mode === "keyword"
              ? String(f.filename ?? "").toLowerCase().includes(needle)
              : String(f.filename ?? "").toLowerCase().includes(needle) ||
                String(fileText[String(f.attachment_id)] ?? "").toLowerCase().includes(needle)
          );
          // A ranked search carries a score and the passage that matched;
          // a name search carries neither.
          if (mode !== "keyword") {
            matched = matched.map((f) => ({
              ...f,
              score: 0.82,
              snippet: (fileText[String(f.attachment_id)] ?? "").slice(0, 90),
            }));
          }
        }

        const limit = Number(body.limit ?? 25);
        const offset = Number(body.offset ?? 0);
        return json(route, {
          results: matched.slice(offset, offset + limit),
          total_matches: matched.length,
          // The aggregation describes the whole drive, not the page — that is
          // why the tree is built from it.
          folders: fileFolders,
        });
      }

      if (first === "attach" && method === "POST") {
        // Existence is InventDB's to judge, not this layer's — the real
        // backend forwards the relink and reports whatever comes back. So an
        // id this mock does not hold still answers in the right shape.
        const target = files.find((f) => f.attachment_id === body.attachment_id);
        // `move` re-parents; `copy` leaves the original home in place.
        if (target && body.mode !== "copy") {
          target.record_type = String(body.type ?? "");
          target.record_id = String(body.record_id ?? "");
        }
        return json(route, {
          mode: body.mode ?? "move",
          parents: [
            { namespace: "pms", typeName: String(body.type ?? ""), recordId: String(body.record_id ?? "") },
          ],
        });
      }

      if (first === "bulk-delete" && method === "POST") {
        const type = String(body.type ?? "");
        const folder = typeof body.folder === "string" ? body.folder : null;
        const limit = Number(body.limit ?? 15);
        const doomed = files.filter((f) => {
          if (String(f.record_type) !== type) return false;
          if (folder === null) return true;
          const path = String(f.folder_path ?? "");
          return path === folder || path.startsWith(`${folder}/`);
        });
        const batch = doomed.slice(0, limit);
        for (const f of batch) files.splice(files.indexOf(f), 1);
        return json(route, {
          deleted: batch.length,
          skipped: 0,
          remaining: doomed.length - batch.length,
        });
      }

      const typeName = first;
      const recordId = second;
      const attachmentId = third;

      if (!attachmentId) {
        if (method === "POST") {
          const created: Rec = {
            _id: nextId("att"),
            attachment_id: nextId("att"),
            namespace: "pms",
            record_type: typeName,
            record_id: recordId,
            filename: "uploaded.pdf",
            content_type: "application/pdf",
            size_bytes: 1024,
            version: 1,
            folder_path: "",
            created_at: new Date().toISOString(),
          };
          files.push(created);
          return json(route, created, 201);
        }
        return json(route, {
          files: files.filter(
            (f) => f.record_type === typeName && f.record_id === recordId
          ),
        });
      }

      const index = files.findIndex((f) => f.attachment_id === attachmentId);
      const file = index === -1 ? undefined : files[index];

      if (fourth === "text") {
        return json(route, { text: fileText[attachmentId] ?? "" });
      }
      if (fourth === "download" || fourth === "preview" || fourth === "thumbnail") {
        // Real bytes, so the detail panel's blob handling runs for real.
        return route.fulfill({
          status: 200,
          contentType: fourth === "thumbnail" ? "image/jpeg" : String(file?.content_type ?? "application/pdf"),
          body: Buffer.from("%PDF-1.4 mock bytes"),
        });
      }
      if (fourth === "versions") {
        if (!fifth) {
          if (method === "POST") {
            const versions = (fileVersions[attachmentId] ??= []);
            const next = versions.length + 1;
            versions.unshift({
              _id: `${attachmentId}.v${next}`,
              version: next,
              filename: "uploaded.pdf",
              size: 2048,
              created_at: new Date().toISOString(),
              is_current: true,
            });
            versions.forEach((v) => (v.is_current = v.version === next));
            if (file) file.version = next;
            return json(route, { version: next }, 201);
          }
          return json(route, { versions: fileVersions[attachmentId] ?? [] });
        }
        if (rest[5] === "restore" && method === "POST") {
          const wanted = Number(fifth);
          const versions = fileVersions[attachmentId] ?? [];
          versions.forEach((v) => (v.is_current = v.version === wanted));
          if (file) file.version = wanted;
          return json(route, { version: wanted });
        }
        if (rest[5] === "download") {
          return route.fulfill({
            status: 200,
            contentType: "application/pdf",
            body: Buffer.from("%PDF-1.4 old version"),
          });
        }
      }

      if (method === "DELETE") {
        if (index === -1) return json(route, { error: "Not found" }, 404);
        files.splice(index, 1);
        return json(route, { deleted: attachmentId });
      }
      if (method === "GET") {
        return file ? json(route, file) : json(route, { error: "Not found" }, 404);
      }
      return json(route, { error: "Not found" }, 404);
    }

    if (head === "notifications") {
      const [id, action] = rest;

      if (!id) return json(route, { notifications: [...notifications] });

      const index = notifications.findIndex((n) => n._id === id);
      if (index === -1) return json(route, { error: "Not found" }, 404);
      const note = notifications[index];

      if (method === "GET" && !action) return json(route, note);

      if (action === "read" && method === "POST") {
        notifications[index] = { ...note, read_at: note.read_at ?? new Date().toISOString() };
        return json(route, { id, read_at: notifications[index].read_at });
      }

      if (action === "resolve" && method === "POST") {
        const actionId = String(body.action_id ?? "");
        if (!actionId) return json(route, { error: "action_id is required" }, 400);
        const offered = (note.actions ?? []) as { id: string; kind?: string }[];
        const chosen = offered.find((a) => a.id === actionId);
        if (!chosen) return json(route, { error: "unknown action id" }, 400);
        // The engine refuses a second answer rather than overwriting the first:
        // the run has already resumed and cannot be un-resumed.
        if (note.resolved_action) {
          return json(route, { error: "notification already resolved" }, 409);
        }
        const kind = String(chosen.kind ?? "");
        const now = new Date().toISOString();
        notifications[index] = {
          ...note,
          resolved_action: actionId,
          resolved_at: now,
          read_at: note.read_at ?? now,
          resolved_payload: body.payload ?? null,
        };
        return json(route, {
          notification_id: id,
          resolved_action: actionId,
          action_kind: kind,
          approved: kind === "approve",
          declined: kind === "decline",
          run_id: note.run_id,
          resumed: true,
        });
      }

      if (method === "DELETE" && !action) {
        notifications.splice(index, 1);
        return json(route, { deleted: id });
      }

      return json(route, { error: "Not found" }, 404);
    }

    if (head === "workflows") {
      const [first, second, third, fourth] = rest;

      if (rest.length === 0) {
        if (method === "POST") {
          // Mirrors the backend's create: it refuses an unusable draft before
          // InventDB ever sees it, and the engine — never the caller — decides
          // that a new workflow starts inactive and awaiting approval.
          if (!String(body.name ?? "").trim()) {
            return json(route, { error: "name is required" }, 400);
          }
          if (!String(body.trigger_intent ?? "").trim()) {
            return json(route, { error: "trigger_intent is required" }, 400);
          }
          const plan = Array.isArray(body.plan) ? body.plan : [];
          if (!plan.length) {
            return json(route, { error: "plan must contain at least one step" }, 400);
          }
          const created = {
            ...body,
            _id: nextId("wf"),
            active: false,
            pending_approval: true,
            sandbox: body.sandbox !== false,
            version: 1,
            created_at: new Date().toISOString(),
          } as Rec;
          workflows.push(created);
          return json(route, created, 201);
        }
        return json(route, { workflows });
      }

      if (first === "runs") {
        if (!second) return json(route, { runs });
        if (third === "cancel" && method === "POST") {
          const i = runs.findIndex((r) => r._id === second);
          if (i === -1) return json(route, { error: "Not found" }, 404);
          // The engine refuses a run that has already finished.
          if (!/succeed|success|complete|fail|timed|cancel/i.test(String(runs[i].status ?? ""))) {
            runs[i] = {
              ...runs[i],
              status: "cancelled",
              ended_at: new Date().toISOString(),
            };
            return json(route, { cancelled: second });
          }
          return json(route, { error: "run is not cancellable in its current state" }, 400);
        }
        const found = runs.find((r) => r._id === second);
        // `{run, steps}`, matching InventDB — the run alone would render a
        // timeline with nothing on it.
        return found
          ? json(route, { run: found, steps: runSteps[second] ?? [] })
          : json(route, { error: "Not found" }, 404);
      }

      const index = workflows.findIndex((w) => w._id === first);
      if (index === -1) return json(route, { error: "Not found" }, 404);
      const wf = workflows[index];

      if (second === "runs") {
        return json(route, { runs: runs.filter((r) => r.workflow_id === first) });
      }

      if (second === "versions") {
        if (method === "GET" && !third) {
          return json(route, {
            versions: versionsOf(first).map((v) => ({ ...v, workflow_id: first })),
          });
        }
        // .../versions — clear the whole history, keeping what is in force.
        if (method === "DELETE" && !third) {
          const kept = versionsOf(first).filter((v) => Number(v.version) === Number(wf.version));
          versions[first] = kept;
          return json(route, { cleared: first });
        }
        if (third) {
          const snapshot = versionsOf(first).find((v) => String(v.version) === third);
          if (!snapshot) return json(route, { error: "Not found" }, 404);

          // .../versions/<n> — the full frozen definition.
          if (method === "GET") {
            return json(route, { ...snapshot, workflow_id: first });
          }
          // .../versions/<n> — drop one from the history.
          if (method === "DELETE") {
            if (Number(snapshot.version) === Number(wf.version)) {
              return json(route, { error: "cannot delete the current version" }, 400);
            }
            versions[first] = versionsOf(first).filter((v) => String(v.version) !== third);
            return json(route, { deleted: third });
          }
          // .../versions/<n>/rollback
          if (method === "POST" && fourth === "rollback") {
            const restored = {
              ...wf,
              ...snapshot,
              _id: first,
              version: Number(wf.version ?? 1) + 1,
            } as Rec;
            workflows[index] = restored;
            return json(route, restored);
          }
        }
        return json(route, { error: "Not found" }, 404);
      }

      // .../fix-from-run/<run_id> — a revised plan, saved nowhere.
      if (second === "fix-from-run" && method === "POST") {
        return json(route, {
          revised: {
            name: wf.name,
            trigger_intent: wf.trigger_intent,
            plan: [
              {
                idx: 0,
                kind: "sql_query",
                label: "Find overdue leases",
                narration: "Rewritten to filter on status rather than a date string.",
                sql: "SELECT _id FROM pms.leases WHERE status = 'overdue'",
              },
            ],
          },
          diagnostics: { error: "SMTP timeout" },
        });
      }

      if (second === "run" && method === "POST") {
        const started = new Date().toISOString();
        runs.unshift({
          _id: nextId("run"),
          workflow_id: first,
          status: "running",
          started_at: started,
          sandbox: body.sandbox_override === true || wf.sandbox === true,
        });
        // The engine queues an event; the run itself starts afterwards. The
        // response names the event, and `status` is the queue's, not the run's.
        return json(
          route,
          { event_id: nextId("ev"), workflow_id: first, status: "pending" },
          202
        );
      }

      if ((second === "activate" || second === "pause" || second === "resume") && method === "POST") {
        const updated: Rec = { ...wf };
        if (second === "pause") updated.active = false;
        else {
          updated.active = true;
          updated.pending_approval = false;
        }
        // Sandbox rides along on activate only, and only when asked for —
        // pause/resume must never silently un-mock a workflow.
        if (second === "activate" && typeof body.sandbox === "boolean") {
          updated.sandbox = body.sandbox;
        }
        workflows[index] = updated;
        return json(route, updated);
      }

      if (!second && method === "PUT") {
        const merged: Rec = { ...wf, ...body };
        // A definition edit mints a version; a bare rename does not.
        if (body.plan || body.trigger_spec || body.trigger_intent) {
          versionsOf(first).unshift({
            _id: `${first}.v${wf.version ?? 1}`,
            version: Number(wf.version ?? 1),
            name: String(wf.name ?? ""),
            trigger_intent: wf.trigger_intent,
            plan: wf.plan,
            created_at: String(wf.created_at ?? ""),
          });
          merged.version = Number(wf.version ?? 1) + 1;
        }
        workflows[index] = merged;
        return json(route, merged);
      }

      if (!second && method === "DELETE") {
        workflows.splice(index, 1);
        return json(route, { deleted: first });
      }

      if (!second && method === "GET") return json(route, wf);

      return json(route, { error: "Not found" }, 404);
    }

    // ---- /api/analyze/* ---------------------------------------------------
    if (head === "analyze") {
      const action = rest.join("/");

      // The agent turn. Fulfilled as a real `text/event-stream` body so the
      // page's own SSE parser runs — a JSON stub would skip the code most
      // likely to break. A spec overrides this route to script a different turn.
      if (action === "chat/stream") {
        return route.fulfill({
          status: 200,
          contentType: "text/event-stream",
          headers: { "cache-control": "no-cache", "x-accel-buffering": "no" },
          body: sseBody(AGENT_STEPS),
        });
      }

      if (action === "models") return json(route, { models: ANALYZE_MODELS });
      if (action === "config") {
        return json(route, {
          configured: true,
          model: "claude-sonnet-5",
          modelFamily: "claude",
        });
      }
      if (action === "websearch/status") {
        return json(route, { enabled: false, consented: false });
      }
      if (rest[0] === "websearch") return json(route, { ok: true });
      if (rest[0] === "threads") {
        if (method === "GET") return json(route, { threads: ANALYZE_THREADS });
        return json(route, { ok: true });
      }
      if (action === "sql") {
        return json(route, { rows: [{ city: "Richmond" }], metrics: { count: 1 } });
      }
      if (rest[0] === "records") {
        return json(route, { ok: true, recordId: nextId("vendors"), type: rest[1] });
      }
      if (action === "change-set/apply") {
        return json(route, { ok: true, results: [{ ok: true, recordId: "v-9" }] });
      }
      return json(route, { error: "Not found" }, 404);
    }

    // ---- /api/settings/* --------------------------------------------------
    if (head === "settings" && rest[0] === "connection") {
      if (method === "PUT") {
        const next = String(body.base_url ?? "");
        if (!/^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)/.test(next)) {
          return json(route, { error: "Use https:// — over plain http your InventDB password would cross the network unencrypted" }, 400);
        }
        if (next.includes("unreachable")) {
          return json(route, { error: `Couldn't reach an InventDB instance at ${next}` }, 400);
        }
        connection.base_url = next;
        connection.overridden = next !== connection.configured_base_url;
        return json(route, { ...connection, changed: true, sign_out_required: true });
      }
      if (method === "DELETE") {
        const changed = connection.overridden;
        connection.base_url = connection.configured_base_url;
        connection.overridden = false;
        return json(route, { ...connection, changed, ...(changed ? { sign_out_required: true } : {}) });
      }
      return json(route, connection);
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
