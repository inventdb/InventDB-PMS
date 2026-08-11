/**
 * A saved view the agent opened.
 *
 * `open_saved_view` emits a `saved_view` step carrying the view's id plus the
 * base SQL behind it. Rather than narrate "I opened the view", the card runs
 * that query and shows the rows — which is what the person asked to see.
 */
import { useEffect, useState } from "react";

import { errorMessage } from "../../api/client";
import { fetchSavedView, runSql } from "../api";
import { DataGrid } from "../DataGrid";
import { singleTypeFromSql, isAggregateSql, tableFromSql } from "../helpers";
import { Skeleton } from "../ui";

export function SavedViewCard({ chart, baseSql }: { chart: any; baseSql: string }) {
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [name, setName] = useState<string>(chart?.name || "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (chart?.viewId) {
      void fetchSavedView(String(chart.viewId))
        .then((view) => {
          if (alive && view?.name) setName(String(view.name));
        })
        .catch(() => {
          /* the view's own metadata is a nicety, not the point */
        });
    }
    void runSql(baseSql)
      .then((result) => {
        if (alive) setRows(result);
      })
      .catch((err) => {
        if (alive) setError(errorMessage(err));
      });
    return () => {
      alive = false;
    };
  }, [baseSql, chart?.viewId]);

  const table = singleTypeFromSql(baseSql) ?? tableFromSql(baseSql);
  const openable = !!singleTypeFromSql(baseSql) && !isAggregateSql(baseSql);

  return (
    <div className="an-card">
      <div className="an-card-head">
        <div className="an-card-titles">
          <div className="an-card-title">{name || "Saved view"}</div>
          <div className="an-note">
            {rows ? `${rows.length} row${rows.length === 1 ? "" : "s"}` : "Loading…"}
            {openable ? " · click a row to open it" : ""}
          </div>
        </div>
      </div>
      {error ? (
        <div className="alert error">{error}</div>
      ) : !rows ? (
        <Skeleton h={90} />
      ) : rows.length === 0 ? (
        <p className="an-note">This view returned no rows.</p>
      ) : (
        <DataGrid rows={rows} table={table} openable={openable} />
      )}
    </div>
  );
}
