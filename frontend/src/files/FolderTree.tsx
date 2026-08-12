/**
 * The drive tree: "All files", then one node per record type, then that type's
 * folders nested by path.
 *
 * It is built from the server's folder aggregation rather than from the grid's
 * results, and it stays **fully visible** whatever is selected — selecting a
 * folder never hides its siblings, because the tree is how you get anywhere
 * else. Selecting a node scopes the grid; the selection itself lives in the URL
 * so a folder can be linked to and Back works.
 */
import { ChevronDown, ChevronRight, Database, Folder, Trash2 } from "lucide-react";

import { Spinner } from "../components/ui";
import type { FolderNode, TypeNode } from "./model";

export interface DriveSelection {
  type?: string;
  folder?: string;
}

export interface DeleteTarget {
  type: string;
  folder?: string;
  count: number;
}

function DeleteNodeButton({ title, onDelete }: { title: string; onDelete: () => void }) {
  return (
    <button
      type="button"
      className="fx-node-del"
      title={title}
      aria-label={title}
      // Without this the click also selects the node it is deleting.
      onClick={(e) => {
        e.stopPropagation();
        onDelete();
      }}
    >
      <Trash2 size={13} />
    </button>
  );
}

function FolderRow({
  node,
  type,
  depth,
  selection,
  expanded,
  onToggle,
  onSelect,
  onDelete,
}: {
  node: FolderNode;
  type: string;
  depth: number;
  selection: DriveSelection;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onSelect: (sel: DriveSelection) => void;
  onDelete: (target: DeleteTarget) => void;
}) {
  const id = `${type}/${node.path}`;
  const open = expanded.has(id);
  const active = selection.type === type && (selection.folder || "") === node.path;

  return (
    <>
      <div
        className={`fx-node ${active ? "is-active" : ""}`}
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        {node.children.length > 0 ? (
          <button
            type="button"
            className="fx-node-tog"
            onClick={() => onToggle(id)}
            aria-label={open ? `Collapse ${node.name}` : `Expand ${node.name}`}
          >
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        ) : (
          <span className="fx-node-tog is-empty" />
        )}
        <Folder size={14} className="fx-node-ico" />
        <button
          type="button"
          className="fx-node-name"
          onClick={() => onSelect({ type, folder: node.path })}
          title={node.path}
        >
          {node.name}
        </button>
        <span className="fx-node-count">{node.count.toLocaleString()}</span>
        <DeleteNodeButton
          title={`Delete “${node.path}” and its ${node.count} file(s) in ${type}`}
          onDelete={() => onDelete({ type, folder: node.path, count: node.count })}
        />
      </div>
      {open &&
        node.children.map((child) => (
          <FolderRow
            key={child.path}
            node={child}
            type={type}
            depth={depth + 1}
            selection={selection}
            expanded={expanded}
            onToggle={onToggle}
            onSelect={onSelect}
            onDelete={onDelete}
          />
        ))}
    </>
  );
}

export function FolderTree({
  types,
  total,
  loading,
  selection,
  expanded,
  onToggle,
  onSelect,
  onDelete,
}: {
  types: TypeNode[];
  total: number;
  loading: boolean;
  selection: DriveSelection;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onSelect: (sel: DriveSelection) => void;
  onDelete: (target: DeleteTarget) => void;
}) {
  const allActive = !selection.type && !selection.folder;

  return (
    <aside className="card card-pad fx-tree">
      <div className="fx-tree-head">
        <span className="fx-tree-title">Where</span>
        <span className="count-pill">{types.length}</span>
      </div>

      <div className="fx-tree-body" role="tree">
        {/* Always at the top, always visible: one click back to everything. */}
        <div className={`fx-node fx-node--root ${allActive ? "is-active" : ""}`}>
          <span className="fx-node-tog is-empty" />
          <Database size={14} className="fx-node-ico" />
          <button type="button" className="fx-node-name" onClick={() => onSelect({})}>
            All files
          </button>
          {!loading && <span className="fx-node-count">{total.toLocaleString()}</span>}
        </div>

        {loading ? (
          <Spinner />
        ) : types.length === 0 ? (
          <p className="report-note fx-tree-empty">
            No files yet — upload one and the record type it belongs to appears here.
          </p>
        ) : (
          types.map((t) => {
            const open = expanded.has(t.key);
            const active = selection.type === t.type && !selection.folder;
            return (
              <div key={t.key} role="treeitem" aria-expanded={open}>
                <div className={`fx-node fx-node--type ${active ? "is-active" : ""}`}>
                  {t.folders.length > 0 ? (
                    <button
                      type="button"
                      className="fx-node-tog"
                      onClick={() => onToggle(t.key)}
                      aria-label={open ? `Collapse ${t.label}` : `Expand ${t.label}`}
                    >
                      {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </button>
                  ) : (
                    <span className="fx-node-tog is-empty" />
                  )}
                  <Database size={14} className="fx-node-ico" />
                  <button
                    type="button"
                    className="fx-node-name"
                    onClick={() => onSelect({ type: t.type })}
                    title={`${t.label} — every file on this type`}
                  >
                    {t.label}
                  </button>
                  <span className="fx-node-count">{t.count.toLocaleString()}</span>
                  <DeleteNodeButton
                    title={`Delete all ${t.count} file(s) on ${t.label}`}
                    onDelete={() => onDelete({ type: t.type, count: t.count })}
                  />
                </div>
                {open &&
                  t.folders.map((node) => (
                    <FolderRow
                      key={node.path}
                      node={node}
                      type={t.type}
                      depth={1}
                      selection={selection}
                      expanded={expanded}
                      onToggle={onToggle}
                      onSelect={onSelect}
                      onDelete={onDelete}
                    />
                  ))}
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
