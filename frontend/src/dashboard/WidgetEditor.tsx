/**
 * Create or edit a dashboard widget — ported from InventDB SOAR's
 * `rooms/dashboard/WidgetEditor.tsx`.
 *
 * The primary path is DESCRIBE: say what the widget should show and the
 * assistant builds a mini-report template — it may pull from several queries
 * and lay them out however you asked — and editing is just describing a change.
 * A secondary "Simple" path makes a one-query number, list, table or chart. A
 * third adds a quick-add form card. Either way the preview renders the ACTUAL
 * widget before it is added.
 *
 * SOAR's SQL generator is a dedicated `/ai/generate-sql` route; the PMS reaches
 * the same assistant through `agentText`, which is the seam this app already
 * has. Same result, no second endpoint.
 */
import { useEffect, useRef, useState } from "react";

import { agentText, isCancel, type AgentStep } from "../analyze/agent";
import { ModelPicker } from "../analyze/ModelPicker";
import { AgentTimeline } from "../analyze/Timeline";
import { ActionProgress, AutoTextarea } from "../analyze/ui";
import { Modal } from "../components/Modal";
import { ENTITIES } from "../config/entities";
import { buildSchemaSummary, NS } from "./suggest";
import { generateWidget } from "./reportWidget";
import { WidgetView } from "./WidgetView";
import { newWidgetId, WIDGET_KINDS, type Widget, type WidgetKind } from "./types";

const SPANS = [3, 4, 6, 8, 12];

export function WidgetEditor({
  initial,
  onSave,
  onClose,
}: {
  initial?: Widget | null;
  onSave: (w: Widget) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"describe" | "simple" | "form">(
    initial?.kind === "report" || !initial
      ? "describe"
      : initial?.kind === "form"
        ? "form"
        : "simple"
  );
  const [title, setTitle] = useState(initial?.title ?? "");
  const [span, setSpan] = useState(initial?.span ?? (initial?.kind === "kpi" ? 3 : 6));

  // describe (mini-report)
  const [describe, setDescribe] = useState("");
  const [templateId, setTemplateId] = useState<string | null>(
    initial?.kind === "report" ? (initial.templateId ?? null) : null
  );
  const [baseSql, setBaseSql] = useState(initial?.kind === "report" ? (initial.sql ?? "") : "");
  // Bumped on each build so the preview remounts and re-fetches the UPDATED
  // template — without it, an in-place edit leaves the stale render on screen
  // and "Apply change" looks like it did nothing.
  const [rev, setRev] = useState(0);
  // The refinement instructions so far — shown, fed back as context, and saved
  // on the widget, so reopening continues the same design conversation rather
  // than starting over.
  const [history, setHistory] = useState<string[]>(
    initial?.kind === "report" ? (initial.history ?? []) : []
  );

  // simple (one query)
  const [kind, setKind] = useState<WidgetKind>(
    initial && initial.kind !== "report" && initial.kind !== "form" ? initial.kind : "kpi"
  );
  const [sql, setSql] = useState(
    initial && initial.kind !== "report" ? (initial.sql ?? "") : ""
  );
  const [moneyFmt, setMoneyFmt] = useState(!!initial?.money);
  const [ask, setAsk] = useState("");
  const [modelFamily, setModelFamily] = useState("");

  // quick-add form
  const [formType, setFormType] = useState(
    initial?.kind === "form" ? (initial.formType || "") : ""
  );

  // shared
  const [previewW, setPreviewW] = useState<Widget | null>(initial ? { ...initial } : null);
  const [busy, setBusy] = useState<"ai" | "sql" | null>(null);
  const [aiSteps, setAiSteps] = useState<AgentStep[]>([]);
  const [progress, setProgress] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const ac = useRef<AbortController | null>(null);

  // Deliberately NOT aborted on unmount: navigating away must not cancel an
  // in-flight build. Only an explicit Stop does.
  function cancelAi() {
    ac.current?.abort("user");
    ac.current = null;
    setBusy(null);
  }

  useEffect(() => {
    if (initial?.kind === "report" && initial.templateId) setRev((r) => r + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function build() {
    const instr = describe.trim();
    if (!instr) {
      setErr("Describe what the widget should show.");
      return;
    }
    const a = new AbortController();
    ac.current = a;
    setBusy("ai");
    setErr(null);
    setAiSteps([]);
    setProgress("Designing the widget…");
    try {
      // The current template and the running instruction history both go up, so
      // the generator EDITS this widget in context rather than rebuilding it.
      const res = await generateWidget(
        instr,
        {
          templateId: templateId || undefined,
          baseSql: baseSql || undefined,
          history,
        },
        { signal: a.signal, modelFamily: modelFamily || undefined, title: title || instr }
      );
      setTemplateId(res.templateId);
      setBaseSql(res.baseSql);
      const t = title.trim() || instr.slice(0, 48);
      if (!title.trim()) setTitle(t);
      setRev((r) => r + 1);
      setHistory((h) => [...h, instr]);
      setPreviewW({
        id: "preview",
        kind: "report",
        title: t,
        sql: res.baseSql,
        span,
        templateId: res.templateId,
      });
      setDescribe("");
    } catch (e) {
      if (!isCancel(e)) setErr((e as Error)?.message || "Could not build the widget.");
    } finally {
      if (ac.current === a) ac.current = null;
      setBusy(null);
      setProgress("");
      setAiSteps([]);
    }
  }

  async function genSql() {
    const q = ask.trim() || title.trim();
    if (!q) {
      setErr("Describe it or set a title first.");
      return;
    }
    const a = new AbortController();
    ac.current = a;
    setBusy("sql");
    setErr(null);
    setAiSteps([]);
    setProgress("Writing the query…");
    try {
      const schema = await buildSchemaSummary();
      if (!schema.length) {
        setErr("There is no data yet — add some, then generate a query.");
        return;
      }
      const schemaText = schema.map((s) => `${NS}.${s.type}(${s.columns.join(", ")})`).join("\n");
      const hint = WIDGET_KINDS.find((k) => k.kind === kind)?.hint ?? "";
      const prompt =
        `Write ONE InventDB SELECT statement for a dashboard widget. Return ONLY the SQL — no prose, no code fences, and do NOT run any tools.\n\n` +
        `Live schema:\n${schemaText}\n\n` +
        `The widget is a ${kind}: ${hint}\n` +
        `What it should show: ${q}\n\n` +
        `Rules: SELECT only. NO CASE WHEN, NO subqueries, NO LOWER(), NO date functions (DATE_TRUNC/strftime/NOW are unsupported); LIKE is case-insensitive. Use real column names from the schema above and qualify tables as ${NS}.<type>.`;
      const out = await agentText(prompt, {
        signal: a.signal,
        timeoutMs: 300000,
        modelFamily: modelFamily || undefined,
        onProgress: setProgress,
        onStep: (s) => setAiSteps((xs) => [...xs, s]),
      });
      const cleaned = out
        .replace(/```[a-z]*\n?/gi, "")
        .replace(/```/g, "")
        .trim();
      const m = cleaned.match(/\b(SELECT|WITH)\b[\s\S]*/i);
      const statement = (m ? m[0] : "").trim().replace(/;+\s*$/, "");
      if (statement) {
        setSql(statement);
        if (!title.trim()) setTitle(q);
      } else setErr("No query produced — write the SQL directly.");
    } catch (e) {
      if (!isCancel(e)) setErr((e as Error)?.message || "Could not generate the query.");
    } finally {
      if (ac.current === a) ac.current = null;
      setBusy(null);
      setProgress("");
      setAiSteps([]);
    }
  }

  function previewSimple() {
    if (!sql.trim()) {
      setErr("Add a query (write it or generate it).");
      return;
    }
    setErr(null);
    setPreviewW({
      id: "preview",
      kind,
      title: title.trim() || "Widget",
      sql: sql.trim(),
      span,
      money: moneyFmt,
    });
  }

  function save() {
    if (mode === "form") {
      if (!formType.trim()) {
        setErr("Pick the type the quick-add form creates records in.");
        return;
      }
      onSave({
        id: initial?.id ?? newWidgetId(),
        kind: "form",
        title: title.trim() || `Add ${formType.trim()}`,
        sql: "",
        span,
        formType: formType.trim(),
      });
      return;
    }
    if (!title.trim()) {
      setErr("Give the widget a title.");
      return;
    }
    if (mode === "describe") {
      if (!templateId) {
        setErr("Build the widget first (describe it, then ✦ Build).");
        return;
      }
      onSave({
        id: initial?.id ?? newWidgetId(),
        kind: "report",
        title: title.trim(),
        sql: baseSql,
        span,
        templateId,
        history,
      });
    } else {
      if (!sql.trim()) {
        setErr("Add a query.");
        return;
      }
      onSave({
        id: initial?.id ?? newWidgetId(),
        kind,
        title: title.trim(),
        sql: sql.trim(),
        span,
        money: moneyFmt,
      });
    }
  }

  const hint = WIDGET_KINDS.find((k) => k.kind === kind)?.hint;
  const running = busy !== null;

  return (
    <Modal
      title={initial ? "Edit widget" : "Add widget"}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" onClick={save}>
            {initial ? "Save widget" : "Add widget"}
          </button>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <div className="we">
        <p className="we-sub">
          describe it and the assistant builds a mini-report — or make a simple one-query widget
        </p>

        <div className="seg" role="tablist">
          <button
            className={`seg-btn${mode === "describe" ? " is-active" : ""}`}
            role="tab"
            aria-selected={mode === "describe"}
            onClick={() => setMode("describe")}
          >
            ✦ Describe (mini-report)
          </button>
          <button
            className={`seg-btn${mode === "simple" ? " is-active" : ""}`}
            role="tab"
            aria-selected={mode === "simple"}
            onClick={() => setMode("simple")}
          >
            Simple (one query)
          </button>
          <button
            className={`seg-btn${mode === "form" ? " is-active" : ""}`}
            role="tab"
            aria-selected={mode === "form"}
            onClick={() => setMode("form")}
          >
            Quick-add form
          </button>
        </div>

        <div className="we-grid">
          <label className="field" htmlFor="w-title">
            <span>Title</span>
            <input
              id="w-title"
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Region scorecard"
            />
          </label>
          <label className="field" htmlFor="w-span">
            <span>Width</span>
            <select
              id="w-span"
              className="input"
              value={span}
              onChange={(e) => setSpan(Number(e.target.value))}
            >
              {SPANS.map((s) => (
                <option key={s} value={s}>
                  {s === 12 ? "Full width" : `${s}/12`}
                </option>
              ))}
            </select>
          </label>
        </div>

        {mode === "describe" ? (
          <div className="we-pane">
            <p className="we-sub">
              Describe what to show — it can combine multiple sources. e.g. “each region with
              its occupancy %, total monthly rent and count of open work orders, as a compact
              scorecard”.
            </p>
            {history.length > 0 && (
              <div className="we-history">
                {history.map((h, i) => (
                  <div key={i}>
                    <span className="we-history-tag">{i === 0 ? "✦ built" : `↳ refine ${i}`}</span>
                    <span>{h}</span>
                  </div>
                ))}
              </div>
            )}
            <textarea
              id="w-describe"
              className="input we-describe"
              placeholder={
                history.length
                  ? "Describe a change to refine — e.g. “add a bar chart of spend by category”, “sort by amount”…"
                  : "Describe the widget…"
              }
              value={describe}
              onChange={(e) => setDescribe(e.target.value)}
              disabled={busy === "ai"}
            />
            <div className="we-row">
              {busy === "ai" ? (
                <ActionProgress label={progress || "Building…"} onCancel={cancelAi} />
              ) : (
                <button
                  className="btn btn-primary btn-sm"
                  disabled={!describe.trim()}
                  onClick={() => void build()}
                >
                  {templateId ? "Apply change" : "✦ Build widget"}
                </button>
              )}
              {templateId && !running && (
                <span className="we-sub">
                  describe a change and Apply to refine — it edits this widget, keeping the
                  prior context
                </span>
              )}
            </div>
            {busy === "ai" && aiSteps.length > 0 && <AgentTimeline steps={aiSteps} running />}
          </div>
        ) : mode === "simple" ? (
          <div className="we-pane">
            <div className="we-grid">
              <label className="field" htmlFor="w-kind">
                <span>Type</span>
                <select
                  id="w-kind"
                  className="input"
                  value={kind}
                  onChange={(e) => {
                    const k = e.target.value as WidgetKind;
                    setKind(k);
                    setSpan(k === "kpi" ? 3 : span < 6 ? 6 : span);
                  }}
                >
                  {WIDGET_KINDS.map((k) => (
                    <option key={k.kind} value={k.kind}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="we-check">
                <input
                  type="checkbox"
                  checked={moneyFmt}
                  onChange={(e) => setMoneyFmt(e.target.checked)}
                />
                currency values
              </label>
            </div>
            <span className="we-sub">{hint}</span>
            <div className="we-row we-ask">
              <AutoTextarea
                className="input"
                placeholder="✦ Describe the query — e.g. “top vendors by spend”"
                value={ask}
                onChange={setAsk}
                onSubmit={() => void genSql()}
                disabled={busy === "sql"}
              />
              <ModelPicker value={modelFamily} onChange={(f) => setModelFamily(f)} />
              {busy === "sql" ? (
                <ActionProgress label={progress || "Writing…"} onCancel={cancelAi} />
              ) : (
                <button className="btn btn-sm" onClick={() => void genSql()}>
                  ✦ Generate SQL
                </button>
              )}
            </div>
            <textarea
              id="w-sql"
              className="input we-sql"
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              placeholder={`SELECT … FROM ${NS}.<type> …`}
              spellCheck={false}
            />
            <div>
              <button className="btn btn-sm" onClick={previewSimple}>
                Preview
              </button>
            </div>
            {busy === "sql" && aiSteps.length > 0 && <AgentTimeline steps={aiSteps} running />}
          </div>
        ) : (
          <div className="we-pane">
            <p className="we-sub">
              A quick-add card on your dashboard — it opens the form for a type so anyone can
              add a record without leaving the dashboard.
            </p>
            <div className="we-grid">
              <label className="field" htmlFor="w-ns">
                <span>Namespace</span>
                <input id="w-ns" className="input" value={NS} readOnly aria-readonly="true" />
              </label>
              <label className="field" htmlFor="w-formtype">
                <span>Type</span>
                <select
                  id="w-formtype"
                  className="input"
                  value={formType}
                  onChange={(e) => {
                    setFormType(e.target.value);
                    const cfg = ENTITIES.find((x) => x.name === e.target.value);
                    if (!title.trim() && cfg) setTitle(`Add ${cfg.label}`);
                  }}
                >
                  <option value="">pick a type…</option>
                  {ENTITIES.map((e) => (
                    <option key={e.name} value={e.name}>
                      {e.labelPlural}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <span className="we-sub">
              It uses the module's own form — validation, choices, references and help.
            </span>
          </div>
        )}

        {err && <div className="inline-error">{err}</div>}

        <div className="we-preview">
          <span className="we-sub">Preview</span>
          <div className="we-preview-box">
            {mode === "form" ? (
              formType.trim() ? (
                <WidgetView
                  key={`form:${formType}`}
                  w={{
                    id: "preview",
                    kind: "form",
                    title: title.trim() || `Add ${formType}`,
                    sql: "",
                    span: 12,
                    formType: formType.trim(),
                  }}
                  editing={false}
                  onEdit={() => {}}
                  onDelete={() => {}}
                />
              ) : (
                <p className="we-sub">Pick a type to preview the quick-add card.</p>
              )
            ) : previewW ? (
              <WidgetView
                key={`${previewW.kind}:${previewW.templateId || previewW.sql}:${rev}`}
                w={{ ...previewW, span: 12 }}
                editing={false}
                onEdit={() => {}}
                onDelete={() => {}}
              />
            ) : (
              <p className="we-sub">
                {mode === "describe"
                  ? "Describe the widget and press ✦ Build to preview it here."
                  : "Write or generate a query and press Preview."}
              </p>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
