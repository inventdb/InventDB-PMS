/**
 * Dashboard widget model — ported from InventDB SOAR's `rooms/dashboard/types.ts`.
 *
 * A dashboard is just an ordered list of widgets; each is a titled card backed
 * by ONE SQL query rendered a chosen way. Everything is data-driven — no
 * hardcoded figures — so the layout is creatable, rearrangeable and suggestable.
 *
 * Simple kinds are one SQL → a standard render. `report` is a mini-report: a
 * report-engine HTML template, multi-source and assistant-designed, referenced
 * by id. `form` is a quick-add card that opens a type's own form.
 */

export type WidgetKind =
  | "kpi"
  | "table"
  | "bar"
  | "line"
  | "area"
  | "histogram"
  | "pie"
  | "donut"
  | "scatter"
  | "heatmap"
  | "list"
  | "report"
  | "form";

export interface Widget {
  id: string;
  kind: WidgetKind;
  title: string;
  /** For simple kinds. Empty for 'report' and 'form'. */
  sql: string;
  /** Grid columns: 3, 4, 6, 8 or 12. */
  span: number;
  /** Format numeric values as currency. */
  money?: boolean;
  /** Optional "open in…" route. */
  link?: string;
  /** kind === 'report' — a report-template id. */
  templateId?: string;
  /**
   * kind === 'report' — the design conversation, so editing CONTINUES the
   * thread rather than rebuilding the widget from scratch each time.
   */
  history?: string[];
  /** kind === 'form' — the type a new record is created in. */
  formType?: string;
}

const KINDS: WidgetKind[] = [
  "kpi",
  "table",
  "bar",
  "line",
  "area",
  "histogram",
  "pie",
  "donut",
  "scatter",
  "heatmap",
  "list",
  "report",
  "form",
];

export const WIDGET_KINDS: { kind: WidgetKind; label: string; hint: string }[] = [
  { kind: "kpi", label: "Number", hint: "one figure — SELECT COUNT(*)/SUM(col) AS v" },
  { kind: "list", label: "List", hint: "label + value rows — SELECT name, amount …" },
  { kind: "table", label: "Table", hint: "a few columns and rows" },
  {
    kind: "bar",
    label: "Bar chart",
    hint: "a breakdown — SELECT dim, SUM(x) AS v GROUP BY dim",
  },
  { kind: "line", label: "Line chart", hint: "a trend over an ordered dimension" },
  {
    kind: "area",
    label: "Area chart",
    hint: "a trend with a filled area — same SQL as line",
  },
  {
    kind: "histogram",
    label: "Histogram",
    hint: "a distribution — SELECT bucket, COUNT(*) AS v GROUP BY bucket",
  },
  {
    kind: "pie",
    label: "Pie chart",
    hint: "share of total — SELECT dim, SUM(x) AS v GROUP BY dim (≤6 slices)",
  },
  { kind: "donut", label: "Donut chart", hint: "share of total with a hole — same SQL as pie" },
  {
    kind: "scatter",
    label: "Scatter plot",
    hint: "correlation of TWO numeric columns — SELECT xcol, ycol FROM …",
  },
  {
    kind: "heatmap",
    label: "Heatmap",
    hint: "a grid — SELECT row_dim, col_dim, SUM(x) AS v GROUP BY row_dim, col_dim",
  },
];

export const newWidgetId = () =>
  `w_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;

/**
 * Keep a persisted or suggested widget sane before it reaches the renderer.
 *
 * Each kind has its own anchor and is dropped without one: a report needs its
 * template, a form needs its type, everything else needs SQL. A widget that
 * cannot render is worse than one that was never added — it occupies a slot on
 * the grid and fails every refresh.
 */
export function sanitizeWidget(w: unknown, i: number): Widget | null {
  if (!w || typeof w !== "object") return null;
  const raw = w as Record<string, unknown>;

  const kind: WidgetKind = KINDS.includes(raw.kind as WidgetKind)
    ? (raw.kind as WidgetKind)
    : "table";
  const isReport = kind === "report";
  const isForm = kind === "form";

  if (isReport ? !raw.templateId : isForm ? !raw.formType : typeof raw.sql !== "string" || !raw.sql.trim())
    return null;

  const span = [3, 4, 5, 6, 7, 8, 9, 12].includes(Number(raw.span))
    ? Number(raw.span)
    : kind === "kpi" || isForm
      ? 3
      : 6;

  return {
    id: String(raw.id || `${newWidgetId()}_${i}`),
    kind,
    title: String(raw.title || "Untitled"),
    sql: typeof raw.sql === "string" ? raw.sql.trim() : "",
    span,
    money: !!raw.money,
    link: typeof raw.link === "string" ? raw.link : undefined,
    templateId: isReport ? String(raw.templateId) : undefined,
    history:
      isReport && Array.isArray(raw.history)
        ? (raw.history as unknown[]).filter((h): h is string => typeof h === "string")
        : undefined,
    formType: isForm ? String(raw.formType) : undefined,
  };
}
