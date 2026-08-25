import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { keepPreviousData, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";

import { useCreate, useDelete, useList, useUpdate } from "../api/hooks";
import { api, errorMessage } from "../api/client";
import {
  ENTITY_BY_NAME,
  recordTitle,
  type EntityConfig,
  type FieldDef,
} from "../config/entities";
import type { Record as Rec } from "../types";
import { formatCell } from "../utils/format";
import { Icon } from "../components/Icon";
import { EntityForm } from "../components/EntityForm";
import { ConfirmDialog, Modal } from "../components/Modal";
import { useReferences } from "../components/references";
import { ScrollX } from "../components/ScrollX";
import { useToast } from "../components/Toast";
import { Alert, Badge, EmptyState, Spinner } from "../components/ui";
import { ViewSwitcher } from "../views/ViewSwitcher";
import { ViewDesigner, type DesignedView } from "../views/ViewDesigner";
import { ReportFrame } from "../components/ReportFrame";
import {
  useCreateView,
  useDeleteViews,
  useRenderedView,
  useSetDefaultView,
  useUpdateView,
  useViews,
  type SavedView,
} from "../views/api";

/** Rows per page. 50 fills a desktop pane without over-fetching on a phone. */
const DEFAULT_PAGE_SIZE = 50;
const PAGE_SIZES = [25, 50, 100, 200];

export default function EntityListPage() {
  const { entity = "" } = useParams();
  const config = ENTITY_BY_NAME[entity];
  if (!config) {
    return (
      <div className="content">
        <EmptyState title="Unknown module" message={`No module named "${entity}".`} />
      </div>
    );
  }
  // key ensures state resets when navigating between entities
  return <EntityModule key={config.name} config={config} />;
}

function EntityModule({ config }: { config: EntityConfig }) {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [rawSearch, setRawSearch] = useState(() => params.get("q") ?? "");
  const [q, setQ] = useState(() => params.get("q")?.trim() ?? "");
  const [sort, setSort] = useState<{ field: string; dir: "asc" | "desc" }>(
    config.defaultSort ?? { field: config.key, dir: "asc" }
  );
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Rec | null>(null);
  const [deleting, setDeleting] = useState<Rec | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  // --- Saved views -------------------------------------------------------
  // `null` means the unfiltered "All <module>" list. A view is only ever the
  // *source* of the search and sort below — once applied it stops being
  // authoritative, so editing the search box leaves the view selected rather
  // than silently rewriting what was saved.
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [designing, setDesigning] = useState(false);
  /** The saved view the designer is amending. null = designing a new one. */
  const [editingView, setEditingView] = useState<SavedView | null>(null);
  const [savingView, setSavingView] = useState(false);
  const [viewName, setViewName] = useState("");
  const qc = useQueryClient();
  const views = useViews(config.name);
  const createView = useCreateView(config.name);
  const updateView = useUpdateView(config.name);
  const deleteViews = useDeleteViews(config.name);
  const setDefaultView = useSetDefaultView(config.name);

  // A custom view replaces the grid with a layout the designer built, so the
  // page has to know which surface it is drawing before it draws either.
  const activeView = (views.data ?? []).find((v) => v.id === activeViewId) ?? null;
  const customView = activeView?.mode === "custom" ? activeView : null;

  function applyView(view: SavedView) {
    setDesigning(false);
    setActiveViewId(view.id);
    setRawSearch(view.search);
    setQ(view.search.trim());
    if (view.sort) setSort({ field: view.sort.col, dir: view.sort.dir });
    setPage(0);
  }

  function applyAllView() {
    setDesigning(false);
    setActiveViewId(null);
    setRawSearch("");
    setQ("");
    setSort(config.defaultSort ?? { field: config.key, dir: "asc" });
    setPage(0);
  }

  // Open the pinned default once, on first load of this module. A `?q=` in the
  // URL wins: someone following a deep link asked for that specific list, and
  // replacing it with a saved view would discard the thing they clicked.
  const defaultApplied = useRef(false);
  useEffect(() => {
    if (defaultApplied.current || views.isLoading) return;
    defaultApplied.current = true;
    if (params.get("q")) return;
    const pinned = (views.data ?? []).find((v) => v.is_default);
    if (pinned) applyView(pinned);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [views.isLoading, views.data]);

  async function saveDesignedView(designed: DesignedView, name: string) {
    try {
      if (editingView) {
        // The template is edited in place upstream, so the view keeps its id,
        // its default flag and its place in the list — a change to a view, not
        // a second view that looks like it.
        await updateView.mutateAsync({
          id: editingView.id,
          patch: {
            name,
            template_id: designed.template_id,
            base_sql: designed.base_sql ?? undefined,
          },
        });
        closeDesigner();
        setActiveViewId(editingView.id);
        setPage(0);
        // The layout changed under the same template id, so the cached render
        // for this view is stale.
        await qc.invalidateQueries({ queryKey: ["view-render", config.name] });
        toast.success(`Updated “${name}”`);
        return;
      }
      const created = await createView.mutateAsync({
        name,
        template_id: designed.template_id,
        base_sql: designed.base_sql ?? undefined,
      });
      closeDesigner();
      setActiveViewId(created?.id ?? null);
      setPage(0);
      toast.success(`Saved “${name}”`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  function closeDesigner() {
    setDesigning(false);
    setEditingView(null);
  }

  function editView(view: SavedView) {
    setEditingView(view);
    setDesigning(true);
  }

  async function saveCurrentView() {
    const name = viewName.trim();
    if (!name) return;
    try {
      const created = await createView.mutateAsync({
        name,
        // `rawSearch`, not the debounced `q`: saving straight after typing
        // should capture what the box says, not the term the list happens to
        // have caught up with 300ms ago.
        search: rawSearch.trim(),
        sort: { col: sort.field, dir: sort.dir },
      });
      setActiveViewId(created?.id ?? null);
      setSavingView(false);
      setViewName("");
      toast.success(`Saved “${name}”`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  // Debounce search input. The page resets with the term rather than in an
  // effect watching it: an effect runs *after* the render that already fired a
  // query, so changing the term while deep in the list sent one request at the
  // old offset — off the end of the new result — before the reset landed.
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(rawSearch.trim());
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [rawSearch]);

  // One page at a time, fetched by the server. The whole table used to arrive
  // in a single 1000-row request, which both stalled the big modules and put
  // every record past the thousandth out of reach — Accounting alone holds
  // 2,262. Search, sort and filters are already applied server-side, so the
  // page is a page of the *result*, not of a slice we then narrow.
  const list = useList(
    config.name,
    {
      q: q || undefined,
      order_by: sort.field,
      order_dir: sort.dir,
      limit: pageSize,
      offset: page * pageSize,
    },
    // Hold the previous page on screen while the next one loads, so paging
    // doesn't flash the empty state and collapse the table's height.
    // Skipped entirely for a custom view: its rows come from the report engine,
    // so fetching the grid's page as well would be a wasted round trip.
    { placeholderData: keepPreviousData, enabled: !customView }
  );

  const rendered = useRenderedView(config.name, customView, page, pageSize);

  const create = useCreate(config.name);
  const update = useUpdate(config.name);
  const del = useDelete(config.name);

  const tableFields = useMemo(
    () => config.fields.filter((f) => f.table),
    [config]
  );
  const refEntities = useMemo(
    () => tableFields.filter((f) => f.ref).map((f) => f.ref as string),
    [tableFields]
  );
  const { labels } = useReferences(refEntities);

  const items = list.data?.items ?? [];
  // Both surfaces page the same way; only the source of the count differs.
  const total = customView ? rendered.data?.total ?? 0 : list.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const firstRow = total === 0 ? 0 : page * pageSize + 1;
  const lastRow = customView
    ? Math.min(total, (page + 1) * pageSize)
    : Math.min(total, page * pageSize + items.length);
  const loading = customView ? rendered.isLoading : list.isLoading;

  // Deleting the last row of the last page, or any change that shortens the
  // result while paged deep into it, leaves `offset` past the end. Step back to
  // the last page that still has rows rather than showing "no records".
  const fetching = customView ? rendered.isFetching : list.isFetching;
  useEffect(() => {
    if (fetching) return;
    if (total > 0 && page > 0 && page >= pageCount) setPage(pageCount - 1);
  }, [total, page, pageCount, fetching]);

  // `?focus=<id>` opens one record straight away. Analyze links here when a
  // result row is clicked — this app has no separate record page, so the module
  // list with that record open IS the record view. Consumed once, then dropped
  // from the URL so a later refresh doesn't reopen the dialog.
  const focusId = params.get("focus");
  const focusedOnce = useRef<string | null>(null);
  useEffect(() => {
    if (!focusId || list.isLoading) return;
    if (focusedOnce.current === focusId) return;
    focusedOnce.current = focusId;
    const match = items.find((r) => String(r._id ?? "") === focusId);
    if (match) {
      setEditing(match);
      setModalOpen(true);
    } else {
      // Not on this page is not the same as gone — and now that the table is
      // paged, a focused record being absent from the current page is the
      // normal case rather than the exception. Fetch the one record by id, and
      // only call it missing if InventDB agrees it is.
      void api
        .get<Rec>(`/${config.name}/${focusId}`)
        .then(({ data }) => {
          if (data && data._id != null) {
            setEditing(data);
            setModalOpen(true);
          } else {
            toast.error("That record is no longer in this list.");
          }
        })
        .catch(() => toast.error("That record is no longer in this list."));
    }
    const next = new URLSearchParams(params);
    next.delete("focus");
    setParams(next, { replace: true });
    // `items` is a fresh array each render; the ref guard is what makes this
    // run once per focused id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, list.isLoading, items.length]);

  // Re-sorting reorders the whole result, not the page, so the row you were
  // looking at is not on page 4 any more. Go back to the top of the new order.
  const toggleSort = (field: string) => {
    setSort((prev) =>
      prev.field === field
        ? { field, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { field, dir: "asc" }
    );
    setPage(0);
  };

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };
  const openEdit = (record: Rec) => {
    setEditing(record);
    setModalOpen(true);
  };

  const handleSubmit = async (values: Rec) => {
    try {
      if (editing?._id) {
        await update.mutateAsync({ id: String(editing._id), payload: values });
        toast.success(`${config.label} updated`);
      } else {
        await create.mutateAsync(values);
        toast.success(`${config.label} created`);
      }
      setModalOpen(false);
      setEditing(null);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const handleDelete = async () => {
    if (!deleting?._id) return;
    try {
      await del.mutateAsync(String(deleting._id));
      toast.success(`${config.label} deleted`);
      setDeleting(null);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const renderCell = (record: Rec, field: FieldDef) => {
    const value = record[field.name];
    if (field.badge) return <Badge value={value} />;
    if (field.ref && value != null && value !== "") {
      const label = labels[field.ref]?.[String(value)];
      return (
        <span title={String(value)}>
          {label ? label : String(value)}
        </span>
      );
    }
    return formatCell(value, field.type);
  };

  const submitting = create.isPending || update.isPending;

  return (
    // `content-fill` gives the TABLE the height the window has left, so the
    // column heads can lock to it while the rows scroll underneath. A designed
    // view is not a table — it is a document, and it has to be allowed to run
    // past the fold and let the page scroll. Locking the page around it clipped
    // everything below the first screen with nothing to scroll.
    <div className={`content${customView || designing ? "" : " content-fill"}`}>
      <div className="page-head">
        <div className="stat-ico" style={{ width: 40, height: 40 }}>
          <Icon name={config.icon} size={20} />
        </div>
        <div className="titles">
          <h2>{config.labelPlural}</h2>
          <p>
            Manage your {config.labelPlural.toLowerCase()} — create, edit and track
            records stored in InventDB.
          </p>
        </div>
        <div className="actions">
          <button className="btn btn-primary" onClick={openCreate}>
            <Plus size={16} /> New {config.label}
          </button>
        </div>
      </div>

      <div className="toolbar">
        <ViewSwitcher
          views={views.data ?? []}
          activeViewId={activeViewId}
          typeLabel={config.labelPlural}
          onApplyView={applyView}
          onApplyAll={applyAllView}
          onNewView={() => {
            setEditingView(null);
            setDesigning(true);
          }}
          onEditView={editView}
          onSaveCurrent={() => {
            setViewName("");
            setSavingView(true);
          }}
          onSetDefault={(view) =>
            // Clicking the star of the view that already holds it unpins it,
            // so the module goes back to opening on the full list.
            setDefaultView.mutate(view.is_default ? null : view.id)
          }
          onDeleteViews={async (ids) => {
            await deleteViews.mutateAsync(ids);
            if (activeViewId && ids.includes(activeViewId)) applyAllView();
          }}
          onRenameView={async (view, name) => {
            await updateView.mutateAsync({ id: view.id, patch: { name } });
          }}
          busy={deleteViews.isPending || setDefaultView.isPending}
        />
        <div className="search input-icon">
          <Search size={16} />
          <input
            className="input"
            placeholder={`Search ${config.labelPlural.toLowerCase()}…`}
            value={rawSearch}
            onChange={(e) => setRawSearch(e.target.value)}
          />
        </div>
        <span className="count-pill">
          {loading ? "…" : `${total} records`}
        </span>
      </div>

      {savingView && (
        <Modal
          title="Save this view"
          narrow
          onClose={() => setSavingView(false)}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setSavingView(false)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={saveCurrentView}
                disabled={!viewName.trim() || createView.isPending}
              >
                {createView.isPending ? "Saving…" : "Save view"}
              </button>
            </>
          }
        >
          <div className="field">
            <label htmlFor="view-name">Name</label>
            <input
              id="view-name"
              className="input"
              autoFocus
              value={viewName}
              placeholder={
                rawSearch.trim()
                  ? `${config.labelPlural} matching “${rawSearch.trim()}”`
                  : config.labelPlural
              }
              onChange={(e) => setViewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  saveCurrentView();
                }
              }}
            />
            <p className="field-hint">
              Saves the current search and sort — not the rows. Opening this view
              re-runs it against the latest data.
            </p>
          </div>
        </Modal>
      )}

      {designing && (
        <ViewDesigner
          // Remounts when the target changes, so an edit never opens showing
          // the previous view's design.
          key={editingView?.id ?? "new"}
          entity={config.name}
          typeLabel={config.labelPlural}
          busy={createView.isPending || updateView.isPending}
          editing={
            editingView?.template_id
              ? {
                  id: editingView.id,
                  name: editingView.name,
                  template_id: editingView.template_id,
                  base_sql: editingView.base_sql,
                }
              : null
          }
          onCancel={closeDesigner}
          onSave={saveDesignedView}
        />
      )}

      {list.isError && !customView && (
        <Alert kind="error">{errorMessage(list.error)}</Alert>
      )}
      {rendered.isError && (
        <Alert kind="error">{errorMessage(rendered.error)}</Alert>
      )}

      {customView ? (
        rendered.isLoading ? (
          <div className="custom-view custom-view--busy">
            <Spinner />
          </div>
        ) : (
          // The engine's own markup and CSS, so it goes in the same sandboxed
          // frame a report does — its stylesheet would otherwise fight the
          // app's, and it is not this app's markup to trust.
          <div className="custom-view">
            <ReportFrame html={rendered.data?.html ?? ""} title={customView.name} />
          </div>
        )
      ) : list.isLoading ? (
        <Spinner />
      ) : items.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Icon name={config.icon} size={26} />}
            title={q ? "No matching records" : `No ${config.labelPlural.toLowerCase()} yet`}
            message={
              q
                ? "Try a different search term."
                : `Add your first ${config.label.toLowerCase()} to get started.`
            }
            action={
              !q && (
                <button className="btn btn-primary" onClick={openCreate}>
                  <Plus size={16} /> New {config.label}
                </button>
              )
            }
          />
        </div>
      ) : (
        <ScrollX className={`table-wrap ${list.isFetching ? "is-paging" : ""}`}>
          <table className="data">
            <thead>
              <tr>
                {!config.hideKeyColumn && <th className="no-sort">{config.key}</th>}
                {tableFields.map((f) => (
                  <th key={f.name} onClick={() => toggleSort(f.name)}>
                    <span className="th-sort">
                      {f.label}
                      {sort.field === f.name &&
                        (sort.dir === "asc" ? (
                          <ArrowUp size={13} />
                        ) : (
                          <ArrowDown size={13} />
                        ))}
                    </span>
                  </th>
                ))}
                <th className="no-sort" style={{ textAlign: "right" }}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((record, idx) => (
                <tr key={String(record._id ?? record[config.key] ?? idx)}>
                  {!config.hideKeyColumn && (
                    <td style={{ fontFamily: "ui-monospace, monospace", fontSize: 12.5, color: "var(--text-muted)" }}>
                      {String(record[config.key] ?? "—")}
                    </td>
                  )}
                  {tableFields.map((f) => (
                    <td key={f.name}>{renderCell(record, f)}</td>
                  ))}
                  <td>
                    <div className="row-actions">
                      <button
                        className="btn-icon"
                        title="Edit"
                        onClick={() => openEdit(record)}
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        className="btn-icon"
                        title="Delete"
                        onClick={() => setDeleting(record)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollX>
      )}

      {/* Gated on the RESULT, not on `items`: a custom view is rendered by the
          engine and never fills `items`, so keying off it left the pager
          appearing only when stale table rows happened to still be in cache. */}
      {total > 0 && (
        <nav className="pager" aria-label={`${config.labelPlural} pagination`}>
          <p className="pager-status" aria-live="polite">
            Showing <b>{firstRow.toLocaleString()}</b>–<b>{lastRow.toLocaleString()}</b> of{" "}
            <b>{total.toLocaleString()}</b>
          </p>
          <div className="pager-controls">
            <label className="pager-size">
              <span>Rows</span>
              <select
                className="input"
                value={pageSize}
                aria-label="Rows per page"
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(0);
                }}
              >
                {PAGE_SIZES.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <div className="pager-nav">
              <button
                className="btn-icon"
                title="First page"
                aria-label="First page"
                disabled={page === 0}
                onClick={() => setPage(0)}
              >
                <ChevronFirst size={16} />
              </button>
              <button
                className="btn-icon"
                title="Previous page"
                aria-label="Previous page"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                <ChevronLeft size={16} />
              </button>
              <span className="pager-page">
                Page {(page + 1).toLocaleString()} of {pageCount.toLocaleString()}
              </span>
              <button
                className="btn-icon"
                title="Next page"
                aria-label="Next page"
                disabled={page >= pageCount - 1}
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              >
                <ChevronRight size={16} />
              </button>
              <button
                className="btn-icon"
                title="Last page"
                aria-label="Last page"
                disabled={page >= pageCount - 1}
                onClick={() => setPage(pageCount - 1)}
              >
                <ChevronLast size={16} />
              </button>
            </div>
          </div>
        </nav>
      )}

      {modalOpen && (
        <Modal
          title={editing ? `Edit ${config.label}` : `New ${config.label}`}
          onClose={() => setModalOpen(false)}
        >
          <EntityForm
            config={config}
            initial={editing}
            submitting={submitting}
            // Creating is where a description saves the most work — and where
            // it is safe, because there is nothing yet for it to overwrite.
            // Editing keeps the form it has always had.
            assist={!editing}
            onSubmit={handleSubmit}
            onCancel={() => setModalOpen(false)}
          />
        </Modal>
      )}

      {deleting && (
        <ConfirmDialog
          title={`Delete ${config.label}`}
          message={`Are you sure you want to delete "${recordTitle(config, deleting)}"? This cannot be undone.`}
          busy={del.isPending}
          onConfirm={handleDelete}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
