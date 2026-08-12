/**
 * Files — every document in the portfolio, in one place.
 *
 * InventDB keeps files as attachments on records: the scanned lease belongs to
 * a lease, the inspection photo to an inspection. That is good for provenance
 * and bad for finding things — nobody remembers which record they attached a
 * certificate to. So this room is a **drive over** those attachments: a tree of
 * record types and folders on the left, the files in the current scope on the
 * right, and search that reads names, the text inside files, or their meaning.
 *
 * It is a surface, not a second store. Every row still says where it lives, and
 * uploading always picks a home.
 *
 * One deliberate difference from SOAR's Files room, which browses every
 * namespace the signed-in user can see: this one is pinned to the PMS
 * namespace, server-side, exactly as Analyze and every entity route are. The
 * tree's top level is therefore record types rather than `namespace.type`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { FolderTree as FolderTreeIcon } from "lucide-react";

import { Alert } from "../components/ui";
import { ConfirmDialog } from "../components/Modal";
import { useToast } from "../components/Toast";
import { errorMessage } from "../api/client";
import { useBulkDeleteFiles, useFileTree } from "../api/hooks";
import type { FileRow } from "../types";
import { buildFileTree } from "../files/model";
import { FolderTree, type DeleteTarget, type DriveSelection } from "../files/FolderTree";
import { FileGrid } from "../files/FileGrid";
import { FileDetail } from "../files/FileDetail";

/** Batch size for a folder or type delete — small enough that progress moves. */
const DELETE_BATCH = 15;

export default function Files() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const tree = useFileTree();
  const bulkDelete = useBulkDeleteFiles();

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [opened, setOpened] = useState<FileRow | null>(null);
  const [target, setTarget] = useState<DeleteTarget | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Set when the user cancels mid-delete. Read between batches, so the batch in
  // flight finishes rather than being abandoned half-applied.
  const cancelled = useRef(false);

  // The selection lives in the URL, so a folder can be linked to and Back works.
  const selection: DriveSelection = useMemo(
    () => ({ type: params.get("type") || undefined, folder: params.get("folder") || undefined }),
    [params]
  );

  const { types, total } = useMemo(
    () => buildFileTree(tree.data?.folders ?? []),
    [tree.data]
  );
  // The server's own count is the truth for "All files"; the rolled-up tree
  // total is the fallback if the aggregation came back without one.
  const allFiles = tree.data?.total_matches || total;

  const select = useCallback(
    (sel: DriveSelection) => {
      const next: Record<string, string> = {};
      if (sel.type) next.type = sel.type;
      if (sel.folder) next.folder = sel.folder;
      setParams(next);
    },
    [setParams]
  );

  /**
   * Reveal whatever is selected, however it got selected.
   *
   * Driven off the selection rather than off the click, so a deep link into
   * `?type=leases&folder=2026` opens the tree to that folder too — arriving at
   * a link and being unable to see where you are is the same bug as clicking
   * one and not seeing it open.
   *
   * Only ever adds. The tree never collapses a branch on selection, because it
   * is how you get everywhere else.
   */
  useEffect(() => {
    if (!selection.type) return;
    setExpanded((open) => {
      const next = new Set(open);
      next.add(selection.type as string);
      if (selection.folder) {
        const parts = selection.folder.split("/");
        for (let i = 1; i <= parts.length; i++) {
          next.add(`${selection.type}/${parts.slice(0, i).join("/")}`);
        }
      }
      return next.size === open.size ? open : next;
    });
  }, [selection.type, selection.folder]);

  const toggle = (id: string) =>
    setExpanded((open) => {
      const nx = new Set(open);
      if (nx.has(id)) nx.delete(id);
      else nx.add(id);
      return nx;
    });

  /**
   * Delete a folder or a whole type, in batches.
   *
   * Batched so the count on screen is real and Cancel can land between passes.
   * The loop ends when a pass deletes nothing — which covers both "empty" and
   * "only files whose record I cannot see are left", and cannot spin.
   */
  async function runDelete(node: DeleteTarget) {
    cancelled.current = false;
    setError(null);
    setProgress({ done: 0, total: node.count });
    let deleted = 0;
    let skipped = 0;
    try {
      for (;;) {
        if (cancelled.current) break;
        const result = await bulkDelete.mutateAsync({
          type: node.type,
          folder: node.folder,
          limit: DELETE_BATCH,
        });
        const batch = Number(result?.deleted) || 0;
        skipped = Number(result?.skipped) || skipped;
        deleted += batch;
        setProgress({ done: Math.min(deleted, node.count), total: node.count });
        if (batch === 0) break;
      }
      const noun = `file${deleted === 1 ? "" : "s"}`;
      if (cancelled.current) toast.success(`Deleted ${deleted} ${noun} — cancelled the rest.`);
      else if (skipped > 0)
        toast.success(`Deleted ${deleted} ${noun}; ${skipped} skipped (no access).`);
      else toast.success(`Deleted ${deleted} ${noun}.`);

      // If what was deleted contained the current scope, fall back to All files
      // rather than sitting on a folder that no longer exists.
      const sameType = selection.type === node.type;
      const hit =
        sameType &&
        (!node.folder ||
          !selection.folder ||
          selection.folder === node.folder ||
          selection.folder.startsWith(`${node.folder}/`));
      if (hit) select({});
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setProgress(null);
      void tree.refetch();
    }
  }

  useEffect(() => {
    if (!error) return;
    const t = window.setTimeout(() => setError(null), 8000);
    return () => window.clearTimeout(t);
  }, [error]);

  return (
    <div className="content">
      <div className="page-head">
        <div className="titles">
          <h2>Files</h2>
          <p>
            Every document in the portfolio, wherever it is attached — leases, inspection photos,
            invoices, certificates. Pick a record type and drill into its folders, or search by
            name, by the text inside files, or by meaning.
          </p>
        </div>
        <div className="actions">
          <span className="count-pill">
            <FolderTreeIcon size={13} style={{ verticalAlign: "-2px", marginRight: 6 }} />
            {allFiles.toLocaleString()} file{allFiles === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      {tree.isError && <Alert kind="error">{errorMessage(tree.error)}</Alert>}
      {error && <Alert kind="error">{error}</Alert>}

      {progress && (
        <div className="card card-pad fx-progress">
          <div className="fx-progress-head">
            <span>
              Deleting files… {progress.done.toLocaleString()} of {progress.total.toLocaleString()}
            </span>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                cancelled.current = true;
              }}
            >
              Cancel
            </button>
          </div>
          <div className="fx-progress-bar">
            <div
              className="fx-progress-fill"
              style={{
                width: `${progress.total ? Math.min(100, (progress.done / progress.total) * 100) : 0}%`,
              }}
            />
          </div>
        </div>
      )}

      <div className="fx-layout">
        <FolderTree
          types={types}
          total={allFiles}
          loading={tree.isLoading}
          selection={selection}
          expanded={expanded}
          onToggle={toggle}
          onSelect={select}
          onDelete={setTarget}
        />
        <FileGrid selection={selection} onOpen={setOpened} />
      </div>

      {opened && (
        <FileDetail
          file={opened}
          onClose={() => setOpened(null)}
          onDeleted={() => {
            setOpened(null);
            void tree.refetch();
          }}
        />
      )}

      {target && (
        <ConfirmDialog
          title={
            target.folder
              ? `Delete “${target.folder}” and its ${target.count.toLocaleString()} file(s)?`
              : `Delete all ${target.count.toLocaleString()} file(s) on ${target.type}?`
          }
          message="The files and everything extracted from them are removed permanently. The records they were attached to are left alone."
          confirmLabel={target.folder ? "Delete folder" : "Delete all files"}
          busy={!!progress}
          onConfirm={() => {
            const node = target;
            setTarget(null);
            void runDelete(node);
          }}
          onCancel={() => setTarget(null)}
        />
      )}
    </div>
  );
}
