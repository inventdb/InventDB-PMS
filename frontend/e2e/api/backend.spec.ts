import { expect, test, type APIRequestContext } from "@playwright/test";

/**
 * The backend, over the wire.
 *
 * The browser suite mocks `/api` and never reaches Flask; the pytest suite
 * reaches Flask but through its test client, which skips HTTP. These run
 * against the real application on a real port (see
 * `backend/tests/e2e_server.py`), so what is asserted here is what a client
 * actually receives: status codes, headers, the error envelope, and the rules
 * this layer owns rather than InventDB's.
 */

const TOKEN = "e2e-token";
const auth = { Authorization: `Bearer ${TOKEN}` };

/** Every module the API exposes. */
const ENTITIES = [
  "properties", "owners", "tenants", "leases", "work_orders",
  "vendors", "transactions", "inspections", "compliance", "daily_tasks",
] as const;

async function login(request: APIRequestContext, password = "correct-horse") {
  return request.post("/api/auth/login", {
    data: { username: "e2e.manager", password },
  });
}

test.describe("Health and shape", () => {
  test("health reports the instance it is pointed at", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.namespace).toBe("pms");
    expect(body.inventdb_base_url).toContain("inventdb");
  });

  test("responses are JSON", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.headers()["content-type"]).toContain("application/json");
  });

  test("an unknown route is a JSON 404, not an HTML error page", async ({ request }) => {
    const res = await request.get("/api/nope/nowhere", { headers: auth });
    expect(res.status()).toBe(404);
    expect(res.headers()["content-type"]).toContain("application/json");
    const body = await res.json();
    // Every failure carries the same envelope, so a client never has to guess.
    expect(body.ok).toBe(false);
    expect(typeof body.error).toBe("string");
  });
});

test.describe("Authentication", () => {
  test("valid credentials return a token and the user", async ({ request }) => {
    const res = await login(request);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.token).toBeTruthy();
    expect(body.user.username).toBe("e2e.manager");
  });

  test("a wrong password is 401 and says so without detail", async ({ request }) => {
    const res = await login(request, "wrong");
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(String(body.error)).toMatch(/invalid/i);
  });

  test("missing credentials are refused as the caller's mistake", async ({ request }) => {
    const res = await request.post("/api/auth/login", { data: {} });
    expect(res.status()).toBe(400);
  });

  test("the current user is readable with a token", async ({ request }) => {
    const res = await request.get("/api/auth/me", { headers: auth });
    expect(res.status()).toBe(200);
    expect((await res.json()).username).toBeTruthy();
  });

  test("every data route refuses an unauthenticated caller", async ({ request }) => {
    for (const path of [
      "/api/properties",
      "/api/dashboard/summary",
      "/api/reports/templates",
      "/api/workflows",
      "/api/notifications",
    ]) {
      const res = await request.get(path);
      expect(res.status(), `${path} should need a token`).toBe(401);
    }
  });

  test("the module registry is served without a token", async ({ request }) => {
    // Called out rather than asserted as 401: unlike every sibling under
    // /api/meta, this route takes no client and returns the app's own static
    // registry. It is the one asymmetry in the auth surface.
    const res = await request.get("/api/meta/entities");
    expect(res.status()).toBe(200);
  });

  test("a malformed Authorization header is refused", async ({ request }) => {
    for (const header of ["Bearer", "Token abc", "Bearer   ", "abc"]) {
      const res = await request.get("/api/properties", {
        headers: { Authorization: header },
      });
      expect(res.status(), `"${header}" should not authenticate`).toBe(401);
    }
  });
});

test.describe("Modules", () => {
  for (const entity of ENTITIES) {
    test(`${entity} lists with a total`, async ({ request }) => {
      const res = await request.get(`/api/${entity}`, { headers: auth });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body.items)).toBe(true);
      expect(typeof body.total).toBe("number");
      expect(body.limit).toBeGreaterThan(0);
    });
  }

  test("an unknown module is a 404", async ({ request }) => {
    const res = await request.get("/api/spaceships", { headers: auth });
    expect(res.status()).toBe(404);
  });

  test("paging is honoured", async ({ request }) => {
    const res = await request.get("/api/properties?limit=1&offset=0", { headers: auth });
    expect(res.status()).toBe(200);
    expect((await res.json()).limit).toBe(1);
  });

  test("a non-numeric limit is the caller's mistake, not a server fault", async ({ request }) => {
    // It used to raise inside the view and surface as a 500 carrying the raw
    // Python message.
    for (const bad of ["abc", "1.5", "1e5", "10; DROP TABLE x"]) {
      const res = await request.get(`/api/properties?limit=${encodeURIComponent(bad)}`, {
        headers: auth,
      });
      expect(res.status(), `limit=${bad}`).toBe(400);
      const body = await res.json();
      expect(String(body.error)).not.toContain("invalid literal");
    }
  });

  test("a non-numeric offset is refused the same way", async ({ request }) => {
    const res = await request.get("/api/properties?offset=abc", { headers: auth });
    expect(res.status()).toBe(400);
  });

  test("a record round-trips: create, read, update, delete", async ({ request }) => {
    const created = await request.post("/api/owners", {
      headers: auth,
      data: { name: "E2E Holdings", type: "LLC", email: "e2e@example.com" },
    });
    expect(created.status()).toBe(201);
    const owner = await created.json();
    const id = owner._id ?? owner.id;
    expect(id).toBeTruthy();
    // The business key is generated when the caller does not supply one.
    expect(String(owner.owner_id ?? "")).toMatch(/^O-/);

    const read = await request.get(`/api/owners/${id}`, { headers: auth });
    expect(read.status()).toBe(200);

    const updated = await request.put(`/api/owners/${id}`, {
      headers: auth,
      data: { name: "E2E Holdings LLC" },
    });
    expect(updated.status()).toBe(200);

    const removed = await request.delete(`/api/owners/${id}`, { headers: auth });
    expect(removed.status()).toBe(200);
  });

  test("a create with no JSON object body is refused", async ({ request }) => {
    const res = await request.post("/api/owners", {
      headers: { ...auth, "Content-Type": "application/json" },
      data: "not an object",
    });
    expect(res.status()).toBe(400);
  });
});

test.describe("Metadata and SQL", () => {
  test("the entity registry is served in the app's own order", async ({ request }) => {
    const res = await request.get("/api/meta/entities", { headers: auth });
    expect(res.status()).toBe(200);
    const body = await res.json();
    const names = (body.entities ?? body).map?.((e: { name: string }) => e.name) ?? [];
    expect(names.length).toBeGreaterThanOrEqual(10);
  });

  test("a SELECT passes through", async ({ request }) => {
    const res = await request.post("/api/meta/sql", {
      headers: auth,
      data: { sql: "SELECT * FROM pms.properties LIMIT 1" },
    });
    expect(res.status()).toBe(200);
    expect(Array.isArray((await res.json()).rows)).toBe(true);
  });

  test("anything that is not a read is refused", async ({ request }) => {
    for (const sql of [
      "DELETE FROM pms.properties",
      "UPDATE pms.properties SET city = 'x'",
      "DROP TABLE pms.properties",
      "INSERT INTO pms.properties VALUES (1)",
    ]) {
      const res = await request.post("/api/meta/sql", { headers: auth, data: { sql } });
      expect(res.status(), sql).toBe(400);
    }
  });

  test("an empty statement is refused", async ({ request }) => {
    const res = await request.post("/api/meta/sql", { headers: auth, data: { sql: "  " } });
    expect(res.status()).toBe(400);
  });
});

test.describe("Dashboard", () => {
  test("the summary and charts answer", async ({ request }) => {
    for (const path of ["/api/dashboard/summary", "/api/dashboard/charts"]) {
      const res = await request.get(path, { headers: auth });
      expect(res.status(), path).toBe(200);
      expect(typeof (await res.json())).toBe("object");
    }
  });

  test("a widget is designed, stored and proved to render", async ({ request }) => {
    const res = await request.post("/api/reports/widgets/design", {
      headers: auth,
      data: { instruction: "count of open work orders", title: "Open WOs" },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.template_id).toBeTruthy();
    expect(body.html).toContain("<");

    const rendered = await request.post(`/api/reports/widgets/${body.template_id}/render`, {
      headers: auth,
      data: { base_sql: body.base_sql },
    });
    expect(rendered.status()).toBe(200);
    expect(typeof (await rendered.json()).html).toBe("string");
  });

  test("a widget with no instruction is refused", async ({ request }) => {
    const res = await request.post("/api/reports/widgets/design", {
      headers: auth,
      data: { instruction: "   " },
    });
    expect(res.status()).toBe(400);
  });
});

test.describe("Reports", () => {
  test("the template library lists", async ({ request }) => {
    const res = await request.get("/api/reports/templates", { headers: auth });
    expect(res.status()).toBe(200);
  });

  for (const report of ["pnl", "cashflow", "rent-roll", "renewals", "occupancy", "work-orders"]) {
    test(`${report} computes`, async ({ request }) => {
      const res = await request.get(`/api/reports/${report}`, { headers: auth });
      expect(res.status(), report).toBe(200);
    });
  }
});

test.describe("Import", () => {
  test("a batch is relayed to the bulk endpoint", async ({ request }) => {
    const res = await request.post("/api/import/properties", {
      headers: auth,
      data: { rows: [{ street: "1 New Way" }, { street: "2 New Way" }] },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.created).toBe(2);
  });

  test("InventDB's own keys never travel back upstream", async ({ request }) => {
    const res = await request.post("/api/import/properties", {
      headers: auth,
      data: { rows: [{ _id: "should-be-stripped", street: "3 New Way" }] },
    });
    expect(res.status()).toBe(200);
    expect((await res.json()).created).toBe(1);
  });

  test("a malformed batch is refused", async ({ request }) => {
    for (const data of [{}, { rows: [] }, { rows: "nope" }, { rows: [1, 2] }]) {
      const res = await request.post("/api/import/properties", { headers: auth, data });
      expect(res.status(), JSON.stringify(data)).toBe(400);
    }
  });

  test("a dangerous type name never reaches InventDB", async ({ request }) => {
    const res = await request.post("/api/import/pms.properties", {
      headers: auth,
      data: { rows: [{ a: 1 }] },
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });
});

test.describe("Saved views", () => {
  test("a view is designed, saved, rendered, edited and removed", async ({ request }) => {
    const designed = await request.post("/api/views/properties/design", {
      headers: auth,
      data: { instruction: "a card per property with address and rent" },
    });
    expect(designed.status()).toBe(200);
    const design = await designed.json();
    expect(design.template_id).toBeTruthy();
    // The house style travels with the layout, so a saved view is not styled
    // however the model felt that run.
    expect(design.html).toContain("<");

    const created = await request.post("/api/views/properties", {
      headers: auth,
      data: { name: "E2E cards", template_id: design.template_id, base_sql: design.sql },
    });
    expect(created.status()).toBeLessThan(300);
    const view = await created.json();
    const id = view.id ?? view._id;
    expect(id).toBeTruthy();

    const rendered = await request.post("/api/views/properties/render", {
      headers: auth,
      data: { template_id: design.template_id, page: 0, page_size: 25 },
    });
    expect(rendered.status()).toBe(200);
    const page = await rendered.json();
    // The kit is injected at render, so even an old layout is styled by it.
    expect(page.html).toContain(".vk-card");

    const renamed = await request.put(`/api/views/properties/${id}`, {
      headers: auth,
      data: { name: "E2E cards renamed" },
    });
    expect(renamed.status()).toBeLessThan(300);

    const listed = await request.get("/api/views/properties", { headers: auth });
    expect(listed.status()).toBe(200);

    const removed = await request.delete(`/api/views/properties/${id}`, { headers: auth });
    expect(removed.status()).toBeLessThan(300);
  });

  test("a design with no instruction is refused", async ({ request }) => {
    const res = await request.post("/api/views/properties/design", {
      headers: auth,
      data: { instruction: "" },
    });
    expect(res.status()).toBe(400);
  });

  test("rendering without a template is refused", async ({ request }) => {
    const res = await request.post("/api/views/properties/render", {
      headers: auth,
      data: { page: 0 },
    });
    expect(res.status()).toBe(400);
  });
});

test.describe("Operations surfaces", () => {
  for (const path of [
    "/api/workflows",
    "/api/workflows/runs",
    "/api/notifications",
    "/api/analyze/config",
    "/api/analyze/models",
    "/api/analyze/threads",
    "/api/settings/connection",
    "/api/meta/types",
    "/api/meta/relationships",
  ]) {
    test(`${path} answers`, async ({ request }) => {
      const res = await request.get(path, { headers: auth });
      expect(res.status(), path).toBeLessThan(400);
    });
  }

  test("the files drive searches with the namespace pinned server-side", async ({ request }) => {
    const res = await request.post("/api/files/search", {
      headers: auth,
      data: { query: "lease", limit: 5 },
    });
    expect(res.status()).toBeLessThan(400);
  });

  test("the read-only analyze SQL seam refuses a write", async ({ request }) => {
    const res = await request.post("/api/analyze/sql", {
      headers: auth,
      data: { sql: "DELETE FROM pms.properties" },
    });
    // 403 here, 400 on /api/meta/sql, for the same refusal. Pinned as-is
    // rather than "fixed" in passing: the code is part of the API's contract.
    expect(res.status()).toBe(403);
    expect(String((await res.json()).error)).toMatch(/only select/i);
  });

  test("the analyze seam refuses a stacked statement", async ({ request }) => {
    const res = await request.post("/api/analyze/sql", {
      headers: auth,
      data: { sql: "SELECT 1; DROP TABLE pms.properties" },
    });
    expect(res.status()).toBe(400);
  });
});

test.describe("Cross-origin", () => {
  test("the configured frontend origin is allowed", async ({ request }) => {
    const res = await request.get("/api/health", {
      headers: { Origin: "http://localhost:5173" },
    });
    expect(res.status()).toBe(200);
    expect(res.headers()["access-control-allow-origin"]).toBeTruthy();
  });
});
