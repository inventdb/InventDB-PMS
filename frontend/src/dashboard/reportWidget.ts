/**
 * Mini-report widgets — ported from InventDB SOAR's
 * `rooms/dashboard/reportWidget.ts`.
 *
 * You DESCRIBE a widget; InventDB's report-layout generator produces a
 * report-engine fragment whose server block runs the queries and lays out the
 * result. That generator is used rather than the chat agent because it reliably
 * returns report HTML — the chat agent answers conversationally and runs tools.
 *
 * The fragment may pull from MULTIPLE sources: it is given a primary `baseSql`
 * and told it may query any type directly. It is persisted as a report template
 * and re-rendered — re-queried live — every time the card is shown.
 *
 * SOAR splits generate / create-template / render across three calls. Here the
 * backend does the generate → persist → prove-it-renders loop in one route, so
 * a widget that cannot render never reaches the grid.
 */
import { api } from "../api/client";
import { buildSchemaSummary, NS, type SchemaEntry } from "./suggest";
import { WIDGET_KIT_GUIDE } from "./widgetKit";

/**
 * Guess the widget's primary type from the description, so the injected
 * `baseSql` targets something sensible. Falls back to the first type available.
 */
function pickPrimaryType(instruction: string, schema: SchemaEntry[]): string {
  const t = instruction.toLowerCase();
  for (const s of schema) {
    const n = s.type.toLowerCase();
    if (t.includes(n) || t.includes(`${n}s`) || t.includes(n.replace(/y$/, "ies"))) return s.type;
  }
  return schema[0]?.type ?? "properties";
}

export interface WidgetDesign {
  templateId: string;
  html: string;
  baseSql: string;
}

/**
 * Generate — or edit — a widget's report template.
 *
 * `prev.history` carries the earlier refinement instructions so the generator
 * amends THIS widget in context, cumulatively, rather than rebuilding it from
 * scratch on every turn.
 */
export async function generateWidget(
  instruction: string,
  prev?: { templateId?: string; baseSql?: string; history?: string[] },
  opts?: { signal?: AbortSignal; modelFamily?: string; title?: string }
): Promise<WidgetDesign> {
  const schema = await buildSchemaSummary();
  if (!schema.length) throw new Error("No data found to build a widget from.");

  const baseSql = prev?.baseSql || `SELECT * FROM ${NS}.${pickPrimaryType(instruction, schema)}`;
  const steer =
    `${instruction}\n\n` +
    `Context: this is a COMPACT dashboard widget (no page title or page margins). ` +
    `You MAY query ANY type directly with query("SELECT … FROM ${NS}.<type> …") and combine MULTIPLE sources — you are not limited to params.viewSql. ` +
    `Available types: ${schema.map((s) => s.type).join(", ")}.\n\n` +
    WIDGET_KIT_GUIDE;

  const { data } = await api.post<{ template_id: string; html: string; base_sql: string }>(
    "/reports/widgets/design",
    {
      instruction: steer,
      base_sql: baseSql,
      template_id: prev?.templateId,
      history: prev?.history,
      model_family: opts?.modelFamily,
      title: opts?.title,
    },
    { signal: opts?.signal }
  );

  if (!data?.html) throw new Error("The assistant didn't return a usable widget — try rephrasing.");
  return { templateId: data.template_id, html: data.html, baseSql: data.base_sql || baseSql };
}

/**
 * Render a widget's template. The server re-runs every query at render time, so
 * a card is live rather than a snapshot.
 */
export async function renderWidget(templateId: string, baseSql = ""): Promise<string> {
  const { data } = await api.post<{ html?: string }>(`/reports/widgets/${templateId}/render`, {
    base_sql: baseSql,
  });
  return data?.html || "";
}
