/**
 * Opening the drill-down panel from anything that is backed by a SQL statement
 * — an Analyze result row or chart, a dashboard widget.
 *
 * The rule is the same everywhere:
 *   - a row of a plain (ungrouped) query over one module IS a record → open it;
 *   - a row, bar or slice of a grouped query is a SUMMARY → list the records
 *     behind it (the query's own filter, narrowed to the clicked group);
 *   - an ungrouped aggregate (a KPI) → list every record behind the number;
 *   - a join, a CTE or another namespace → not traceable to one module, so the
 *     figure isn't offered as clickable at all.
 */
import { useQuery } from "@tanstack/react-query";

import { api } from "../api/client";
import { ENTITY_BY_NAME } from "../config/entities";
import { useToast } from "../components/Toast";
import { useOptionalDrill, type DrillFrame } from "./DrillContext";
import { behindPoint, behindRow, parseSql, sqlLiteral, type ParsedSql } from "./sqlDrill";

type Row = Record<string, unknown>;

/** The namespace this app is bound to (server-side config), for the SQL check. */
export function useAppNamespace(): string {
  const q = useQuery({
    queryKey: ["health"],
    queryFn: async () => (await api.get<{ namespace?: string }>("/health")).data,
    staleTime: 5 * 60_000,
  });
  return q.data?.namespace || "pms";
}

export type DrillMode = "record" | "behind" | null;

/** What a click on a row of this statement would do — or null if nothing. */
export function drillMode(sql: string | null | undefined, ns: string): DrillMode {
  const p = parseSql(sql);
  if (!p || p.ns !== ns || !ENTITY_BY_NAME[p.type]) return null;
  return p.aggregate ? "behind" : "record";
}

const PLAIN_COLUMN = /^(?:([A-Za-z_]\w*)\.)?([A-Za-z_]\w*)$/;

/**
 * Find the `_id` of the record a plain result row came from. When the query
 * didn't select `_id`, match on the row's plain-column values — a business key
 * like "P-5012" is not the id, and guessing would open a record that doesn't
 * exist. Returns the ids found (0, 1 or several).
 */
async function resolveIds(p: ParsedSql, row: Row): Promise<{ ids: string[]; where: string }> {
  if (row._id != null) return { ids: [String(row._id)], where: "" };
  const conds: string[] = [];
  for (const s of p.select) {
    if (!PLAIN_COLUMN.test(s.expr)) continue;
    const v = row[s.name];
    if (v == null || !["string", "number", "boolean"].includes(typeof v)) continue;
    conds.push(`${s.expr} = ${sqlLiteral(v)}`);
  }
  if (p.select.some((s) => s.expr === "*")) {
    for (const [k, v] of Object.entries(row)) {
      if (k.startsWith("_") || !/^[A-Za-z_]\w*$/.test(k)) continue;
      if (v == null || !["string", "number", "boolean"].includes(typeof v)) continue;
      conds.push(`${p.alias ? p.alias + "." : ""}${k} = ${sqlLiteral(v)}`);
    }
  }
  if (!conds.length) return { ids: [], where: "" };
  const where = conds.join(" AND ");
  const from = `${p.ns}.${p.type}${p.alias ? " " + p.alias : ""}`;
  const { data } = await api.post<{ rows?: Row[] }>("/meta/sql", {
    sql: `SELECT ${p.alias ? p.alias + "." : ""}_id FROM ${from} WHERE ${where} LIMIT 2`,
  });
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  return { ids: rows.map((r) => String(r._id)).filter(Boolean), where };
}

export function useDrillActions() {
  const drill = useOptionalDrill();
  const ns = useAppNamespace();
  const toast = useToast();

  const open = (frame: DrillFrame) => drill?.open(frame);

  /** A result row was clicked. */
  async function openRow(sql: string | null | undefined, row: Row, title?: string) {
    const p = parseSql(sql);
    if (!p || p.ns !== ns || !ENTITY_BY_NAME[p.type]) return;
    if (p.aggregate) {
      const spec = behindRow(sql, row, { ns, title });
      if (spec) open({ kind: "list", ...spec });
      else toast.error("Can't tell which group that row is — its query doesn't return the grouping column.");
      return;
    }
    try {
      const { ids, where } = await resolveIds(p, row);
      if (ids.length === 1) {
        open({ kind: "record", entity: p.type, id: ids[0] });
        return;
      }
      // Several records share those values (or none was found): show the
      // candidates rather than pick one at random.
      const cfg = ENTITY_BY_NAME[p.type];
      open({
        kind: "list",
        entity: p.type,
        alias: p.alias || undefined,
        where: [p.where && `(${p.where})`, where].filter(Boolean).join(" AND "),
        title: `${cfg.labelPlural} matching this row`,
        subtitle: ids.length ? "Several records match" : "Behind this row",
      });
    } catch {
      toast.error("Couldn't find the record behind that row.");
    }
  }

  /** A chart mark was clicked: `category` is the bar/slice/point label. */
  function openPoint(
    sql: string | null | undefined,
    category: string,
    opts: { series?: string; rows?: Row[]; title?: string } = {}
  ) {
    const p = parseSql(sql);
    if (!p || p.ns !== ns || !ENTITY_BY_NAME[p.type]) return;
    if (!p.aggregate) {
      // A chart over plain rows (a top-N by value): the mark IS a record.
      const row = (opts.rows ?? []).find((r) =>
        Object.values(r).some((v) => v != null && String(v) === category)
      );
      if (row) void openRow(sql, row, opts.title);
      return;
    }
    const spec = behindPoint(sql, category, { ns, ...opts });
    if (spec) open({ kind: "list", ...spec });
    else toast.error("Can't trace that mark back to records.");
  }

  /** The whole figure (a KPI): every record behind the number. */
  function openBehind(sql: string | null | undefined, title: string) {
    const p = parseSql(sql);
    if (!p || p.ns !== ns || !ENTITY_BY_NAME[p.type]) return;
    const spec = behindRow(sql, null, { ns, title });
    if (spec && !p.groupBy.length) {
      open({ kind: "list", ...spec, title });
      return;
    }
    // Not an aggregate (or a grouped one): its own rows are the records.
    open({
      kind: "list",
      entity: p.type,
      alias: p.alias || undefined,
      where: p.where || undefined,
      title,
      subtitle: "Behind this figure",
    });
  }

  return { ns, enabled: !!drill, mode: (sql?: string | null) => drillMode(sql, ns), openRow, openPoint, openBehind };
}
