/**
 * The file grid: what is in the current selection, how to search it, and how
 * to put something new into it.
 *
 * Three ways to search, because they answer different questions:
 *   • **name** — the fastest, and what you want when you know what it is called
 *   • **text** — reads inside the files, via what the extraction pipeline read
 *   • **meaning** — ranks by similarity, for when you cannot remember the words
 *
 * Uploading always needs a home. Files live on records, so "which record" is
 * not a detail the UI can invent — a drop with nowhere to go asks before it
 * writes anything, and remembers the answer for next time.
 */
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { ChevronLeft, ChevronRight, FileText, Search, Upload } from "lucide-react";

import { Alert, EmptyState, Spinner } from "../components/ui";
import { ConfirmDialog } from "../components/Modal";
import { ScrollX } from "../components/ScrollX";
import { useToast } from "../components/Toast";
import { errorMessage } from "../api/client";
import {
  downloadFile,
  useDeleteFile,
  useFileSearch,
  useUploadFile,
  type FileHome,
  type FileSearchParams,
} from "../api/hooks";
import { ActionProgress } from "../analyze/ui";
import { listTypes } from "../dashboard/api";
import { NS } from "../dashboard/suggest";
import { ENTITIES } from "../config/entities";
import type { FileRow } from "../types";
import type { DriveSelection } from "./FolderTree";
import {
  baseName,
  ext,
  fileHome,
  fileId,
  fileSize,
  fileSizeLabel,
  fileSnippet,
  fmtFileDate,
  folderOf,
} from "./model";

const PAGE_SIZE = 25;
/** Where the last upload went — the next one almost always goes there too. */
const LAST_TARGET_KEY = "pms.files.upload-target";

type Mode = "name" | "text" | "meaning";

const MODE_SEARCH: { [m in Mode]: FileSearchParams["searchType"] } = {
  name: "keyword",
  text: "fulltext",
  meaning: "semantic",
};

/**
 * A file with this record id has no real parent — it sits in its type's vault.
 * InventDB's own convention, and what an upload lands in unless it is aimed at
 * a specific record. Both files already in this drive live here.
 */
const VAULT = "_vault";

interface UploadTarget {
  type: string;
  /** Empty means the vault: a home without a parent record. */
  recordId: string;
}

function readLastTarget(): UploadTarget | null {
  try {
    const raw = localStorage.getItem(LAST_TARGET_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed?.type ? { type: parsed.type, recordId: parsed.recordId || "" } : null;
  } catch {
    return null;
  }
}

/** `a/b/c.pdf` -> `a/b`; a bare name has no folder. */
function relativeFolder(file: File): string {
  const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || "";
  return folderOf(rel);
}

/** The row's full address: its type, its record, and the attachment itself. */
const homeOf = (f: FileRow): FileHome => ({
  ...fileHome(f),
  attachmentId: fileId(f),
});

/** `application/pdf` -> `pdf`, `image/jpeg` -> `jpeg` — the useful half. */
function shortType(f: FileRow): string {
  const raw = f.content_type || ext(f.filename || "").toLowerCase();
  return raw.replace(/^application[/]/, "").replace(/^image[/]/, "") || "—";
}

const trimSlashes = (v: string) => v.trim().replace(/^\/+|\/+$/g, "");

export function FileGrid({
  selection,
  onOpen,
}: {
  selection: DriveSelection;
  onOpen: (file: FileRow) => void;
}) {
  const toast = useToast();
  const [mode, setMode] = useState<Mode>("name");
  const [draft, setDraft] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [page, setPage] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Staged, not sent. Nothing leaves the browser until the destination below
  // is confirmed — which is the whole point of showing it.
  const [staged, setStaged] = useState<File[]>([]);
  const [sending, setSending] = useState<{ done: number; total: number } | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const folderPicker = useRef<HTMLInputElement | null>(null);
  const cancelSend = useRef(false);
  const [confirming, setConfirming] = useState<FileRow | null>(null);

  const upload = useUploadFile();
  const removeFile = useDeleteFile();

  // A new scope or a new query starts at the first page; staying on page 4 of
  // a result set that no longer has one shows an empty grid over real matches.
  useEffect(() => {
    setPage(0);
  }, [selection.type, selection.folder, submitted, mode]);

  const search = useFileSearch({
    query: submitted,
    searchType: MODE_SEARCH[mode],
    type: selection.type,
    folder: selection.folder,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const rows = search.data?.results ?? [];
  const total = search.data?.total_matches ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Typing filters what is already on screen straight away; submitting is what
  // asks the server. Without this, a name search would feel like it needed a
  // round trip to hide one row.
  const visible = useMemo(() => {
    const needle = draft.trim().toLowerCase();
    if (!needle || needle === submitted.trim().toLowerCase()) return rows;
    return rows.filter((r) => (r.filename || "").toLowerCase().includes(needle));
  }, [rows, draft, submitted]);

  async function send(files: File[], target: UploadTarget, prefix: string) {
    setError(null);
    cancelSend.current = false;
    setSending({ done: 0, total: files.length });
    let ok = 0;
    for (const file of files) {
      if (cancelSend.current) break;
      try {
        // A dropped folder gives each file a relative path; its directory part
        // becomes the folder, so the structure survives the drop rather than
        // flattening into one heap. The typed prefix sits above it.
        const folder = [prefix, relativeFolder(file)].filter(Boolean).join("/");
        await upload.mutateAsync({
          type: target.type,
          // No record chosen means the type's vault — a home of its own, not a
          // missing answer. It is where both files already in this drive live.
          recordId: target.recordId || VAULT,
          file,
          folder: folder || undefined,
        });
        ok += 1;
        setSending({ done: ok, total: files.length });
      } catch (err) {
        setError(errorMessage(err));
        break;
      }
    }
    setSending(null);
    setStaged([]);
    if (ok) {
      const where = target.recordId ? `${target.type} · ${target.recordId}` : target.type;
      toast.success(`Uploaded ${ok} file${ok === 1 ? "" : "s"} to ${where}.`);
    }
  }

  /** Everything dropped or picked waits here until the destination is confirmed. */
  function accept(files: File[]) {
    if (!files.length) return;
    setError(null);
    setStaged((prev) => [...prev, ...files]);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    accept(Array.from(e.dataTransfer.files || []));
  }

  return (
    <div className="fx-grid-wrap">
      <div className="fx-toolbar">
        <div className="fx-modes" role="tablist" aria-label="Search by">
          {(["name", "text", "meaning"] as Mode[]).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              className={`fx-mode ${mode === m ? "active" : ""}`}
              onClick={() => setMode(m)}
              title={
                m === "name"
                  ? "Match the file name"
                  : m === "text"
                  ? "Search the text inside files"
                  : "Rank by meaning, not exact words"
              }
            >
              {m}
            </button>
          ))}
        </div>

        <form
          className="fx-search input-icon"
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(draft);
          }}
        >
          <Search size={15} />
          <input
            className="input"
            placeholder={
              mode === "name"
                ? "Search file names…"
                : mode === "text"
                ? "Search inside files…"
                : "Describe what you are looking for…"
            }
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          {/* Typing filters what is already on screen; this is what asks the
              server. Without a button the distinction is invisible. */}
          <button className="btn btn-sm" type="submit" disabled={search.isFetching}>
            <Search size={14} /> {search.isFetching ? "Searching…" : "Search"}
          </button>
          {(draft || submitted) && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setDraft("");
                setSubmitted("");
                setPage(0);
              }}
            >
              Clear
            </button>
          )}
        </form>

        {/* Two pickers, as SOAR has: a folder upload needs `webkitdirectory`,
            which a file picker cannot also carry. */}
        <button
          className="btn btn-primary btn-sm"
          onClick={() => picker.current?.click()}
          disabled={!!sending}
        >
          <Upload size={14} /> Upload files
        </button>
        <button
          className="btn btn-sm"
          onClick={() => folderPicker.current?.click()}
          disabled={!!sending}
        >
          Upload folder
        </button>
        <input
          ref={picker}
          type="file"
          multiple
          className="fx-hidden-input"
          onChange={(e) => {
            accept(Array.from(e.target.files || []));
            e.target.value = "";
          }}
        />
        <input
          ref={(el) => {
            if (el) {
              el.setAttribute("webkitdirectory", "");
              el.setAttribute("directory", "");
            }
            folderPicker.current = el;
          }}
          type="file"
          multiple
          className="fx-hidden-input"
          onChange={(e) => {
            accept(Array.from(e.target.files || []));
            e.target.value = "";
          }}
        />
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      {/* Always on screen, not only after a drop: a drive whose drop target is
          the file list gives no sign it accepts anything at all. */}
      <div
        className={`fx-dropzone ${dragging ? "is-over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => picker.current?.click()}
      >
        <span className="dz-mark" aria-hidden>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 16V4M7 9l5-5 5 5M5 20h14" />
          </svg>
        </span>
        <div>
          <b>Drop files or a folder</b> here, or click to choose — you&rsquo;ll confirm where
          they live before anything uploads. Folders keep their structure.
        </div>
      </div>

      {staged.length > 0 && (
        <UploadStage
          files={staged}
          presetType={selection.type}
          presetFolder={selection.folder}
          sending={sending}
          onRemove={(i) => setStaged((prev) => prev.filter((_, at) => at !== i))}
          onCancel={() => {
            if (sending) cancelSend.current = true;
            else setStaged([]);
          }}
          onConfirm={(target, prefix) => {
            localStorage.setItem(LAST_TARGET_KEY, JSON.stringify(target));
            void send(staged, target, prefix);
          }}
        />
      )}

      <div
        className={`fx-drop ${dragging ? "is-over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        {search.isLoading ? (
          <Spinner />
        ) : search.isError ? (
          <Alert kind="error">{errorMessage(search.error)}</Alert>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<FileText size={26} />}
            title={submitted ? "Nothing matched" : "No files here"}
            message={
              submitted
                ? "Try a different search, or switch how you are searching — text reads inside files, meaning ranks by similarity."
                : "Drop files here, or use Upload. They attach to a record, and the folder you are in becomes their folder."
            }
          />
        ) : (
          <ScrollX>
            <table className="fx-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Where</th>
                  <th>Type</th>
                  <th className="fx-num">Size</th>
                  <th>Modified</th>
                  <th>Status</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {visible.map((f) => {
                  const home = fileHome(f);
                  const snippet = fileSnippet(f);
                  return (
                    <tr key={fileId(f)} onClick={() => onOpen(f)} className="fx-row">
                      <td>
                        <div className="fx-name">
                          <span className="fx-ext">{ext(f.filename || "")}</span>
                          <span className="fx-filename">
                            {baseName(f.filename || "Untitled")}
                          </span>
                          {typeof f.score === "number" && mode !== "name" && (
                            <span className="fx-score">{Math.round(f.score * 100)}%</span>
                          )}
                        </div>
                        {snippet && <div className="fx-snippet">{snippet}</div>}
                      </td>
                      <td>
                        <span className="fx-where" title={`${home.type}/${home.recordId}`}>
                          {home.type}
                          {f.folder_path ? ` › ${f.folder_path}` : ""}
                        </span>
                      </td>
                      <td className="fx-dim fx-type" title={f.content_type || undefined}>
                        {shortType(f)}
                      </td>
                      <td className="fx-num fx-dim">
                        {fileSizeLabel(fileSize(f))}
                        {f.version && f.version > 1 ? ` · v${f.version}` : ""}
                      </td>
                      <td className="fx-dim">{fmtFileDate(f.updated_at || f.created_at)}</td>
                      <td>
                        {/* An unindexed file is stored but not yet searchable,
                            which is worth saying: its absence from a text
                            search is the pipeline still working, not a miss. */}
                        {f.processing_state && f.processing_state !== "Ready" ? (
                          <span
                            className={`fx-state is-${f.processing_state.toLowerCase()}`}
                          >
                            {f.processing_state === "Skipped"
                              ? "no text"
                              : f.processing_state === "Failed"
                                ? "failed"
                                : f.processing_state === "Processing"
                                  ? "processing…"
                                  : "queued"}
                          </span>
                        ) : (
                          <span className="fx-state">ready</span>
                        )}
                      </td>
                      <td
                        className="fx-actions"
                        // The row opens the file; the buttons do their own
                        // thing, so their clicks stop here.
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button className="btn btn-ghost btn-sm" onClick={() => onOpen(f)}>
                          Preview
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => {
                            downloadFile(homeOf(f), f.filename || "file").catch((err) =>
                              setError(errorMessage(err))
                            );
                          }}
                        >
                          Download
                        </button>
                        <button
                          className="btn btn-ghost btn-sm fx-del"
                          onClick={() => setConfirming(f)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollX>
        )}
      </div>

      <details className="fx-how">
        <summary>⌁ how this works</summary>
        <div>
          <b>source</b> — <code>POST /api/files/search</code>, over every attachment in the{" "}
          <code>{NS}</code> namespace you can see (access is enforced upstream).
        </div>
        <div>
          <b>note</b> — each file lives on a record type (the Where chip); a file with no
          parent record sits in that type&rsquo;s <code>_vault</code>. Folders come from the
          path files were uploaded with.
        </div>
      </details>

      {confirming && (
        <ConfirmDialog
          title={`Delete “${confirming.filename || "this file"}”?`}
          message="This removes the file and every version of it from your InventDB instance. This can't be undone."
          confirmLabel="Delete"
          busy={removeFile.isPending}
          onConfirm={() => {
            const home = homeOf(confirming);
            const name = confirming.filename || "file";
            removeFile
              .mutateAsync(home)
              .then(() => toast.success(`Deleted “${name}”.`))
              .catch((err) => setError(errorMessage(err)))
              .finally(() => setConfirming(null));
          }}
          onCancel={() => setConfirming(null)}
        />
      )}

      {pages > 1 && (
        <div className="fx-pager">
          <button
            className="btn btn-ghost btn-sm"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            <ChevronLeft size={14} /> Previous
          </button>
          <span className="report-note">
            Page {page + 1} of {pages} · {total.toLocaleString()} file
            {total === 1 ? "" : "s"}
          </span>
          <button
            className="btn btn-ghost btn-sm"
            disabled={page + 1 >= pages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Where should these files live?
 *
 * Asked rather than assumed, and only when the answer is not already known —
 * a file with no record to hang off is not a file this system can store.
 */
/**
 * The staging panel — everything picked, and where it is about to go.
 *
 * Uploading is the one action in this room that cannot be undone by looking
 * somewhere else, so it is deliberately two steps: the files sit here, named
 * and sized, until a destination is confirmed. Nothing has left the browser
 * while this is on screen, which is what the badge says out loud.
 */
function UploadStage({
  files,
  presetType,
  presetFolder,
  sending,
  onRemove,
  onCancel,
  onConfirm,
}: {
  files: File[];
  presetType?: string;
  presetFolder?: string;
  sending: { done: number; total: number } | null;
  onRemove: (index: number) => void;
  onCancel: () => void;
  onConfirm: (target: UploadTarget, folderPrefix: string) => void;
}) {
  const last = readLastTarget();
  const [type, setType] = useState(presetType || last?.type || "files");
  const [recordId, setRecordId] = useState("");
  const [folder, setFolder] = useState(presetFolder || "");

  // Every type in the namespace, InventDB's own list — the same source SOAR
  // offers, so a vault this drive can already show is one it can also fill.
  const [types, setTypes] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    listTypes()
      .then((all) => {
        if (live) setTypes(all.filter((t) => !t.startsWith("_")));
      })
      .catch(() => {
        /* the select falls back to the modules below */
      });
    return () => {
      live = false;
    };
  }, []);

  const options = useMemo(() => {
    const names = types.length ? types : ENTITIES.map((e) => e.name);
    return Array.from(new Set([...names, "files", type])).filter(Boolean).sort();
  }, [types, type]);

  const prefix = trimSlashes(folder);
  const landing = `${NS}.${type || "…"}`;

  return (
    <div className="card fx-stage">
      <div className="fx-stage-head">
        <h4>
          Ready to upload — {files.length} file{files.length === 1 ? "" : "s"}
        </h4>
        <span className="fx-stage-tag">NOT UPLOADED YET</span>
      </div>

      <div className="fx-stage-list">
        {files.slice(0, 200).map((f, i) => (
          <div className="fx-stage-row" key={`${f.name}-${i}`}>
            <span className="fx-stage-name" title={relativeFolder(f) || f.name}>
              {(f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name}
            </span>
            <span className="fx-stage-size">{fileSizeLabel(f.size)}</span>
            {!sending && (
              <button
                type="button"
                className="fx-stage-x"
                aria-label={`Remove ${f.name}`}
                onClick={() => onRemove(i)}
              >
                ✕
              </button>
            )}
          </div>
        ))}
        {files.length > 200 && (
          <span className="report-note">…and {files.length - 200} more</span>
        )}
      </div>

      {!sending && (
        <div className="fx-stage-where">
          <span className="report-note">
            Where should these live? Every file belongs to a <b>type</b> — pick one, and
            attach it to a record if it has one.
          </span>
          <div className="fx-stage-grid">
            <div className="field">
              <label>Namespace</label>
              {/* Fixed, unlike SOAR's picker: this app is pinned to one
                  namespace server-side, so offering a choice it cannot honour
                  would be a control that lies. */}
              <input className="input mono" value={NS} readOnly aria-readonly />
            </div>
            <div className="field">
              <label htmlFor="fx-stage-type">Type</label>
              <select
                id="fx-stage-type"
                className="select"
                value={type}
                onChange={(e) => setType(e.target.value)}
              >
                {options.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="fx-stage-record">Record</label>
              <input
                id="fx-stage-record"
                className="input mono"
                value={recordId}
                placeholder="(vault — no parent record)"
                onChange={(e) => setRecordId(e.target.value)}
              />
            </div>
          </div>
          <div className="fx-stage-folder">
            <span className="report-note">Folder</span>
            <input
              className="input mono"
              value={folder}
              placeholder="(target root — no folder)"
              aria-label="Folder prefix for uploaded files"
              onChange={(e) => setFolder(e.target.value)}
            />
            {folder && (
              <button className="btn btn-ghost btn-sm" onClick={() => setFolder("")}>
                Clear
              </button>
            )}
          </div>
          <span className="report-note">
            Files land at{" "}
            <b className="mono">
              {landing} / {prefix ? `${prefix}/…` : "…"}
            </b>
            {recordId.trim() ? ` — attached to record ${recordId.trim()}.` : ""}
          </span>
        </div>
      )}

      {sending ? (
        <ActionProgress
          label="Uploading files…"
          done={sending.done}
          total={sending.total}
          onCancel={onCancel}
        />
      ) : (
        <div className="fx-stage-actions">
          <button
            className="btn btn-amber"
            disabled={!type}
            onClick={() => onConfirm({ type, recordId: recordId.trim() }, prefix)}
          >
            Upload {files.length} file{files.length === 1 ? "" : "s"} to {landing}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={onCancel}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
