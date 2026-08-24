/**
 * The view designer — "New view", built by describing it.
 *
 * You say how you want to *see* this module (cards, a gallery, a compact table)
 * and InventDB's designer returns both a layout and the query to drive it. The
 * preview below is the real thing rendered over real rows, not a mock-up, so
 * the view takes shape where it will live.
 *
 * It sits in place above the list rather than in a drawer, for the same reason:
 * the data stays visible while you describe what to do with it.
 *
 * Nothing becomes a view until Save. A design you dislike costs nothing —
 * though it does leave a report template behind, because rendering a layout
 * requires a stored one, which is the same trade SOAR makes.
 */
import { useState } from "react";
import { Sparkles, X } from "lucide-react";

import { ReportFrame } from "../components/ReportFrame";
import { Alert, Spinner } from "../components/ui";
import { errorMessage } from "../api/client";
import { useDesignView, type DesignResult } from "./api";

export interface DesignedView {
  template_id: string;
  base_sql: string | null;
  html: string;
}

export function ViewDesigner({
  entity,
  typeLabel,
  busy,
  onCancel,
  onSave,
}: {
  entity: string;
  typeLabel: string;
  /** True while the save is in flight, so the panel cannot be double-submitted. */
  busy?: boolean;
  onCancel: () => void;
  onSave: (designed: DesignedView, name: string) => void | Promise<void>;
}) {
  const [instruction, setInstruction] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [design, setDesign] = useState<DesignResult | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  const designer = useDesignView(entity);
  const editing = !!design;

  async function run() {
    const text = instruction.trim();
    if (!text) return;
    setError("");
    try {
      const next = await designer.mutateAsync({
        instruction: text,
        // Once a design exists every further turn amends it, so "now make the
        // rent bold" builds on what is on screen instead of starting over.
        template_id: design?.template_id,
        history,
        base_sql: design?.sql ?? undefined,
      });
      setDesign(next);
      setHistory((h) => [...h, text]);
      setInstruction("");
      if (!name.trim()) setName(text.slice(0, 60));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="view-designer" data-testid="view-designer">
      <div className="vd-head">
        <span className="vd-chip">
          <Sparkles size={13} /> New view
        </span>
        <p className="vd-lede">
          Describe how you want to see your {typeLabel.toLowerCase()} — a card per
          record, a gallery, a compact table. The designer builds the layout and
          its query.
        </p>
        <button className="btn btn-ghost btn-sm" onClick={onCancel} aria-label="Close designer">
          <X size={15} />
        </button>
      </div>

      {history.length > 0 && (
        <div className="vd-history">
          <span className="vd-history-label">Applied ({history.length})</span>
          {history.map((h, i) => (
            <button
              key={i}
              type="button"
              className="vd-history-row"
              title="Put this back in the box"
              onClick={() => setInstruction(h)}
            >
              <span className="vd-history-n">{i + 1}.</span>
              <span className="vd-history-text">{h}</span>
            </button>
          ))}
        </div>
      )}

      <form
        className="vd-composer"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <input
          className="input"
          value={instruction}
          disabled={designer.isPending}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder={
            editing
              ? "Describe a change — e.g. “make the rent bold”"
              : `e.g. “a card per record with address, status badge and rent”`
          }
          aria-label="Describe the view"
        />
        <button
          className="btn btn-primary"
          type="submit"
          disabled={!instruction.trim() || designer.isPending}
        >
          {designer.isPending
            ? "Designing…"
            : editing
              ? "Apply change"
              : "Design view"}
        </button>
      </form>

      {error && <Alert kind="error">{error}</Alert>}

      {designer.isPending && (
        <div className="vd-preview vd-preview--busy">
          <Spinner />
          <p className="field-hint">
            Designing the layout, then checking it renders against real rows.
          </p>
        </div>
      )}

      {design && !designer.isPending && (
        <>
          <div className="vd-preview">
            <ReportFrame html={design.html} title="View preview" />
          </div>
          <div className="vd-save">
            <div className="field vd-name">
              <label htmlFor="designed-view-name">Name</label>
              <input
                id="designed-view-name"
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={`${typeLabel} cards`}
              />
            </div>
            <button
              className="btn btn-primary"
              disabled={!name.trim() || busy}
              onClick={() =>
                onSave(
                  {
                    template_id: design.template_id,
                    base_sql: design.sql,
                    html: design.html,
                  },
                  name.trim()
                )
              }
            >
              {busy ? "Saving…" : "Save view"}
            </button>
            <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}
