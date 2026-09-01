/**
 * The running import, held outside React.
 *
 * An import is the one thing this app does that keeps writing after you stop
 * looking at it. It was previously owned by the Import page's own component
 * state, so leaving the room unmounted it — which aborted the run mid-batch and
 * threw away every trace of it. The batches already sent were real records, so
 * clicking Properties during a large import silently left a partial import
 * behind and an empty Import page to come back to.
 *
 * So the run lives here instead: a module-level singleton the page subscribes
 * to. Navigation cannot touch it, the batches keep going, and returning to the
 * room finds the same progress bar (or the same result) that was there before.
 * There is deliberately only ever one — two concurrent imports would race on
 * the same types with no way to tell whose rows landed.
 */
import { api } from "../api/client";

/** Rows accepted per request. Matches the server's own ceiling of 5,000. */
const BATCH = 500;

/**
 * A bulk insert of 500 rows legitimately takes longer than an ordinary read, and
 * the shared axios client gives up at 60s. That timeout rejecting one batch used
 * to abandon every batch after it, so a slow moment two thirds of the way
 * through a 68,000-row import looked like "only a few uploaded".
 */
const BATCH_TIMEOUT_MS = 10 * 60_000;

/** Transient failures are the common case; a bad batch is not. */
const ATTEMPTS = 3;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Guard a reload, a closed tab, or a link out of the app.
 *
 * Client-side navigation is survivable — the store outlives the page. A
 * document unload is not: the JS context goes, and every batch still in flight
 * dies with it, leaving a half-written table and nothing to say so. This is the
 * only moment the browser will let us ask first.
 */
function guardUnload(on: boolean) {
  if (typeof window === "undefined") return;
  if (on) window.addEventListener("beforeunload", onBeforeUnload);
  else window.removeEventListener("beforeunload", onBeforeUnload);
}

function onBeforeUnload(e: BeforeUnloadEvent) {
  e.preventDefault();
  // Chrome shows its own wording; the assignment is what arms the prompt.
  e.returnValue = "An import is still running. Leaving now will stop it.";
  return e.returnValue;
}

export interface ImportJob {
  type: string;
  records: Record<string, unknown>[];
}

export interface ImportPlan {
  jobs: ImportJob[];
  total: number;
  /**
   * The plan's signature at the moment the run started, so the page can tell
   * "you already imported this" from "you have changed something since".
   */
  sig: string;
  summary: (imported: number, types: number) => string;
}

export interface ImportState {
  running: boolean;
  done: number;
  total: number;
  /** Set once a run finishes, cancels part-way, or fails. */
  message: string | null;
  /** The types written, deduped — two sheets can share one type name. */
  types: string[];
  sig: string | null;
  error: string | null;
}

const IDLE: ImportState = {
  running: false,
  done: 0,
  total: 0,
  message: null,
  types: [],
  sig: null,
  error: null,
};

let state: ImportState = IDLE;
let controller: AbortController | null = null;
const listeners = new Set<() => void>();

function emit(patch: Partial<ImportState>) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
}

export function subscribeImport(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** `useSyncExternalStore` compares by reference, so this must stay identity-stable. */
export function getImportState(): ImportState {
  return state;
}

export function isImportRunning(): boolean {
  return state.running;
}

/** Clear a finished run's result. Refused while one is in flight. */
export function resetImport(): void {
  if (state.running) return;
  emit(IDLE);
}

export function cancelImport(): void {
  controller?.abort();
}

/**
 * Start an import. Resolves when it settles, but nothing needs to await it —
 * the store is the source of truth and outlives whoever called this.
 *
 * `onFinished` is how the page announces the result. It is invoked even if that
 * page has since unmounted, which is the point: the toast provider sits above
 * the router, so a completed import is announced wherever the user has got to.
 */
export async function startImport(
  plan: ImportPlan,
  onFinished?: (result: { message: string; types: string[]; ok: boolean }) => void
): Promise<void> {
  if (state.running) return;

  const ac = new AbortController();
  controller = ac;
  guardUnload(true);
  emit({
    running: true,
    done: 0,
    total: plan.total,
    message: null,
    types: [],
    sig: null,
    error: null,
  });

  let sent = 0;
  let failure: string | null = null;
  try {
    for (const job of plan.jobs) {
      for (let i = 0; i < job.records.length; i += BATCH) {
        if (ac.signal.aborted) throw new DOMException("Aborted", "AbortError");
        const chunk = job.records.slice(i, i + BATCH);

        // Retry the batch rather than the import. A network blip or a slow
        // moment upstream is not a reason to abandon the 60,000 rows behind it,
        // and re-running the whole import instead would duplicate everything
        // that already landed.
        let lastError: unknown = null;
        for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
          try {
            await api.post(
              `/import/${job.type}`,
              { rows: chunk },
              { signal: ac.signal, timeout: BATCH_TIMEOUT_MS }
            );
            lastError = null;
            break;
          } catch (err) {
            const name = (err as { name?: string })?.name;
            if (name === "AbortError" || ac.signal.aborted) throw err;
            lastError = err;
            if (attempt < ATTEMPTS) await wait(attempt * 1500);
          }
        }
        if (lastError) throw lastError;

        sent += chunk.length;
        emit({ done: sent });
      }
    }
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name !== "AbortError" && !ac.signal.aborted) {
      const detail = (err as { message?: string })?.message || "Import failed";
      // Say where it stopped. "Import failed" over a half-written table leaves
      // the operator with no idea what is in the database.
      failure =
        sent > 0
          ? `${detail} — stopped after ${sent.toLocaleString()} of ${plan.total.toLocaleString()} rows.`
          : detail;
    }
  } finally {
    controller = null;
    guardUnload(false);
  }

  const written = [...new Set(plan.jobs.map((j) => j.type))];

  if (failure) {
    // Whatever landed before the failure is still real, so the count is kept
    // rather than reported as nothing having happened.
    emit({ running: false, done: sent, error: failure, types: written, sig: plan.sig });
    onFinished?.({ message: failure, types: written, ok: false });
    return;
  }

  if (ac.signal.aborted) {
    // A cancelled run still committed every batch before the stop. Those rows
    // are real, so this settles like a finished one — re-running the same plan
    // would write the committed prefix a second time.
    if (sent === 0) {
      emit(IDLE);
      return;
    }
    const message = `Imported ${sent.toLocaleString()} rows — cancelled the rest.`;
    emit({ running: false, done: sent, message, types: written, sig: plan.sig });
    onFinished?.({ message, types: written, ok: true });
    return;
  }

  const message = plan.summary(sent, written.length);
  emit({ running: false, done: sent, message, types: written, sig: plan.sig });
  onFinished?.({ message, types: written, ok: true });
}
