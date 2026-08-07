import { useQueries } from "@tanstack/react-query";

import { api } from "../api/client";
import { ENTITY_BY_NAME, recordTitle } from "../config/entities";
import type { ListResponse } from "../types";

export interface RefOption {
  value: string;
  label: string;
}

// Fetch option lists for a set of referenced entities and build:
//  - options: selectable {value,label} arrays keyed by entity name
//  - labels: value -> human title lookup keyed by entity name
export function useReferences(entityNames: string[]) {
  const unique = Array.from(new Set(entityNames));
  const results = useQueries({
    queries: unique.map((name) => ({
      queryKey: ["ref", name],
      staleTime: 60_000,
      queryFn: async () => {
        const { data } = await api.get<ListResponse>(`/${name}`, {
          params: { limit: 1000 },
        });
        return data.items ?? [];
      },
    })),
  });

  const options: { [entity: string]: RefOption[] } = {};
  const labels: { [entity: string]: { [value: string]: string } } = {};
  const loading = results.some((r) => r.isLoading);

  unique.forEach((name, i) => {
    const cfg = ENTITY_BY_NAME[name];
    const rows = (results[i].data ?? []) as Array<Record<string, unknown>>;
    const opts: RefOption[] = [];
    const map: { [value: string]: string } = {};
    for (const row of rows) {
      if (!cfg) break;
      const value = row[cfg.key];
      if (value === undefined || value === null || value === "") continue;
      const v = String(value);
      const title = recordTitle(cfg, row);
      const label = title && title !== v ? `${v} — ${title}` : v;
      opts.push({ value: v, label });
      map[v] = title || v;
    }
    opts.sort((a, b) => a.label.localeCompare(b.label));
    options[name] = opts;
    labels[name] = map;
  });

  return { options, labels, loading };
}
