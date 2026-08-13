/**
 * "Describe it" — the plain-English way to start a New <type>.
 *
 * Say what the record is the way you would say it to a colleague; the assistant
 * transcribes it into the form's fields and you check its work. This is the
 * same affordance InventDB SOAR puts on its own New-record flow, and it exists
 * for the same reason: a twenty-field form is a transcription exercise, and
 * nobody knows the shape of a lease better in field order than in a sentence.
 *
 * Three things this deliberately does NOT do.
 *
 * It does not save. The values land in the open form and the person still reads
 * them and still presses Save — the assistant proposes, the manager commits.
 * It does not clear what you have already typed: a fill only sets the fields it
 * has values for, so hand-entered work survives a description that never
 * mentioned it. And it does not hide what it couldn't do — a status it can't
 * match to a choice, a property that isn't on the books, are reported, because
 * a description half-transcribed in silence is the one way this feature could
 * put a wrong record in front of someone who trusted it.
 */
import { useEffect, useRef, useState } from "react";
import { Sparkles, Square } from "lucide-react";

import { agentText, friendlyAiError, isCancel } from "../analyze/agent";
import { ModelPicker, useDefaultModelFamily } from "../analyze/ModelPicker";
import type { EntityConfig } from "../config/entities";
import { coerceFill, extractJsonObject, fillPrompt } from "./describe";
import type { RefOption } from "./references";

/**
 * A single extraction is a short completion, not a reasoning run — the prompt
 * forbids tools precisely so it stays that way. Two minutes is far past any
 * healthy turn, so hitting it means the request is not coming back.
 */
const FILL_TIMEOUT_MS = 120_000;

interface Summary {
  filled: string[];
  unresolved: string[];
}

export function DescribeRecord({
  config,
  values,
  refOptions,
  onFill,
}: {
  config: EntityConfig;
  /** The form's current values, so a second description refines rather than resets. */
  values: { [name: string]: string };
  /** Loaded option lists per referenced entity, used to resolve names to ids. */
  refOptions: { [entity: string]: RefOption[] };
  onFill: (patch: { [name: string]: string }) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [family, setFamily] = useState("");
  const workspaceDefault = useDefaultModelFamily();
  const abort = useRef<AbortController | null>(null);

  // A fill in flight is a request to a live model; leaving the form should end
  // it rather than let it run on against a component that is gone.
  useEffect(() => () => abort.current?.abort(), []);

  const canSubmit = text.trim().length > 0 && !busy;

  function stop() {
    abort.current?.abort();
    abort.current = null;
    setBusy(false);
    setStep("");
  }

  async function fill() {
    const description = text.trim();
    if (!description || busy) return;
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setError(null);
    setSummary(null);
    setStep("Reading your description…");

    try {
      const answer = await agentText(
        fillPrompt(config, description, values),
        {
          signal: controller.signal,
          modelFamily: family || workspaceDefault || undefined,
          timeoutMs: FILL_TIMEOUT_MS,
          onProgress: setStep,
        }
      );
      const raw = extractJsonObject(answer);
      if (!raw) {
        setError(
          "The assistant didn't answer with anything the form could use. Try describing the record again, a little more plainly."
        );
        return;
      }
      const { values: patch, unresolved } = coerceFill(config, raw, refOptions);
      const names = Object.keys(patch);
      if (!names.length && !unresolved.length) {
        setError(
          `Nothing in that described a ${config.label.toLowerCase()}. Try naming a few of the fields below — ${config.fields
            .slice(0, 3)
            .map((f) => f.label.toLowerCase())
            .join(", ")}.`
        );
        return;
      }
      onFill(patch);
      const labels = config.fields
        .filter((f) => names.includes(f.name))
        .map((f) => f.label);
      setSummary({ filled: labels, unresolved });
    } catch (err) {
      // Stop is the user's own decision — reporting it back as a failure would
      // be the interface arguing with them.
      if (!isCancel(err)) setError(friendlyAiError((err as Error)?.message));
    } finally {
      abort.current = null;
      setBusy(false);
      setStep("");
    }
  }

  return (
    <section className="dsc" aria-label={`Describe the ${config.label.toLowerCase()}`}>
      <div className="dsc-head">
        <Sparkles size={15} />
        <h4>Describe it</h4>
        <span className="dsc-head-note">
          Plain English — the assistant fills the form, you check it
        </span>
      </div>

      <label className="sr-only" htmlFor="describe-record">
        Describe the {config.label.toLowerCase()} in plain English
      </label>
      <textarea
        id="describe-record"
        className="input dsc-input"
        rows={3}
        value={text}
        disabled={busy}
        placeholder={config.describeExample}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // Enter fills, Shift+Enter breaks the line — the same bargain the
          // Analyze composer strikes, so the muscle memory carries across.
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void fill();
          }
        }}
      />

      <div className="dsc-foot">
        <ModelPicker value={family || workspaceDefault} onChange={setFamily} />
        {busy && step && <span className="dsc-step">{step}</span>}
        <div className="dsc-actions">
          {busy ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={stop}>
              <Square size={13} /> Stop
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!canSubmit}
              onClick={() => void fill()}
            >
              <Sparkles size={14} /> Fill the form
            </button>
          )}
        </div>
      </div>

      {error && (
        <p className="dsc-error" role="alert">
          {error}
        </p>
      )}

      {summary && (
        <div className="dsc-summary">
          {summary.filled.length > 0 && (
            <p className="dsc-filled">
              {summary.filled.length === 1
                ? `Filled 1 field — ${summary.filled[0]}. Check it before saving.`
                : `Filled ${summary.filled.length} fields — ${summary.filled.join(
                    ", "
                  )}. Check them before saving.`}
            </p>
          )}
          {summary.unresolved.map((note, i) => (
            <p key={i} className="dsc-unresolved">
              {note}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
