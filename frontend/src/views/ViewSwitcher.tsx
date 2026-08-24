/**
 * The view switcher — a module list's primary navigation.
 *
 * A trigger showing the current view opens a search-first palette: type to
 * filter, ↑/↓ and Enter to switch, ★ to pin the one that opens first. "Manage"
 * turns the rows into checkboxes for multi-select delete, and makes each name
 * editable in place.
 *
 * Search-first rather than a row of tabs because the number of views is
 * unbounded — tabs stop working somewhere around six and there is no natural
 * cap on how many browse states a portfolio manager wants to keep.
 *
 * "All <module>" is always present and is not a stored view: it is the
 * unfiltered list, and it is what the module falls back to when nothing is
 * pinned as the default.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Plus,
  Settings2,
  Sparkles,
  Star,
  Rows3,
} from "lucide-react";

import type { SavedView } from "./api";
import { ConfirmDialog } from "../components/Modal";

type Row = { id: string; name: string; all?: boolean; view?: SavedView };

export function ViewSwitcher({
  views,
  activeViewId,
  typeLabel,
  onApplyView,
  onApplyAll,
  onNewView,
  onSaveCurrent,
  onSetDefault,
  onDeleteViews,
  onRenameView,
  busy,
}: {
  views: SavedView[];
  /** `null` means "All <module>" is showing. */
  activeViewId: string | null;
  typeLabel: string;
  onApplyView: (view: SavedView) => void;
  onApplyAll: () => void;
  /** Opens the designer — a view described rather than captured. */
  onNewView: () => void;
  /** Captures the search and sort already on screen. */
  onSaveCurrent: () => void;
  onSetDefault: (view: SavedView) => void;
  onDeleteViews: (ids: string[]) => void | Promise<void>;
  onRenameView: (view: SavedView, name: string) => void | Promise<void>;
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [manage, setManage] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [confirming, setConfirming] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const allLabel = `All ${typeLabel.toLowerCase()}`;
  const activeName =
    views.find((v) => v.id === activeViewId)?.name ?? (activeViewId ? "View" : allLabel);

  // The default sorts to the top; everything else alphabetical. "All" only
  // appears when it matches what has been typed, so the list stays honest
  // about what the search found.
  const rows = useMemo<Row[]>(() => {
    const term = query.trim().toLowerCase();
    const matched = [...views]
      .sort((a, b) => {
        if (a.is_default !== b.is_default) return a.is_default ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .filter((v) => !term || v.name.toLowerCase().includes(term))
      .map((v) => ({ id: v.id, name: v.name, view: v }));
    const head: Row[] =
      !term || allLabel.toLowerCase().includes(term)
        ? [{ id: "__all__", name: allLabel, all: true }]
        : [];
    return [...head, ...matched];
  }, [views, query, allLabel]);

  // Reset and focus on open; close on an outside click.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setCursor(0);
    setManage(false);
    setSelected(new Set());
    setRenaming(null);
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => {
      clearTimeout(t);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  // Keep the highlight inside the list as filtering shortens it.
  useEffect(() => {
    if (cursor > rows.length - 1) setCursor(Math.max(0, rows.length - 1));
  }, [rows.length, cursor]);

  function choose(row: Row) {
    if (row.all) onApplyAll();
    else if (row.view) onApplyView(row.view);
    setOpen(false);
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (renaming) return; // the inline editor owns the keyboard while it is open
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[cursor];
      if (!row) return;
      if (manage) {
        if (!row.all) toggle(row.id);
      } else choose(row);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  }

  function startRename(view: SavedView) {
    setRenaming(view.id);
    setDraftName(view.name);
  }

  async function commitRename(view: SavedView) {
    const next = draftName.trim();
    setRenaming(null);
    if (!next || next === view.name) return;
    const clash = views.some(
      (v) => v.id !== view.id && v.name.trim().toLowerCase() === next.toLowerCase()
    );
    if (clash) return; // silently keep the old name rather than create a duplicate
    await onRenameView(view, next);
  }

  async function confirmDelete() {
    const ids = [...selected];
    setConfirming(false);
    if (!ids.length) return;
    await onDeleteViews(ids);
    setSelected(new Set());
    setManage(false);
  }

  return (
    <div ref={rootRef} className="view-switcher">
      <button
        className="btn view-switcher-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        title="Switch view"
      >
        <Rows3 size={15} />
        <span className="vs-current">{activeName}</span>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {open && (
        <div className="vs-palette" onKeyDown={onKeyDown}>
          <input
            ref={inputRef}
            className="vs-search"
            placeholder={manage ? "Search views to manage…" : "Search views…"}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
          />

          <div className="vs-list" role="listbox" aria-label="Views">
            {rows.length === 0 && (
              <p className="vs-empty">No views match “{query}”.</p>
            )}
            {rows.map((row, i) => {
              const active = row.all ? activeViewId === null : row.id === activeViewId;
              const isDefault = !row.all && !!row.view?.is_default;
              const editing = renaming === row.id;
              return (
                <div
                  key={row.id}
                  role="option"
                  aria-selected={active}
                  className={`vs-row${i === cursor ? " is-cursor" : ""}${
                    active ? " is-active" : ""
                  }`}
                  onMouseEnter={() => setCursor(i)}
                >
                  {manage && !row.all && (
                    <input
                      type="checkbox"
                      className="vs-check"
                      checked={selected.has(row.id)}
                      onChange={() => toggle(row.id)}
                      aria-label={`Select ${row.name}`}
                    />
                  )}

                  {!manage && !row.all && (
                    <button
                      className={`vs-star${isDefault ? " is-on" : ""}`}
                      title={isDefault ? "Opens first" : "Make this the default"}
                      aria-label={isDefault ? "Default view" : "Make default"}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (row.view) onSetDefault(row.view);
                      }}
                    >
                      <Star size={14} fill={isDefault ? "currentColor" : "none"} />
                    </button>
                  )}

                  {editing && row.view ? (
                    <input
                      className="vs-rename"
                      autoFocus
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      onBlur={() => commitRename(row.view!)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commitRename(row.view!);
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          setRenaming(null);
                        }
                      }}
                      aria-label="Rename view"
                    />
                  ) : (
                    <button
                      className="vs-label"
                      onClick={() => {
                        if (!manage) choose(row);
                        else if (row.view) startRename(row.view);
                      }}
                      title={manage && !row.all ? "Click to rename" : undefined}
                    >
                      {row.name}
                    </button>
                  )}

                  {active && !manage && <span className="vs-badge">current</span>}
                </div>
              );
            })}
          </div>

          <div className="vs-foot">
            {manage ? (
              <>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setManage(false);
                    setSelected(new Set());
                  }}
                >
                  Done
                </button>
                <span className="vs-count">{selected.size} selected</span>
                <button
                  className="btn btn-sm vs-delete"
                  disabled={!selected.size || busy}
                  onClick={() => setConfirming(true)}
                >
                  Delete{selected.size ? ` ${selected.size}` : ""}
                </button>
              </>
            ) : (
              <>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setManage(true)}
                  disabled={!views.length}
                  title={
                    views.length ? "Rename or delete views" : "No saved views yet"
                  }
                >
                  <Settings2 size={14} /> Manage
                </button>
                {/* Two ways to make a view, because they answer different
                    questions: "keep what I am looking at" and "show me this
                    differently". */}
                <button
                  className="btn btn-sm vs-save"
                  onClick={() => {
                    onSaveCurrent();
                    setOpen(false);
                  }}
                  title="Keep the current search and sort as a view"
                >
                  <Plus size={14} /> Save current
                </button>
                <button
                  className="btn btn-primary btn-sm vs-new"
                  onClick={() => {
                    onNewView();
                    setOpen(false);
                  }}
                  title="Describe a new view — the designer builds its layout and query"
                >
                  <Sparkles size={14} /> New view
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {confirming && (
        <ConfirmDialog
          title={`Delete ${selected.size} view${selected.size === 1 ? "" : "s"}?`}
          message="The saved view is removed. The records it showed are untouched."
          confirmLabel={`Delete ${selected.size}`}
          onConfirm={confirmDelete}
          onCancel={() => setConfirming(false)}
          busy={busy}
        />
      )}
    </div>
  );
}
