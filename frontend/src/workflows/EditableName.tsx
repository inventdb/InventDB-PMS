/**
 * A heading you can rename in place.
 *
 * Renaming a workflow through the full editor means opening a form, changing
 * one field and saving a definition — which also means every rename looks, to
 * anyone reading the history later, like a definition change. Here it is what
 * it actually is: one field, saved on blur or Enter.
 *
 * A failed save keeps the draft in the box rather than reverting it. Losing
 * what someone typed because the network hiccuped is the one outcome worth
 * designing out; the error sits next to the text so it can simply be retried.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Check, PencilLine, X } from "lucide-react";

export function EditableName({
  value,
  onCommit,
  ariaLabel = "Rename",
  disabled,
}: {
  value: string;
  /** Rejects to signal failure — the draft is kept and the error shown. */
  onCommit: (next: string) => Promise<void>;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  async function commit() {
    const next = draft.trim();
    if (!next || next === value) {
      setEditing(false);
      setDraft(value);
      setError(null);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onCommit(next);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not rename it.");
    } finally {
      setSaving(false);
    }
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      void commit();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setDraft(value);
      setError(null);
      setEditing(false);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        className="wf-rename"
        onClick={() => setEditing(true)}
        disabled={disabled}
        // Labelled explicitly: the visible content is the name itself, so
        // without this the control announces as the value rather than as the
        // thing that changes it.
        aria-label={ariaLabel}
        title={ariaLabel}
      >
        <span>{value}</span>
        <PencilLine size={13} aria-hidden />
      </button>
    );
  }

  return (
    <span className="wf-rename-edit">
      <input
        ref={input}
        className="input"
        value={draft}
        aria-label={ariaLabel}
        disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
      />
      <button
        type="button"
        className="btn-icon"
        aria-label="Save name"
        disabled={saving}
        onClick={() => void commit()}
      >
        <Check size={15} />
      </button>
      <button
        type="button"
        className="btn-icon"
        aria-label="Cancel rename"
        disabled={saving}
        onClick={() => {
          setDraft(value);
          setError(null);
          setEditing(false);
        }}
      >
        <X size={15} />
      </button>
      {error && <span className="wf-rename-error">{error}</span>}
    </span>
  );
}
