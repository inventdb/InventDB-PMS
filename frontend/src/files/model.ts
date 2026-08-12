/**
 * Reading a file row.
 *
 * InventDB's search response flattens several shapes together, so the same
 * value arrives under more than one key depending on which leg produced the
 * row — `_id` or `attachment_id`, `size_bytes` or `size`, `snippet` or
 * `text_snippet`. Every reader goes through these accessors rather than
 * picking a spelling, because picking one is how a grid ends up with blank
 * cells for half its rows.
 */
import type { FileRow, FolderAgg } from "../types";

export function fileId(f: FileRow): string {
  return String(f.attachment_id || f._id || "");
}

export function fileSize(f: FileRow): number {
  return Number(f.size ?? f.size_bytes ?? 0);
}

export function fileSnippet(f: FileRow): string {
  return String(f.snippet ?? f.text_snippet ?? "");
}

/** The record a file hangs off — its home, and where a download is addressed. */
export function fileHome(f: FileRow): { type: string; recordId: string } {
  return { type: String(f.record_type || ""), recordId: String(f.record_id || "") };
}

export const baseName = (s: string): string => String(s || "").split("/").pop() || String(s || "");

export const folderOf = (s: string): string => {
  const parts = String(s || "").split("/");
  parts.pop();
  return parts.join("/");
};

/** A short uppercase extension for the file chip — "PDF", "XLSX", "FILE". */
export function ext(name: string): string {
  const base = baseName(name);
  if (!base.includes(".")) return "FILE";
  return (base.split(".").pop() || "file").slice(0, 4).toUpperCase();
}

export function fileSizeLabel(bytes?: number): string {
  const n = Number(bytes || 0);
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export function fmtFileDate(v?: string): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    year: "2-digit",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const isImage = (ct?: string): boolean => !!ct && ct.startsWith("image/");
export const isPdf = (ct?: string, name?: string): boolean =>
  ct === "application/pdf" || /\.pdf$/i.test(name || "");
/** Previewable inline; anything else is offered as a download. */
export const isPreviewable = (ct?: string, name?: string): boolean =>
  isImage(ct) || isPdf(ct, name) || (!!ct && ct.startsWith("text/"));

// ---- The drive tree -------------------------------------------------------

export interface FolderNode {
  name: string;
  path: string;
  count: number;
  children: FolderNode[];
}

export interface TypeNode {
  type: string;
  key: string;
  label: string;
  count: number;
  folders: FolderNode[];
}

/**
 * Build the drive tree from the server's folder aggregation.
 *
 * Grouped by **type first**, then nested by path segment. That order is not
 * cosmetic: "2026" under leases and "2026" under inspections are different
 * folders, and a path-first tree would silently merge them into one node whose
 * count belonged to neither.
 *
 * Counts roll up — a folder counts everything beneath it, a type counts all its
 * folders plus the files sitting at its root (`path: ""`).
 *
 * Built from `folders`, never from `results`: the results array is one page,
 * so a tree built from it would describe only what happens to be on screen.
 */
export function buildFileTree(folders: FolderAgg[]): { types: TypeNode[]; total: number } {
  interface Building {
    type: string;
    root: FolderNode;
    byPath: Map<string, FolderNode>;
  }
  const byType = new Map<string, Building>();
  let total = 0;

  for (const f of folders) {
    const type = String(f.type || "");
    if (!type) continue; // a folder always has a home
    let entry = byType.get(type);
    if (!entry) {
      const root: FolderNode = { name: "", path: "", count: 0, children: [] };
      entry = { type, root, byPath: new Map([["", root]]) };
      byType.set(type, entry);
    }
    const count = Number(f.count) || 0;
    total += count;

    const parts = String(f.path || "").split("/").filter(Boolean);
    if (!parts.length) {
      entry.root.count += count; // this type's unfoldered files
      continue;
    }
    let cursor = entry.root;
    let path = "";
    for (const part of parts) {
      path = path ? `${path}/${part}` : part;
      let node = entry.byPath.get(path);
      if (!node) {
        node = { name: part, path, count: 0, children: [] };
        entry.byPath.set(path, node);
        cursor.children.push(node);
      }
      cursor = node;
    }
    cursor.count += count;
  }

  const finish = (n: FolderNode): number => {
    n.children.sort((a, b) => a.name.localeCompare(b.name));
    n.count += n.children.reduce((sum, c) => sum + finish(c), 0);
    return n.count;
  };

  const types: TypeNode[] = [...byType.values()]
    .map((t) => {
      const folderTotal = t.root.children.reduce((sum, c) => sum + finish(c), 0);
      return {
        type: t.type,
        key: t.type,
        label: t.type,
        count: t.root.count + folderTotal,
        folders: t.root.children,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));

  return { types, total };
}
