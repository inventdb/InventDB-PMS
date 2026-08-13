/**
 * The streaming agent client, ported from InventDB SOAR's `lib/agent.ts`.
 *
 * One turn is a Server-Sent Event stream of `AgentStep` frames — the plan, each
 * SQL query and its rows, charts, action cards, the reasoning trace, and finally
 * the answer. The PMS backend forwards them untouched from InventDB, so the
 * shapes here are InventDB's own.
 *
 * Axios can't read a stream incrementally in the browser, so this is raw
 * `fetch` — but it attaches the same bearer token the axios client uses.
 */
import { api, getToken } from "../api/client";

export interface AgentStep {
  /** plan | sql | result | chart | info | reasoning | answer | done | error | … */
  type: string;
  content: string;
  sql?: string;
  /** Query result rows — `sql`/`result` steps carry the grid data. */
  data?: Record<string, unknown>[];
  /** Card payload: a Plotly-style figure, or a card spec keyed by step type. */
  chart?: any;
  executionTimeMs?: number;
  sources?: { title?: string; url?: string; snippet?: string }[];
  /** "External Inference" | "InventDB Inference" | "Cache" */
  inferenceSource?: string;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface StreamOptions {
  onStep: (step: AgentStep) => void;
  onError?: (message: string) => void;
  onDone?: () => void;
  modelFamily?: string;
  focusedReportId?: string;
  conversationMode?: boolean;
  /** Opt-in hard cap. Off by default — see below. */
  timeoutMs?: number;
}

/** The caller's IANA zone, so the agent can stamp a valid time on an event. */
function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

function streamUrl(): string {
  const base = (api.defaults.baseURL || "/api").replace(/\/$/, "");
  return `${base}/analyze/chat/stream`;
}

/**
 * Stream one agent turn. Calls `onStep` per frame; resolves through `onDone`
 * when the stream closes. Abort the returned controller to stop it.
 *
 * There is deliberately no default timeout: a long reasoning run or a multi-step
 * report build legitimately takes minutes, and killing it would look like a bug
 * to the person watching the work. Only the user's Stop button ends a turn early.
 */
export function streamAgent(
  messages: ChatMessage[],
  opts: StreamOptions
): AbortController {
  const ac = new AbortController();
  const timeout =
    opts.timeoutMs && opts.timeoutMs > 0
      ? window.setTimeout(() => {
          try {
            ac.abort("timeout");
          } catch {
            /* already gone */
          }
        }, opts.timeoutMs)
      : undefined;
  const clear = () => {
    if (timeout !== undefined) window.clearTimeout(timeout);
  };

  void (async () => {
    try {
      const token = getToken();
      const res = await fetch(streamUrl(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          messages,
          stream: true,
          // Replays prior turns so a follow-up keeps its context; without it the
          // agent treats every message as the start of a new conversation.
          conversation_mode: opts.conversationMode !== false,
          time_zone: browserTimeZone(),
          ...(opts.modelFamily ? { model_family: opts.modelFamily } : {}),
          ...(opts.focusedReportId
            ? { focusedReportId: opts.focusedReportId }
            : {}),
        }),
        signal: ac.signal,
      });

      if (!res.ok || !res.body) {
        // The backend answers a pre-stream failure with ordinary JSON.
        let message = `Agent error ${res.status}`;
        try {
          const body = await res.json();
          if (body?.error) message = String(body.error);
        } catch {
          /* keep the status message */
        }
        clear();
        opts.onError?.(message);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE frames are separated by a blank line; a frame may carry an
        // `event:` line and one or more `data:` lines.
        let idx: number;
        while ((idx = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const dataLines = frame
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trim());
          if (!dataLines.length) continue;
          const payload = dataLines.join("\n");
          if (payload === "[DONE]") {
            clear();
            opts.onDone?.();
            return;
          }
          try {
            opts.onStep(JSON.parse(payload) as AgentStep);
          } catch {
            /* a partial frame — the next chunk completes it */
          }
        }
      }
      clear();
      opts.onDone?.();
    } catch (err: any) {
      clear();
      if (ac.signal.aborted && ac.signal.reason === "timeout") {
        opts.onError?.(
          "The assistant ran past the safety time limit and was stopped. It was likely still working — try again, or break the request into smaller steps."
        );
      } else if (err?.name !== "AbortError" && !ac.signal.aborted) {
        opts.onError?.(err?.message || "The agent stream failed");
      } else {
        // A user-initiated Stop is not a failure.
        opts.onDone?.();
      }
    }
  })();

  return ac;
}

/** Marker for a turn the user stopped, so callers can stay quiet about it. */
function cancelled(): Error {
  const err = new Error("cancelled");
  (err as Error & { cancelled?: boolean }).cancelled = true;
  return err;
}

/** True when a rejection is a user-initiated Stop rather than a failure. */
export function isCancel(err: unknown): boolean {
  return !!err && (err as { cancelled?: boolean }).cancelled === true;
}

/**
 * One agent turn, collected into its final text.
 *
 * The canvas wants every frame; a feature that just needs an answer — fill this
 * form from a description — wants the last one. This runs the same stream with
 * `conversationMode` off, so the turn is judged on its prompt alone rather than
 * inheriting whatever was asked in Analyze earlier.
 *
 * An `error` frame with no answer behind it REJECTS. The agent emits one and
 * recovers often enough that a mid-stream error is not fatal, but a turn that
 * errored and produced nothing is an outage, not an empty result — and a caller
 * that can't tell the two apart reports "nothing matched" when the truth is
 * "the model service is down".
 */
export function agentText(
  prompt: string,
  opts: {
    signal?: AbortSignal;
    timeoutMs?: number;
    modelFamily?: string;
    onProgress?: (label: string) => void;
  } = {}
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    if (opts.signal?.aborted) {
      reject(cancelled());
      return;
    }
    let text = "";
    let errored: string | null = null;

    const controller = streamAgent([{ role: "user", content: prompt }], {
      conversationMode: false,
      timeoutMs: opts.timeoutMs,
      modelFamily: opts.modelFamily,
      onStep: (step) => {
        opts.onProgress?.(stepLabel(step));
        if (step.type === "error" && step.content) errored = step.content;
        if (
          (step.type === "answer" || step.type === "text" || step.type === "done") &&
          step.content
        ) {
          text += step.content;
        }
      },
      onError: (message) => reject(new Error(message)),
      // A user Stop routes through streamAgent's catch into onDone, so the
      // signal — not the callback — is what says it was cancelled.
      onDone: () => {
        if (opts.signal?.aborted) reject(cancelled());
        else if (errored && !text) reject(new Error(errored));
        else resolve(text);
      },
    });

    opts.signal?.addEventListener(
      "abort",
      () => {
        try {
          controller.abort("user");
        } catch {
          /* already closed */
        }
      },
      { once: true }
    );
  });
}

/**
 * A user-facing message for an AI failure, distinguishing a model-service
 * outage (credits, quota, rate limit) from a generic error so the UI can say
 * "try again shortly" rather than failing silently.
 */
export function friendlyAiError(raw?: string | null): string {
  const message = String(raw || "").trim();
  if (
    /credit|exhaust|quota|billing|insufficient|rate.?limit|unavailable|overloaded|\b(429|502|503|529)\b|temporarily/i.test(
      message
    )
  ) {
    return `The assistant is temporarily unavailable — the model service returned an error (exhausted credits or quota, or an outage). Your data is unaffected; try again shortly.${
      message ? `\n\nDetails: ${message}` : ""
    }`;
  }
  return message
    ? `The assistant hit an error: ${message}`
    : "The assistant hit an error — please try again.";
}

/** A short, human progress label for a step ("Planning…", "Querying…"). */
export function stepLabel(step: AgentStep): string {
  switch (step.type) {
    case "plan":
      return "Planning…";
    case "sql":
    case "result":
      return "Querying your data…";
    case "chart":
      return "Building a chart…";
    case "workflow":
      return "Composing…";
    case "info":
      return step.content
        ? step.content.replace(/\s+/g, " ").trim().slice(0, 48)
        : "Working…";
    case "text":
    case "answer":
      return "Writing…";
    default:
      return "Working…";
  }
}
