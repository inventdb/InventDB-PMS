/**
 * One file, opened: preview, what it is, the text read out of it, and its
 * version history.
 *
 * The version history is the part worth having. Uploading the same file again
 * adds a version rather than overwriting, and restoring an old one makes it
 * current without discarding what came after — which is what you want the
 * moment a re-signed lease replaces the one it supersedes and somebody asks to
 * see the original.
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Download, FileText, History, Info, RotateCcw, Trash2, Upload } from "lucide-react";

import { Modal, ConfirmDialog } from "../components/Modal";
import { Alert, EmptyState, Spinner } from "../components/ui";
import { useToast } from "../components/Toast";
import { errorMessage } from "../api/client";
import {
  downloadFile,
  fileObjectUrl,
  useDeleteFile,
  useFileText,
  useFileVersions,
  useRestoreFileVersion,
  useUploadFileVersion,
  type FileHome,
} from "../api/hooks";
import type { FileRow } from "../types";
import { AttachPanel, AttachedTo } from "./AttachPanel";
import {
  ext,
  fileHome,
  fileId,
  fileSize,
  fileSizeLabel,
  fmtFileDate,
  isImage,
  isPdf,
  isPreviewable,
} from "./model";

type Tab = "preview" | "info" | "text" | "versions";

/**
 * A file with this as its record id has no real parent — it is in its type's
 * vault. InventDB's own convention, and what SOAR's Files room uploads into.
 */
const VAULT = "_vault";

/**
 * An authed inline preview.
 *
 * The bytes need the bearer token, so they are fetched as a blob and handed to
 * the element as an object URL. The URL is revoked when the file changes or the
 * panel closes — a preview that leaked one per open would hold every file it
 * had ever shown for the life of the tab.
 */
function Preview({ home, file }: { home: FileHome; file: FileRow }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const contentType = file.content_type;
  const name = file.filename;

  useEffect(() => {
    let revoked = false;
    let current: string | null = null;
    setUrl(null);
    setError(null);
    if (!isPreviewable(contentType, name)) return;

    fileObjectUrl(home)
      .then((next) => {
        if (revoked) {
          URL.revokeObjectURL(next);
          return;
        }
        current = next;
        setUrl(next);
      })
      .catch((err) => !revoked && setError(errorMessage(err)));

    return () => {
      revoked = true;
      if (current) URL.revokeObjectURL(current);
    };
  }, [home, contentType, name]);

  if (!isPreviewable(contentType, name)) {
    return (
      <EmptyState
        icon={<FileText size={24} />}
        title={`${ext(name || "")} file`}
        message="No inline preview for this kind of file — download it to open it."
      />
    );
  }
  if (error) return <Alert kind="error">{error}</Alert>;
  if (!url) return <Spinner />;

  if (isImage(contentType)) {
    return <img className="fx-preview-img" src={url} alt={name || "Preview"} />;
  }
  if (isPdf(contentType, name)) {
    // Sandboxed: a PDF is a document from outside this app, and it has no
    // business reaching the page that frames it.
    return <iframe className="fx-preview-frame" src={url} title={name || "Preview"} sandbox="" />;
  }
  return <iframe className="fx-preview-frame" src={url} title={name || "Preview"} sandbox="" />;
}

export function FileDetail({
  file,
  onClose,
  onDeleted,
}: {
  file: FileRow;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const toast = useToast();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("preview");
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const versionInput = useRef<HTMLInputElement>(null);

  const { type, recordId } = fileHome(file);
  const home: FileHome = { type, recordId, attachmentId: fileId(file) };

  const versions = useFileVersions(tab === "versions" ? home : null);
  const text = useFileText(tab === "text" ? home : null);
  const remove = useDeleteFile();
  const addVersion = useUploadFileVersion();
  const restore = useRestoreFileVersion();
  const busy = remove.isPending || addVersion.isPending || restore.isPending;

  const name = file.filename || "File";

  async function save(version?: number) {
    setError(null);
    try {
      await downloadFile(home, name, version);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function onPickVersion(picked: File | undefined) {
    if (!picked) return;
    setError(null);
    try {
      await addVersion.mutateAsync({ home, file: picked });
      toast.success(`Added a new version of “${name}”.`);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function confirmDelete() {
    try {
      await remove.mutateAsync(home);
      toast.success(`Deleted “${name}”.`);
      onDeleted();
    } catch (err) {
      setConfirming(false);
      setError(errorMessage(err));
    }
  }

  const attached = !!recordId && recordId !== VAULT;
  const rows: [string, string][] = [
    ["Type", file.content_type || "—"],
    ["Size", fileSizeLabel(fileSize(file))],
    ["Version", String(file.version ?? 1)],
    ["Folder", file.folder_path || "— (type root)"],
    ["Added", fmtFileDate(file.created_at)],
    ["Updated", fmtFileDate(file.updated_at)],
    ["Indexing", file.processing_state || "—"],
  ];

  return (
    <>
      <Modal title={name} onClose={onClose}>
        <div className="fx-detail">
          {error && <Alert kind="error">{error}</Alert>}

          <div className="fx-detail-actions">
            <button className="btn btn-sm" onClick={() => save()} disabled={busy}>
              <Download size={14} /> Download
            </button>
            <button
              className="btn btn-sm"
              onClick={() => versionInput.current?.click()}
              disabled={busy}
              title="Upload a newer copy. The current one is kept as an earlier version."
            >
              <Upload size={14} /> {addVersion.isPending ? "Uploading…" : "New version"}
            </button>
            <input
              ref={versionInput}
              type="file"
              className="fx-hidden-input"
              onChange={(e) => {
                void onPickVersion(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <button
              className="btn btn-danger btn-sm fx-detail-end"
              onClick={() => setConfirming(true)}
              disabled={busy}
            >
              <Trash2 size={14} /> Delete
            </button>
          </div>

          <div className="fx-tabs" role="tablist">
            {(
              [
                ["preview", "Preview"],
                ["info", "Details"],
                ["text", "Extracted text"],
                ["versions", "Versions"],
              ] as [Tab, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                role="tab"
                aria-selected={tab === key}
                className={`fx-tab ${tab === key ? "active" : ""}`}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "preview" && (
            <div className="fx-preview">
              <Preview home={home} file={file} />
            </div>
          )}

          {tab === "info" && (
            <>
              {/* Where it lives comes first — for a document it is the most
                  load-bearing fact on the panel, and the one a vault file is
                  missing. */}
              {attached ? (
                <AttachedTo
                  type={type}
                  recordId={recordId}
                  onOpenRecord={() => {
                    onClose();
                    navigate(`/${type}`);
                  }}
                />
              ) : (
                <AttachPanel
                  attachmentId={home.attachmentId}
                  currentType={type}
                  // The panel reports the outcome — it is the one that knows
                  // whether a record was created along the way. Announcing it
                  // here too would just say the same thing twice.
                  onAttached={onClose}
                />
              )}
              <dl className="fx-info">
                {rows.map(([k, v]) => (
                  <div key={k} className="fx-info-row">
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}

          {tab === "text" &&
            (text.isLoading ? (
              <Spinner />
            ) : text.isError ? (
              <Alert kind="error">{errorMessage(text.error)}</Alert>
            ) : text.data?.text ? (
              <pre className="fx-text">{text.data.text}</pre>
            ) : (
              <EmptyState
                icon={<Info size={24} />}
                title="Nothing extracted"
                message="This file has no readable text yet — either it is still being processed, or there was none to read."
              />
            ))}

          {tab === "versions" &&
            (versions.isLoading ? (
              <Spinner />
            ) : versions.isError ? (
              <Alert kind="error">{errorMessage(versions.error)}</Alert>
            ) : !versions.data?.versions?.length ? (
              <EmptyState
                icon={<History size={24} />}
                title="Only one version"
                message="Upload a newer copy and the current one is kept here rather than replaced."
              />
            ) : (
              <div className="fx-versions">
                {[...versions.data.versions]
                  .sort((a, b) => b.version - a.version)
                  .map((v) => {
                    const current = v.is_current ?? v.version === (file.version ?? 1);
                    return (
                      <div key={v.version} className="fx-version">
                        <span className="fx-version-no">v{v.version}</span>
                        <span className="fx-version-meta">
                          {fileSizeLabel(v.size)} · {fmtFileDate(v.created_at)}
                        </span>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => save(v.version)}
                          disabled={busy}
                        >
                          <Download size={13} /> Download
                        </button>
                        {current ? (
                          <span className="badge success">Current</span>
                        ) : (
                          <button
                            className="btn btn-ghost btn-sm"
                            disabled={busy}
                            onClick={async () => {
                              setError(null);
                              try {
                                await restore.mutateAsync({ home, version: v.version });
                                toast.success(`Version ${v.version} is now current.`);
                              } catch (err) {
                                setError(errorMessage(err));
                              }
                            }}
                          >
                            <RotateCcw size={13} /> Restore
                          </button>
                        )}
                      </div>
                    );
                  })}
              </div>
            ))}
        </div>
      </Modal>

      {confirming && (
        <ConfirmDialog
          title={`Delete “${name}”?`}
          message="The file and everything extracted from it are removed. This can’t be undone."
          confirmLabel="Delete file"
          busy={remove.isPending}
          onConfirm={confirmDelete}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  );
}
