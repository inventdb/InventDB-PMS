/**
 * The result grid — rows the assistant returned, as a table you can click into.
 *
 * Clicking opens the drill-down panel (see drill/actions.ts):
 *   - rows of a plain query over one PMS module are records → the record opens,
 *     read-only, with its related records beneath it;
 *   - rows of a GROUP BY are summaries → the records behind that group open;
 *   - a joined result maps to no single module, so its rows stay static rather
 *     than pretending to lead somewhere.
 */
import { MONEY_HINT, money, titleize } from "./helpers";
import { ScrollX } from "../components/ScrollX";
import { useDrillActions } from "../drill/actions";

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
  sql,
  title,
}: {
  rows: Record<string, unknown>[];
  /** The statement that produced the rows — what decides where a click goes. */
  sql?: string | null;
  title?: string;
}) {
  const actions = useDrillActions();
  const columns = Object.keys(rows[0]).filter(
    (k) => !k.startsWith("_") || k === "_id"
  );
  const visible = columns.slice(0, 8);
  const clickable = actions.enabled && !!actions.mode(sql);
  const openRow = (row: Record<string, unknown>) => void actions.openRow(sql, row, title);

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
              tabIndex={clickable ? 0 : undefined}
              onClick={clickable ? () => openRow(row) : undefined}
              onKeyDown={
                clickable
                  ? (e) => {
                      if (e.key === "Enter") openRow(row);
                    }
                  : undefined
              }
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
