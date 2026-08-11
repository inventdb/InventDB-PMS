/**
 * What to ask next.
 *
 * The model proposes its own follow-ups and actions alongside the answer (folded
 * into the same call, so they cost no extra round trip). When it hasn't, chips
 * are derived from the columns the query actually touched — so a result with no
 * date column never offers "over time", and the suggestions stay true to the
 * answer on screen.
 */
import { useEffect, useState } from "react";

import { runSql } from "./api";
import { titleize } from "./helpers";

const DATE_RE = /(date|_at|start|end|expir|opened|closed|due|month|year)/i;
const MEASURE_RE =
  /^(v|n|count|total|sum|avg|amount|amt|cost|price|qty|quantity|value|balance|rate|min|max)$|_(count|total|amount|sum|avg)$/i;

/** A breakdown dimension: not internal, not an id, not a date, not a measure. */
function isDimension(column: string): boolean {
  return (
    !column.startsWith("_") &&
    !/_id$/i.test(column) &&
    !DATE_RE.test(column) &&
    !MEASURE_RE.test(column)
  );
}

export function Followups({
  suggested,
  actions,
  table,
  resultColumns,
  onFollow,
  disabled,
}: {
  suggested?: string[];
  actions?: string[];
  table: { ns: string; type: string } | null;
  resultColumns: string[];
  onFollow: (question: string) => void;
  /** True once a newer message exists — the offer is stale. */
  disabled?: boolean;
}) {
  const [columns, setColumns] = useState<string[]>(resultColumns);

  // A bare aggregate result has nothing to break down by, so learn the subject
  // table's columns instead and offer real dimensions from those.
  useEffect(() => {
    const meaningful = resultColumns.filter((c) => !c.startsWith("_"));
    if (table && meaningful.length <= 1) {
      let alive = true;
      void runSql(`SELECT * FROM ${table.ns}.${table.type} LIMIT 1`)
        .then((rows) => {
          if (alive && rows[0]) setColumns(Object.keys(rows[0]));
        })
        .catch(() => {
          /* suggestions are a nicety */
        });
      return () => {
        alive = false;
      };
    }
    setColumns(resultColumns);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table?.type, resultColumns.length]);

  let chips: { label: string; prompt: string }[];
  if (suggested && suggested.length) {
    chips = suggested.map((q) => ({ label: q, prompt: q }));
  } else {
    const dimensions = columns.filter(isDimension).slice(0, 3);
    chips = dimensions.map((d) => ({
      label: `By ${titleize(d).toLowerCase()}`,
      prompt: `Break this down by ${d}`,
    }));
    if (columns.some((c) => DATE_RE.test(c))) {
      chips.push({ label: "Over time by month", prompt: "Chart this by month" });
    }
  }

  const acts = (actions || []).filter((a) => a && a.length < 80);
  const showActions = acts.length > 0;
  const showChips = !disabled && chips.length > 0;
  if (!showActions && !showChips) return null;

  return (
    <div className="an-followups">
      {showActions && (
        <div className="an-chip-rail">
          <span className="an-note">Do it:</span>
          {acts.map((action, i) =>
            disabled ? (
              <span
                key={i}
                className="an-chip is-static is-stale"
                title="You've continued this thread — ask again below to redo this"
              >
                ✦ {action}
              </span>
            ) : (
              <button
                key={i}
                type="button"
                className="an-chip is-action"
                onClick={() =>
                  onFollow(
                    `Yes, please ${action.charAt(0).toLowerCase()}${action.slice(1)}.`
                  )
                }
              >
                ✦ {action}
              </button>
            )
          )}
        </div>
      )}
      {showChips && (
        <div className="an-chip-rail">
          <span className="an-note">Follow up:</span>
          {chips.slice(0, 4).map((chip, i) => (
            <button
              key={i}
              type="button"
              className="an-chip"
              onClick={() => onFollow(chip.prompt)}
            >
              {chip.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
