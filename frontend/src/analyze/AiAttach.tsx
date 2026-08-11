/**
 * Attachments for the AI composers.
 *
 * A file dropped or pasted into a message is an EPHEMERAL LLM INPUT, not a
 * record attachment: InventDB holds the bytes for 30 minutes, indexes nothing
 * and writes no row. On submit the composer appends a
 * `[attached: name (mime, size) — pending: <id>]` marker to the message; the
 * server feeds images to vision and extracts text from documents.
 *
 * A composer that passes a stable `key` keeps its staged files in a module-level
 * store, so navigating away and back doesn't drop them — the upload keeps
 * running after the component unmounts and writes its result here.
 */
import {
  useCallback,
  useRef,
  useState,
  useSyncExternalStore,
  type ClipboardEvent,
} from "react";
import { Paperclip } from "lucide-react";

import { stageUpload, unstageUpload } from "./api";

export interface PendingAtt {
  localId: string;
  file: File;
  pendingId?: string;
  uploading: boolean;
  error?: string;
}

const MAX_FILE_BYTES = 25 * 1024 * 1024;

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const makeLocalId = () =>
  `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

interface AttachStore {
  list: PendingAtt[];
  listeners: Set<() => void>;
}
const stores: Record<string, AttachStore> = {};
const EMPTY: PendingAtt[] = [];

function getStore(key: string): AttachStore {
  let store = stores[key];
  if (!store) {
    store = { list: [], listeners: new Set() };
    stores[key] = store;
  }
  return store;
}

export interface UseAiAttach {
  pending: PendingAtt[];
  addFiles: (files: FileList | File[]) => void;
  removeOne: (localId: string) => void;
  clearAll: () => void;
  /**
   * Clear the chips WITHOUT unstaging. Use this right after submitting: the
   * staged files are still referenced by the markers in the sent message, and
   * the agent reads them seconds later. Unstaging here would delete the file out
   * from under it. The 30-minute TTL reclaims anything unused.
   */
  clearKeep: () => void;
  markers: () => string[];
  /** Wait (up to `timeoutMs`) for in-flight uploads to settle, then mark up. */
  waitMarkers: (timeoutMs?: number) => Promise<string[]>;
  hasUploading: boolean;
  hasReady: boolean;
}

export function useAiAttach(key?: string): UseAiAttach {
  const store = key ? getStore(key) : null;
  const [localPending, setLocalPending] = useState<PendingAtt[]>([]);
  const localRef = useRef<PendingAtt[]>([]);

  const subscribe = useCallback(
    (cb: () => void) => {
      if (!store) return () => {};
      store.listeners.add(cb);
      return () => store.listeners.delete(cb);
    },
    [store]
  );
  const getSnapshot = useCallback(() => (store ? store.list : EMPTY), [store]);
  const storePending = useSyncExternalStore(subscribe, getSnapshot);
  const pending = store ? storePending : localPending;

  // Live read of the current list, for the side-effecting callbacks that must
  // see completed uploads rather than a stale closure.
  const read = useCallback(
    () => (store ? store.list : localRef.current),
    [store]
  );
  const write = useCallback(
    (update: (prev: PendingAtt[]) => PendingAtt[]) => {
      if (store) {
        store.list = update(store.list);
        store.listeners.forEach((l) => l());
      } else {
        setLocalPending((prev) => {
          const next = update(prev);
          localRef.current = next;
          return next;
        });
      }
    },
    [store]
  );

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const incoming: PendingAtt[] = [];
      for (const file of Array.from(files)) {
        if (file.size > MAX_FILE_BYTES) {
          incoming.push({
            localId: makeLocalId(),
            file,
            uploading: false,
            error: `Too large (${fmtBytes(file.size)} > ${fmtBytes(MAX_FILE_BYTES)})`,
          });
          continue;
        }
        incoming.push({ localId: makeLocalId(), file, uploading: true });
      }
      if (!incoming.length) return;
      write((prev) => [...prev, ...incoming]);
      for (const item of incoming) {
        if (item.error) continue;
        void (async () => {
          try {
            const res = await stageUpload(item.file);
            write((prev) =>
              prev.map((p) =>
                p.localId === item.localId
                  ? { ...p, uploading: false, pendingId: res.pending_id }
                  : p
              )
            );
          } catch (e: any) {
            write((prev) =>
              prev.map((p) =>
                p.localId === item.localId
                  ? { ...p, uploading: false, error: e?.message || "Upload failed" }
                  : p
              )
            );
          }
        })();
      }
    },
    [write]
  );

  // Side effects run OUTSIDE the updater, reading the live list — updaters must
  // be pure, and StrictMode double-invokes them in dev, which would otherwise
  // fire the unstage twice.
  const removeOne = useCallback(
    (localId: string) => {
      const item = read().find((p) => p.localId === localId);
      if (item?.pendingId) void unstageUpload(item.pendingId);
      write((prev) => prev.filter((p) => p.localId !== localId));
    },
    [read, write]
  );

  const clearAll = useCallback(() => {
    read().forEach((p) => p.pendingId && void unstageUpload(p.pendingId));
    write(() => []);
  }, [read, write]);

  const clearKeep = useCallback(() => write(() => []), [write]);

  const buildMarkers = useCallback(
    (list: PendingAtt[]): string[] =>
      list
        .filter((p) => !p.error && p.pendingId)
        .map((p) => {
          const type = p.file.type || "application/octet-stream";
          return `[attached: ${p.file.name} (${type}, ${fmtBytes(p.file.size)}) — pending: ${p.pendingId}]`;
        }),
    []
  );

  const markers = useCallback(() => buildMarkers(read()), [buildMarkers, read]);

  const waitMarkers = useCallback(
    async (timeoutMs = 30000): Promise<string[]> => {
      const deadline = Date.now() + timeoutMs;
      while (
        Date.now() < deadline &&
        read().some((p) => !p.error && p.uploading)
      ) {
        await new Promise((r) => setTimeout(r, 100));
      }
      return buildMarkers(read());
    },
    [buildMarkers, read]
  );

  return {
    pending,
    addFiles,
    removeOne,
    clearAll,
    clearKeep,
    markers,
    waitMarkers,
    hasUploading: pending.some((p) => !p.error && p.uploading),
    hasReady: pending.some((p) => !p.error && p.pendingId),
  };
}

/** Pull files out of a paste. Returns true when it consumed the event. */
export function pasteFiles(
  e: ClipboardEvent,
  addFiles: (files: File[]) => void
): boolean {
  const items = e.clipboardData?.items;
  if (!items) return false;
  const files: File[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (!file) continue;
    if (file.name) {
      files.push(file);
    } else {
      // A pasted screenshot arrives nameless; give it something recognisable.
      const ext = (item.type.split("/")[1] || "png").replace(/[^a-z0-9]/gi, "");
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      files.push(new File([file], `pasted-${stamp}.${ext}`, { type: item.type }));
    }
  }
  if (!files.length) return false;
  addFiles(files);
  return true;
}

export function AttachButton({
  onPick,
  disabled,
}: {
  onPick: (files: FileList | File[]) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const title = "Attach images or documents";
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          if (e.target.files?.length) {
            onPick(e.target.files);
            e.target.value = "";
          }
        }}
      />
      <button
        type="button"
        className="an-icon-btn"
        disabled={disabled}
        title={title}
        aria-label={title}
        onClick={() => inputRef.current?.click()}
      >
        <Paperclip size={15} />
      </button>
    </>
  );
}

export function AttachChips({
  pending,
  removeOne,
  clearAll,
}: {
  pending: PendingAtt[];
  removeOne: (localId: string) => void;
  clearAll: () => void;
}) {
  if (!pending.length) return null;
  return (
    <div className="an-attach-chips">
      {pending.map((p) => (
        <span
          key={p.localId}
          className={`an-attach-chip ${p.error ? "is-error" : ""}`}
          title={p.error ?? (p.uploading ? "Uploading…" : "Ready")}
        >
          <span aria-hidden>
            {p.uploading ? "⏳" : p.error ? "⚠" : p.file.type.startsWith("image/") ? "🖼" : "📄"}
          </span>
          <span className="an-attach-name">{p.file.name}</span>
          <span className="an-attach-size">
            {p.error ? p.error : fmtBytes(p.file.size)}
          </span>
          <button
            type="button"
            aria-label={`Remove ${p.file.name}`}
            onClick={() => removeOne(p.localId)}
          >
            ×
          </button>
        </span>
      ))}
      {pending.length > 1 && (
        <button type="button" className="an-linkbtn" onClick={clearAll}>
          Clear all
        </button>
      )}
    </div>
  );
}
