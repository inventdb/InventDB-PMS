/**
 * The result grid — rows the assistant returned, as a table you can click into.
 *
 * When the rows all belong to one PMS module and aren't group summaries, each
 * row opens that record in its module (`/leases?focus=<id>`). A joined or
 * aggregated result maps to no single record, so those rows stay static rather
 * than pretending to lead somewhere.
 */
import { useNavigate } from "react-router-dom";

import { ENTITY_BY_NAME } from "../config/entities";
import { MONEY_HINT, money, titleize } from "./helpers";
import { runSql } from "./api";
import { ScrollX } from "../components/ScrollX";

/** Render a value as a SQL literal for an equality match. */
function sqlLiteral(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function isStructured(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    (Array.isArray(value) ? value.length > 0 : Object.keys(value).length > 0)
  );
}

function cellText(value: unknown, column: string): string {
  if (value == null) return "—";
  if (isStructured(value)) {
    return Array.isArray(value)
      ? `${value.length} item${value.length === 1 ? "" : "s"}`
      : "details";
  }
  if (typeof value === "number" && MONEY_HINT.test(column)) return money(value);
  if (typeof value === "number") return value.toLocaleString();
  return String(value);
}

export function DataGrid({
  rows,
  table,
  openable,
}: {
  rows: Record<string, unknown>[];
  table?: { ns: string; type: string } | null;
  openable?: boolean;
}) {
  const navigate = useNavigate();
  const columns = Object.keys(rows[0]).filter(
    (k) => !k.startsWith("_") || k === "_id"
  );
  const visible = columns.slice(0, 8);
  // Only rows from one PMS module can be opened — the module page is the only
  // record surface this app has.
  const entity = table && ENTITY_BY_NAME[table.type] ? table.type : null;
  const clickable = !!entity && !!openable;

  async function openRow(row: Record<string, unknown>) {
    if (!entity || !table) return;
    const direct = row._id != null ? String(row._id) : null;
    if (direct) {
      navigate(`/${entity}?focus=${encodeURIComponent(direct)}`);
      return;
    }
    // The query didn't select `_id`, so resolve the real record by matching the
    // combination of its visible values. A business key like "P-5012" is NOT the
    // id, and guessing one would land on a record that doesn't exist.
    //
    // Column names are whatever the agent's SELECT aliased them to, so they are
    // held to a bare-identifier shape before being spliced into the WHERE —
    // values already go through `sqlLiteral`, and this closes the other half.
    const conditions = visible
      .filter((c) => {
        const v = row[c];
        return (
          /^[A-Za-z_][A-Za-z0-9_]*$/.test(c) &&
          v != null &&
          (typeof v === "string" || typeof v === "number" || typeof v === "boolean")
        );
      })
      .map((c) => `${c} = ${sqlLiteral(row[c])}`);
    if (conditions.length) {
      try {
        const found = await runSql(
          `SELECT _id FROM ${table.ns}.${table.type} WHERE ${conditions.join(" AND ")} LIMIT 2`
        );
        const id = found?.[0]?._id;
        if (id != null) {
          navigate(`/${entity}?focus=${encodeURIComponent(String(id))}`);
          return;
        }
      } catch {
        /* fall through to the module list */
      }
    }
    navigate(`/${entity}`);
  }

  return (
    <ScrollX className="an-table-wrap">
      <table className="an-table">
        <thead>
          <tr>
            {visible.map((c) => (
              <th key={c}>{c === "_id" ? "ID" : titleize(c)}</th>
            ))}
            {clickable && <th aria-label="Open" />}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 50).map((row, i) => (
            <tr
              key={i}
              className={clickable ? "is-clickable" : undefined}
              onClick={clickable ? () => void openRow(row) : undefined}
            >
              {visible.map((c) => (
                <td key={c} className={typeof row[c] === "number" ? "an-num" : undefined}>
                  {cellText(row[c], c)}
                </td>
              ))}
              {clickable && <td className="an-row-open">›</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollX>
  );
}
