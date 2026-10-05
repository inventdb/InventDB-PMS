/**
 * The right-hand drill-down panel.
 *
 * A record opens READ-ONLY: its fields, the records it points at (its property,
 * its tenant — each a link one level deeper), and a paged grid for every module
 * that points at it (a property's leases, work orders, ledger…). Rows in those
 * grids open the next level; Back and Esc step out one level at a time.
 *
 * Edit appears only when the server says this person may change THIS record
 * (`GET /api/drill/<module>/<id>/access`). Saving still goes through InventDB's
 * row rules; if one refuses, the panel says why and the record stays view-only.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { ArrowLeft, ChevronRight, Lock, Pencil, X } from "lucide-react";

import { api, errorMessage } from "../api/client";
import { ENTITY_BY_NAME, recordTitle, type EntityConfig, type FieldDef } from "../config/entities";
import type { Record as Rec } from "../types";
import { formatCell } from "../utils/format";
import { Badge } from "../components/ui";
import { EntityForm } from "../components/EntityForm";
import { useReferences } from "../components/references";
import { useToast } from "../components/Toast";
import { useDrill, type DrillFrame } from "./DrillContext";
import { DrillGrid } from "./DrillGrid";
import { childHeading, childrenOf, fieldText, parentsOf, relationFor } from "./relations";

interface Access {
  can_view: boolean;
  can_edit: boolean;
  reason?: string;
  row_rules?: string;
}

function frameLabel(frame: DrillFrame, title?: string): string {
  const cfg = ENTITY_BY_NAME[frame.entity];
  if (frame.kind === "list") return frame.title;
  return title || cfg?.label || frame.entity;
}

export function DrillPanel() {
  const drill = useDrill();
  const frame = drill.stack[drill.stack.length - 1];
  const [titles, setTitles] = useState<Record<number, string>>({});
  const depth = drill.stack.length;
  const panelRef = useRef<HTMLElement>(null);

  // Take focus whenever a level opens. A card in a designed view is clicked
  // inside its frame, and focus stays in that frame: Esc then went to the
  // frame's document, never reached this panel, and the page looked stuck.
  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
  }, [depth]);

  // One Esc handler for the whole stack: step back a level, close at the top.
  // A Modal opened from inside the panel registers its own and is left alone.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelector(".modal-backdrop")) return;
      if (depth > 1) drill.back();
      else drill.close();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [depth, drill]);

  if (!frame) return null;
  const cfg = ENTITY_BY_NAME[frame.entity];
  const label = frame.kind === "list" ? "Behind this number" : `${cfg?.label ?? frame.entity} details`;

  return createPortal(
    <div className="drill-scrim" onMouseDown={drill.close}>
      <aside
        ref={panelRef}
        tabIndex={-1}
        className="drill-panel"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="drill-head">
          {depth > 1 ? (
            <button className="btn-icon" aria-label="Back" title="Back (Esc)" onClick={drill.back}>
              <ArrowLeft size={17} />
            </button>
          ) : (
            <span className="drill-head-spacer" />
          )}
          <nav className="drill-crumbs" aria-label="Drill-down path">
            {drill.stack.map((f, i) => (
              <span key={i} className="drill-crumb">
                {i > 0 && <ChevronRight size={12} aria-hidden />}
                <span className={i === depth - 1 ? "is-current" : undefined}>
                  {frameLabel(f, titles[i])}
                </span>
              </span>
            ))}
          </nav>
          <button className="btn-icon" aria-label="Close panel" title="Close" onClick={drill.close}>
            <X size={18} />
          </button>
        </header>
        <div className="drill-body">
          {frame.kind === "record" ? (
            <RecordView
              key={`${depth}:${frame.entity}:${frame.id ?? JSON.stringify(frame.match)}`}
              frame={frame}
              onTitle={(t) => setTitles((m) => (m[depth - 1] === t ? m : { ...m, [depth - 1]: t }))}
            />
          ) : (
            <ListView key={`${depth}:${frame.entity}:${frame.where}:${JSON.stringify(frame.filters)}`} frame={frame} />
          )}
        </div>
      </aside>
    </div>,
    document.body
  );
}

/* ── one record ─────────────────────────────────────────────────────────── */

function RecordView({
  frame,
  onTitle,
}: {
  frame: Extract<DrillFrame, { kind: "record" }>;
  onTitle: (t: string) => void;
}) {
  const drill = useDrill();
  const toast = useToast();
  const qc = useQueryClient();
  const cfg = ENTITY_BY_NAME[frame.entity] as EntityConfig | undefined;
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [denied, setDenied] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const rec = useQuery({
    queryKey: ["drill", "record", frame.entity, frame.id ?? frame.match],
    queryFn: async (): Promise<Rec | null> => {
      if (frame.id) {
        const { data } = await api.get<Rec>(`/${frame.entity}/${encodeURIComponent(frame.id)}`);
        return data && data._id != null ? data : null;
      }
      if (!frame.match) return null;
      const { data } = await api.post<{ items: Rec[] }>(`/drill/${frame.entity}`, {
        filters: { [frame.match.field]: frame.match.value },
        limit: 1,
      });
      return data.items?.[0] ?? null;
    },
  });
  const record = rec.data ?? null;
  const recordId = record?._id != null ? String(record._id) : null;

  const access = useQuery({
    queryKey: ["drill", "access", frame.entity, recordId],
    enabled: !!recordId,
    queryFn: async () =>
      (await api.get<Access>(`/drill/${frame.entity}/${encodeURIComponent(recordId!)}/access`)).data,
  });

  const parents = useMemo(() => (cfg ? parentsOf(cfg.name) : []), [cfg]);
  const children = useMemo(() => (cfg ? childrenOf(cfg.name) : []), [cfg]);
  const { labels } = useReferences(parents.filter((r) => r.toField === ENTITY_BY_NAME[r.to]?.key).map((r) => r.to));

  const title = cfg && record ? recordTitle(cfg, record) : "";
  useEffect(() => {
    if (title) onTitle(title);
  }, [title, onTitle]);

  if (!cfg) return <p className="drill-error">This app has no “{frame.entity}” module.</p>;
  if (rec.isLoading) return <p className="drill-muted">Loading…</p>;
  if (rec.isError || !record)
    return (
      <p className="drill-error" role="alert">
        {rec.isError && axios.isAxiosError(rec.error) && rec.error.response?.status !== 404
          ? errorMessage(rec.error)
          : `This ${cfg.label.toLowerCase()} isn't available — it may have been deleted, or it isn't visible to you.`}
      </p>
    );

  const canEdit = !!access.data?.can_edit && !denied;
  const badges = cfg.fields.filter((f) => f.badge && record[f.name] != null && record[f.name] !== "");
  const known = new Set(cfg.fields.map((f) => f.name));
  const extras = Object.keys(record).filter((k) => !k.startsWith("_") && !known.has(k) && k !== cfg.key);

  async function save(values: Rec) {
    setSaving(true);
    setSaveError(null);
    try {
      await api.put(`/${cfg!.name}/${encodeURIComponent(recordId!)}`, values);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["drill"] }),
        qc.invalidateQueries({ queryKey: ["list", cfg!.name] }),
        qc.invalidateQueries({ queryKey: ["ref", cfg!.name] }),
        qc.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
      toast.success(`${cfg!.label} updated`);
      setEditing(false);
    } catch (err) {
      const msg = errorMessage(err);
      if (axios.isAxiosError(err) && err.response?.status === 403) {
        // A row rule refused this record: the grant allowed edits to the
        // module, the rule does not allow them to THIS one. Say so and stop
        // offering an edit that will only be refused again.
        setDenied(msg);
        setEditing(false);
        toast.error("You can't change this record.");
      } else {
        setSaveError(msg);
      }
    } finally {
      setSaving(false);
    }
  }

  const openParent = (field: FieldDef, value: unknown) => {
    const rel = relationFor(cfg.name, field.name);
    if (!rel) return;
    drill.push({ kind: "record", entity: rel.to, match: { field: rel.toField, value } });
  };

  return (
    <div className="drill-record">
      <div className="drill-title">
        <div>
          <p className="drill-kicker">
            {cfg.label}
            {record[cfg.key] != null && <span className="drill-key"> · {String(record[cfg.key])}</span>}
          </p>
          <h2>{title}</h2>
          {badges.length > 0 && (
            <div className="drill-badges">
              {badges.map((f) => (
                <Badge key={f.name} value={record[f.name]} />
              ))}
            </div>
          )}
        </div>
        {!editing && canEdit && (
          <button
            className="btn btn-sm"
            onClick={() => {
              setSaveError(null);
              setEditing(true);
            }}
            title={
              access.data?.row_rules === "enforced_on_save"
                ? "Your access to this module allows changes; any row rule is checked when you save."
                : undefined
            }
          >
            <Pencil size={14} /> Edit
          </button>
        )}
      </div>

      {!editing && !canEdit && access.isSuccess && (
        <p className="drill-readonly">
          <Lock size={13} aria-hidden /> View only — {denied ?? access.data?.reason ?? "you can't change this record."}
        </p>
      )}

      {editing ? (
        <section className="drill-section drill-edit" aria-label={`Edit ${cfg.label}`}>
          {saveError && (
            <p className="drill-error" role="alert">
              {saveError}
            </p>
          )}
          <EntityForm
            config={cfg}
            initial={record}
            submitting={saving}
            onSubmit={(v) => void save(v)}
            onCancel={() => setEditing(false)}
          />
        </section>
      ) : (
        <>
          <section className="drill-section" aria-label="Details">
            <header className="drill-section-head">
              <h3>Details</h3>
            </header>
            <dl className="drill-fields">
              {cfg.fields.map((f) => {
                const value = record[f.name];
                const empty = value == null || value === "";
                const rel = relationFor(cfg.name, f.name);
                return (
                  <div key={f.name} className="drill-field">
                    <dt>{f.label}</dt>
                    <dd>
                      {empty ? (
                        <span className="drill-muted">—</span>
                      ) : rel ? (
                        <button className="drill-link" onClick={() => openParent(f, value)}>
                          <span className="drill-link-key">{String(value)}</span>
                          {labels[rel.to]?.[String(value)] && labels[rel.to][String(value)] !== String(value) && (
                            <span className="drill-link-sub"> · {labels[rel.to][String(value)]}</span>
                          )}
                          <ChevronRight size={13} aria-hidden />
                        </button>
                      ) : f.badge ? (
                        <Badge value={value} />
                      ) : (
                        fieldText(f, value)
                      )}
                    </dd>
                  </div>
                );
              })}
              {extras.map((k) => (
                <div key={k} className="drill-field">
                  <dt>{k}</dt>
                  <dd>{formatCell(record[k], "text")}</dd>
                </div>
              ))}
            </dl>
          </section>

          {children.map((rel) => {
            const value = record[rel.toField];
            if (value == null || value === "") return null;
            const childCfg = ENTITY_BY_NAME[rel.from];
            const heading = childHeading(rel, childCfg);
            return (
              <DrillGrid
                key={`${rel.from}.${rel.field}`}
                entity={rel.from}
                title={heading}
                query={{ filters: { [rel.field]: value } }}
                pageSize={5}
                maxColumns={4}
                emptyText={`No ${childCfg?.labelPlural.toLowerCase() ?? rel.from} for this ${cfg.label.toLowerCase()}.`}
                onOpen={(row) =>
                  drill.push({ kind: "record", entity: rel.from, id: row._id != null ? String(row._id) : undefined })
                }
              />
            );
          })}
        </>
      )}
    </div>
  );
}

/* ── the records behind a number ────────────────────────────────────────── */

function ListView({ frame }: { frame: Extract<DrillFrame, { kind: "list" }> }) {
  const drill = useDrill();
  const cfg = ENTITY_BY_NAME[frame.entity];
  if (!cfg) return <p className="drill-error">This app has no “{frame.entity}” module.</p>;
  return (
    <div className="drill-record">
      <div className="drill-title">
        <div>
          <p className="drill-kicker">{frame.subtitle ?? "Behind this number"}</p>
          <h2>{frame.title}</h2>
        </div>
      </div>
      {frame.where && (
        <details className="drill-filter">
          <summary>The filter behind it</summary>
          <code>{frame.where}</code>
        </details>
      )}
      <DrillGrid
        entity={frame.entity}
        title={cfg.labelPlural}
        query={{ where: frame.where, alias: frame.alias, filters: frame.filters }}
        pageSize={25}
        maxColumns={6}
        emptyText="No records match any more — the data may have changed since the figure was drawn."
        onOpen={(row) =>
          drill.push({ kind: "record", entity: frame.entity, id: row._id != null ? String(row._id) : undefined })
        }
      />
    </div>
  );
}
