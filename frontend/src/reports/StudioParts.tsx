/**
 * Small pieces the Report Studio is built from: an editable title, a tab strip,
 * and the "edit by instruction" panel that drives the report agent.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Pencil, Sparkles, X } from "lucide-react";

import { errorMessage } from "../api/client";
import { AnimatedNumber, AutoTextarea, useThrottledValue } from "../analyze/ui";
import { ModelPicker, useDefaultModelFamily } from "../analyze/ModelPicker";
import {
  AttachButton,
  AttachChips,
  pasteFiles,
  useAiAttach,
} from "../analyze/AiAttach";
import { streamReportEdit, type EditTurn } from "./editStream";

/**
 * A heading you can rename in place.
 *
 * Renaming is the one edit that shouldn't require opening a panel — click the
 * title, type, press Enter. `validate` rejects a duplicate before the request
 * goes out, so the error arrives while the input is still open.
 */
export function EditableName({
  value,
  onCommit,
  validate,
}: {
  value: string;
  onCommit: (next: string) => Promise<void>;
  validate?: (next: string) => string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  async function commit() {
    const next = draft.trim();
    if (!next || next === value) {
      setEditing(false);
      setDraft(value);
      setError(null);
      return;
    }
    const problem = validate?.(next);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onCommit(next);
      setEditing(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        className="rs-title"
        onClick={() => setEditing(true)}
        title="Rename this report"
      >
        <h3>{value}</h3>
        <Pencil size={14} aria-hidden />
      </button>
    );
  }

  return (
    <div className="rs-title-edit">
      <input
        ref={inputRef}
        className="input"
        value={draft}
        disabled={busy}
        aria-label="Report name"
        onChange={(e) => {
          setDraft(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") void commit();
          if (e.key === "Escape") {
            setEditing(false);
            setDraft(value);
            setError(null);
          }
        }}
      />
      <button className="btn-icon" onClick={() => void commit()} disabled={busy} title="Save">
        <Check size={16} />
      </button>
      <button
        className="btn-icon"
        onClick={() => {
          setEditing(false);
          setDraft(value);
          setError(null);
        }}
        disabled={busy}
        title="Cancel"
      >
        <X size={16} />
      </button>
      {error && <span className="rs-title-error">{error}</span>}
    </div>
  );
}

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: string; label: string }[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="rs-tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={active === t.id}
          className={`rs-tab ${active === t.id ? "is-active" : ""}`}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Edit by instruction.
 *
 * Describe the change in plain language and the report agent rewrites the
 * layout, saving it as a new version. The conversation is kept per report, so
 * refinements stack ("now sort it by amount", "undo that") the way they do in
 * Analyze rather than each edit starting cold.
 *
 * The in-flight edit is deliberately NOT aborted on unmount: it finishes and
 * persists server-side regardless, so cancelling on navigation would only lose
 * the user's view of a change that still happened. Only Stop aborts it.
 */
export function EditByInstruction({
  templateId,
  onApplied,
}: {
  templateId: string;
  onApplied: (version?: number) => void;
}) {
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [tokens, setTokens] = useState(0);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [history, setHistory] = useState<EditTurn[]>([]);
  const controller = useRef<AbortController | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const defaultFamily = useDefaultModelFamily();
  const [modelFamily, setModelFamily] = useState("");
  const effectiveFamily = modelFamily || defaultFamily;
  const attach = useAiAttach(`report:${templateId}`);

  // Each report has its own edit conversation.
  useEffect(() => {
    setHistory([]);
    setResult(null);
    setInstruction("");
  }, [templateId]);

  const liveStage = useThrottledValue(stage, 350);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy) return;
    const text = instruction.trim();
    if (!text && !attach.hasReady && !attach.hasUploading) return;

    const ac = new AbortController();
    controller.current = ac;
    setBusy(true);
    setResult(null);
    setTokens(0);
    setStage("Reading the report…");

    try {
      // Wait for any in-flight upload, then append the markers so the agent
      // reads the attached image or document as part of the instruction.
      const markers = await attach.waitMarkers();
      if (!text && markers.length === 0) {
        setBusy(false);
        setStage("");
        controller.current = null;
        return;
      }
      const body = markers.length
        ? `${text || "Update this report using the attached file(s)."}\n\n${markers.join("\n")}`
        : text;

      const { version } = await streamReportEdit(
        templateId,
        body,
        history,
        effectiveFamily,
        ac.signal,
        {
          onStage: setStage,
          onReasoning: (chunk) => setTokens((t) => t + (chunk.tokens || 0)),
        }
      );

      setHistory((h) => [
        ...h,
        { role: "user", content: text || "Updated this report using the attached file(s)." },
      ]);
      setResult({
        ok: true,
        text: version
          ? `Applied — saved as version ${version} and re-rendered from your data.`
          : "Applied — re-rendered from your data.",
      });
      setInstruction("");
      attach.clearKeep();
      onApplied(version);
    } catch (err: any) {
      if (err?.name !== "AbortError" && !ac.signal.aborted) {
        setResult({ ok: false, text: errorMessage(err) });
      }
    } finally {
      if (controller.current === ac) controller.current = null;
      setBusy(false);
      setStage("");
    }
  }

  function stop() {
    controller.current?.abort();
    controller.current = null;
    setBusy(false);
    setStage("");
  }

  const canSubmit =
    (instruction.trim().length > 0 || attach.hasReady) && !attach.hasUploading;

  return (
    <div className="rs-edit">
      <span className="rs-ai-chip">
        <Sparkles size={13} aria-hidden /> Edit by instruction
      </span>
      <p className="report-note">
        Describe a change — “add a payment-terms column”, “sort by amount”, “show
        totals in bold”. It rewrites the report and saves a new version; every
        figure still re-runs against live data.
      </p>

      {busy && (
        <div className="rs-progress">
          <span className="an-spinner" aria-hidden />
          <span className="rs-progress-text">{liveStage || "Working…"}</span>
          {tokens > 0 && (
            <span className="rs-tokens">
              <AnimatedNumber value={tokens} /> tokens
            </span>
          )}
        </div>
      )}

      <AttachChips
        pending={attach.pending}
        removeOne={attach.removeOne}
        clearAll={attach.clearAll}
      />

      <form ref={formRef} className="an-composer" onSubmit={(e) => void submit(e)}>
        <AutoTextarea
          className="input an-composer-input"
          placeholder="Describe the change…"
          value={instruction}
          onChange={setInstruction}
          onSubmit={() => formRef.current?.requestSubmit()}
          onPaste={(e) => {
            if (pasteFiles(e, attach.addFiles)) e.preventDefault();
          }}
          disabled={busy}
        />
        <div className="an-composer-foot">
          <AttachButton onPick={attach.addFiles} disabled={busy} />
          <ModelPicker value={effectiveFamily} onChange={setModelFamily} />
          <span className="an-composer-actions">
            {busy ? (
              <button type="button" className="btn btn-ghost btn-sm an-danger" onClick={stop}>
                Stop
              </button>
            ) : (
              <button className="btn btn-primary btn-sm" type="submit" disabled={!canSubmit}>
                Apply
              </button>
            )}
          </span>
        </div>
      </form>

      {result && (
        <div className={result.ok ? "alert success" : "alert error"}>{result.text}</div>
      )}

      {history.length > 0 && (
        <div className="rs-history">
          <div className="rs-history-label">This session's edits</div>
          <ol>
            {history.map((turn, i) => (
              <li key={i}>{turn.content}</li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

/** A labelled row in the rail's detail panels. */
export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rs-detail-row">
      <span className="rs-detail-label">{label}</span>
      <span className="rs-detail-value">{children}</span>
    </div>
  );
}
