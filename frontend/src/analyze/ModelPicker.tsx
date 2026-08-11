/**
 * Per-message model picker.
 *
 * The list is dynamic: `/analyze/models` returns only the models a staff admin
 * has enabled for this workspace, so a model that gets disabled disappears here
 * without a release. The picker defaults to the workspace default (from
 * `/analyze/config`) and overrides it per message.
 *
 * Both fetches are cached at module scope and shared across mounts — the ask bar
 * and every thread's follow-up composer render a picker, and each one hitting
 * the network would be pure waste.
 */
import { useEffect, useState } from "react";

import { fetchDefaultModel, fetchModels, type PickerModel } from "./api";

/** The canonical model key, e.g. "claude-sonnet-5". */
export type ModelFamily = string;

/** Last-resort entry so a composer always has something to render. */
const FALLBACK: PickerModel[] = [
  { key: "claude-sonnet-5", family: "Claude", display: "Claude Sonnet 5" },
];

let cachedModels: PickerModel[] | null = null;
let inflight: Promise<PickerModel[]> | null = null;
const subscribers = new Set<(models: PickerModel[]) => void>();

function loadModels(): Promise<PickerModel[]> {
  if (cachedModels) return Promise.resolve(cachedModels);
  if (inflight) return inflight;
  inflight = fetchModels()
    .then((models) => {
      const resolved = models.length ? models : FALLBACK;
      cachedModels = resolved;
      subscribers.forEach((fn) => fn(resolved));
      return resolved;
    })
    .catch(() => FALLBACK) // leave the cache empty so a later mount retries
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function useEnabledModels(): PickerModel[] {
  const [models, setModels] = useState<PickerModel[]>(cachedModels || FALLBACK);
  useEffect(() => {
    if (cachedModels) {
      setModels(cachedModels);
      return;
    }
    let alive = true;
    const sub = (m: PickerModel[]) => {
      if (alive) setModels(m);
    };
    subscribers.add(sub);
    void loadModels().then((m) => {
      if (alive) setModels(m);
    });
    return () => {
      alive = false;
      subscribers.delete(sub);
    };
  }, []);
  return models;
}

let cachedDefault: string | null = null;

/** The workspace default model key. Empty until the fetch resolves. */
export function useDefaultModelFamily(): string {
  const [family, setFamily] = useState<string>(cachedDefault || "");
  useEffect(() => {
    if (cachedDefault) {
      setFamily(cachedDefault);
      return;
    }
    let alive = true;
    void fetchDefaultModel()
      .then((f) => {
        if (!f) return;
        cachedDefault = f;
        if (alive) setFamily(f);
      })
      .catch(() => {
        /* leave it empty; the server applies its own default */
      });
    return () => {
      alive = false;
    };
  }, []);
  return family;
}

/** Group models into ordered [family, models] pairs for the <optgroup>s. */
function groupByFamily(models: PickerModel[]): [string, PickerModel[]][] {
  const order: string[] = [];
  const map = new Map<string, PickerModel[]>();
  for (const m of models) {
    const family = m.family || "Models";
    if (!map.has(family)) {
      map.set(family, []);
      order.push(family);
    }
    map.get(family)!.push(m);
  }
  return order.map((f) => [f, map.get(f)!]);
}

export function ModelPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (family: ModelFamily) => void;
}) {
  const models = useEnabledModels();
  const groups = groupByFamily(models);
  // Keep the current value selectable even if the catalog hasn't resolved yet,
  // so the control never shows a blank.
  const known = models.some((m) => m.key === value);
  const selected = known ? value : (models[0]?.key ?? FALLBACK[0].key);

  return (
    <label
      className="an-chip an-model"
      title="The model used for this message. Defaults to your workspace default."
    >
      <span className="an-model-label">Model</span>
      <select
        value={selected}
        onChange={(e) => onChange(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        aria-label="AI model for this message"
      >
        {groups.map(([family, items]) => (
          <optgroup key={family} label={family}>
            {items.map((m) => (
              <option
                key={m.key}
                value={m.key}
                title={`${m.family} — ${m.display}${m.isReasoning ? " · reasoning" : ""}`}
              >
                {m.display}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}
