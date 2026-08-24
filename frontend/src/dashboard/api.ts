/**
 * The narrow slice of the API the dashboard needs, in one place.
 *
 * SOAR's dashboard talks to a client that carries the namespace on every call.
 * The PMS pins its namespace server-side — every route below is already scoped
 * to it — so these helpers take no namespace and the widgets' SQL names the
 * types directly, exactly as it does in SOAR.
 */
import { useEffect, useState } from "react";

import { api, errorMessage } from "../api/client";

/** Read-only SELECT. The same passthrough the Analyze canvas uses for lookups. */
export async function sql<T = Record<string, unknown>>(statement: string): Promise<T[]> {
  const { data } = await api.post<{ rows?: T[] }>("/meta/sql", { sql: statement });
  return data?.rows ?? [];
}

/** Every type in the namespace, InventDB's own list. */
export async function listTypes(): Promise<string[]> {
  const { data } = await api.get<unknown>("/meta/types");
  const raw = Array.isArray(data)
    ? data
    : ((data as { types?: unknown })?.types ?? []);
  return (Array.isArray(raw) ? raw : [])
    .map((t) => (typeof t === "string" ? t : String((t as { name?: unknown })?.name ?? "")))
    .filter(Boolean);
}

/**
 * Run a widget's query and keep its result. Ported from SOAR's `lib/ui.useSql`.
 *
 * `deps` is what the dashboard's Refresh bumps: the same statement re-runs and
 * the previous rows stay on screen until the new ones land, so a refresh reads
 * as figures updating rather than every card blanking at once.
 */
export function useSql<T = Record<string, unknown>>(
  statement: string | null,
  deps: unknown[] = []
): { rows: T[]; loading: boolean; error: string | null } {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(!!statement);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!statement) {
      setRows([]);
      setLoading(false);
      return;
    }
    let live = true;
    setLoading(true);
    setError(null);
    sql<T>(statement)
      .then((r) => {
        if (live) setRows(r);
      })
      .catch((e) => {
        if (live) setError(errorMessage(e));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statement, ...deps]);

  return { rows, loading, error };
}
