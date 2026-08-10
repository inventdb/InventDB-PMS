import { useEffect, useMemo, useRef, useState } from "react";
import { FileBarChart, Printer, RefreshCw, Search } from "lucide-react";

import {
  useRenderReport,
  useReportTemplate,
  useReportTemplates,
} from "../api/hooks";
import { errorMessage } from "../api/client";
import { Alert, EmptyState, Spinner } from "../components/ui";
import { ReportFrame, type ReportFrameHandle } from "../components/ReportFrame";
import type { ReportParameter, ReportSummary } from "../types";

/**
 * The Reports section is a viewer for the saved reports defined in InventDB
 * SOAR — it does not define reports of its own. Everything on this page comes
 * from `_System.ReportTemplates` on the connected instance: the gallery is
 * that list, and each sheet is rendered by InventDB's report engine against
 * live data at the moment you open it.
 */
export default function Reports() {
  const templates = useReportTemplates();
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const all = useMemo(() => templates.data?.templates ?? [], [templates.data]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((t) =>
      `${t.name} ${t.description} ${t.category}`.toLowerCase().includes(q)
    );
  }, [all, query]);

  // Open the first report as soon as the gallery arrives, so the page lands on
  // something rather than an instruction to click.
  useEffect(() => {
    if (!selected && all.length) setSelected(all[0].id);
  }, [all, selected]);

  if (templates.isLoading) return <Spinner />;

  if (templates.isError) {
    return (
      <div className="content">
        <PageHead count={0} />
        <Alert kind="error">{errorMessage(templates.error)}</Alert>
      </div>
    );
  }

  if (all.length === 0) {
    return (
      <div className="content">
        <PageHead count={0} />
        <div className="card">
          <EmptyState
            icon={<FileBarChart size={26} />}
            title="No saved reports yet"
            message="This page lists the reports saved on your InventDB instance. Create one in the SOAR app's Report section and it will appear here."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="content">
      <PageHead count={all.length} />

      <div className="report-layout">
        <aside className="report-gallery card card-pad">
          <div className="input-icon" style={{ marginBottom: 12 }}>
            <Search size={15} />
            <input
              className="input"
              placeholder="Find a report…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {visible.length === 0 ? (
            <p className="report-note">No report matches “{query}”.</p>
          ) : (
            <GalleryList
              templates={visible}
              selected={selected}
              onSelect={setSelected}
            />
          )}
        </aside>

        <section className="report-stage">
          {selected && <ReportSheet key={selected} id={selected} />}
        </section>
      </div>
    </div>
  );
}

function PageHead({ count }: { count: number }) {
  return (
    <div className="page-head">
      <div className="titles">
        <h2>Reports</h2>
        <p>
          Saved reports from InventDB SOAR. A report is rendered when you first
          open it and kept until you Refresh.
        </p>
      </div>
      {count > 0 && (
        <div className="actions">
          <span className="count-pill">
            {count} report{count === 1 ? "" : "s"}
          </span>
        </div>
      )}
    </div>
  );
}

/** The gallery, grouped by the category each report declares in SOAR. */
function GalleryList({
  templates,
  selected,
  onSelect,
}: {
  templates: ReportSummary[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const groups = useMemo(() => {
    const byCategory = new Map<string, ReportSummary[]>();
    for (const t of templates) {
      const key = t.category || "Uncategorised";
      const list = byCategory.get(key);
      if (list) list.push(t);
      else byCategory.set(key, [t]);
    }
    return [...byCategory.entries()];
  }, [templates]);

  return (
    <>
      {groups.map(([category, items]) => (
        <div key={category}>
          {groups.length > 1 && <div className="nav-section">{category}</div>}
          {items.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`report-item ${t.id === selected ? "active" : ""}`}
              onClick={() => onSelect(t.id)}
            >
              <span className="report-item-name">{t.name}</span>
              {t.description && (
                <span className="report-item-desc">{t.description}</span>
              )}
            </button>
          ))}
        </div>
      ))}
    </>
  );
}

/** True when every required input has a value. */
function unfilled(params: ReportParameter[], values: Record<string, unknown>) {
  return params
    .filter((p) => p.required && (values[p.name] == null || values[p.name] === ""))
    .map((p) => p.label || p.name);
}

/** Ticks while a render is in flight, so a slow report doesn't look hung. */
function useElapsed(active: boolean): number {
  const [ms, setMs] = useState(0);
  useEffect(() => {
    if (!active) return;
    const started = Date.now();
    setMs(0);
    const timer = window.setInterval(() => setMs(Date.now() - started), 100);
    return () => window.clearInterval(timer);
  }, [active]);
  return ms;
}

/** One report: its inputs, and the sheet InventDB renders from them. */
function ReportSheet({ id }: { id: string }) {
  const detail = useReportTemplate(id);
  const frame = useRef<ReportFrameHandle>(null);

  // `values` is what the form holds; `applied` is the parameter set the
  // current render belongs to. Keeping them apart is what stops a text input
  // from firing a full server-side render on every keystroke — and it gives
  // the render cache a stable key.
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [applied, setApplied] = useState<Record<string, unknown> | null>(null);
  const [missing, setMissing] = useState<string[]>([]);

  const render = useRenderReport(id, applied);
  const params = detail.data?.parameters ?? [];

  // Waiting on the *first* render — `isPending` means no data at all. Any
  // later fetch (Refresh) sets `isFetching` instead, and leaves the existing
  // sheet on screen rather than blanking the page under someone mid-read.
  const awaitingFirst = applied !== null && render.isPending;
  const refreshing = render.isFetching && !!render.data?.html;
  const elapsed = useElapsed(awaitingFirst);

  // Seed the inputs from the template's own defaults, preferring the first
  // option for a picker that has no default — the same seeding SOAR does.
  // When that leaves nothing to ask for, the seeded set is applied straight
  // away and the report renders on open.
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    if (!detail.data) return;
    // Seed once per report. A refetch of the definition hands back a fresh
    // object identity, and re-seeding on that would wipe out inputs the user
    // had just typed.
    if (seededFor.current === id) return;
    seededFor.current = id;

    const seed: Record<string, unknown> = {};
    for (const p of detail.data.parameters) {
      if (p.default != null && p.default !== "") seed[p.name] = p.default;
      else if (p.options.length) seed[p.name] = p.options[0].value;
    }
    setValues(seed);
    setApplied(unfilled(detail.data.parameters, seed).length === 0 ? seed : null);
  }, [detail.data, id]);

  const submit = () => {
    const gaps = unfilled(params, values);
    setMissing(gaps);
    if (gaps.length === 0) setApplied(values);
  };

  if (detail.isLoading) return <Spinner />;
  if (detail.isError) {
    return <Alert kind="error">{errorMessage(detail.error)}</Alert>;
  }

  const meta = render.data?.meta;
  // When these figures were produced — the honest version of "live", now that
  // a cached sheet can be on screen while a fresh one is still being built.
  const renderedAt = render.dataUpdatedAt
    ? new Date(render.dataUpdatedAt).toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "—";

  return (
    <>
      <div className="report-stage-head">
        <div className="titles">
          <h3>{detail.data?.name}</h3>
          {detail.data?.description && (
            <p className="report-note">{detail.data.description}</p>
          )}
        </div>
        <div className="report-stage-actions">
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => render.refetch()}
            disabled={render.isFetching || applied === null}
          >
            <RefreshCw size={14} className={render.isFetching ? "spin" : ""} />
            {render.isFetching ? "Rendering…" : "Refresh"}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => frame.current?.print()}
            disabled={!render.data?.html}
          >
            <Printer size={14} /> Print / PDF
          </button>
        </div>
      </div>

      {params.length > 0 && (
        <div className="card card-pad report-params">
          <div className="report-note" style={{ marginBottom: 10 }}>
            This report takes inputs — set them, then render.
          </div>
          <div className="report-param-grid">
            {params.map((p) => (
              <ParamField
                key={p.name}
                param={p}
                value={values[p.name]}
                onChange={(v) => setValues((prev) => ({ ...prev, [p.name]: v }))}
              />
            ))}
          </div>
          {missing.length > 0 && (
            <div className="report-note" style={{ color: "var(--danger)", marginTop: 10 }}>
              Fill required inputs: {missing.join(", ")}
            </div>
          )}
          <button
            className="btn btn-primary btn-sm"
            style={{ marginTop: 12 }}
            onClick={submit}
            disabled={render.isFetching}
          >
            {render.isFetching ? "Rendering…" : "Render report"}
          </button>
        </div>
      )}

      {render.isError && <Alert kind="error">{errorMessage(render.error)}</Alert>}

      {awaitingFirst ? (
        <div className="report-progress card">
          <div className="spinner" aria-label="Rendering" role="status" />
          <div>
            <div className="report-progress-title">Rendering “{detail.data?.name}”</div>
            <div className="report-note">
              InventDB is re-querying every figure · {(elapsed / 1000).toFixed(1)}s
            </div>
          </div>
        </div>
      ) : render.data?.html ? (
        <>
          <div className={`report-paper ${refreshing ? "is-refreshing" : ""}`}>
            <ReportFrame
              ref={frame}
              html={render.data.html}
              title={detail.data?.name ?? "Report"}
            />
          </div>
          <p className="report-rendered-note">
            {refreshing ? (
              "Re-querying against live data…"
            ) : (
              <>
                Rendered {renderedAt}
                {typeof meta?.elapsed_ms === "number" && ` · ${meta.elapsed_ms} ms`}
              </>
            )}
          </p>
        </>
      ) : (
        !render.isError && (
          <div className="card">
            <EmptyState
              icon={<FileBarChart size={26} />}
              title="Set the inputs above"
              message="Fill this report's inputs, then render."
            />
          </div>
        )
      )}
    </>
  );
}

function ParamField({
  param,
  value,
  onChange,
}: {
  param: ReportParameter;
  value: unknown;
  onChange: (v: string) => void;
}) {
  const current = value == null ? "" : String(value);
  return (
    <div className="field">
      <label htmlFor={`p-${param.name}`}>
        {param.label || param.name}
        {param.required && <span className="req">*</span>}
      </label>
      {param.options.length > 0 ? (
        <select
          id={`p-${param.name}`}
          className="select"
          value={current}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">— choose —</option>
          {param.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={`p-${param.name}`}
          className="input"
          type={param.type === "date" ? "date" : param.type === "number" ? "number" : "text"}
          value={current}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}
