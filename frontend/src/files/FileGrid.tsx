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
import { ScrollX } from "../components/ScrollX";
import { useToast } from "../components/Toast";
import { errorMessage } from "../api/client";
import { useFileSearch, useUploadFile, type FileSearchParams } from "../api/hooks";
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

interface UploadTarget {
  type: string;
  recordId: string;
}

function readLastTarget(): UploadTarget | null {
  try {
    const raw = localStorage.getItem(LAST_TARGET_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed?.type && parsed?.recordId ? parsed : null;
  } catch {
    return null;
  }
}

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
  const [pendingDrop, setPendingDrop] = useState<File[] | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  const upload = useUploadFile();

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

  async function send(files: File[], target: UploadTarget) {
    setError(null);
    let ok = 0;
    for (const file of files) {
      try {
        // A dropped folder gives each file a relative path; its directory part
        // becomes the folder, so the structure survives the drop rather than
        // flattening into one heap.
        const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath || "";
        const folder = [selection.folder, folderOf(relative)].filter(Boolean).join("/");
        await upload.mutateAsync({
          type: target.type,
          recordId: target.recordId,
          file,
          folder: folder || undefined,
        });
        ok += 1;
      } catch (err) {
        setError(errorMessage(err));
        break;
      }
    }
    if (ok) toast.success(`Uploaded ${ok} file${ok === 1 ? "" : "s"}.`);
  }

  function accept(files: File[]) {
    if (!files.length) return;
    const target = selection.type
      ? { type: selection.type, recordId: readLastTarget()?.recordId || "" }
      : readLastTarget();
    // A file has to land on a record. If we do not know which, ask — never
    // guess, and never drop the bytes on the floor either.
    if (!target?.type || !target?.recordId) {
      setPendingDrop(files);
      return;
    }
    void send(files, target);
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
        </form>

        <button className="btn btn-sm" onClick={() => picker.current?.click()} disabled={upload.isPending}>
          <Upload size={14} /> {upload.isPending ? "Uploading…" : "Upload"}
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
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      {pendingDrop && (
        <UploadTargetPrompt
          count={pendingDrop.length}
          presetType={selection.type}
          onCancel={() => setPendingDrop(null)}
          onConfirm={(target) => {
            localStorage.setItem(LAST_TARGET_KEY, JSON.stringify(target));
            const files = pendingDrop;
            setPendingDrop(null);
            void send(files, target);
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
                  <th>Size</th>
                  <th>Added</th>
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
                      <td className="fx-num">{fileSizeLabel(fileSize(f))}</td>
                      <td className="fx-num">{fmtFileDate(f.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollX>
        )}
      </div>

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
function UploadTargetPrompt({
  count,
  presetType,
  onCancel,
  onConfirm,
}: {
  count: number;
  presetType?: string;
  onCancel: () => void;
  onConfirm: (target: UploadTarget) => void;
}) {
  const [type, setType] = useState(presetType || ENTITIES[0]?.name || "");
  const [recordId, setRecordId] = useState(readLastTarget()?.recordId || "");

  return (
    <div className="card card-pad fx-target">
      <h4 className="fx-target-head">
        Where should {count} file{count === 1 ? "" : "s"} go?
      </h4>
      <p className="report-note">
        Files attach to a record. Pick the record type and the id of the record they belong to —
        the lease, the work order, the inspection.
      </p>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="fx-target-type">Record type</label>
          <select
            id="fx-target-type"
            className="select"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            {ENTITIES.map((entity) => (
              <option key={entity.name} value={entity.name}>
                {entity.labelPlural}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="fx-target-record">Record id</label>
          <input
            id="fx-target-record"
            className="input mono"
            value={recordId}
            placeholder="lea-1"
            onChange={(e) => setRecordId(e.target.value)}
          />
        </div>
      </div>
      <div className="fx-target-actions">
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="btn btn-primary btn-sm"
          disabled={!type || !recordId.trim()}
          onClick={() => onConfirm({ type, recordId: recordId.trim() })}
        >
          Upload here
        </button>
      </div>
    </div>
  );
}
