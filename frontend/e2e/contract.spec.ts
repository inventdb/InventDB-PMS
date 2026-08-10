import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { test, expect } from "./fixtures";

/**
 * Checks the mocked API against the contract the backend publishes.
 *
 * Every other spec in this suite asserts on the UI while the API underneath it
 * is a fiction written by hand in `fixtures/mock-api.ts`. That fiction is only
 * useful while it matches the real backend, and nothing was checking that — a
 * renamed field or a dropped envelope would leave the whole suite green against
 * a backend it no longer describes.
 *
 * So: `backend/tests/contract/` replays recorded InventDB responses through the
 * real Flask app, verifies the output against `contract/api-contract.json`, and
 * publishes the app's actual responses to `contract/responses/`. This spec holds
 * the mock to the same contract and the same responses. Drift on either side now
 * fails on that side.
 *
 * Regenerate the contract after changing a backend response shape:
 *
 *   cd backend && UPDATE_CONTRACT=1 python -m pytest tests/contract
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONTRACT_FILE = path.resolve(HERE, "../../contract/api-contract.json");
const RESPONSES_DIR = path.resolve(HERE, "../../contract/responses");

type Shape = string | Shape[] | { [key: string]: Shape };

interface Endpoint {
  key: string;
  method: string;
  path: string;
  status: number;
  auth: boolean;
  body: unknown;
  shape: Shape;
}

interface Contract {
  version: number;
  endpoints: Endpoint[];
}

const contract = JSON.parse(fs.readFileSync(CONTRACT_FILE, "utf8")) as Contract;

/**
 * A port of `backend/tests/contract/spec.py:validate`.
 *
 * Deliberately duplicated rather than shared: a validator generated from the
 * backend would agree with the backend by construction, which is the one thing
 * this must not do.
 */
function validate(shape: Shape, value: unknown, at = "$"): string[] {
  if (typeof shape === "string") {
    for (const member of shape.split("|")) {
      if (matchesScalar(member, value)) return [];
    }
    return [`${at}: expected ${shape}, got ${describe(value)}`];
  }

  if (Array.isArray(shape)) {
    if (!Array.isArray(value)) return [`${at}: expected array, got ${describe(value)}`];
    return value.flatMap((item, index) => validate(shape[0], item, `${at}[${index}]`));
  }

  if (!isRecord(value)) return [`${at}: expected object, got ${describe(value)}`];

  const errors: string[] = [];
  for (const [rawKey, sub] of Object.entries(shape)) {
    const optional = rawKey.endsWith("?");
    const key = optional ? rawKey.slice(0, -1) : rawKey;
    if (!(key in value)) {
      if (!optional) errors.push(`${at}.${key}: missing`);
      continue;
    }
    errors.push(...validate(sub, value[key], `${at}.${key}`));
  }
  return errors;
}

function matchesScalar(type: string, value: unknown): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    // `true` where a count belongs is a bug, not a 1 — same rule as the Python side.
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "int":
      return typeof value === "number" && Number.isInteger(value);
    case "bool":
      return typeof value === "boolean";
    case "object":
      return isRecord(value);
    case "array":
      return Array.isArray(value);
    case "null":
      return value === null;
    case "any":
      return true;
    default:
      return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `array[${value.length}]`;
  if (isRecord(value)) return `object{${Object.keys(value).sort().join(", ")}}`;
  return `${typeof value}(${JSON.stringify(value)})`;
}

interface ApiResult {
  status: number;
  json: unknown;
}

/**
 * Calls the API from inside the page, so `page.route` — and therefore the mock —
 * intercepts it. Playwright's `request` fixture would bypass the mock entirely
 * and hit whatever is really listening on the dev server.
 */
async function callApi(
  page: import("@playwright/test").Page,
  method: string,
  url: string,
  body: unknown
): Promise<ApiResult> {
  return page.evaluate(
    async ({ method, url, body }) => {
      const response = await fetch(url, {
        method,
        headers: body === null ? undefined : { "Content-Type": "application/json" },
        body: body === null ? undefined : JSON.stringify(body),
      });
      let json: unknown = null;
      try {
        json = await response.json();
      } catch {
        json = null;
      }
      return { status: response.status, json };
    },
    { method, url, body: body ?? null }
  );
}

/**
 * A blank same-origin document.
 *
 * The fetches only need an origin the mock is installed on; booting the real
 * SPA would fire its own queries and mutate the store before the assertions run.
 */
async function blankPage(page: import("@playwright/test").Page): Promise<void> {
  await page.route("**/__contract__", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>c</title>" })
  );
  await page.goto("/__contract__");
}

/** The mock's ids differ from the backend recordings', so each side binds its own. */
async function resolveBindings(
  page: import("@playwright/test").Page
): Promise<Record<string, string>> {
  const list = await callApi(page, "GET", "/api/properties?limit=1", null);
  const items = (list.json as { items?: { _id?: string }[] })?.items ?? [];

  const templates = await callApi(page, "GET", "/api/reports/templates", null);
  const entries = (templates.json as { templates?: { id?: string }[] })?.templates ?? [];

  return {
    record_id: items[0]?._id ?? "prop-1",
    template_id: entries[0]?.id ?? "rpt-owner-statement",
  };
}

function bind(template: string, bindings: Record<string, string>): string {
  return Object.entries(bindings).reduce(
    (acc, [name, value]) => acc.split(`{${name}}`).join(value),
    template
  );
}

test.describe("mocked API honours the published backend contract", () => {
  test.beforeEach(async ({ page }) => {
    await blankPage(page);
  });

  for (const endpoint of contract.endpoints) {
    test(`${endpoint.key} (${endpoint.method} ${endpoint.path})`, async ({ page }) => {
      const url = endpoint.path.includes("{")
        ? bind(endpoint.path, await resolveBindings(page))
        : endpoint.path;

      const result = await callApi(page, endpoint.method, url, endpoint.body);

      expect(
        result.status,
        `${endpoint.key}: expected ${endpoint.status}, body was ${JSON.stringify(result.json)}`
      ).toBe(endpoint.status);

      const errors = validate(endpoint.shape, result.json);
      expect(errors, `${endpoint.key} drifted from contract/api-contract.json`).toEqual([]);
    });
  }
});

test.describe("mocked API returns the same fields as the real backend", () => {
  test.beforeEach(async ({ page }) => {
    await blankPage(page);
  });

  /**
   * The shape check above allows extra fields, which is right for a contract —
   * an API may add to a response without breaking its clients. This one catches
   * the opposite direction: a field the backend really returns that the mock
   * omits, which the shape check only notices if the contract happens to
   * require it.
   */
  for (const endpoint of contract.endpoints) {
    const snapshot = path.join(RESPONSES_DIR, `${endpoint.key}.json`);
    if (!fs.existsSync(snapshot)) continue;

    const expected = JSON.parse(fs.readFileSync(snapshot, "utf8")) as unknown;
    if (!isRecord(expected)) continue;

    test(`${endpoint.key} exposes every top-level field`, async ({ page }) => {
      const url = endpoint.path.includes("{")
        ? bind(endpoint.path, await resolveBindings(page))
        : endpoint.path;

      const result = await callApi(page, endpoint.method, url, endpoint.body);
      const actual = result.json;

      expect(isRecord(actual), `${endpoint.key}: mock returned ${describe(actual)}`).toBe(true);

      // Record bodies are schemaless documents whose columns are the fixture
      // author's choice, so only the envelope endpoints are compared.
      const isEnvelope = !["property-detail", "property-create", "property-update"].includes(
        endpoint.key
      );
      if (!isEnvelope) return;

      const missing = Object.keys(expected).filter(
        (key) => !Object.prototype.hasOwnProperty.call(actual as object, key)
      );
      expect(
        missing,
        `${endpoint.key}: the mock omits fields the backend returns — see contract/responses/${endpoint.key}.json`
      ).toEqual([]);
    });
  }
});
