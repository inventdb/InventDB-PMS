/**
 * Giving a file a home.
 *
 * A file that arrives through the drive — dropped here, or uploaded from
 * SOAR's Files room — lands in its type's vault with no parent record. That is
 * fine for storage and useless for the question anyone actually asks about a
 * document: *which lease is this? which job is this invoice for?*
 *
 * Two ways to answer it, and they are different questions:
 *   • the record already exists — attach it (this is most of the time);
 *   • the file **is** the reason for a new record — a photo of a burst pipe is
 *     a work order waiting to be raised. Create it and attach in one go, so the
 *     evidence is on the job from the moment the job exists.
 */
import { useMemo, useState } from "react";
import { Link2, Plus, Wrench } from "lucide-react";

import { Alert, Spinner } from "../components/ui";
import { EntityForm } from "../components/EntityForm";
import { useToast } from "../components/Toast";
import { errorMessage } from "../api/client";
import { useAttachFile, useCreate, useList } from "../api/hooks";
import { ENTITIES, ENTITY_BY_NAME, recordTitle } from "../config/entities";
import type { Record as Rec } from "../types";

/**
 * The type a file most often turns into a record for.
 *
 * Photos and quotes are overwhelmingly about a job that needs doing, so the
 * work-order path is the one offered by name rather than buried in a picker.
 */
const DEFAULT_NEW_TYPE = "work_orders";

/** Records of one type, addressed by `_id` — which is what an attachment binds to. */
function useRecordChoices(type: string) {
  const list = useList(type, { limit: 500 }, { enabled: !!type });
  const config = ENTITY_BY_NAME[type];
  const options = useMemo(() => {
    const rows = (list.data?.items ?? []) as Rec[];
    return rows
      .map((row) => {
        const id = String(row._id ?? "");
        if (!id) return null;
        const key = config ? String(row[config.key] ?? "") : "";
        const title = config ? recordTitle(config, row) : "";
        const label = [key, title].filter(Boolean).join(" — ") || id;
        return { value: id, label };
      })
      .filter((o): o is { value: string; label: string } => !!o)
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [list.data, config]);
  return { options, loading: list.isLoading };
}

export function AttachPanel({
  attachmentId,
  currentType,
  onAttached,
}: {
  attachmentId: string;
  /** The type whose vault the file is sitting in — the sensible default. */
  currentType: string;
  onAttached: (target: { type: string; recordId: string }) => void;
}) {
  const toast = useToast();
  const attach = useAttachFile();

  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [type, setType] = useState(currentType || ENTITIES[0]?.name || "");
  const [recordId, setRecordId] = useState("");
  const [newType, setNewType] = useState(
    ENTITY_BY_NAME[DEFAULT_NEW_TYPE] ? DEFAULT_NEW_TYPE : ENTITIES[0]?.name || ""
  );
  const [error, setError] = useState<string | null>(null);

  const { options, loading } = useRecordChoices(type);
  const create = useCreate(newType);
  const newConfig = ENTITY_BY_NAME[newType];
  const busy = attach.isPending || create.isPending;

  async function attachTo(target: { type: string; recordId: string }) {
    await attach.mutateAsync({
      attachmentId,
      type: target.type,
      recordId: target.recordId,
      mode: "move",
    });
    onAttached(target);
  }

  async function attachExisting() {
    setError(null);
    if (!recordId) return setError("Pick the record this file belongs to.");
    try {
      await attachTo({ type, recordId });
      toast.success(`Now on ${type} / ${recordId}.`);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  /**
   * Create the record, then move the file onto it.
   *
   * Two steps that cannot be one, so the failure between them is reported
   * honestly: if the record saves and the attach fails, the record still
   * exists and the message says so rather than implying nothing happened.
   */
  async function createAndAttach(values: Rec) {
    setError(null);
    let created: Rec;
    try {
      created = (await create.mutateAsync(values)) as Rec;
    } catch (err) {
      return setError(errorMessage(err));
    }
    const id = String(created?._id ?? "");
    if (!id) {
      return setError("The record was created, but came back without an id, so the file was not attached to it.");
    }
    try {
      await attachTo({ type: newType, recordId: id });
      toast.success(`Created the ${newConfig?.label.toLowerCase() ?? "record"} and attached this file to it.`);
    } catch (err) {
      setError(
        `Created the ${newConfig?.label.toLowerCase() ?? "record"}, but could not attach the file to it — ${errorMessage(err)}`
      );
    }
  }

  return (
    <div className="fx-attach">
      <p className="report-note fx-attach-lead">
        This file isn’t on a record yet — it’s sitting in the <code>{currentType}</code> vault.
        Put it where it belongs.
      </p>

      <div className="fx-attach-modes" role="tablist">
        <button
          role="tab"
          aria-selected={mode === "existing"}
          className={`fx-mode ${mode === "existing" ? "active" : ""}`}
          onClick={() => setMode("existing")}
        >
          <Link2 size={13} /> Attach to a record
        </button>
        <button
          role="tab"
          aria-selected={mode === "new"}
          className={`fx-mode ${mode === "new" ? "active" : ""}`}
          onClick={() => setMode("new")}
        >
          <Wrench size={13} /> Raise a work order
        </button>
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      {mode === "existing" ? (
        <>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="fx-attach-type">Record type</label>
              <select
                id="fx-attach-type"
                className="select"
                value={type}
                onChange={(e) => {
                  setType(e.target.value);
                  // The chosen record belongs to the old type; keeping it would
                  // attach the file to an id that means nothing here.
                  setRecordId("");
                }}
              >
                {ENTITIES.map((entity) => (
                  <option key={entity.name} value={entity.name}>
                    {entity.labelPlural}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="fx-attach-record">Record</label>
              <select
                id="fx-attach-record"
                className="select"
                value={recordId}
                onChange={(e) => setRecordId(e.target.value)}
              >
                <option value="">{loading ? "Loading…" : "— Pick one —"}</option>
                {options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={attachExisting} disabled={busy}>
            <Link2 size={14} /> {attach.isPending ? "Attaching…" : "Attach"}
          </button>
        </>
      ) : (
        <>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="fx-attach-newtype">Create a</label>
              <select
                id="fx-attach-newtype"
                className="select"
                value={newType}
                onChange={(e) => setNewType(e.target.value)}
              >
                {ENTITIES.map((entity) => (
                  <option key={entity.name} value={entity.name}>
                    {entity.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {newConfig ? (
            <div className="fx-attach-form">
              <EntityForm
                key={newType}
                config={newConfig}
                submitting={busy}
                onSubmit={(values) => void createAndAttach(values)}
                onCancel={() => setMode("existing")}
              />
            </div>
          ) : (
            <Spinner />
          )}
        </>
      )}
    </div>
  );
}

/** Where a file lives, once it has a home. */
export function AttachedTo({
  type,
  recordId,
  onOpenRecord,
}: {
  type: string;
  recordId: string;
  onOpenRecord: () => void;
}) {
  const config = ENTITY_BY_NAME[type];
  return (
    <div className="fx-attached">
      <Plus size={14} className="fx-attached-ico" aria-hidden />
      <span>
        On {config?.label.toLowerCase() ?? "record"}{" "}
        <button type="button" className="fx-attached-link" onClick={onOpenRecord}>
          {type} / {recordId} →
        </button>
      </span>
    </div>
  );
}
