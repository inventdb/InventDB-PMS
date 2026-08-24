/**
 * "✦ Suggest from my data" — ported from InventDB SOAR's
 * `rooms/dashboard/suggest.ts`.
 *
 * Reads the namespace's real schema (types and their columns) and asks the
 * assistant to propose a dashboard as a JSON array of widget specs. Tool-free,
 * conversation mode off — pure reasoning over the schema handed to it. The
 * caller previews the result before saving.
 */
import { agentText, type AgentStep } from "../analyze/agent";
import { listTypes, sql } from "./api";
import { sanitizeWidget, type Widget } from "./types";

/**
 * The FIRST balanced JSON array in noisy model text.
 *
 * A greedy `/\[[\s\S]*\]/` runs from the first `[` to the LAST `]`, so a stray
 * bracket in prose or a trailing note poisons the parse mid-value. Walking from
 * the first `[` to ITS matching `]` — string and escape aware — parses only the
 * slice that is actually the array.
 */
function extractJsonArray(text: string): unknown[] | null {
  const start = text.indexOf("[");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) {
        try {
          const v = JSON.parse(text.slice(start, i + 1));
          return Array.isArray(v) ? v : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** The namespace every PMS record lives in. Pinned server-side; named here only
 *  because the widgets' SQL has to qualify its tables. */
export const NS = "pms";

export interface SchemaEntry {
  type: string;
  columns: string[];
}

/** Each type with the columns one real record actually has. */
export async function buildSchemaSummary(): Promise<SchemaEntry[]> {
  let types: string[] = [];
  try {
    types = await listTypes();
  } catch {
    types = [];
  }
  const out: SchemaEntry[] = [];
  await Promise.all(
    types
      .filter((t) => !t.startsWith("_"))
      .slice(0, 18)
      .map(async (t) => {
        try {
          const rows = await sql(`SELECT * FROM ${NS}.${t} LIMIT 1`);
          if (rows[0])
            out.push({
              type: t,
              columns: Object.keys(rows[0]).filter((c) => !c.startsWith("_")),
            });
        } catch {
          /* a type with no readable rows tells us nothing — skip it */
        }
      })
  );
  return out;
}

/**
 * Propose a dashboard.
 *
 * With no `instruction` this is SOAR's one-click Suggest: the assistant reads
 * the schema and decides what a daily operator would want. With one, the same
 * reasoning is pointed at what was asked for — "a delinquency view", "something
 * about renewals" — so the layout serves a question rather than the whole
 * database.
 */
export async function suggestWidgets(
  instruction?: string,
  signal?: AbortSignal,
  onProgress?: (label: string) => void,
  onStep?: (s: AgentStep) => void
): Promise<Widget[]> {
  onProgress?.("Reading your schema…");
  const schema = await buildSchemaSummary();
  if (!schema.length) throw new Error("No data found to build a dashboard from.");

  const schemaText = schema.map((s) => `${NS}.${s.type}(${s.columns.join(", ")})`).join("\n");
  const asked = (instruction ?? "").trim();
  // With nothing asked for, the assistant decides what a daily operator wants —
  // SOAR's one-click Suggest. With an instruction, the same reasoning is pointed
  // at it, and a focused layout is allowed to be a short one.
  const steer = asked
    ? `The person asked for this dashboard specifically:\n"${asked}"\n\n` +
      `Build the layout around that. Every widget must serve it; ignore parts of the schema that do not. ` +
      `If it needs fewer than six widgets, return fewer — a focused dashboard beats a padded one.\n\n`
    : "";
  const prompt =
    `You design an at-a-glance dashboard for a data app. Here is the live schema (type and columns):\n${schemaText}\n\n` +
    steer +
    `Propose ${asked ? "the widgets that answer it" : "6–8 widgets that a daily operator would want"}. Return ONLY a JSON array (no prose, no code fences, do NOT run any tools or SQL):\n` +
    `[{"kind":"kpi|list|table|bar|line|area|histogram|pie|donut|scatter|heatmap","title":"...","sql":"<one SELECT>","span":3|4|6|8|12,"money":true|false}]\n\n` +
    `Match the chart to the metric — a trend over time is a LINE or AREA, a share/composition is a PIE or DONUT, a ranking/comparison across categories is a BAR, a distribution is a HISTOGRAM, correlation of two numbers is a SCATTER, a value across two dimensions is a HEATMAP. Vary them; a good dashboard is NOT all bars.\n` +
    `Rules for the SQL (InventDB engine — SELECT only). Every chart reads the first TEXT column as the label and v (or the first numeric column) as the value:\n` +
    `- kpi: exactly one value, alias it v — e.g. SELECT COUNT(*) AS v FROM ${NS}.<type>  /  SELECT SUM(<col>) AS v FROM ${NS}.<type> WHERE <cond>\n` +
    `- bar: a CATEGORICAL breakdown by a LOW-cardinality text column (status, type, category — never a date or id) — SELECT <dim>, SUM(<num>) AS v FROM ${NS}.<type> GROUP BY <dim> ORDER BY v DESC LIMIT 12\n` +
    `- line: a trend over TIME or an ordered dimension — SELECT <date_or_ordered_dim>, COUNT(*) AS v FROM ${NS}.<type> GROUP BY <date_or_ordered_dim> ORDER BY <date_or_ordered_dim> ASC. Order CHRONOLOGICALLY (ascending), NOT by value. Return the raw date column as-is — the chart formats and thins date labels automatically (no date functions needed; InventDB has none).\n` +
    `- area: same SQL shape as line (a trend), rendered with a filled area — use for a single cumulative/volume series over time.\n` +
    `- histogram: a DISTRIBUTION — bucket a value then count, SELECT <bucket_dim>, COUNT(*) AS v FROM ${NS}.<type> GROUP BY <bucket_dim> ORDER BY <bucket_dim> ASC.\n` +
    `- pie / donut: a SHARE-OF-TOTAL composition by a LOW-cardinality text column (≤6 slices) — SELECT <dim>, COUNT(*) AS v FROM ${NS}.<type> GROUP BY <dim> ORDER BY v DESC LIMIT 6. Pick pie/donut for "what share / proportion" questions; bar for ranking or magnitude.\n` +
    `- scatter: CORRELATION of TWO numeric columns — SELECT <xcol>, <ycol> FROM ${NS}.<type> LIMIT 200 (first numeric = x, second = y; no GROUP BY). Use only when two numeric measures plausibly relate.\n` +
    `- heatmap: a value across TWO dimensions — SELECT <row_dim>, <col_dim>, SUM(<num>) AS v FROM ${NS}.<type> GROUP BY <row_dim>, <col_dim> (both dims LOW-cardinality text). First text col = rows, second = columns, v = cell.\n` +
    `- list: two columns (label, value) — SELECT <name>, <num> FROM ${NS}.<type> ORDER BY <num> DESC LIMIT 6\n` +
    `- table: 3–5 useful columns, ORDER BY something, LIMIT 8\n` +
    `- NO CASE WHEN, NO subqueries, NO LOWER(), NO date functions (DATE_TRUNC/strftime/NOW are unsupported); LIKE is case-insensitive. Use real column names from the schema above.\n` +
    `- set money:true when the value is a currency amount. Use span 3 for kpis, 6–8 for tables/charts.`;

  const acc = await agentText(prompt, { signal, timeoutMs: 300000, onProgress, onStep });
  const arr = extractJsonArray(acc);
  if (!arr) throw new Error("The assistant didn't return a usable layout — try again.");

  const widgets = arr.map(sanitizeWidget).filter(Boolean) as Widget[];
  if (!widgets.length) throw new Error("No usable widgets in the suggestion.");
  return widgets;
}
