/**
 * Record-change proposals.
 *
 * The assistant only ever reads on its own. When a turn would change data it
 * emits a proposal instead — a single-record `form`, or a compound/bulk
 * `change_set` — and this card is where the user reviews and applies it. Nothing
 * is written until the Apply button here is clicked.
 *
 * Card state is stamped back onto the step's chart (`_cardApplied`,
 * `_cardCreated`, `_cardFrozen`) and persisted with the thread, so a reloaded
 * conversation shows the same trace: what was proposed, and what became of it.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { ENTITY_BY_NAME } from "../../config/entities";
import { errorMessage } from "../../api/client";
import { applyChangeSet, createRecord, runSql, updateRecord } from "../api";
import { titleize } from "../helpers";
import { ActionProgress } from "../ui";

type StatePatch = Record<string, unknown>;

export function MutationCard({
  step,
  onState,
}: {
  step: any;
  onState?: (patch: StatePatch) => void;
}) {
  if (step?.type === "form")
    return <FormStepCard spec={step.chart || {}} onState={onState} />;
  return <ChangeSetCard step={step} onState={onState} />;
}

// ---------------------------------------------------------------- single form

interface FormEntity {
  namespace: string;
  typeName: string;
  existingData?: Record<string, unknown>;
}
interface FormSpec {
  operation?: string;
  entities?: FormEntity[];
  _cardApplied?: boolean;
  _cardRecordId?: string;
  _cardFrozen?: boolean;
}

function valueToString(v: unknown): string {
  if (v == null) return "";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

/**
 * Re-type edited strings on the way back out: numbers, booleans and JSON where
 * they round-trip cleanly, otherwise the string as typed. Mirrors how the agent
 * passed the values in.
 */
function coerceFields(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value !== "string") {
      out[key] = value;
      continue;
    }
    const s = value.trim();
    if (s === "") continue;
    if (/^-?\d+(\.\d+)?$/.test(s)) out[key] = Number(s);
    else if (s === "true" || s === "false") out[key] = s === "true";
    else if (
      (s.startsWith("{") && s.endsWith("}")) ||
      (s.startsWith("[") && s.endsWith("]"))
    ) {
      try {
        out[key] = JSON.parse(s);
      } catch {
        out[key] = value;
      }
    } else out[key] = value;
  }
  return out;
}

function FormStepCard({
  spec,
  onState,
}: {
  spec: FormSpec;
  onState?: (patch: StatePatch) => void;
}) {
  const entity = spec.entities?.[0];
  const operation = (spec.operation || "insert").toLowerCase();
  const type = entity?.typeName || "";
  const proposed = useMemo(
    () =>
      entity?.existingData && typeof entity.existingData === "object"
        ? entity.existingData
        : {},
    [entity]
  );

  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Seed from the persisted state so a reloaded applied card stays committed.
  const [done, setDone] = useState(!!spec._cardApplied);
  const [recordId, setRecordId] = useState<string | undefined>(spec._cardRecordId);
  const frozen = !!spec._cardFrozen;

  /**
   * Open the editor over the type's FULL column set with the proposed values
   * laid on top, so you can see the fields the agent left alone as well as the
   * ones it wants to change — not just its own subset.
   */
  async function review() {
    let sample: Record<string, unknown> = {};
    try {
      const rows = await runSql(`SELECT * FROM pms.${type} LIMIT 1`);
      if (rows?.[0]) sample = rows[0];
    } catch {
      /* a brand-new type has no sample row */
    }
    const merged: Record<string, string> = {};
    for (const key of Object.keys({ ...sample, ...proposed })) {
      if (key.startsWith("_")) continue;
      merged[key] = valueToString(
        key in proposed ? proposed[key] : (sample as any)[key] ?? ""
      );
    }
    setFields(merged);
    setOpen(true);
  }

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      const payload = coerceFields(fields);
      if (operation === "update") {
        const id = String(proposed._id ?? recordId ?? "");
        if (!id) throw new Error("This proposal has no record to update.");
        await updateRecord(type, id, payload);
        setRecordId(id);
        onState?.({ _cardApplied: true, _cardRecordId: id });
      } else {
        const id = await createRecord(type, payload);
        if (id) setRecordId(id);
        onState?.({ _cardApplied: true, ...(id ? { _cardRecordId: id } : {}) });
      }
      setDone(true);
      setOpen(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!entity) return null;

  const label = ENTITY_BY_NAME[type]?.label ?? titleize(type);
  const verb =
    operation === "update" ? "Update" : operation === "delete" ? "Delete" : "Create";
  const pastVerb =
    operation === "update" ? "Updated" : operation === "delete" ? "Deleted" : "Created";
  const previewKeys = Object.keys(proposed)
    .filter((k) => !k.startsWith("_"))
    .slice(0, 6);
  const preview = previewKeys
    .map((k) => `${titleize(k)}: ${previewValue(proposed[k])}`)
    .join(" · ");

  // Applied → a read-only record of what was committed.
  if (done) {
    return (
      <div className="an-card is-done">
        <div className="an-card-head">
          <span className="an-tag is-good">✓ {pastVerb.toLowerCase()}</span>
          <div className="an-card-titles">
            <div className="an-note">
              {pastVerb} the {label.toLowerCase()} in {type}.
            </div>
          </div>
          {recordId && operation !== "delete" && ENTITY_BY_NAME[type] && (
            <Link
              className="btn btn-ghost btn-sm"
              to={`/${type}?focus=${encodeURIComponent(recordId)}`}
            >
              View record →
            </Link>
          )}
        </div>
      </div>
    );
  }

  // Superseded by a later message and never applied — kept as a trace of what
  // was offered, so the thread doesn't quietly lose it.
  if (frozen) {
    return (
      <div className="an-card is-frozen">
        <div className="an-card-head">
          <span className="an-tag">superseded</span>
          <div className="an-card-titles">
            <div className="an-note">
              Proposed to {verb.toLowerCase()} the {label.toLowerCase()} — not applied
              (a later message moved on).
            </div>
          </div>
        </div>
        {preview && <div className="an-note an-clip">{preview}</div>}
      </div>
    );
  }

  return (
    <div className="an-card">
      <div className="an-card-head">
        <span className="an-mark" aria-hidden>
          ✎
        </span>
        <div className="an-card-titles">
          <div className="an-card-title">
            {verb} {label.toLowerCase()}
            <span className="an-note"> · {type}</span>
          </div>
          <div className="an-note an-clip">
            {preview || "Review the proposed fields"}
          </div>
        </div>
        <span className="an-tag is-warn">NOT APPLIED YET</span>
      </div>

      {!open ? (
        <div className="an-card-actions">
          <button className="btn btn-primary btn-sm" onClick={() => void review()}>
            Review &amp; {verb.toLowerCase()} →
          </button>
        </div>
      ) : (
        <>
          <div className="an-field-grid">
            {Object.keys(fields).map((key) => (
              <label className="an-field" key={key}>
                <span>{titleize(key)}</span>
                <input
                  className="input"
                  value={fields[key]}
                  onChange={(e) =>
                    setFields((prev) => ({ ...prev, [key]: e.target.value }))
                  }
                  disabled={busy}
                />
              </label>
            ))}
          </div>
          {error && <div className="alert error">{error}</div>}
          <div className="an-card-actions">
            <button className="btn btn-primary btn-sm" onClick={() => void apply()} disabled={busy}>
              {busy ? "Saving…" : `${verb} ${label.toLowerCase()}`}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function previewValue(v: unknown): string {
  if (v == null || v === "") return "—";
  if (typeof v === "object")
    return Array.isArray(v) ? `${v.length} item${v.length === 1 ? "" : "s"}` : "details";
  const s = String(v);
  return s.length > 30 ? `${s.slice(0, 29)}…` : s;
}

// ------------------------------------------------------- compound / bulk sets

interface Op {
  op: "insert" | "update" | "delete" | "attach";
  type: string;
  recordId?: string;
  matchField?: string;
  fields: Record<string, unknown>;
  /** The record's current values, so an update can show old → new per field. */
  currentValues?: Record<string, unknown>;
  description?: string;
  include: boolean;
}

/** Type names are bare identifiers — sanitise anything the model emitted. */
function cleanIdent(s: unknown): string {
  return String(s || "")
    .replace(/[.\s]+/g, "_")
    .replace(/[^A-Za-z0-9_]/g, "")
    .replace(/^_+/, "");
}

function normalize(step: any): { title: string; ops: Op[] } {
  const spec = step?.chart || {};
  const make = (o: Partial<Op>): Op =>
    ({ op: "insert", type: "", fields: {}, include: true, ...o }) as Op;

  if (step?.type === "change_set") {
    return {
      title: spec.title || step.content || "Proposed changes",
      ops: (spec.steps || []).map((s: any) =>
        make({
          op: s.op || "insert",
          type: cleanIdent(s.typeName),
          recordId: s.recordId,
          matchField: s.matchField,
          fields: s.fields && typeof s.fields === "object" ? s.fields : {},
          currentValues:
            s.currentValues && typeof s.currentValues === "object"
              ? s.currentValues
              : undefined,
          description: s.description,
        })
      ),
    };
  }

  if (step?.type === "bulk_intake" || step?.type === "attachments_bulk_intake") {
    return {
      title: spec.title || step.content || "Create records",
      ops: (spec.records || []).map((r: any) =>
        make({
          op: "insert",
          type: cleanIdent(r.typeName || spec.typeName),
          fields:
            r.prefill && typeof r.prefill === "object"
              ? r.prefill
              : r.fields || r.values || {},
          description: r.filename,
        })
      ),
    };
  }

  if (step?.type === "bulk_update") {
    const common = spec.changes && typeof spec.changes === "object" ? spec.changes : {};
    return {
      title: spec.title || step.content || "Update records",
      ops: (spec.records || []).map((r: any) =>
        make({
          op: "update",
          type: cleanIdent(r.typeName || spec.typeName),
          recordId: r._id || r.recordId,
          matchField: r.matchField,
          fields: {
            ...common,
            ...(r.changes && typeof r.changes === "object" ? r.changes : {}),
          },
          currentValues:
            r.currentValues && typeof r.currentValues === "object"
              ? r.currentValues
              : undefined,
          description: r.displayLabel,
        })
      ),
    };
  }

  return { title: step?.content || "Changes", ops: [] };
}

const OP_LABEL: Record<string, string> = {
  insert: "Create",
  update: "Update",
  delete: "Delete",
  attach: "Attach",
};

function ChangeSetCard({
  step,
  onState,
}: {
  step: any;
  onState?: (patch: StatePatch) => void;
}) {
  const initial = useMemo(() => normalize(step), [step]);
  const spec = (step?.chart || {}) as any;

  const [ops, setOps] = useState<Op[]>(initial.ops);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [cancelled, setCancelled] = useState(!!spec._cardCancelled);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  // ops index → the created record's id. An entry here is DONE: its inputs lock
  // and it is excluded from any later Apply, so nothing is ever created twice.
  const [created, setCreated] = useState<Record<number, string>>(
    spec._cardCreated || {}
  );

  const frozen = !!spec._cardFrozen || cancelled;
  const title = initial.title;

  const groups = useMemo(() => {
    const map: Record<string, number[]> = {};
    ops.forEach((op, i) => {
      (map[op.type] ||= []).push(i);
    });
    return map;
  }, [ops]);

  if (!ops.length) {
    return (
      <div className="an-card">
        <div className="an-card-title">{title}</div>
        <p className="an-note">Nothing to apply.</p>
      </div>
    );
  }

  const setField = (i: number, key: string, value: string) =>
    setOps((arr) =>
      arr.map((o, j) => (j === i ? { ...o, fields: { ...o.fields, [key]: value } } : o))
    );
  const toggle = (i: number) =>
    setOps((arr) => arr.map((o, j) => (j === i ? { ...o, include: !o.include } : o)));

  const pendingCount = ops.filter((o, i) => o.include && !created[i]).length;
  const createdCount = Object.keys(created).length;

  function cancelAll() {
    setCancelled(true);
    setResult(null);
    onState?.({ _cardFrozen: true, _cardCancelled: true });
  }

  async function apply() {
    setResult(null);
    setBusy(true);
    // Only rows that are included AND not already created, so re-applying after
    // a partial failure never double-creates the ones that landed.
    const pending = ops
      .map((op, index) => ({ op, index }))
      .filter((p) => p.op.include && !created[p.index]);
    try {
      const steps = pending.map(({ op }) => ({
        op: op.op,
        typeName: op.type,
        ...(op.recordId ? { recordId: op.recordId } : {}),
        ...(op.matchField ? { matchField: op.matchField } : {}),
        fields: coerceFields(op.fields),
      }));
      const results = await applyChangeSet(title, steps);
      const failed = results.filter((r) => r && r.ok === false).length;
      const next: Record<number, string> = { ...created };
      results.forEach((row: any, k) => {
        const index = pending[k]?.index;
        const id = row?.ok ? row.recordId || row.record_id : null;
        if (index != null && id) next[index] = String(id);
      });
      const applied = pending.filter(({ index }) => next[index] && !created[index]).length;
      setCreated(next);
      onState?.({ _cardCreated: next });
      setResult(
        failed
          ? {
              ok: false,
              text: `Applied ${applied} of ${pending.length}; ${failed} failed — fix those and apply the rest.`,
            }
          : {
              ok: true,
              text: `Applied ${applied} change${applied === 1 ? "" : "s"}.`,
            }
      );
    } catch (err) {
      setResult({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="an-card">
      <div className="an-card-head">
        <span className="an-mark" aria-hidden>
          ≡
        </span>
        <div className="an-card-titles">
          <div className="an-card-title">{title}</div>
          <div className="an-note">
            {frozen
              ? cancelled
                ? `Cancelled — discarded${createdCount ? ` · ${createdCount} of ${ops.length} were already applied` : ", nothing applied"}`
                : `Superseded by a later message${createdCount ? ` · ${createdCount} of ${ops.length} were applied` : " — not applied"}`
              : createdCount > 0
                ? `${createdCount} of ${ops.length} applied${pendingCount ? ` · ${pendingCount} still to apply` : " · done"}`
                : `${pendingCount} of ${ops.length} change${ops.length === 1 ? "" : "s"} selected · applied together, atomically`}
          </div>
        </div>
        {!frozen && createdCount === 0 && (
          <span className="an-tag is-warn">NOT APPLIED YET</span>
        )}
      </div>

      <div className="an-groups">
        {Object.entries(groups).map(([type, indexes]) => {
          const open = openGroups[type] ?? Object.keys(groups).length <= 2;
          const label = ENTITY_BY_NAME[type]?.labelPlural ?? titleize(type);
          return (
            <div className="an-group" key={type}>
              <button
                type="button"
                className="an-group-head"
                onClick={() => setOpenGroups((g) => ({ ...g, [type]: !open }))}
              >
                <span aria-hidden>{open ? "▾" : "▸"}</span>
                <span className="an-group-title">{label}</span>
                <span className="an-note">
                  {indexes.length} row{indexes.length === 1 ? "" : "s"}
                </span>
              </button>
              {open && (
                <div className="an-group-body">
                  {indexes.map((i) => {
                    const op = ops[i];
                    const keys = Object.keys(op.fields).filter(
                      (k) => !k.startsWith("_")
                    );
                    const locked = frozen || !op.include || !!created[i];
                    return (
                      <div
                        className={`an-op ${op.include ? "" : "is-excluded"}`}
                        key={i}
                      >
                        <div className="an-op-head">
                          <span className="an-tag">
                            {OP_LABEL[op.op] || op.op}
                          </span>
                          <span className="an-note an-clip">
                            {op.description || op.recordId || "new row"}
                          </span>
                          <label className="an-op-include">
                            <input
                              type="checkbox"
                              checked={op.include}
                              disabled={frozen || !!created[i]}
                              onChange={() => toggle(i)}
                            />
                            {created[i] ? "✓ applied" : frozen ? "not applied" : "include"}
                          </label>
                        </div>
                        {keys.length > 0 && (
                          <div className="an-field-grid">
                            {keys.map((key) => {
                              const hasOld =
                                op.op === "update" &&
                                op.currentValues &&
                                key in op.currentValues;
                              const oldValue = hasOld
                                ? valueToString(op.currentValues![key])
                                : "";
                              return (
                                <label className="an-field" key={key}>
                                  <span>{titleize(key)}</span>
                                  {hasOld ? (
                                    <span className="an-diff">
                                      <span className="an-old" title={oldValue}>
                                        {oldValue === "" ? "—" : oldValue}
                                      </span>
                                      <span aria-hidden>→</span>
                                      <input
                                        className="input"
                                        value={valueToString(op.fields[key])}
                                        disabled={locked}
                                        onChange={(e) =>
                                          setField(i, key, e.target.value)
                                        }
                                      />
                                    </span>
                                  ) : (
                                    <input
                                      className="input"
                                      value={valueToString(op.fields[key])}
                                      disabled={locked}
                                      onChange={(e) => setField(i, key, e.target.value)}
                                    />
                                  )}
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="an-card-actions">
        {frozen ? (
          <span className="an-tag">
            {cancelled
              ? `cancelled — discarded${createdCount ? `, ${createdCount} already applied` : ""}`
              : `superseded — ${createdCount ? `${createdCount} applied, rest not` : "not applied"}`}
          </span>
        ) : busy ? (
          <ActionProgress
            label={`Applying ${pendingCount} change${pendingCount === 1 ? "" : "s"}…`}
          />
        ) : createdCount > 0 && pendingCount === 0 ? (
          <span className="an-tag is-good">
            ✓ {createdCount} change{createdCount === 1 ? "" : "s"} applied — locked
          </span>
        ) : (
          <>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => void apply()}
              disabled={!pendingCount}
            >
              Apply {pendingCount} change{pendingCount === 1 ? "" : "s"}
            </button>
            <button
              className="btn btn-ghost btn-sm an-danger"
              onClick={cancelAll}
              title="Discard the whole proposal — nothing is applied"
            >
              Cancel
            </button>
          </>
        )}
        {result && (
          <span className={result.ok ? "an-tag is-good" : "alert error"}>
            {result.text}
          </span>
        )}
      </div>
    </div>
  );
}
