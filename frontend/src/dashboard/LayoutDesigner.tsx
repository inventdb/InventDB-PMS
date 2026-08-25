/**
 * New layout — describe a whole dashboard, not one widget.
 *
 * The assistant reads the live schema and proposes several widgets at once,
 * pointed at what was asked for rather than at the database in general. The
 * preview is the real grid, so what is approved is what appears.
 *
 * "Yes" means two different things for a whole layout, so it is two answers:
 * replace what is there, or add to it. Nothing is written until one is chosen.
 */
import { useRef, useState } from "react";

import { isCancel, type AgentStep } from "../analyze/agent";
import { AgentTimeline } from "../analyze/Timeline";
import { ActionProgress } from "../analyze/ui";
import { Modal } from "../components/Modal";
import { suggestWidgets } from "./suggest";
import { WidgetView } from "./WidgetView";
import type { Widget } from "./types";

export function LayoutDesigner({
  onApply,
  onClose,
}: {
  onApply: (widgets: Widget[], how: "replace" | "add") => void;
  onClose: () => void;
}) {
  const [ask, setAsk] = useState("");
  const [widgets, setWidgets] = useState<Widget[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const ac = useRef<AbortController | null>(null);

  function cancel() {
    ac.current?.abort("user");
    ac.current = null;
    setBusy(false);
  }

  async function build() {
    const instr = ask.trim();
    if (!instr) {
      setErr("Describe the dashboard you want.");
      return;
    }
    const a = new AbortController();
    ac.current = a;
    setBusy(true);
    setErr(null);
    setSteps([]);
    setProgress("Reading your data…");
    try {
      setWidgets(
        await suggestWidgets(instr, a.signal, setProgress, (s) =>
          setSteps((xs) => [...xs, s])
        )
      );
    } catch (e) {
      if (!isCancel(e)) setErr((e as Error)?.message || "Could not build that layout.");
    } finally {
      if (ac.current === a) ac.current = null;
      setBusy(false);
      setProgress("");
      // The trace is progress, not a result — it goes once the work is done.
      setSteps([]);
    }
  }

  return (
    <Modal
      title="New layout"
      onClose={onClose}
      footer={
        <>
          <button
            className="btn btn-primary"
            disabled={!widgets?.length}
            onClick={() => widgets && onApply(widgets, "replace")}
          >
            Replace my dashboard
          </button>
          <button
            className="btn"
            disabled={!widgets?.length}
            onClick={() => widgets && onApply(widgets, "add")}
          >
            Add to my dashboard
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <div className="we">
        <p className="we-sub">
          Describe the dashboard you want and the assistant builds the whole thing —
          several widgets at once, each backed by its own query. e.g. “a delinquency view:
          overdue rent by property, leases ending within 60 days, and arrears by region”.
        </p>

        <textarea
          id="w-layout"
          className="input we-describe"
          placeholder="Describe the dashboard…"
          value={ask}
          aria-label="Describe the dashboard"
          onChange={(e) => setAsk(e.target.value)}
          disabled={busy}
        />

        <div className="we-row">
          {busy ? (
            <ActionProgress label={progress || "Building the layout…"} onCancel={cancel} />
          ) : (
            <button
              className="btn btn-primary btn-sm"
              disabled={!ask.trim()}
              onClick={() => void build()}
            >
              {widgets ? "Rebuild layout" : "✦ Build layout"}
            </button>
          )}
          {widgets && !busy && (
            <span className="we-sub">
              {widgets.length} widget{widgets.length === 1 ? "" : "s"} — nothing is written
              until you choose below
            </span>
          )}
        </div>

        {busy && steps.length > 0 && <AgentTimeline steps={steps} running />}
        {err && <div className="inline-error">{err}</div>}

        <div className="we-preview">
          <span className="we-sub">Preview</span>
          <div className="we-preview-box">
            {widgets?.length ? (
              <div className="bento we-layout-preview">
                {widgets.map((w) => (
                  <div key={w.id} className={`bento-slot span-${w.span}`}>
                    <WidgetView w={w} editing={false} onEdit={() => {}} onDelete={() => {}} />
                  </div>
                ))}
              </div>
            ) : (
              <p className="we-sub">
                Describe the dashboard and press ✦ Build layout to preview it here.
              </p>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
