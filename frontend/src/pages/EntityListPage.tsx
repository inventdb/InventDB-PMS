import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import {
  ArrowDown,
  ArrowUp,
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

  // Debounce search input.
  useEffect(() => {
    const t = setTimeout(() => setQ(rawSearch.trim()), 300);
    return () => clearTimeout(t);
  }, [rawSearch]);

  const list = useList(config.name, {
    q: q || undefined,
    order_by: sort.field,
    order_dir: sort.dir,
    limit: 1000,
  });

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
      // Not on this page is not the same as gone. The list is capped at 1000
      // rows while Analyze can hand us any record in the module — Accounting
      // alone holds 2,262 — so a row clicked in a result grid landed here and
      // was told it no longer existed. Fetch the one record by id instead, and
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

  const toggleSort = (field: string) => {
    setSort((prev) =>
      prev.field === field
        ? { field, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { field, dir: "asc" }
    );
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
    // `content-fill` gives the table the height the window has left, so the
    // column heads can lock to it while the rows scroll underneath.
    <div className="content content-fill">
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
          {list.isLoading ? "…" : `${list.data?.total ?? items.length} records`}
        </span>
      </div>

      {list.isError && (
        <Alert kind="error">{errorMessage(list.error)}</Alert>
      )}

      {list.isLoading ? (
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
        <ScrollX className="table-wrap">
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
