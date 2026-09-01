/**
 * Report Studio — one library, one stage, ported from InventDB SOAR.
 *
 * A report here is one of two things, and they share a single searchable list
 * so you don't hunt across two screens:
 *
 *   • a LIVE template — HTML with `<script type="server">` blocks that re-query
 *     at render time. Editable by instruction, parameterised, versioned.
 *   • a SNAPSHOT — a point-in-time render the assistant stored. Its figures are
 *     frozen; it can be promoted to a live template to make it self-updating.
 *
 * That split is real at the engine level (a re-rendering definition versus a
 * frozen render), so both are kept — but the difference is stated rather than
 * implied, because "why are these numbers stale?" is the question it answers.
 *
 * InventDB owns the authoring: its report agent rewrites the layout and its
 * engine versions the result. This page is the studio around that.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Clock,
  FileBarChart,
  Link2,
  Printer,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";

import {
  useRenderReport,
  useReportTemplate,
  useReportTemplates,
} from "../api/hooks";
import { errorMessage } from "../api/client";
import {
  useDeleteReport,
  useDeleteReports,
  useDeleteSnapshot,
  usePromoteSnapshot,
  useRenameReport,
  useReportSnapshots,
  useSnapshotHtml,
  type ReportSnapshot,
} from "../reports/api";
import {
  DetailRow,
  EditableName,
  EditByInstruction,
  Tabs,
} from "../reports/StudioParts";
import { Alert, EmptyState, Spinner } from "../components/ui";
import { ConfirmDialog } from "../components/Modal";
import { ReportFrame, type ReportFrameHandle } from "../components/ReportFrame";
import { useToast } from "../components/Toast";
import { formatDate } from "../utils/format";
import type { ReportParameter, ReportSummary } from "../types";

/** One row in the unified library. */
type ReportItem =
  | {
      key: string;
      kind: "template";
      name: string;
      templateId: string;
      description?: string;
      category?: string;
      version?: number;
    }
  | {
      key: string;
      kind: "snapshot";
      name: string;
      snapshot: ReportSnapshot;
    };

export default function Reports() {
  const toast = useToast();
  const templates = useReportTemplates();
  const snapshots = useReportSnapshots();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("edit");
  const [confirmDelete, setConfirmDelete] = useState<ReportItem | null>(null);
  // Selection is held as library keys rather than as items, so it survives the
  // list re-fetching underneath it and cannot pin a stale copy of a report.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);
  // Bumped after an AI edit so the stage re-fetches the definition and re-renders.
  const [editKey, setEditKey] = useState(0);

  const rename = useRenameReport();
  const deleteReport = useDeleteReport();
  const deleteSnapshot = useDeleteSnapshot();
  const deleteMany = useDeleteReports();
  const promote = usePromoteSnapshot();

  const templateRows = useMemo(() => templates.data?.templates ?? [], [templates.data]);
  const snapshotRows = useMemo(() => snapshots.data?.snapshots ?? [], [snapshots.data]);

  /**
   * The library. A live template and the snapshot the assistant rendered while
   * building it are the same report twice — once the live one exists it is the
   * canonical, self-updating copy, so the redundant snapshot is hidden. Genuine
   * one-off snapshots, and orphans whose template was deleted, still show.
   */
  const items = useMemo<ReportItem[]>(() => {
    const liveNames = new Set(
      templateRows.map((t) => (t.name || "").trim().toLowerCase())
    );
    return [
      ...templateRows.map(
        (t: ReportSummary): ReportItem => ({
          key: `t:${t.id}`,
          kind: "template",
          name: t.name,
          templateId: t.id,
          description: t.description,
          category: t.category,
          version: t.version as number | undefined,
        })
      ),
      ...snapshotRows
        .filter(
          (s) => !(s.from_template && liveNames.has((s.name || "").trim().toLowerCase()))
        )
        .map(
          (s): ReportItem => ({
            key: `s:${s.record_id}:${s.attachment_id}`,
            kind: "snapshot",
            name: s.name,
            snapshot: s,
          })
        ),
    ];
  }, [templateRows, snapshotRows]);

  // `?open=` accepts a library key or a bare template id (a shared link).
  const [activeKey, setActiveKey] = useState<string>(() => {
    const open = params.get("open");
    if (!open) return "";
    return /^(t|s):/.test(open) ? open : `t:${open}`;
  });
  const active = items.find((i) => i.key === activeKey) ?? null;

  // Land on something rather than an instruction to click.
  useEffect(() => {
    if (!activeKey && items.length) setActiveKey(items[0].key);
  }, [items, activeKey]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((i) =>
      `${i.name} ${i.kind === "template" ? `${i.description ?? ""} ${i.category ?? ""} live` : "snapshot"}`
        .toLowerCase()
        .includes(needle)
    );
  }, [items, query]);

  const loading = templates.isLoading || snapshots.isLoading;

  // ---- Selection ---------------------------------------------------------
  // Everything below works on the *visible* rows. Select-all that quietly took
  // in rows a search had filtered out would be a bulk delete of records the
  // operator cannot see, which is the one thing this control must never do.
  const chosen = useMemo(
    () => visible.filter((i) => selected.has(i.key)),
    [visible, selected]
  );
  const allChosen = visible.length > 0 && chosen.length === visible.length;
  const someChosen = chosen.length > 0 && !allChosen;

  // A deleted report leaves its key behind. Dropping keys the library no longer
  // holds keeps the count honest and stops a stale key resurrecting a tick.
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const live = new Set(items.map((i) => i.key));
      const next = new Set([...prev].filter((k) => live.has(k)));
      return next.size === prev.size ? prev : next;
    });
  }, [items]);

  function toggleOne(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allChosen) visible.forEach((i) => next.delete(i.key));
      else visible.forEach((i) => next.add(i.key));
      return next;
    });
  }

  async function doBulkDelete() {
    const targets = chosen;
    let deleted = 0;
    let failed: string[] = [];
    try {
      ({ deleted, failed } = await deleteMany.mutateAsync(
        targets.map((i) =>
          i.kind === "template"
            ? ({ kind: "template", id: i.templateId, name: i.name } as const)
            : ({ kind: "snapshot", recordId: i.snapshot.record_id, name: i.name } as const)
        )
      ));
    } catch (err) {
      // The mutation handles a per-report failure itself, so reaching here means
      // the run did not get that far. Close the dialog anyway: leaving it open
      // over an error is an invitation to press Delete a second time.
      setConfirmBulk(false);
      toast.error(errorMessage(err));
      return;
    }
    if (targets.some((i) => i.key === activeKey)) setActiveKey("");
    setSelected(new Set());
    setConfirmBulk(false);
    if (failed.length) {
      // Naming the survivors matters more than the total: the operator has to
      // know which reports are still there before deciding what to do next.
      toast.error(
        `Deleted ${deleted}. Could not delete ${failed.length}: ${failed
          .slice(0, 3)
          .join(", ")}${failed.length > 3 ? "…" : ""}`
      );
    } else {
      toast.success(`Deleted ${deleted} report${deleted === 1 ? "" : "s"}.`);
    }
  }

  async function doDelete(item: ReportItem) {
    try {
      if (item.kind === "template") await deleteReport.mutateAsync(item.templateId);
      else await deleteSnapshot.mutateAsync(item.snapshot.record_id);
      if (item.key === activeKey) setActiveKey("");
      toast.success(`Deleted “${item.name}”`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setConfirmDelete(null);
    }
  }

  async function doPromote(snapshot: ReportSnapshot) {
    try {
      const result = await promote.mutateAsync(snapshot);
      toast.success("Converted to a live template — it now re-renders with current data.");
      if (result?.id) setActiveKey(`t:${result.id}`);
      setTab("edit");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  if (loading) return <Spinner />;

  if (templates.isError) {
    return (
      <div className="content">
        <PageHead count={0} />
        <Alert kind="error">{errorMessage(templates.error)}</Alert>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="content">
        <PageHead count={0} />
        <div className="card">
          <EmptyState
            icon={<FileBarChart size={26} />}
            title="No reports yet"
            message="Ask Analyze for a report — “build me a monthly rent-collection report” — and it appears here, ready to edit."
            action={
              <a className="btn btn-primary" href="/analyze">
                <Sparkles size={16} /> Create one in Analyze
              </a>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="content">
      <PageHead count={items.length} />

      <div className="rs-layout">
        {/* Library */}
        <aside className="rs-library card card-pad">
          <div className="input-icon">
            <Search size={15} />
            <input
              className="input"
              placeholder="Search reports…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {/* The count belongs beside the list it counts, not only in the page
              head: with a search box above it, "6 reports" three hundred pixels
              away answers a question nobody asked once the list is filtered. */}
          <div className="rs-tools">
            <label className="rs-check rs-check-all" title="Select every report shown">
              <input
                type="checkbox"
                checked={allChosen}
                ref={(el) => {
                  if (el) el.indeterminate = someChosen;
                }}
                onChange={toggleAllVisible}
                disabled={visible.length === 0}
                aria-label={allChosen ? "Clear selection" : "Select every report shown"}
              />
            </label>
            {chosen.length > 0 ? (
              <>
                <span className="rs-tools-count">{chosen.length} selected</span>
                <button
                  type="button"
                  className="btn btn-danger btn-sm rs-bulk-del"
                  onClick={() => setConfirmBulk(true)}
                  disabled={deleteMany.isPending}
                >
                  <Trash2 size={14} />
                  Delete {chosen.length}
                </button>
              </>
            ) : (
              <span className="rs-tools-count">
                {/* Filtered: say what is on screen *and* what is not, so a
                    shrinking list reads as a search rather than a loss. */}
                {query.trim() && visible.length !== items.length
                  ? `${visible.length} of ${items.length} reports`
                  : `${items.length} report${items.length === 1 ? "" : "s"}`}
              </span>
            )}
          </div>
          <div className="rs-list">
            {visible.length === 0 ? (
              <p className="report-note">No report matches “{query}”.</p>
            ) : (
              visible.map((item) => (
                <div
                  key={item.key}
                  className={`rs-row ${item.key === activeKey ? "active" : ""}${
                    selected.has(item.key) ? " is-chosen" : ""
                  }`}
                >
                  <label className="rs-check" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selected.has(item.key)}
                      onChange={() => toggleOne(item.key)}
                      aria-label={`Select ${item.name}`}
                    />
                  </label>
                  <button
                    type="button"
                    className="rs-row-open"
                    onClick={() => {
                      setActiveKey(item.key);
                      const next = new URLSearchParams(params);
                      next.delete("open");
                      setParams(next, { replace: true });
                    }}
                  >
                    <span className="rs-row-name">{item.name}</span>
                    <span className="rs-row-meta">
                      <span
                        className={`rs-tag ${item.kind === "template" ? "is-live" : "is-snapshot"}`}
                      >
                        {item.kind === "template" ? "Live" : "Snapshot"}
                      </span>
                      {item.kind === "template"
                        ? `re-runs live${item.version ? ` · v${item.version}` : ""}`
                        : item.snapshot.created_at
                          ? formatDate(item.snapshot.created_at)
                          : "frozen"}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="btn-icon rs-row-del"
                    title={`Delete “${item.name}”`}
                    aria-label={`Delete ${item.name}`}
                    onClick={() => setConfirmDelete(item)}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))
            )}
          </div>
          <a className="btn btn-ghost btn-sm rs-new" href="/analyze">
            <Sparkles size={15} /> New report in Analyze
          </a>
        </aside>

        {/* Stage */}
        <section className="rs-stage">
          {!active ? (
            <div className="card">
              <EmptyState
                icon={<FileBarChart size={26} />}
                title="Pick a report"
                message="Choose one from the library to render, edit or share it."
              />
            </div>
          ) : active.kind === "template" ? (
            <TemplateSheet
              key={`${active.templateId}:${editKey}`}
              id={active.templateId}
              name={active.name}
              onRename={async (next) => {
                await rename.mutateAsync({ id: active.templateId, name: next });
                toast.success("Renamed");
              }}
              validateName={(next) => {
                const low = next.trim().toLowerCase();
                const clash = items.some(
                  (i) =>
                    i.kind === "template" &&
                    i.templateId !== active.templateId &&
                    i.name.trim().toLowerCase() === low
                );
                return clash ? "A report with that name already exists." : null;
              }}
            />
          ) : (
            <SnapshotSheet item={active.snapshot} />
          )}
        </section>

        {/* Controls */}
        <aside className="rs-rail">
          <div className="card card-pad">
            <Tabs
              tabs={[
                { id: "edit", label: "Edit" },
                { id: "share", label: "Share" },
                { id: "history", label: "History" },
              ]}
              active={tab}
              onChange={setTab}
            />

            {tab === "edit" && (
              <div className="rs-panel">
                {active?.kind === "template" ? (
                  <EditByInstruction
                    templateId={active.templateId}
                    onApplied={() => {
                      setEditKey((k) => k + 1);
                      void templates.refetch();
                    }}
                  />
                ) : active?.kind === "snapshot" ? (
                  <div className="rs-panel-body">
                    <p className="report-note">
                      This is a <b>saved snapshot</b> — its figures are frozen
                      {active.snapshot.created_at
                        ? ` as of ${formatDate(active.snapshot.created_at)}`
                        : ""}
                      . Convert it to a live template to make it self-updating and
                      editable by instruction.
                    </p>
                    <button
                      className="btn btn-primary btn-sm"
                      disabled={promote.isPending}
                      onClick={() => void doPromote(active.snapshot)}
                    >
                      <Sparkles size={15} />
                      {promote.isPending ? "Converting…" : "Convert to live template"}
                    </button>
                  </div>
                ) : (
                  <p className="report-note rs-panel-body">
                    Pick a report to edit.
                  </p>
                )}
              </div>
            )}

            {tab === "share" && (
              <div className="rs-panel rs-panel-body">
                <ShareRow itemKey={activeKey} />
                {active && (
                  <div className="rs-panel-section">
                    <div className="rs-panel-title">Schedule as a workflow</div>
                    <p className="report-note">
                      Puts this report on a recurring workflow that renders and emails
                      it — always with current data.
                      {active.kind === "snapshot" &&
                        " A snapshot is converted to a live template first, so each run sends fresh numbers."}
                    </p>
                    <a
                      className="btn btn-primary btn-sm"
                      href={`/analyze?q=${encodeURIComponent(
                        `Create a scheduled workflow that renders the live report "${active.name}" with current data and emails it. Ask me for the schedule and the recipient, then build it in the sandbox so I can rehearse and activate it.`
                      )}`}
                    >
                      <Clock size={15} /> Schedule in Analyze
                    </a>
                  </div>
                )}
              </div>
            )}

            {tab === "history" && (
              <div className="rs-panel rs-panel-body">
                {active?.kind === "template" ? (
                  <>
                    <DetailRow label="Current version">
                      v{active.version ?? 1}
                    </DetailRow>
                    {active.category && (
                      <DetailRow label="Category">{active.category}</DetailRow>
                    )}
                    {active.description && (
                      <DetailRow label="About">{active.description}</DetailRow>
                    )}
                    <p className="report-note">
                      Edits are append-only — each change bumps the version, and
                      nothing in your data is overwritten.
                    </p>
                  </>
                ) : active?.kind === "snapshot" ? (
                  <>
                    <DetailRow label="Generated">
                      {active.snapshot.created_at
                        ? formatDate(active.snapshot.created_at)
                        : "—"}
                    </DetailRow>
                    <DetailRow label="Source">
                      {active.snapshot.from_template
                        ? "Rendered from a template"
                        : "Generated in Analyze"}
                    </DetailRow>
                    <p className="report-note">
                      A snapshot is a frozen render kept for the record — its figures
                      don't change.
                    </p>
                  </>
                ) : (
                  <p className="report-note">Pick a report to see its history.</p>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete “${confirmDelete.name}”?`}
          message={
            confirmDelete.kind === "template"
              ? "This removes the report from your InventDB instance, for everyone. This can't be undone."
              : "This removes the saved snapshot and its source. This can't be undone."
          }
          confirmLabel="Delete"
          busy={deleteReport.isPending || deleteSnapshot.isPending}
          onConfirm={() => void doDelete(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {confirmBulk && (
        <ConfirmDialog
          title={`Delete ${chosen.length} report${chosen.length === 1 ? "" : "s"}?`}
          message={
            // Naming them is the point. "Delete 6 reports?" is not a question
            // anyone can answer safely without knowing which six.
            `${chosen
              .slice(0, 6)
              .map((i) => `“${i.name}”`)
              .join(", ")}${chosen.length > 6 ? `, and ${chosen.length - 6} more` : ""}. ` +
            "Live reports are removed from your InventDB instance, for everyone. " +
            "This can't be undone."
          }
          confirmLabel={`Delete ${chosen.length}`}
          busy={deleteMany.isPending}
          onConfirm={() => void doBulkDelete()}
          onCancel={() => setConfirmBulk(false)}
        />
      )}

    </div>
  );
}

function PageHead({ count }: { count: number }) {
  return (
    <div className="page-head">
      <div className="titles">
        <h2>Reports</h2>
        <p>
          Live reports re-query your data every time you open them, and can be
          renamed or rewritten by describing the change. Snapshots keep the numbers
          from when they were taken.
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

/** One live report: its inputs, and the sheet InventDB renders from them. */
function TemplateSheet({
  id,
  name,
  onRename,
  validateName,
}: {
  id: string;
  name: string;
  onRename: (next: string) => Promise<void>;
  validateName: (next: string) => string | null;
}) {
  const detail = useReportTemplate(id);
  const frame = useRef<ReportFrameHandle>(null);

  // `values` is what the form holds; `applied` is the parameter set the current
  // render belongs to. Keeping them apart stops a text input from firing a
  // server-side render on every keystroke, and gives the cache a stable key.
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [applied, setApplied] = useState<Record<string, unknown> | null>(null);
  const [missing, setMissing] = useState<string[]>([]);

  const render = useRenderReport(id, applied);
  const params = detail.data?.parameters ?? [];

  const awaitingFirst = applied !== null && render.isPending;
  const refreshing = render.isFetching && !!render.data?.html;
  const elapsed = useElapsed(awaitingFirst);

  // Seed from the template's own defaults, preferring the first option for a
  // picker with none. When that leaves nothing to ask for, render on open.
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    if (!detail.data) return;
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
  if (detail.isError) return <Alert kind="error">{errorMessage(detail.error)}</Alert>;

  const meta = render.data?.meta;
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
        <div className="titles rs-head-titles">
          <EditableName value={name} onCommit={onRename} validate={validateName} />
          <span className="rs-tag is-live">Live</span>
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
      {detail.data?.description && (
        <p className="report-note">{detail.data.description}</p>
      )}

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
            <div className="report-progress-title">Rendering “{name}”</div>
            <div className="report-note">
              InventDB is re-querying every figure · {(elapsed / 1000).toFixed(1)}s
            </div>
          </div>
        </div>
      ) : render.data?.html ? (
        <>
          <div className={`report-paper ${refreshing ? "is-refreshing" : ""}`}>
            <ReportFrame ref={frame} html={render.data.html} title={name} />
          </div>
          <p className="report-rendered-note">
            {refreshing ? (
              "Re-querying against live data…"
            ) : (
              <>
                Rendered {renderedAt}
                {typeof meta?.elapsed_ms === "number" && ` · ${meta.elapsed_ms} ms`}
                {" · every figure re-queried"}
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

/** A stored snapshot — frozen HTML, shown on the same sheet. */
function SnapshotSheet({ item }: { item: ReportSnapshot }) {
  const snapshot = useSnapshotHtml(item);
  const frame = useRef<ReportFrameHandle>(null);

  return (
    <>
      <div className="report-stage-head">
        <div className="titles rs-head-titles">
          <h3>{item.name}</h3>
          <span className="rs-tag is-snapshot">Snapshot</span>
        </div>
        <div className="report-stage-actions">
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => frame.current?.print()}
            disabled={!snapshot.data?.html}
          >
            <Printer size={14} /> Print / PDF
          </button>
        </div>
      </div>

      {snapshot.isError ? (
        <Alert kind="error">{errorMessage(snapshot.error)}</Alert>
      ) : snapshot.isPending ? (
        <Spinner />
      ) : (
        <>
          <div className="report-paper">
            <ReportFrame ref={frame} html={snapshot.data.html} title={item.name} />
          </div>
          <p className="report-rendered-note">
            Saved snapshot · figures frozen
            {item.created_at ? ` as of ${formatDate(item.created_at)}` : ""} — convert
            it to a live template for current data
          </p>
        </>
      )}
    </>
  );
}

function ShareRow({ itemKey }: { itemKey: string }) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/reports?open=${encodeURIComponent(itemKey)}`;
  return (
    <div className="rs-panel-section">
      <div className="rs-panel-title">Share a link</div>
      <p className="report-note">
        Opens this report here and re-renders from current data. Recipients see only
        what their InventDB role allows.
      </p>
      <div className="rs-share">
        <span className="rs-share-url" title={url}>
          <Link2 size={13} aria-hidden /> {url}
        </span>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => {
            navigator.clipboard?.writeText(url).catch(() => {});
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
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
