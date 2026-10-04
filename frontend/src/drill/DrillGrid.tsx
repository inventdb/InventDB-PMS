/**
 * A compact, paged, sortable grid of one module's records, for the drill-down
 * panel. Used twice: the related-record sections under a record ("this
 * property's leases") and the "behind this number" list a chart opens.
 *
 * Every page is fetched by the server (`POST /api/drill/<module>`), with the
 * total, so a property with 300 transactions pages through all 300 instead of
 * showing the first few and implying that was everything.
 */
import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from "lucide-react";

import { api, errorMessage } from "../api/client";
import { ENTITY_BY_NAME, type FieldDef } from "../config/entities";
import type { Record as Rec } from "../types";
import { fieldText } from "./relations";
import { Badge } from "../components/ui";

export interface GridQuery {
  filters?: Record<string, unknown>;
  where?: string;
  alias?: string;
}

interface Page {
  items: Rec[];
  total: number;
}

export function DrillGrid({
  entity,
  query,
  title,
  pageSize = 10,
  maxColumns = 5,
  onOpen,
  emptyText,
  hideWhenEmpty = false,
}: {
  entity: string;
  query: GridQuery;
  title: string;
  pageSize?: number;
  maxColumns?: number;
  onOpen: (row: Rec) => void;
  emptyText?: string;
  /** Related sections with nothing in them collapse to the "none" line instead. */
  hideWhenEmpty?: boolean;
}) {
  const cfg = ENTITY_BY_NAME[entity];
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<{ field: string; dir: "asc" | "desc" } | null>(
    cfg?.defaultSort ?? null
  );

  const q = useQuery({
    queryKey: ["drill", "grid", entity, query, page, pageSize, sort],
    queryFn: async () => {
      const { data } = await api.post<Page>(`/drill/${entity}`, {
        ...query,
        limit: pageSize,
        offset: page * pageSize,
        order_by: sort?.field,
        order_dir: sort?.dir,
      });
      return data;
    },
    placeholderData: keepPreviousData,
  });

  if (!cfg) return null;
  const fields: FieldDef[] = cfg.fields.filter((f) => f.table).slice(0, maxColumns);
  const items = q.data?.items ?? [];
  const total = q.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : page * pageSize + 1;
  const last = Math.min(total, page * pageSize + items.length);

  if (hideWhenEmpty && q.isSuccess && total === 0) return null;

  const toggleSort = (field: string) => {
    setSort((s) => (s?.field === field ? { field, dir: s.dir === "asc" ? "desc" : "asc" } : { field, dir: "asc" }));
    setPage(0);
  };

  return (
    <section className="drill-section" aria-label={title}>
      <header className="drill-section-head">
        <h3>{title}</h3>
        <span className="drill-count">{q.isLoading ? "…" : total.toLocaleString()}</span>
      </header>
      {q.isError ? (
        <p className="drill-error">{errorMessage(q.error)}</p>
      ) : q.isLoading ? (
        <p className="drill-muted">Loading…</p>
      ) : total === 0 ? (
        <p className="drill-muted">{emptyText ?? `No ${cfg.labelPlural.toLowerCase()}.`}</p>
      ) : (
        <>
          <div className={`drill-grid-wrap${q.isFetching ? " is-paging" : ""}`}>
            <table className="drill-grid">
              <thead>
                <tr>
                  {!cfg.hideKeyColumn && <th>{cfg.key}</th>}
                  {fields.map((f) => (
                    <th key={f.name} onClick={() => toggleSort(f.name)} className="is-sortable">
                      <span className="th-sort">
                        {f.label}
                        {sort?.field === f.name &&
                          (sort.dir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((row, i) => (
                  <tr
                    key={String(row._id ?? i)}
                    className="is-clickable"
                    tabIndex={0}
                    onClick={() => onOpen(row)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") onOpen(row);
                    }}
                  >
                    {!cfg.hideKeyColumn && <td className="drill-key">{String(row[cfg.key] ?? "—")}</td>}
                    {fields.map((f) => (
                      <td key={f.name}>{f.badge ? <Badge value={row[f.name]} /> : fieldText(f, row[f.name])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {total > pageSize && (
            <nav className="drill-pager" aria-label={`${title} pages`}>
              <span>
                {first.toLocaleString()}–{last.toLocaleString()} of {total.toLocaleString()}
              </span>
              <button
                className="btn-icon"
                aria-label="Previous page"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                <ChevronLeft size={15} />
              </button>
              <span className="drill-page">
                {page + 1} / {pages}
              </span>
              <button
                className="btn-icon"
                aria-label="Next page"
                disabled={page >= pages - 1}
                onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
              >
                <ChevronRight size={15} />
              </button>
            </nav>
          )}
        </>
      )}
    </section>
  );
}
