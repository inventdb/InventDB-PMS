/**
 * Small building blocks the Analyze room shares: a growing textarea, a
 * disclosure, the SQL receipt, skeleton placeholders, and the two number
 * animations that make a live agent turn feel calm rather than jumpy.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ChevronDown } from "lucide-react";

/** A textarea that grows with its content. Enter submits; Shift+Enter breaks. */
export function AutoTextarea({
  value,
  onChange,
  onSubmit,
  placeholder,
  disabled,
  autoFocus,
  className,
  onPaste,
  maxHeight = 260,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
  onPaste?: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  maxHeight?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [value, maxHeight]);

  return (
    <textarea
      ref={ref}
      className={className}
      rows={1}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      autoFocus={autoFocus}
      onPaste={onPaste}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault();
          onSubmit?.();
        }
      }}
    />
  );
}

/** A click-to-expand block. `summary` may be a node so it can carry chips. */
export function Disclosure({
  summary,
  children,
  defaultOpen,
}: {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="an-disclosure">
      <button
        type="button"
        className="an-disclosure-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <ChevronDown size={13} className={`an-chev ${open ? "is-open" : ""}`} />
        <span className="an-disclosure-summary">{summary}</span>
      </button>
      {open && <div className="an-disclosure-body">{children}</div>}
    </div>
  );
}

/** Monospaced SQL, wrapped so a long query scrolls inside its own box. */
export function Sql({ children }: { children: string }) {
  return <pre className="an-sql">{children}</pre>;
}

/**
 * The receipt: what the assistant actually ran, collapsed by default. This is
 * the room's promise — every answer can be checked against the query behind it.
 */
export function Receipt({ children }: { children: ReactNode }) {
  return (
    <Disclosure summary={<span className="an-receipt-label">Show the query it ran</span>}>
      <div className="an-receipt">{children}</div>
    </Disclosure>
  );
}

export function ReceiptRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="an-receipt-row">
      <span className="an-receipt-key">{label}</span>
      <span>{children}</span>
    </div>
  );
}

export function Skeleton({ h = 16, w = "100%" }: { h?: number; w?: number | string }) {
  return <div className="an-skeleton" style={{ height: h, width: w }} />;
}

/**
 * Tween a number toward its target (ease-out cubic) so the token counter counts
 * up instead of snapping on every stream flush. Each tween resumes from what is
 * currently displayed, so rapid updates stay continuous.
 */
export function AnimatedNumber({ value }: { value: number }) {
  const [display, setDisplay] = useState(value);
  const displayRef = useRef(value);
  const rafRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const from = displayRef.current;
    const to = value;
    if (Math.round(from) === to) {
      displayRef.current = to;
      setDisplay(to);
      return;
    }
    const duration = 500;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const current = from + (to - from) * eased;
      displayRef.current = current;
      setDisplay(current);
      if (t < 1) rafRef.current = requestAnimationFrame(step);
      else displayRef.current = to;
    };
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [value]);

  return <>{Math.round(display).toLocaleString()}</>;
}

/**
 * Throttle a fast-changing value to at most one update per `ms`, so the live
 * status line settles instead of shivering on every sub-second flush.
 */
export function useThrottledValue<T>(value: T, ms: number): T {
  const [out, setOut] = useState(value);
  const lastRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const now = performance.now();
    const since = now - lastRef.current;
    const commit = () => {
      lastRef.current = performance.now();
      setOut(value);
    };
    if (since >= ms) commit();
    else {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(commit, ms - since);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [value, ms]);

  return out;
}

/** A determinate progress strip for the multi-step card applies. */
/* ── Cancelable run ──────────────────────────────────────────────────────────
   Ported from InventDB SOAR's `lib/ui.tsx`. Drives a long operation that runs
   in batches — a bulk apply, a spreadsheet import — with a live count and a
   Cancel that actually stops it. Work already committed stays committed and is
   reported, because a cancelled import has still written the batches it sent. */

export interface RunCtx {
  signal: AbortSignal;
  /** Set the loop total once known. Leave unset for an indeterminate spinner. */
  setTotal: (n: number) => void;
  /** Report N items completed — call after each batch. */
  progress: (done: number) => void;
  /** Throw AbortError if cancelled — call at the top of each iteration. */
  throwIfAborted: () => void;
}

export interface CancelableRun {
  run: () => Promise<void>;
  cancel: () => void;
  running: boolean;
  done: number;
  total: number | null;
  error: string | null;
  aborted: boolean;
}

export function useCancelableRun(
  fn: (ctx: RunCtx) => Promise<void>,
  opts?: {
    onSettled?: (r: {
      done: number;
      total: number | null;
      aborted: boolean;
      error: string | null;
    }) => void;
    keepOnUnmount?: boolean;
  }
): CancelableRun {
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aborted, setAborted] = useState(false);
  const acRef = useRef<AbortController | null>(null);
  const doneRef = useRef(0);
  const totalRef = useRef<number | null>(null);

  const cancel = () => acRef.current?.abort();

  const run = async () => {
    if (acRef.current) return; // already running
    const ac = new AbortController();
    acRef.current = ac;
    doneRef.current = 0;
    totalRef.current = null;
    setRunning(true);
    setError(null);
    setAborted(false);
    setDone(0);
    setTotal(null);

    const ctx: RunCtx = {
      signal: ac.signal,
      setTotal: (n) => {
        totalRef.current = n;
        setTotal(n);
      },
      progress: (d) => {
        doneRef.current = d;
        setDone(d);
      },
      throwIfAborted: () => {
        if (ac.signal.aborted) throw new DOMException("Aborted", "AbortError");
      },
    };

    let err: string | null = null;
    let wasAborted = false;
    try {
      await fn(ctx);
    } catch (e) {
      const name = (e as { name?: string })?.name;
      if (name === "AbortError" || ac.signal.aborted) {
        wasAborted = true;
        setAborted(true);
      } else {
        err = (e as { message?: string })?.message || "Operation failed";
        setError(err);
      }
    } finally {
      setRunning(false);
      acRef.current = null;
      opts?.onSettled?.({
        done: doneRef.current,
        total: totalRef.current,
        aborted: wasAborted,
        error: err,
      });
    }
  };

  // Stop anything in flight when the owner unmounts, unless told otherwise.
  useEffect(
    () => () => {
      if (!opts?.keepOnUnmount) acRef.current?.abort();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  return { run, cancel, running, done, total, error, aborted };
}

export function ActionProgress({
  label,
  done,
  total,
  onCancel,
}: {
  label: string;
  done?: number;
  total?: number | null;
  onCancel?: () => void;
}) {
  const pct = total && total > 0 ? Math.round(((done ?? 0) / total) * 100) : null;
  return (
    <div className="an-progress">
      <span className="an-spinner" aria-hidden />
      <span className="an-progress-label">
        {label}
        {pct !== null && ` · ${done}/${total}`}
      </span>
      {pct !== null && (
        <span className="an-progress-bar" aria-hidden>
          <span style={{ width: `${pct}%` }} />
        </span>
      )}
      {onCancel && (
        <button type="button" className="btn btn-ghost btn-sm an-danger" onClick={onCancel}>
          Cancel
        </button>
      )}
    </div>
  );
}

/** Relative time for thread rows ("4m ago"). Falls back to an empty string. */
export function relTime(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const secs = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  if (secs < 45) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Absolute time for the thread details ("Mar 4, 9:12 AM"). */
export function fmtWhen(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
