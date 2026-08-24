/**
 * One dashboard widget — ported from InventDB SOAR's
 * `rooms/dashboard/WidgetView.tsx`.
 *
 * Simple kinds are one SQL rendered a standard way. `report` is a mini-report —
 * a report-engine template that may pull from several queries — rendered
 * in-card. `form` is a quick-add card. Edit mode adds a drag handle plus
 * edit/remove. The query behind a figure lives in a footer receipt, so its
 * drawer never overlaps the content.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";

import { useCreate } from "../api/hooks";
import { ENTITY_BY_NAME } from "../config/entities";
import { EntityForm } from "../components/EntityForm";
import { Modal } from "../components/Modal";
import { Receipt, Skeleton, Sql } from "../analyze/ui";
import { formatCurrency, formatDate, formatNumber, titleCase } from "../utils/format";
import { useSql } from "./api";
import { AreaLine, GroupedBars, HBars, Heatmap, PieChart, ScatterPlot } from "./charts";
import { renderWidget } from "./reportWidget";
import { ShadowHtml } from "./ShadowHtml";
import { WIDGET_KIT_CSS } from "./widgetKit";
import type { Widget } from "./types";

type Row = Record<string, unknown>;

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Tween a figure from its previous value to `target` whenever it changes — so a
 * Refresh reads as the number moving rather than swapping. The first value
 * snaps in (no counting up from zero), a mid-flight retarget picks up from
 * what is on screen, and reduced-motion skips it entirely.
 */
function useCountUp(target: number | null, ms = 600): number | null {
  const [val, setVal] = useState<number | null>(target);
  const currentRef = useRef<number | null>(target);
  const rafRef = useRef<number | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    if (target == null) {
      currentRef.current = null;
      setVal(null);
      return;
    }
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!mounted.current || reduced) {
      mounted.current = true;
      currentRef.current = target;
      setVal(target);
      return;
    }
    const from = currentRef.current ?? 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const v = from + (target - from) * easeOutCubic(t);
      currentRef.current = v;
      setVal(v);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [target, ms]);

  return val;
}

function firstNumber(row: Row | undefined): number | null {
  if (!row) return null;
  if (row.v != null && !isNaN(Number(row.v))) return Number(row.v);
  for (const val of Object.values(row)) if (typeof val === "number") return val;
  const only = Object.values(row)[0];
  return only != null && !isNaN(Number(only)) ? Number(only) : null;
}

/** The type a widget reads from, parsed out of its FROM clause. */
function typeOf(w: Widget): string | null {
  const m = w.sql.match(/\bfrom\s+([a-z_][\w]*)\.([a-z_][\w]*)/i);
  return m ? m[2] : null;
}

/** "view →" goes to that type's own module, when the PMS has one for it. */
function targetFor(w: Widget): { to: string; label: string } | null {
  if (w.link) return { to: w.link, label: "view →" };
  const t = typeOf(w);
  if (t && ENTITY_BY_NAME[t]) return { to: `/${t}`, label: "view →" };
  return null;
}

export function WidgetView({
  w,
  editing,
  onEdit,
  onDelete,
  drag,
  refresh,
}: {
  w: Widget;
  editing: boolean;
  onEdit: () => void;
  onDelete: () => void;
  drag?: { onDragStart: () => void; onDragEnd: () => void; dragging: boolean };
  /** Bumped by the room's Refresh — re-runs the query, re-renders the report. */
  refresh?: number;
}) {
  return (
    <section
      className={`card wg span-${w.span}`}
      data-dragging={drag?.dragging ? "true" : undefined}
      draggable={editing}
      onDragStart={editing ? drag?.onDragStart : undefined}
      onDragEnd={editing ? drag?.onDragEnd : undefined}
    >
      <div className="wg-head">
        <h3>
          {editing && (
            <span className="wg-handle" title="Drag to reorder" aria-hidden>
              ⠿
            </span>
          )}
          <span className="wg-title">{w.title}</span>
        </h3>
        {editing && (
          <div className="wg-actions">
            <button className="btn btn-ghost btn-sm" onClick={onEdit}>
              Edit
            </button>
            <button className="btn btn-ghost btn-sm wg-remove" onClick={onDelete}>
              Remove
            </button>
          </div>
        )}
      </div>

      {w.kind === "report" ? (
        <ReportBody w={w} editing={editing} refresh={refresh} />
      ) : w.kind === "form" ? (
        <FormBody w={w} editing={editing} />
      ) : (
        <SimpleBody w={w} editing={editing} refresh={refresh} />
      )}
    </section>
  );
}

/* ── form kind — a quick-add card ───────────────────────────────────────── */

function FormBody({ w, editing }: { w: Widget; editing: boolean }) {
  const [open, setOpen] = useState(false);
  const [added, setAdded] = useState(0);
  const type = w.formType || "";
  const config = ENTITY_BY_NAME[type];
  const create = useCreate(type);

  if (!config)
    return (
      <p className="wg-empty">
        {type
          ? `This app has no ${type} module to add to.`
          : "Edit this widget and pick the type it adds to."}
      </p>
    );

  return (
    <>
      <div className="wg-form">
        <span className="wg-sub">
          Add a new {config.label.toLowerCase()} without leaving the dashboard.
        </span>
        <button className="btn btn-primary" disabled={editing} onClick={() => setOpen(true)}>
          ＋ New {config.label}
        </button>
        {added > 0 && (
          <span className="chip chip-green">
            Added {added} {added === 1 ? config.label.toLowerCase() : config.labelPlural.toLowerCase()} ✓
          </span>
        )}
      </div>
      {/* Portalled to <body>: grid items are transformed while dragging, which
          would otherwise make the modal's fixed positioning relative to the
          widget instead of the viewport. */}
      {open &&
        createPortal(
          <Modal title={`New ${config.label}`} onClose={() => setOpen(false)}>
            <EntityForm
              config={config}
              initial={null}
              submitting={create.isPending}
              onCancel={() => setOpen(false)}
              onSubmit={(values) =>
                create.mutate(values, {
                  onSuccess: () => {
                    setOpen(false);
                    setAdded((n) => n + 1);
                  },
                })
              }
            />
          </Modal>,
          document.body
        )}
    </>
  );
}

/* ── simple kinds — one SQL, a standard render ──────────────────────────── */

function SimpleBody({
  w,
  editing,
  refresh,
}: {
  w: Widget;
  editing: boolean;
  refresh?: number;
}) {
  const navigate = useNavigate();
  const { rows, loading, error } = useSql<Row>(w.sql, [refresh]);
  const fmtNum = (n: unknown) =>
    w.money
      ? formatCurrency(Number(n))
      : typeof n === "number"
        ? formatNumber(n)
        : String(n ?? "—");
  const tgt = targetFor(w);

  const kpiTarget = w.kind === "kpi" && rows.length ? firstNumber(rows[0]) : null;
  const kpiAnim = useCountUp(kpiTarget);

  const body = loading ? (
    <Skeleton h={w.kind === "kpi" ? 40 : 90} />
  ) : error ? (
    <div className="inline-error">{error}</div>
  ) : !rows.length ? (
    <p className="wg-empty">This widget's query returned nothing yet.</p>
  ) : w.kind === "kpi" ? (
    <div className="wg-kpi">
      <span className="wg-kpi-value">
        {kpiTarget == null
          ? fmtNum(firstNumber(rows[0]))
          : fmtNum(Math.round(kpiAnim ?? kpiTarget))}
      </span>
      {!editing && tgt && (
        <button className="wg-link" onClick={() => navigate(tgt.to)}>
          {tgt.label}
        </button>
      )}
    </div>
  ) : w.kind === "list" ? (
    <Listing
      rows={rows}
      fmtNum={fmtNum}
      to={!editing && tgt ? tgt.to : null}
      label={tgt?.label ?? ""}
      navigate={navigate}
    />
  ) : w.kind === "table" ? (
    <TableView rows={rows} money={w.money} />
  ) : (
    <ChartView rows={rows} kind={w.kind} fmtNum={fmtNum} />
  );

  return (
    <>
      {body}
      {!loading && !error && rows.length > 0 && (
        <div className="wg-receipt">
          <Receipt>
            <Sql>{w.sql}</Sql>
          </Receipt>
        </div>
      )}
    </>
  );
}

/* ── report kind — a mini-report rendered in-card ───────────────────────── */

function ReportBody({
  w,
  editing,
  refresh,
}: {
  w: Widget;
  editing: boolean;
  refresh?: number;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!w.templateId) {
      setErr("This widget has no template.");
      return;
    }
    let live = true;
    setErr(null);
    // The prior render stays on screen while re-querying, so a refresh reads as
    // the figures updating in place rather than the card blanking.
    renderWidget(w.templateId, w.sql)
      .then((h) => {
        if (live) setHtml(h);
      })
      .catch((e) => {
        if (live) setErr((e as Error)?.message || "Could not render widget.");
      });
    return () => {
      live = false;
    };
  }, [w.templateId, w.sql, refresh]);

  if (err) return <div className="inline-error">{err}</div>;
  if (html == null) return <Skeleton h={120} />;
  return (
    <>
      <div style={{ pointerEvents: editing ? "none" : undefined }}>
        <ShadowHtml html={html} kitStyles={WIDGET_KIT_CSS} />
      </div>
      <div className="wg-sub wg-receipt">✦ mini report · every figure re-queried live</div>
    </>
  );
}

/* ── renderers ──────────────────────────────────────────────────────────── */

function Listing({
  rows,
  fmtNum,
  to,
  label,
  navigate,
}: {
  rows: Row[];
  fmtNum: (n: unknown) => string;
  to: string | null;
  label: string;
  navigate: (p: string) => void;
}) {
  const keys = Object.keys(rows[0]).filter((k) => !k.startsWith("_") || k === "_id");
  const labelKey = keys.find((k) => typeof rows[0][k] !== "number") ?? keys[0];
  const valKey = keys.find((k) => typeof rows[0][k] === "number") ?? keys[1] ?? keys[0];
  return (
    <div>
      {rows.slice(0, 8).map((r, i) => (
        <div className="metric-row" key={i}>
          <span className="m-label">{String(r[labelKey] ?? "—")}</span>
          <span className="m-value">{valKey === labelKey ? "" : fmtNum(r[valKey])}</span>
        </div>
      ))}
      {to && (
        <button className="btn btn-sm wg-more" onClick={() => navigate(to)}>
          {label}
        </button>
      )}
    </div>
  );
}

function ChartView({
  rows,
  kind,
  fmtNum,
}: {
  rows: Row[];
  kind: Widget["kind"];
  fmtNum: (n: unknown) => string;
}) {
  const keys = Object.keys(rows[0]);
  const labelKey = keys.find((k) => typeof rows[0][k] !== "number") ?? keys[0];
  // Every numeric column besides the label. Two or more, with no `v` alias, is a
  // natural grouped comparison rather than a single-series bar.
  const numKeys = keys.filter((k) => k !== labelKey && typeof rows[0][k] === "number");
  const valKey = rows[0].v != null ? "v" : (numKeys[0] ?? keys[1] ?? keys[0]);
  const points = rows.map((r) => ({
    label: String(r[labelKey] ?? "—"),
    value: Number(r[valKey]) || 0,
  }));

  if (kind === "pie" || kind === "donut")
    return <PieChart data={points} donut={kind === "donut"} />;
  if (kind === "line" || kind === "area") return <AreaLine points={points} />;

  if (kind === "scatter") {
    // Take x and y from ALL numeric columns, not `numKeys` — with no text column
    // the first numeric becomes the label and only one would be left.
    const allNum = keys.filter((k) => typeof rows[0][k] === "number");
    const textK = keys.find((k) => typeof rows[0][k] !== "number");
    const [xk, yk] = allNum;
    if (xk && yk) {
      const sp = rows.map((r) => ({
        x: Number(r[xk]) || 0,
        y: Number(r[yk]) || 0,
        label: textK ? String(r[textK] ?? "") : "",
      }));
      return <ScatterPlot points={sp} />;
    }
    return <HBars data={points} fmt={(n) => fmtNum(n)} />;
  }

  if (kind === "heatmap") {
    const dims = keys.filter((k) => typeof rows[0][k] !== "number");
    const [rowK, colK] = dims;
    if (rowK && colK && valKey) {
      const yLabels = Array.from(new Set(rows.map((r) => String(r[rowK] ?? "—"))));
      const xLabels = Array.from(new Set(rows.map((r) => String(r[colK] ?? "—"))));
      const idx = new Map<string, number>();
      rows.forEach((r) => idx.set(`${r[rowK]} ${r[colK]}`, Number(r[valKey]) || 0));
      const matrix = yLabels.map((y) => xLabels.map((x) => idx.get(`${y} ${x}`) ?? NaN));
      return <Heatmap matrix={matrix} xLabels={xLabels} yLabels={yLabels} />;
    }
    return <HBars data={points} fmt={(n) => fmtNum(n)} />;
  }

  // A bar or histogram whose query returns 2+ numeric columns is a grouped
  // comparison, not one series.
  if ((kind === "bar" || kind === "histogram") && rows[0].v == null && numKeys.length > 1) {
    const categories = rows.map((r) => String(r[labelKey] ?? "—"));
    const series = numKeys.map((k) => ({
      name: titleCase(k),
      values: rows.map((r) => Number(r[k]) || 0),
    }));
    return <GroupedBars categories={categories} series={series} />;
  }

  return <HBars data={points} fmt={(n) => fmtNum(n)} />;
}

/**
 * One table cell: currency when the column is money-ish, a readable date when
 * the value is a full ISO timestamp — so a cell never shows `…T00:00:00.000Z` —
 * and otherwise the raw value. Date-only strings are already readable.
 */
function cell(v: unknown, moneyish: boolean): string {
  if (v == null) return "—";
  if (moneyish && typeof v === "number") return formatCurrency(v);
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return formatDate(v);
  return String(v);
}

function TableView({ rows, money }: { rows: Row[]; money?: boolean }) {
  const cols = Object.keys(rows[0])
    .filter((k) => !k.startsWith("_") || k === "_id")
    .slice(0, 6);
  const moneyish = (c: string) => !!money && /rent|cost|amount|price|value|fee|balance|est/i.test(c);
  return (
    <div className="table-wrap wg-table">
      <table className="data">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c}>{c === "_id" ? "ID" : titleCase(c)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 8).map((r, i) => (
            <tr key={i}>
              {cols.map((c) => (
                <td key={c} className={typeof r[c] === "number" ? "num" : undefined}>
                  {cell(r[c], moneyish(c))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
