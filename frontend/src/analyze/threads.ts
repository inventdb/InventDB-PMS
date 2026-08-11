/**
 * Thread persistence.
 *
 * Threads are stored SERVER-SIDE, per user, by InventDB's AI API — the same
 * `/ai/threads` store the SOAR app writes, so an analysis started in SOAR shows
 * up here and vice versa. The frontend never touches the database directly; it
 * calls the PMS backend, which forwards the caller's token and lets InventDB
 * scope the rows to the signed-in user.
 */
import { api } from "../api/client";

/** An artifact an exchange produced that must re-render after a reload. */
export interface StoredArtifact {
  kind:
    | "workflow"
    | "report"
    | "websearch"
    | "research"
    | "email"
    | "bulk_email"
    | "event"
    | "bulk_events"
    | "mutation"
    | "data"
    | "chart"
    | "saved_view"
    | "attachments";
  id?: string;
  name?: string;
  url?: string;
  payload?: any;
}

/** One persisted work step, so the "show the work" timeline survives a reload. */
export interface StoredStep {
  type: string;
  content?: string;
  sql?: string;
  ms?: number;
}

export interface StoredExchange {
  question: string;
  answer: string;
  artifacts?: StoredArtifact[];
  steps?: StoredStep[];
  ts?: string;
}

export interface StoredThread {
  id: string;
  label: string;
  created: string;
  exchanges: StoredExchange[];
}

export async function loadThreads(): Promise<StoredThread[]> {
  try {
    const { data } = await api.get("/analyze/threads");
    const rows: any[] = Array.isArray(data?.threads) ? data.threads : [];
    return rows
      .map(
        (t): StoredThread => ({
          id: String(t._id ?? t.id ?? ""),
          label: String(t.label || "Chat"),
          created: String(t.created || ""),
          // InventDB stores the exchanges under `_exchanges`; older rows used
          // the bare name.
          exchanges: Array.isArray(t._exchanges)
            ? t._exchanges
            : Array.isArray(t.exchanges)
              ? t.exchanges
              : [],
        })
      )
      .filter((t) => t.id);
  } catch {
    return [];
  }
}

export async function saveThread(thread: StoredThread): Promise<void> {
  try {
    await api.put("/analyze/threads", {
      id: thread.id,
      label: (thread.label || "Chat").slice(0, 80),
      created: thread.created,
      exchanges: thread.exchanges,
    });
  } catch {
    /* best-effort: a failed save just means this thread re-saves next change */
  }
}

export async function deleteThread(id: string): Promise<void> {
  try {
    await api.delete(`/analyze/threads/${encodeURIComponent(id)}`);
  } catch {
    /* ignore */
  }
}
