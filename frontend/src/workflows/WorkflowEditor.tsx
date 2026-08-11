/**
 * Edit an existing workflow.
 *
 * Workflows are authored in InventDB SOAR — or by describing one in Analyze,
 * which reaches the same engine — and land here as records the PMS can change:
 * rename them, move the schedule, rewrite the steps, mark them safe or live.
 *
 * Three things it deliberately does not do:
 *
 * * **Judge the plan's contents.** InventDB validates a plan on save and
 *   names the failing step; those `issues` are surfaced verbatim. Duplicating
 *   those rules here would only let the two drift.
 * * **Rewrite what it does not understand.** A step kind with no form is
 *   edited as JSON, and unknown keys on a known kind ride through untouched,
 *   so editing a SOAR-authored workflow cannot strip it.
 * * **Change what triggers a workflow.** A plan is written against the payload
 *   its trigger produces, so swapping it would leave `${…}` references pointing
 *   at nothing. The trigger's own settings — which records to watch, which
 *   mailbox label — stay editable; the kind does not.
 */
import { useMemo, useState, type FormEvent } from "react";
import { ChevronDown, ChevronUp, GripVertical, Plus, Trash2 } from "lucide-react";

import { Modal } from "../components/Modal";
import { Alert } from "../components/ui";
import { errorMessage } from "../api/client";
import { useUpdateWorkflow } from "../api/hooks";
import type { PlanIssue, Workflow, WorkflowDraft, WorkflowStep } from "../types";
import {
  STEP_KINDS,
  stepKind,
  triggerKind as triggerSpecFor,
  triggerLabel,
  type StepField,
} from "./catalog";
import {
  DAYS_OF_WEEK,
  DEFAULT_CRON,
  buildCron,
  describeSchedule,
  parseSchedule,
  timezoneOptions,
  type Schedule,
} from "./schedule";
import { PlanError, blankStep, toPlan, toStepDraft, type StepDraft } from "./draft";
import { PlanTimeline } from "./PlanTimeline";

/** Prefill a trigger's own settings from a saved workflow, or from defaults. */
function seedSpec(
  kind: string,
  saved?: { [key: string]: unknown }
): { [field: string]: string } {
  const out: { [field: string]: string } = {};
  for (const field of triggerSpecFor(kind)?.specFields ?? []) {
    const value = saved?.[field.name];
    if (Array.isArray(value)) out[field.name] = value.join(", ");
    else if (value !== undefined && value !== null) out[field.name] = String(value);
    else out[field.name] = field.defaultValue ?? "";
  }
  return out;
}

/** Pull the per-step messages out of a rejected save, if the server sent any. */
function planIssues(err: unknown): PlanIssue[] {
  const body = (err as { response?: { data?: { issues?: unknown } } })?.response?.data;
  const issues = body?.issues;
  if (!Array.isArray(issues)) return [];
  return issues.filter((i): i is PlanIssue => !!i && typeof (i as PlanIssue).message === "string");
}

export function WorkflowEditor({
  workflow,
  onClose,
  onSaved,
}: {
  workflow: Workflow;
  onClose: () => void;
  onSaved: (saved: Workflow) => void;
}) {
  const update = useUpdateWorkflow();
  const busy = update.isPending;

  const [name, setName] = useState(workflow.name);
  const [intent, setIntent] = useState(workflow.trigger_intent ?? "");
  const trigger = workflow.trigger_kind ?? "manual";
  const [schedule, setSchedule] = useState<Schedule>(() =>
    parseSchedule(workflow.trigger_spec?.expr ?? DEFAULT_CRON)
  );
  const [tz, setTz] = useState(workflow.trigger_spec?.tz ?? timezoneOptions()[0]);
  const [sandbox, setSandbox] = useState(workflow.sandbox ?? true);
  /**
   * The non-schedule half of `trigger_spec`, as text — which records to watch,
   * which mailbox label. Seeded from the saved workflow so an edit keeps the
   * settings it already had.
   */
  const [spec, setSpec] = useState<{ [field: string]: string }>(() =>
    seedSpec(trigger, workflow.trigger_spec)
  );
  const [steps, setSteps] = useState<StepDraft[]>(() =>
    (workflow.plan ?? []).map(toStepDraft)
  );
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<PlanIssue[]>([]);
  const [badStep, setBadStep] = useState<number | null>(null);

  const zones = useMemo(timezoneOptions, []);
  const isCron = trigger === "cron" || trigger === "schedule";

  const patchSchedule = (p: Partial<Schedule>) => setSchedule((s) => ({ ...s, ...p }));
  const patchStep = (uid: string, p: Partial<StepDraft>) =>
    setSteps((all) => all.map((s) => (s.uid === uid ? { ...s, ...p } : s)));
  const setStepValue = (uid: string, field: string, value: string) =>
    setSteps((all) =>
      all.map((s) => (s.uid === uid ? { ...s, values: { ...s.values, [field]: value } } : s))
    );

  const move = (index: number, by: number) =>
    setSteps((all) => {
      const to = index + by;
      if (to < 0 || to >= all.length) return all;
      const next = [...all];
      [next[index], next[to]] = [next[to], next[index]];
      return next;
    });

  /**
   * Changing a step's kind keeps the label and narration — the human part of
   * the step usually survives a change of mechanism ("Email owners" stays
   * "Email owners" whether it is mail or SMS) — and resets the arguments,
   * which never carry across.
   */
  const changeKind = (uid: string, kind: string) =>
    setSteps((all) =>
      all.map((s) => {
        if (s.uid !== uid) return s;
        const fresh = blankStep(kind);
        return { ...fresh, uid: s.uid, label: s.label, narration: s.narration, saveAs: s.saveAs, when: s.when };
      })
    );

  /** The plan as it currently stands, for the live preview. Invalid drafts
   *  preview as far as they parse rather than blanking the panel. */
  const previewPlan: WorkflowStep[] = useMemo(() => {
    try {
      return toPlan(steps);
    } catch {
      return steps.map((s, i) => ({
        idx: i,
        kind: s.kind,
        label: s.label || stepKind(s.kind)?.label || s.kind,
        narration: s.narration,
        save_as: s.saveAs || undefined,
        when: s.when || undefined,
      }));
    }
  }, [steps]);

  const specFields = triggerSpecFor(trigger)?.specFields ?? [];

  /**
   * Assemble `trigger_spec`. Built on top of whatever was saved rather than
   * replacing it, so settings InventDB understands but this form does not show
   * survive an edit — the same rule the plan follows.
   */
  const triggerSpec = () => {
    const base = { ...(workflow.trigger_spec ?? {}) };
    if (isCron) return { ...base, expr: buildCron(schedule), tz };
    for (const field of specFields) {
      const raw = (spec[field.name] ?? "").trim();
      if (!raw) {
        delete base[field.name];
        continue;
      }
      base[field.name] =
        field.type === "list" ? raw.split(",").map((p) => p.trim()).filter(Boolean) : raw;
    }
    return base;
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIssues([]);
    setBadStep(null);

    if (!name.trim()) return setError("Give the workflow a name.");
    if (!intent.trim()) return setError("Describe when this should run.");
    for (const field of specFields) {
      if (field.required && !(spec[field.name] ?? "").trim()) {
        return setError(`${field.label} is required for this trigger.`);
      }
    }

    let plan: WorkflowStep[];
    try {
      plan = toPlan(steps);
    } catch (err) {
      if (err instanceof PlanError) {
        setBadStep(err.stepIndex);
        return setError(err.message);
      }
      throw err;
    }

    // `trigger_kind` is deliberately absent: it is not editable, and the
    // engine's update accepts no such field.
    const patch: Partial<WorkflowDraft> = {
      name: name.trim(),
      trigger_intent: intent.trim(),
      trigger_spec: triggerSpec(),
      plan,
      sandbox,
    };

    try {
      onSaved(await update.mutateAsync({ id: workflow._id, patch }));
    } catch (err) {
      const found = planIssues(err);
      setIssues(found);
      const first = found.find((i) => typeof i.step_idx === "number");
      if (first?.step_idx !== undefined) setBadStep(first.step_idx);
      setError(errorMessage(err));
    }
  }

  return (
    <Modal
      title={`Edit “${workflow.name}”`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form="workflow-form" className="btn btn-primary" disabled={busy}>
            {busy ? "Saving…" : "Save changes"}
          </button>
        </>
      }
    >
      <form id="workflow-form" onSubmit={submit} className="wf-editor">
        {error && (
          <Alert kind="error">
            <div>{error}</div>
            {issues.length > 0 && (
              <ul className="wf-issues">
                {issues.map((issue, i) => (
                  <li key={i}>
                    {typeof issue.step_idx === "number" ? `Step ${issue.step_idx + 1}: ` : ""}
                    {issue.message}
                  </li>
                ))}
              </ul>
            )}
          </Alert>
        )}

        {/* ---- What it is ------------------------------------------------- */}
        <section className="wf-section">
          <div className="form-grid">
            <div className="field full">
              <label htmlFor="wf-name">
                Name<span className="req">*</span>
              </label>
              <input
                id="wf-name"
                className="input"
                value={name}
                placeholder="Monthly owner statements"
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          </div>
        </section>

        {/* ---- When it runs ----------------------------------------------- */}
        <section className="wf-section">
          <h4 className="wf-section-head">When it runs</h4>
          <p className="report-note">
            This workflow runs {triggerLabel(trigger).toLowerCase()}. What triggers it can’t be
            changed — the steps below are written against what that trigger produces — but its
            settings can.
          </p>

          {isCron && (
            <div className="form-grid wf-schedule">
              <div className="field">
                <label htmlFor="wf-freq">Repeats</label>
                <select
                  id="wf-freq"
                  className="select"
                  value={schedule.raw ? "raw" : schedule.frequency}
                  onChange={(e) =>
                    e.target.value === "raw"
                      ? patchSchedule({ raw: true, expr: buildCron({ ...schedule, raw: false }) })
                      : patchSchedule({ raw: false, frequency: e.target.value as Schedule["frequency"] })
                  }
                >
                  <option value="daily">Every day</option>
                  <option value="weekdays">Every weekday</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="raw">Custom (cron)</option>
                </select>
              </div>

              {!schedule.raw && (
                <div className="field">
                  <label htmlFor="wf-time">At</label>
                  <input
                    id="wf-time"
                    className="input"
                    type="time"
                    value={schedule.time}
                    onChange={(e) => patchSchedule({ time: e.target.value })}
                  />
                </div>
              )}

              {!schedule.raw && schedule.frequency === "weekly" && (
                <div className="field">
                  <label htmlFor="wf-dow">On</label>
                  <select
                    id="wf-dow"
                    className="select"
                    value={schedule.dayOfWeek}
                    onChange={(e) => patchSchedule({ dayOfWeek: e.target.value })}
                  >
                    {DAYS_OF_WEEK.map((d) => (
                      <option key={d.value} value={d.value}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {!schedule.raw && schedule.frequency === "monthly" && (
                <div className="field">
                  <label htmlFor="wf-dom">Day of month</label>
                  <input
                    id="wf-dom"
                    className="input"
                    type="number"
                    min={1}
                    max={31}
                    value={schedule.dayOfMonth}
                    onChange={(e) => patchSchedule({ dayOfMonth: e.target.value })}
                  />
                </div>
              )}

              {schedule.raw && (
                <div className="field">
                  <label htmlFor="wf-cron">Cron expression</label>
                  <input
                    id="wf-cron"
                    className="input mono"
                    value={schedule.expr}
                    placeholder="*/15 * * * *"
                    onChange={(e) => patchSchedule({ expr: e.target.value })}
                  />
                </div>
              )}

              <div className="field">
                <label htmlFor="wf-tz">Time zone</label>
                <select id="wf-tz" className="select" value={tz} onChange={(e) => setTz(e.target.value)}>
                  {zones.map((z) => (
                    <option key={z} value={z}>
                      {z}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field full">
                <p className="report-note wf-sched-preview">{describeSchedule(schedule)}</p>
              </div>
            </div>
          )}

          {specFields.length > 0 && (
            <div className="form-grid wf-schedule">
              {specFields.map((field) => (
                <StepFieldControl
                  key={field.name}
                  uid="wf-trigger"
                  field={field}
                  value={spec[field.name] ?? ""}
                  onChange={(v) => setSpec((s) => ({ ...s, [field.name]: v }))}
                />
              ))}
            </div>
          )}

          <div className="form-grid">
            <div className="field full">
              <label htmlFor="wf-intent">
                In one line<span className="req">*</span>
              </label>
              <input
                id="wf-intent"
                className="input"
                value={intent}
                placeholder="Email each owner their statement on the 1st of the month"
                onChange={(e) => setIntent(e.target.value)}
              />
              <p className="report-note">
                Shown wherever this workflow appears, and used to decide whether an ambiguous
                incoming event belongs to it.
              </p>
            </div>
          </div>
        </section>

        {/* ---- What it does ----------------------------------------------- */}
        <section className="wf-section">
          <h4 className="wf-section-head">
            What it does
            <span className="wf-step-count">{steps.length} step{steps.length === 1 ? "" : "s"}</span>
          </h4>

          {steps.length === 0 && (
            <p className="report-note">
              A workflow needs at least one step. Most start by querying the data they act on.
            </p>
          )}

          <div className="wf-step-editors">
            {steps.map((step, index) => (
              <StepEditor
                key={step.uid}
                step={step}
                index={index}
                total={steps.length}
                invalid={badStep === index}
                onChangeKind={(kind) => changeKind(step.uid, kind)}
                onPatch={(p) => patchStep(step.uid, p)}
                onValue={(field, value) => setStepValue(step.uid, field, value)}
                onMove={(by) => move(index, by)}
                onRemove={() => setSteps((all) => all.filter((s) => s.uid !== step.uid))}
              />
            ))}
          </div>

          <AddStep onAdd={(kind) => setSteps((all) => [...all, blankStep(kind)])} />
        </section>

        {/* ---- Safety ------------------------------------------------------ */}
        <section className="wf-section">
          <h4 className="wf-section-head">Before it goes live</h4>
          <label className="wf-check">
            <input
              type="checkbox"
              checked={sandbox}
              onChange={(e) => setSandbox(e.target.checked)}
            />
            <span>
              <strong>Rehearse only</strong>
              <span className="wf-check-hint">
                Queries run for real; emails, texts and record changes are mocked. Leave this on
                until a test run looks right — a workflow can be active and still rehearsing.
              </span>
            </span>
          </label>
        </section>

        {/* ---- Preview ----------------------------------------------------- */}
        <section className="wf-section">
          <h4 className="wf-section-head">Preview</h4>
          <div className="card card-pad wf-preview">
            <PlanTimeline
              workflow={{
                plan: previewPlan,
                trigger_kind: trigger,
                trigger_spec: isCron ? { expr: buildCron(schedule), tz } : workflow?.trigger_spec,
                trigger_intent: intent,
              }}
              showTrigger
              emptyNote="Add a step to see the plan."
            />
          </div>
        </section>
      </form>
    </Modal>
  );
}

// ---- One step -------------------------------------------------------------

function StepEditor({
  step,
  index,
  total,
  invalid,
  onChangeKind,
  onPatch,
  onValue,
  onMove,
  onRemove,
}: {
  step: StepDraft;
  index: number;
  total: number;
  invalid: boolean;
  onChangeKind: (kind: string) => void;
  onPatch: (patch: Partial<StepDraft>) => void;
  onValue: (field: string, value: string) => void;
  onMove: (by: number) => void;
  onRemove: () => void;
}) {
  const spec = stepKind(step.kind);
  const [open, setOpen] = useState(true);

  return (
    <div className={`wf-step-editor ${invalid ? "invalid" : ""}`}>
      <div className="wf-step-editor-head">
        <GripVertical size={14} className="wf-grip" aria-hidden />
        <span className="wf-step-no">{index + 1}</span>
        <select
          className="select wf-kind-select"
          value={step.kind}
          aria-label={`Step ${index + 1} action`}
          onChange={(e) => onChangeKind(e.target.value)}
        >
          {!spec && <option value={step.kind}>{step.kind || "Unrecognised step"}</option>}
          {STEP_KINDS.map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.label}
            </option>
          ))}
        </select>
        <div className="wf-step-editor-actions">
          <button
            type="button"
            className="btn-icon"
            onClick={() => onMove(-1)}
            disabled={index === 0}
            aria-label={`Move step ${index + 1} up`}
          >
            <ChevronUp size={15} />
          </button>
          <button
            type="button"
            className="btn-icon"
            onClick={() => onMove(1)}
            disabled={index === total - 1}
            aria-label={`Move step ${index + 1} down`}
          >
            <ChevronDown size={15} />
          </button>
          <button
            type="button"
            className="btn-icon danger"
            onClick={onRemove}
            aria-label={`Remove step ${index + 1}`}
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      {spec && <p className="wf-step-blurb">{spec.blurb}</p>}

      {open && (
        <div className="form-grid wf-step-fields">
          <div className="field">
            <label htmlFor={`${step.uid}-label`}>Name this step</label>
            <input
              id={`${step.uid}-label`}
              className="input"
              value={step.label}
              placeholder={spec?.label ?? ""}
              onChange={(e) => onPatch({ label: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor={`${step.uid}-save`}>Remember result as</label>
            <input
              id={`${step.uid}-save`}
              className="input mono"
              value={step.saveAs}
              placeholder="expiring"
              onChange={(e) => onPatch({ saveAs: e.target.value })}
            />
          </div>

          {step.rawJson !== undefined ? (
            <div className="field full">
              <label htmlFor={`${step.uid}-raw`}>Step definition</label>
              <textarea
                id={`${step.uid}-raw`}
                className="textarea mono"
                rows={8}
                value={step.rawJson}
                onChange={(e) => onPatch({ rawJson: e.target.value })}
              />
              <p className="report-note">
                This step’s kind has no form here — most likely it was authored in SOAR. It is
                shown as JSON so it survives an edit intact.
              </p>
            </div>
          ) : (
            spec?.fields.map((field) => (
              <StepFieldControl
                key={field.name}
                uid={step.uid}
                field={field}
                value={step.values[field.name] ?? ""}
                onChange={(v) => onValue(field.name, v)}
              />
            ))
          )}

          <div className="field full">
            <label htmlFor={`${step.uid}-narration`}>Notes</label>
            <input
              id={`${step.uid}-narration`}
              className="input"
              value={step.narration}
              placeholder="What this accomplishes, in plain words"
              onChange={(e) => onPatch({ narration: e.target.value })}
            />
          </div>

          <div className="field full">
            <label htmlFor={`${step.uid}-when`}>Only run this step if</label>
            <input
              id={`${step.uid}-when`}
              className="input mono"
              value={step.when}
              placeholder="${expiring}"
              onChange={(e) => onPatch({ when: e.target.value })}
            />
            <p className="report-note">
              Leave blank to always run it. Name a variable from an earlier step to skip this one
              when that variable comes back empty.
            </p>
          </div>
        </div>
      )}

      <button type="button" className="btn btn-ghost btn-sm wf-collapse" onClick={() => setOpen((o) => !o)}>
        {open ? "Collapse" : "Edit details"}
      </button>
    </div>
  );
}

function StepFieldControl({
  uid,
  field,
  value,
  onChange,
}: {
  uid: string;
  field: StepField;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = `${uid}-${field.name}`;
  const full = field.type === "textarea" || field.type === "sql" || field.type === "json";

  let control;
  if (field.type === "boolean") {
    control = (
      <label className="wf-check inline">
        <input id={id} type="checkbox" checked={value === "true"} onChange={(e) => onChange(String(e.target.checked))} />
        <span>{field.label}</span>
      </label>
    );
  } else if (field.type === "select") {
    control = (
      <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">— Select —</option>
        {field.options?.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
        {/* Keep a saved value that is no longer offered, rather than
            silently switching the workflow to something else. */}
        {value && !field.options?.includes(value) && <option value={value}>{value}</option>}
      </select>
    );
  } else if (field.type === "textarea") {
    control = (
      <textarea
        id={id}
        className="textarea"
        rows={4}
        value={value}
        placeholder={field.placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  } else if (field.type === "sql" || field.type === "json") {
    control = (
      <textarea
        id={id}
        className="textarea mono"
        rows={field.type === "sql" ? 4 : 3}
        spellCheck={false}
        value={value}
        placeholder={field.placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  } else {
    control = (
      <input
        id={id}
        className="input"
        value={value}
        placeholder={field.placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  return (
    <div className={`field ${full ? "full" : ""}`}>
      {field.type !== "boolean" && (
        <label htmlFor={id}>
          {field.label}
          {field.required && <span className="req">*</span>}
        </label>
      )}
      {control}
      {field.hint && <p className="report-note">{field.hint}</p>}
    </div>
  );
}

function AddStep({ onAdd }: { onAdd: (kind: string) => void }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button type="button" className="btn btn-ghost wf-add" onClick={() => setOpen(true)}>
        <Plus size={15} /> Add a step
      </button>
    );
  }

  return (
    <div className="wf-add-menu">
      <div className="wf-add-menu-head">
        <span>What should happen next?</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
      <div className="wf-add-grid">
        {STEP_KINDS.map((k) => {
          const Ico = k.icon;
          return (
            <button
              key={k.kind}
              type="button"
              className="wf-add-option"
              onClick={() => {
                onAdd(k.kind);
                setOpen(false);
              }}
            >
              <Ico size={16} />
              <span className="wf-add-label">
                {k.label}
                {k.sideEffecting && <span className="wf-add-tag">sends</span>}
              </span>
              <span className="wf-add-blurb">{k.blurb}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
