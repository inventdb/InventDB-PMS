/**
 * Editing a report by describing the change.
 *
 * The report agent answers over Server-Sent Events: `start`, then `reasoning`
 * while it composes, then `html` with the new layout, then `saved` carrying the
 * new version number. The endpoint writes the template itself — `saved` is the
 * confirmation, not a request for the client to persist anything — so all this
 * has to do is report progress and tell the caller when to re-render.
 *
 * Axios can't read a stream incrementally in the browser, so this is raw
 * `fetch` with the same bearer token the axios client sends.
 */
import { api, getToken } from "../api/client";

export interface EditProgress {
  /** A short human stage for the status line. */
  onStage?: (stage: string) => void;
  /** Reasoning as it streams: `tokens` is a running count, not a duration. */
  onReasoning?: (chunk: { content: string; tokens: number }) => void;
  /** The new version number, once the engine has saved it. */
  onSaved?: (version: number | undefined) => void;
}

export interface EditTurn {
  role: "user";
  content: string;
}

function streamUrl(templateId: string): string {
  const base = (api.defaults.baseURL || "/api").replace(/\/$/, "");
  return `${base}/reports/templates/${encodeURIComponent(templateId)}/edit/stream`;
}

/**
 * Apply one instruction. Resolves when the edit has landed; rejects with a
 * readable message if it didn't.
 *
 * `history` replays the previous instructions for this report, so a follow-up
 * ("now drop the decimals too", "undo that") builds on the last edit instead of
 * starting from scratch.
 */
export async function streamReportEdit(
  templateId: string,
  instruction: string,
  history: EditTurn[],
  modelFamily: string | undefined,
  signal: AbortSignal | undefined,
  progress: EditProgress = {}
): Promise<{ version?: number }> {
  progress.onStage?.("Reading the report…");

  const token = getToken();
  const res = await fetch(streamUrl(templateId), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      instruction,
      messages: history,
      ...(modelFamily ? { model_family: modelFamily } : {}),
    }),
    signal,
  });

  if (!res.ok || !res.body) {
    // A failure before the stream opens comes back as ordinary JSON.
    let message = `The edit failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = String(body.error);
    } catch {
      /* keep the status message */
    }
    throw new Error(message);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let saved = false;
  let gotHtml = false;
  let version: number | undefined;
  let failure = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);

      const event = frame.match(/^event:\s*(.+)$/m)?.[1]?.trim();
      const data = frame
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .join("\n");
      if (!event) continue;

      if (event === "reasoning") {
        try {
          const parsed = JSON.parse(data);
          progress.onReasoning?.({
            content: parsed.content || "",
            tokens: Number(parsed.tokens) || 0,
          });
        } catch {
          /* a partial frame — the next chunk completes it */
        }
      } else if (event === "html") {
        gotHtml = true;
        progress.onStage?.("Rendering the new layout…");
      } else if (event === "saved") {
        saved = true;
        progress.onStage?.("Saving…");
        try {
          version = Number(JSON.parse(data)?.version) || undefined;
        } catch {
          /* the version is a nicety */
        }
        progress.onSaved?.(version);
      } else if (event === "error") {
        failure = data || "The edit failed";
      }
    }
  }

  if (failure) throw new Error(failure);
  // The endpoint emits `html` and then saves; either means the edit landed.
  if (!saved && !gotHtml) {
    throw new Error(
      "The assistant didn't return an updated layout — try rephrasing the change."
    );
  }
  return { version };
}
