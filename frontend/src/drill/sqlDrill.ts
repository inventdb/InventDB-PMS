/**
 * From "the query behind this figure" to "the records behind this number".
 *
 * A chart bar, a dashboard KPI and a grouped table row are all one SQL
 * statement summarised. Clicking one should show the rows that were summed —
 * which is that statement's own FROM and WHERE, narrowed by the GROUP BY value
 * that was clicked:
 *
 *   SELECT category, SUM(actual_cost) FROM pms.work_orders
 *   WHERE status = 'Open' GROUP BY category            ← behind the chart
 *
 *   click "HVAC" →  work_orders WHERE (status = 'Open') AND category = 'HVAC'
 *
 * Only a statement over ONE module can be traced this way. A join's rows belong
 * to no single module and a CTE hides its source, so those return null and the
 * figure simply isn't clickable — better than opening the wrong records.
 */
import { ENTITY_BY_NAME } from "../config/entities";

export interface ParsedSql {
  ns: string;
  type: string;
  alias: string;
  where: string;
  select: { expr: string; name: string }[];
  groupBy: string[];
  aggregate: boolean;
}

/** What the panel needs to list the records behind a figure. */
export interface BehindSpec {
  entity: string;
  alias?: string;
  where?: string;
  title: string;
  subtitle?: string;
}

type Clause = "select" | "from" | "where" | "group" | "having" | "order" | "limit" | "offset";

const CLAUSE_RE: [Clause, RegExp][] = [
  ["select", /^select\b/i],
  ["from", /^from\b/i],
  ["where", /^where\b/i],
  ["group", /^group\s+by\b/i],
  ["having", /^having\b/i],
  ["order", /^order\s+by\b/i],
  ["limit", /^limit\b/i],
  ["offset", /^offset\b/i],
];

/** Split a statement into its top-level clauses (outside parens and strings). */
function clauses(sql: string): Partial<Record<Clause, string>> | null {
  const s = sql.replace(/\s+/g, " ").trim().replace(/;\s*$/, "");
  const marks: { clause: Clause; at: number; len: number }[] = [];
  let depth = 0;
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (ch === "'" && s[i + 1] === "'") i++;
      else if (ch === "'") inStr = false;
      continue;
    }
    if (ch === "'") {
      inStr = true;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (depth !== 0) continue;
    if (i > 0 && /[\w.]/.test(s[i - 1])) continue;
    const rest = s.slice(i);
    for (const [clause, re] of CLAUSE_RE) {
      const m = rest.match(re);
      if (m) {
        marks.push({ clause, at: i, len: m[0].length });
        i += m[0].length - 1;
        break;
      }
    }
  }
  if (!marks.length || marks[0].clause !== "select" || marks[0].at !== 0) return null;
  const out: Partial<Record<Clause, string>> = {};
  marks.forEach((m, k) => {
    const end = k + 1 < marks.length ? marks[k + 1].at : s.length;
    if (out[m.clause] !== undefined) return; // a second SELECT (UNION) etc.
    out[m.clause] = s.slice(m.at + m.len, end).trim();
  });
  // UNION / INTERSECT at top level means more than one statement's rows.
  if (/\b(union|intersect|except)\b/i.test(stripStrings(s).replace(/\([^()]*\)/g, ""))) return null;
  return out;
}

function stripStrings(s: string): string {
  return s.replace(/'(?:[^']|'')*'/g, "''");
}

/** Split on commas at paren depth 0, outside strings. */
function splitTop(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inStr = false;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const ch = list[i];
    if (inStr) {
      if (ch === "'" && list[i + 1] === "'") i++;
      else if (ch === "'") inStr = false;
      continue;
    }
    if (ch === "'") inStr = true;
    else if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(list.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(list.slice(start).trim());
  return parts.filter(Boolean);
}

const AGG_RE = /\b(count|sum|avg|min|max)\s*\(/i;

function selectItem(item: string): { expr: string; name: string } {
  const as = item.match(/^(.*\S)\s+as\s+("?)([A-Za-z_][\w]*)\2$/i);
  if (as) return { expr: as[1].trim(), name: as[3] };
  // Implicit alias: `SUM(amount) total`, `t.category cat`.
  const implicit = item.match(/^(.*[)\w"'])\s+([A-Za-z_][\w]*)$/);
  if (implicit && !/\b(and|or|not|is|null|distinct)$/i.test(implicit[1]) && !/^(distinct)$/i.test(implicit[1])) {
    return { expr: implicit[1].trim(), name: implicit[2] };
  }
  const col = item.match(/^(?:[A-Za-z_]\w*\.)?([A-Za-z_]\w*)$/);
  return { expr: item.trim(), name: col ? col[1] : item.trim() };
}

/** Parse the parts of a single-module statement the drill-down needs. */
export function parseSql(sql?: string | null): ParsedSql | null {
  if (!sql) return null;
  if (/^\s*with\b/i.test(sql)) return null;
  const c = clauses(sql);
  if (!c?.select || !c.from) return null;
  const from = c.from.match(/^([A-Za-z_]\w*)\.([A-Za-z_]\w*)(?:\s+(?:as\s+)?([A-Za-z_]\w*))?$/i);
  if (!from) return null; // a join, a comma list or a subquery
  const alias = from[3] && !/^(where|group|order|limit)$/i.test(from[3]) ? from[3] : "";
  const select = splitTop(c.select.replace(/^distinct\s+/i, "")).map(selectItem);
  const groupBy = c.group ? splitTop(c.group) : [];
  const aggregate = groupBy.length > 0 || select.some((s) => AGG_RE.test(s.expr));
  return { ns: from[1], type: from[2], alias, where: c.where ?? "", select, groupBy, aggregate };
}

const norm = (s: string) => s.replace(/\s+/g, "").replace(/"/g, "").toLowerCase();
const bare = (s: string) => norm(s).replace(/^[a-z_]\w*\./, "");

/** Each GROUP BY item as {expression to filter on, output column holding its value}. */
export function dimensions(p: ParsedSql): { expr: string; column: string }[] {
  return p.groupBy.map((g) => {
    const ordinal = /^\d+$/.test(g) ? p.select[Number(g) - 1] : undefined;
    const byAlias = p.select.find((s) => norm(s.name) === norm(g));
    const byExpr = p.select.find((s) => norm(s.expr) === norm(g) || bare(s.expr) === bare(g));
    const hit = ordinal ?? byExpr ?? byAlias;
    const expr = hit && (ordinal || byAlias === hit) ? hit.expr : g;
    return { expr, column: hit?.name ?? g.replace(/^[A-Za-z_]\w*\./, "") };
  });
}

export function sqlLiteral(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function condition(expr: string, value: unknown): string {
  if (value === null || value === undefined || value === "—") return `${expr} IS NULL`;
  return `${expr} = ${sqlLiteral(value)}`;
}

function joinWhere(base: string, extra: string[]): string {
  const parts = [base ? `(${base})` : "", ...extra].filter(Boolean);
  return parts.join(" AND ");
}

/** Does this statement's module belong to the app, so its rows can open? */
function ownModule(p: ParsedSql | null, ns?: string): p is ParsedSql {
  return !!p && !!ENTITY_BY_NAME[p.type] && (!ns || p.ns === ns);
}

/**
 * The records behind one grouped row (or, for an ungrouped aggregate such as a
 * KPI, behind the whole figure). `row` is the result row clicked.
 */
export function behindRow(
  sql: string | null | undefined,
  row: Record<string, unknown> | null,
  opts: { ns?: string; title?: string } = {}
): BehindSpec | null {
  const p = parseSql(sql);
  if (!ownModule(p, opts.ns) || !p.aggregate) return null;
  const dims = dimensions(p);
  const extra: string[] = [];
  const labels: string[] = [];
  for (const d of dims) {
    if (!row || !(d.column in row)) return null; // can't tell which group this is
    extra.push(condition(d.expr, row[d.column]));
    labels.push(String(row[d.column] ?? "—"));
  }
  const cfg = ENTITY_BY_NAME[p.type];
  return {
    entity: p.type,
    alias: p.alias || undefined,
    where: joinWhere(p.where, extra),
    title: labels.length ? `${cfg.labelPlural} · ${labels.join(" · ")}` : opts.title || cfg.labelPlural,
    subtitle: "Behind this number",
  };
}

/**
 * The records behind one chart mark. Charts carry the category as text, so the
 * typed value is looked up in the statement's own result rows when they are to
 * hand (a year is 2026, not "2026"); with two GROUP BY columns the series name
 * picks the second one.
 */
export function behindPoint(
  sql: string | null | undefined,
  category: string,
  opts: { ns?: string; series?: string; rows?: Record<string, unknown>[]; title?: string } = {}
): BehindSpec | null {
  const p = parseSql(sql);
  if (!ownModule(p, opts.ns) || !p.aggregate) return null;
  const dims = dimensions(p);
  if (!dims.length) return behindRow(sql, null, opts);
  const same = (a: unknown, b: unknown) =>
    a != null && b != null && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
  const rows = opts.rows ?? [];
  const row =
    rows.find((r) =>
      dims.some((d) => same(r[d.column], category)) &&
      (dims.length < 2 || !opts.series || dims.some((d) => same(r[d.column], opts.series)))
    ) ?? null;
  if (row) return behindRow(sql, row, opts);
  if (dims.length !== 1) return null;
  const numeric = /^-?\d+(\.\d+)?$/.test(category.trim());
  return behindRow(sql, { [dims[0].column]: numeric ? Number(category) : category }, opts);
}
