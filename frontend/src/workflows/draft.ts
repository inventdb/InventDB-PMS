/**
 * Turning a plan into editable text and back.
 *
 * Every control in the step editor holds a string, because that is what a user
 * types and what a half-finished JSON object has to survive as. The engine, on
 * the other hand, wants real types — an array for `cc`, an object for
 * `record`, a boolean for `also_email`. This module owns both directions of
 * that conversion plus the check that runs before a save.
 *
 * The rule that shapes it: **never silently drop a field**. A plan authored in
 * SOAR can carry step kinds and keys this editor has no control for, and an
 * edit made here must not quietly delete them. Unknown keys are preserved on
 * the step, and an unknown *kind* is edited as raw JSON rather than being
 * rewritten from a form that does not fit it.
 */
import type { WorkflowStep } from "../types";
import { stepKind, type StepField } from "./catalog";

/** Keys every step has, whatever its kind. */
const COMMON_KEYS = ["idx", "kind", "label", "narration", "save_as", "when"];

export interface StepDraft {
  /** Stable across reorders, so React keeps input focus when steps move. */
  uid: string;
  kind: string;
  label: string;
  narration: string;
  saveAs: string;
  when: string;
  /** Kind-specific values, as typed. */
  values: { [field: string]: string };
  /**
   * Keys the catalogue has no control for, kept verbatim so an edit made here
   * cannot strip configuration authored elsewhere.
   */
  passthrough: { [key: string]: unknown };
  /** Set for a kind the catalogue does not describe — edited as raw JSON. */
  rawJson?: string;
}

let uidCounter = 0;
const nextUid = () => `step-${++uidCounter}`;

function toFieldText(value: unknown, type: StepField["type"]): string {
  if (value === undefined || value === null) return "";
  if (type === "list") {
    return Array.isArray(value) ? value.join(", ") : String(value);
  }
  if (type === "json") {
    if (typeof value === "string") return value;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return "";
    }
  }
  if (type === "boolean") return value === true ? "true" : "false";
  return String(value);
}

/** Read one saved step into the editor's string-shaped form. */
export function toStepDraft(step: WorkflowStep): StepDraft {
  const kind = String(step.kind ?? "");
  const spec = stepKind(kind);
  const base = {
    uid: nextUid(),
    kind,
    label: String(step.label ?? ""),
    narration: String(step.narration ?? ""),
    saveAs: String(step.save_as ?? ""),
    when: String(step.when ?? ""),
  };

  if (!spec) {
    // No form fits this kind. Show the whole step as JSON so it stays
    // editable and, more importantly, stays intact.
    const { idx: _idx, ...rest } = step;
    return { ...base, values: {}, passthrough: {}, rawJson: JSON.stringify(rest, null, 2) };
  }

  const values: { [field: string]: string } = {};
  for (const field of spec.fields) {
    values[field.name] = toFieldText(step[field.name], field.type);
  }
  const known = new Set([...COMMON_KEYS, ...spec.fields.map((f) => f.name)]);
  const passthrough: { [key: string]: unknown } = {};
  for (const [key, value] of Object.entries(step)) {
    if (!known.has(key)) passthrough[key] = value;
  }
  return { ...base, values, passthrough };
}

/** A blank step of the given kind, ready to fill in. */
export function blankStep(kind: string): StepDraft {
  const spec = stepKind(kind);
  const values: { [field: string]: string } = {};
  for (const field of spec?.fields ?? []) values[field.name] = "";
  return {
    uid: nextUid(),
    kind,
    label: "",
    narration: "",
    saveAs: "",
    when: "",
    values,
    passthrough: {},
  };
}

export class PlanError extends Error {
  constructor(
    message: string,
    /** 0-based index of the step at fault, so the editor can point at it. */
    readonly stepIndex: number
  ) {
    super(message);
    this.name = "PlanError";
  }
}

function fromFieldText(text: string, field: StepField, stepIndex: number): unknown {
  const trimmed = text.trim();
  if (field.type === "boolean") return trimmed === "true";
  if (!trimmed) {
    if (field.required) {
      throw new PlanError(`Step ${stepIndex + 1}: ${field.label} is required.`, stepIndex);
    }
    return undefined;
  }
  if (field.type === "list") {
    return trimmed
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  }
  if (field.type === "json") {
    try {
      return JSON.parse(trimmed);
    } catch {
      throw new PlanError(`Step ${stepIndex + 1}: ${field.label} is not valid JSON.`, stepIndex);
    }
  }
  return trimmed;
}

/**
 * Build the plan to send.
 *
 * Throws a `PlanError` naming the step at fault rather than returning a
 * partial plan — a save that silently dropped a required field would produce a
 * workflow that looks saved and fails on its first run.
 *
 * `label` and `narration` are always emitted, even empty: the engine's step
 * type requires both, and a missing one fails deserialisation for the whole
 * plan rather than for the step.
 */
export function toPlan(drafts: StepDraft[]): WorkflowStep[] {
  if (!drafts.length) throw new PlanError("Add at least one step.", 0);

  return drafts.map((draft, index) => {
    if (draft.rawJson !== undefined) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(draft.rawJson);
      } catch {
        throw new PlanError(`Step ${index + 1} is not valid JSON.`, index);
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new PlanError(`Step ${index + 1} must be a JSON object.`, index);
      }
      return { ...(parsed as WorkflowStep), idx: index };
    }

    const spec = stepKind(draft.kind);
    if (!spec) throw new PlanError(`Step ${index + 1}: pick what this step does.`, index);

    const step: WorkflowStep = {
      ...draft.passthrough,
      idx: index,
      kind: draft.kind,
      // The label is what the timeline reads, so an unnamed step falls back to
      // its kind's name rather than showing an empty row.
      label: draft.label.trim() || spec.label,
      narration: draft.narration.trim(),
    };
    if (draft.saveAs.trim()) step.save_as = draft.saveAs.trim();
    if (draft.when.trim()) step.when = draft.when.trim();

    for (const field of spec.fields) {
      const value = fromFieldText(draft.values[field.name] ?? "", field, index);
      if (value !== undefined) step[field.name] = value;
    }
    return step;
  });
}

/** A one-line summary of what a step is configured to do, for the timeline. */
export function summariseStep(step: WorkflowStep): string {
  if (step.narration) return String(step.narration);
  const kind = String(step.kind ?? "");
  if (kind === "send_email" && step.to) return `To ${String(step.to)}`;
  if (kind === "send_sms" && step.to) return `To ${String(step.to)}`;
  if (kind === "sql_query" && step.sql) return String(step.sql).replace(/\s+/g, " ").slice(0, 120);
  if (kind === "render_report" && step.template_id) return `Template ${String(step.template_id)}`;
  if ((kind === "insert_record" || kind === "update_record" || kind === "delete_record") && step.type_name) {
    return `${String(step.namespace ?? "")}.${String(step.type_name)}`;
  }
  if (kind === "finish" && step.summary) return String(step.summary);
  return "";
}
