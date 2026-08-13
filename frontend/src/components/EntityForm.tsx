import { useMemo, useState, type FormEvent } from "react";

import type { EntityConfig, FieldDef } from "../config/entities";
import type { Record as Rec } from "../types";
import { toNumber } from "../utils/format";
import { DescribeRecord } from "./DescribeRecord";
import { useReferences, type RefOption } from "./references";

interface Props {
  config: EntityConfig;
  initial?: Rec | null;
  submitting?: boolean;
  /**
   * Offer the plain-English composer above the fields.
   *
   * Opt-in rather than automatic: the create flows want it, but a form embedded
   * in a narrow panel beside other controls does not, and the caller is the
   * only one that knows which it is.
   */
  assist?: boolean;
  onSubmit: (values: Rec) => void;
  onCancel: () => void;
}

function initialValue(field: FieldDef, initial?: Rec | null): string {
  const raw = initial?.[field.name];
  if (raw === undefined || raw === null) return "";
  return String(raw);
}

export function EntityForm({
  config,
  initial,
  submitting,
  assist,
  onSubmit,
  onCancel,
}: Props) {
  const refEntities = useMemo(
    () => config.fields.filter((f) => f.ref).map((f) => f.ref as string),
    [config]
  );
  const { options, loading: refsLoading } = useReferences(refEntities);

  const [values, setValues] = useState<{ [k: string]: string }>(() => {
    const v: { [k: string]: string } = {};
    for (const f of config.fields) v[f.name] = initialValue(f, initial);
    return v;
  });
  const [errors, setErrors] = useState<{ [k: string]: boolean }>({});
  /**
   * Which fields the assistant wrote and the person has not looked at yet.
   *
   * The mark is not decoration — it is the difference between a value you typed
   * and a value something else typed for you, and the whole flow rests on the
   * second kind being checked. Touching a field clears its mark: reviewing it
   * IS the check, so the highlight has done its job.
   */
  const [aiFilled, setAiFilled] = useState<Set<string>>(new Set());

  const set = (name: string, value: string) => {
    setValues((prev) => ({ ...prev, [name]: value }));
    setAiFilled((prev) => {
      if (!prev.has(name)) return prev;
      const next = new Set(prev);
      next.delete(name);
      return next;
    });
  };

  const applyFill = (patch: { [name: string]: string }) => {
    const names = Object.keys(patch);
    if (!names.length) return;
    setValues((prev) => ({ ...prev, ...patch }));
    setAiFilled(new Set(names));
    // A required field the description just supplied is no longer missing.
    setErrors((prev) => {
      const next = { ...prev };
      for (const name of names) delete next[name];
      return next;
    });
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const nextErrors: { [k: string]: boolean } = {};
    for (const f of config.fields) {
      if (f.required && !String(values[f.name] ?? "").trim()) nextErrors[f.name] = true;
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    // Coerce numeric / boolean fields to their proper JSON types before sending.
    const payload: Rec = {};
    for (const f of config.fields) {
      const raw = values[f.name];
      if (raw === "" || raw === undefined) continue;
      if (f.type === "number" || f.type === "currency") {
        const n = toNumber(raw);
        payload[f.name] = n === null ? raw : n;
      } else if (f.type === "boolean") {
        payload[f.name] = raw === "true";
      } else {
        payload[f.name] = raw;
      }
    }
    onSubmit(payload);
  };

  return (
    <>
      {/* Outside the <form>, not merely above it: a form inside a form is
          invalid HTML, and Enter in the composer must fill, never submit. */}
      {assist && (
        <DescribeRecord
          config={config}
          values={values}
          refOptions={options}
          onFill={applyFill}
        />
      )}
      <form onSubmit={handleSubmit} id="entity-form">
        <div className="form-grid">
          {config.fields.map((f) => (
            <FieldControl
              key={f.name}
              field={f}
              value={values[f.name] ?? ""}
              invalid={!!errors[f.name]}
              filledByAi={aiFilled.has(f.name)}
              options={f.ref ? options[f.ref] ?? [] : undefined}
              optionsLoading={refsLoading}
              onChange={(v) => set(f.name, v)}
            />
          ))}
        </div>
        <div className="modal-foot" style={{ paddingLeft: 0, paddingRight: 0, paddingBottom: 0 }}>
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </>
  );
}

function FieldControl({
  field,
  value,
  invalid,
  filledByAi,
  options,
  optionsLoading,
  onChange,
}: {
  field: FieldDef;
  value: string;
  invalid: boolean;
  /** Written from a description and not yet reviewed. */
  filledByAi?: boolean;
  options?: RefOption[];
  optionsLoading?: boolean;
  onChange: (v: string) => void;
}) {
  const borderStyle = invalid ? { borderColor: "var(--danger)" } : undefined;
  const label = (
    <label htmlFor={`f-${field.name}`}>
      {field.label}
      {field.required && <span className="req">*</span>}
      {/* The tint alone would carry this on colour only, and "the assistant
          wrote this one" is exactly the thing that must not be missable. */}
      {filledByAi && (
        <span className="field-ai-mark" title="Filled from your description — check it">
          <span aria-hidden>✦</span>
          <span className="sr-only"> filled from your description</span>
        </span>
      )}
    </label>
  );

  let control;
  if (field.ref) {
    control = (
      <select
        id={`f-${field.name}`}
        className="select"
        style={borderStyle}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{optionsLoading ? "Loading…" : "— None —"}</option>
        {options?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
        {/* Preserve an existing value even if it is not in the option list. */}
        {value && !options?.some((o) => o.value === value) && (
          <option value={value}>{value}</option>
        )}
      </select>
    );
  } else if (field.type === "select") {
    control = (
      <select
        id={`f-${field.name}`}
        className="select"
        style={borderStyle}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">— Select —</option>
        {field.options?.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  } else if (field.type === "boolean") {
    control = (
      <select
        id={`f-${field.name}`}
        className="select"
        style={borderStyle}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">— Select —</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  } else if (field.type === "textarea") {
    control = (
      <textarea
        id={`f-${field.name}`}
        className="textarea"
        style={borderStyle}
        value={value}
        placeholder={field.placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  } else {
    const inputType =
      field.type === "currency" || field.type === "number"
        ? "number"
        : field.type === "date"
        ? "date"
        : field.type === "email"
        ? "email"
        : field.type === "tel"
        ? "tel"
        : "text";
    control = (
      <input
        id={`f-${field.name}`}
        className="input"
        style={borderStyle}
        type={inputType}
        step={field.step ?? (field.type === "currency" ? "0.01" : undefined)}
        value={value}
        placeholder={field.placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  return (
    <div
      className={`field ${field.full || field.type === "textarea" ? "full" : ""} ${
        filledByAi ? "is-ai" : ""
      }`}
    >
      {label}
      {control}
    </div>
  );
}
