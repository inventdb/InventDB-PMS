/**
 * Dashboard — InventDB SOAR's Today room, in the PMS.
 *
 * A live, configurable dashboard: every widget is one SQL query rendered as a
 * number, list, table or chart — or a mini-report the assistant designs from a
 * description. Widgets are creatable, drag-and-drop rearrangeable, and
 * suggestable in one click; a suggestion is previewed and only replaces the
 * layout when it is saved. Nothing here is hardcoded data — an empty instance
 * shows per-widget "no data" and an onboarding prompt.
 *
 * Ported from `rooms/Today.tsx`. Two things differ, both deliberate: the
 * dashboard is stored per user rather than per user per namespace, because the
 * PMS has one namespace; and the assistant's token usage is not shown.
 */
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { ChevronDown, RefreshCw } from "lucide-react";

import { useAuth } from "../auth/AuthContext";
import { agentText as _agentText, isCancel, type AgentStep } from "../analyze/agent";
import { AgentTimeline } from "../analyze/Timeline";
import { ActionProgress } from "../analyze/ui";
import { ConfirmDialog } from "../components/Modal";
import { Skeleton } from "../analyze/ui";
import { loadDashboard, saveDashboard } from "../dashboard/dashboardStore";
import { suggestWidgets, NS } from "../dashboard/suggest";
import { LayoutDesigner } from "../dashboard/LayoutDesigner";
import { WidgetEditor } from "../dashboard/WidgetEditor";
import { WidgetView } from "../dashboard/WidgetView";
import type { Widget } from "../dashboard/types";

// Referenced so the import of the agent module is not tree-shaken away in dev
// builds that only reach it through suggestWidgets.
void _agentText;

/**
 * Time-of-day greeting, in the reader's own timezone.
 *
 * Evening starts at 4pm. Later than that and the greeting reads as a clock that
 * is wrong — "good afternoon" at half past five was reported as a bug. The date
 * is a parameter so the boundaries can be tested without waiting for one to
 * arrive.
 */
export function greeting(now: Date = new Date()): string {
  const h = now.getHours();
  if (h < 12) return "Good morning";
  if (h < 16) return "Good afternoon";
  return "Good evening";
}

export default function Dashboard() {
  const { user } = useAuth();
  const userId = user?.username;

  const [widgets, setWidgets] = useState<Widget[] | null>(null); // null = loading
  const [proposed, setProposed] = useState<Widget[] | null>(null); // preview, unsaved
  const [editing, setEditing] = useState(false);
  const [editor, setEditor] = useState<{ w: Widget | null } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  /** The New layout panel — a whole dashboard, described. */
  const [layoutOpen, setLayoutOpen] = useState(false);

  const [aiBusy, setAiBusy] = useState(false);
  const [aiStep, setAiStep] = useState("");
  const [aiSteps, setAiSteps] = useState<AgentStep[]>([]);
  const [aiErr, setAiErr] = useState<string | null>(null);
  const suggestAc = useRef<AbortController | null>(null);

  // Bumped by Refresh: every widget re-queries, numbers tween to their new
  // value, and report widgets re-render with the fresh result.
  const [refreshTick, setRefreshTick] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  // Live drag-reorder, keyed by the dragged widget's id. Insertion is computed
  // in reading order at the container level, with the dragged card excluded
  // from hit-testing — so moving it never re-triggers a reverse move.
  const dragId = useRef<string | null>(null);
  const [dragVisualId, setDragVisualId] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  // Tween the settle, never the drag itself.
  useGridFlip(gridRef, (widgets ?? []).map((w) => w.id).join("|"), dragVisualId === null);

  useEffect(() => {
    let live = true;
    loadDashboard(userId)
      .then((w) => {
        if (live) setWidgets(w ?? []);
      })
      .catch(() => {
        if (live) setWidgets([]);
      });
    return () => {
      live = false;
    };
  }, [userId]);

  const persist = (next: Widget[]) => {
    setWidgets(next);
    void saveDashboard(next, userId);
  };

  function addOrUpdate(w: Widget) {
    const cur = widgets ?? [];
    // Editing replaces in place; a NEW widget is prepended so it lands at the
    // top rather than buried at the bottom.
    persist(cur.some((x) => x.id === w.id) ? cur.map((x) => (x.id === w.id ? w : x)) : [w, ...cur]);
    setEditor(null);
  }

  const remove = (id: string) => persist((widgets ?? []).filter((x) => x.id !== id));

  /** A whole described layout, from the New layout panel. */
  function applyLayout(next: Widget[], how: "replace" | "add") {
    persist(how === "replace" ? next : [...next, ...(widgets ?? [])]);
    setLayoutOpen(false);
    setEditing(false);
  }

  function startDrag(id: string) {
    dragId.current = id;
    setDragVisualId(id);
  }

  function onGridDragOver(e: React.DragEvent) {
    const id = dragId.current;
    const cont = gridRef.current;
    if (!id || !cont) return;
    e.preventDefault();
    const items = Array.from(cont.querySelectorAll<HTMLElement>("[data-flip]")).filter(
      (el) => el.dataset.flip !== id
    );
    const px = e.clientX;
    const py = e.clientY;

    /**
     * Insert beside whichever card the pointer is NEAREST, on whichever side of
     * its centre the pointer is.
     *
     * Reading order — "before the first card the pointer sits above or left of"
     * — sounds right and is not. It compares against a card's top EDGE, so the
     * moment the pointer leaves its own row every card in the next row answers
     * "before me", and the dragged card is pinned at the end of the row it
     * started in. Dragging straight across, which is what people do, then moved
     * a card one slot and stopped. Distance to a centre has no such boundary:
     * both axes are considered together, and crossing a row is nothing special.
     */
    let insert = items.length;
    let best = Infinity;
    let inRow = false;

    for (let i = 0; i < items.length; i++) {
      const r = items[i].getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      // A card the pointer is actually level with always beats one it is not.
      // Straight-line distance alone lets a card in the row ABOVE win at the
      // left edge of a wide card, and the drop lands a row early.
      const over = py >= r.top && py <= r.bottom;
      if (inRow && !over) continue;
      const d = over ? Math.abs(px - cx) : Math.hypot(px - cx, py - cy);
      if (over && !inRow) {
        inRow = true;
        best = Infinity;
      }
      if (d < best) {
        best = d;
        insert = px < cx ? i : i + 1;
      }
    }
    setWidgets((ws) => {
      if (!ws) return ws;
      const cur = ws.findIndex((w) => w.id === id);
      if (cur < 0) return ws;
      const without = ws.filter((w) => w.id !== id);
      const target = Math.max(0, Math.min(without.length, insert));
      const next = [...without.slice(0, target), ws[cur], ...without.slice(target)];
      // A no-op keeps the same array, so nothing re-renders and nothing flickers.
      return next.every((w, k) => w.id === ws[k].id) ? ws : next;
    });
  }

  function endDrag() {
    dragId.current = null;
    setDragVisualId(null);
    setWidgets((ws) => {
      if (ws) void saveDashboard(ws, userId);
      return ws;
    });
  }

  async function suggest() {
    const ac = new AbortController();
    suggestAc.current = ac;
    setAiBusy(true);
    setAiErr(null);
    setAiStep("Reading your data…");
    setAiSteps([]);
    try {
      setProposed(
        await suggestWidgets(undefined, ac.signal, setAiStep, (s) =>
          setAiSteps((xs) => [...xs, s])
        )
      );
    } catch (e) {
      if (!isCancel(e)) setAiErr((e as Error)?.message || "Could not suggest a layout.");
    } finally {
      if (suggestAc.current === ac) suggestAc.current = null;
      setAiBusy(false);
      setAiStep("");
      // The reasoning trail (and its token count) is progress, not a result. It
      // goes the moment the layout lands, so a finished dashboard carries no
      // leftover machinery.
      setAiSteps([]);
    }
  }

  function cancelSuggest() {
    suggestAc.current?.abort("user");
    suggestAc.current = null;
    setAiBusy(false);
    setAiStep("");
  }

  useEffect(() => () => suggestAc.current?.abort("unmount"), []);

  function refreshAll() {
    setRefreshing(true);
    setRefreshTick((t) => t + 1);
    window.setTimeout(() => setRefreshing(false), 650);
  }

  const activity =
    aiBusy || aiSteps.length > 0 ? (
      <>
        {aiBusy ? (
          <ActionProgress label={aiStep || "Suggesting…"} onCancel={cancelSuggest} />
        ) : null}
      </>
    ) : null;

  /* ── loading ─────────────────────────────────────────────────────────── */
  if (widgets === null) {
    return (
      <div className="content">
        <Head />
        <div className="bento">
          {[8, 4, 6, 6].map((s, i) => (
            <section key={i} className={`card wg span-${s}`}>
              <Skeleton h={90} />
            </section>
          ))}
        </div>
      </div>
    );
  }

  /* ── suggestion preview: the saved layout is untouched until Save ────── */
  if (proposed) {
    return (
      <div className="content">
        <Head />
        <div className="card bento-preview">
          <span className="preview-tag">PREVIEW</span>
          <span className="preview-text">
            The assistant suggested <b>{proposed.length} widgets</b> from your data. Your
            current dashboard is untouched until you save this.
          </span>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => {
              persist(proposed);
              setProposed(null);
              setEditing(false);
            }}
          >
            Save this layout
          </button>
          {activity ?? (
            <button className="btn btn-sm" onClick={() => void suggest()}>
              Suggest again
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={() => setProposed(null)}>
            Discard
          </button>
        </div>
        <div className="bento">
          {proposed.map((w) => (
            <WidgetView key={w.id} w={w} editing={false} onEdit={() => {}} onDelete={() => {}} />
          ))}
        </div>
      </div>
    );
  }

  /* ── the room ────────────────────────────────────────────────────────── */
  return (
    <div className="content">
      <Head />

      {/* The toolbar only appears once there are widgets: with none, the empty
          state below is the single entry point, and Refresh / Edit layout have
          nothing to act on. */}
      {widgets.length > 0 && (
        <div className="bento-toolbar">
          {activity ?? (
            <button className="btn btn-primary btn-sm" onClick={() => void suggest()}>
              ✦ Suggest widgets
            </button>
          )}
          <button className="btn btn-sm" onClick={() => setEditor({ w: null })}>
            + Add widget
          </button>
          <button
            className="btn btn-sm bento-refresh"
            onClick={refreshAll}
            disabled={refreshing}
            title="Refresh all widgets"
          >
            <RefreshCw size={14} className={refreshing ? "is-spinning" : undefined} />
            Refresh
          </button>
          <button className="btn btn-sm" onClick={() => setLayoutOpen(true)}>
            ✦ New layout
          </button>
          <button
            className={`btn btn-sm${editing ? " is-active" : ""}`}
            onClick={() => setEditing((v) => !v)}
          >
            {editing ? "Done" : "Edit layout"}
          </button>
          <span className="bento-hint">
            {editing
              ? "drag the ⠿ handles to rearrange · edit or remove a widget"
              : `live from ${NS} · ✦ Suggest builds a layout from what you have`}
          </span>
          {editing && (
            <button className="btn btn-ghost btn-sm" onClick={() => setConfirmClear(true)}>
              Clear dashboard
            </button>
          )}
        </div>
      )}

      {aiErr && <div className="inline-error">{aiErr}</div>}
      {aiBusy && aiSteps.length > 0 && <AgentTimeline steps={aiSteps} running />}

      {widgets.length === 0 ? (
        <div className="card bento-empty">
          <span className="bento-empty-ico" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
            </svg>
          </span>
          <h3>No widgets on the {NS} dashboard yet</h3>
          <p>
            Let the assistant propose a starting layout from your <b>{NS}</b> data, or add
            widgets yourself — a number, a list, a table or a chart, each backed by one query.
          </p>
          <div className="bento-empty-actions">
            {activity ?? (
              <button className="btn btn-primary" onClick={() => void suggest()}>
                ✦ Suggest from my {NS} data
              </button>
            )}
            <button className="btn" onClick={() => setEditor({ w: null })}>
              + Add a widget
            </button>
            {/* The toolbar only exists once there are widgets, so the empty
                state carries this too — otherwise describing a layout would be
                unreachable on the one dashboard that most needs it. */}
            <button className="btn" onClick={() => setLayoutOpen(true)}>
              ✦ New layout
            </button>
          </div>
        </div>
      ) : (
        <div
          className="bento"
          ref={gridRef}
          onDragOver={editing ? onGridDragOver : undefined}
          onDrop={
            editing
              ? (e) => {
                  e.preventDefault();
                  endDrag();
                }
              : undefined
          }
        >
          {widgets.map((w) => (
            <WidgetViewSlot
              key={w.id}
              w={w}
              editing={editing}
              refresh={refreshTick}
              dragging={dragVisualId === w.id}
              onEdit={() => setEditor({ w })}
              onDelete={() => remove(w.id)}
              onDragStart={() => startDrag(w.id)}
              onDragEnd={endDrag}
            />
          ))}
        </div>
      )}

      {editor && (
        <WidgetEditor
          initial={editor.w}
          onSave={addOrUpdate}
          onClose={() => setEditor(null)}
        />
      )}

      {layoutOpen && (
        <LayoutDesigner onApply={applyLayout} onClose={() => setLayoutOpen(false)} />
      )}

      {confirmClear && (
        <ConfirmDialog
          title={`Clear the ${NS} dashboard?`}
          message="All widgets on this dashboard will be removed. You can ✦ Suggest a fresh one."
          confirmLabel="Clear"
          onConfirm={() => {
            persist([]);
            setConfirmClear(false);
          }}
          onCancel={() => setConfirmClear(false)}
        />
      )}
    </div>
  );
}

/** The FLIP wrapper needs `data-flip` on the card itself, which WidgetView owns;
 *  this passes it through without WidgetView having to know about dragging. */
function WidgetViewSlot({
  w,
  editing,
  refresh,
  dragging,
  onEdit,
  onDelete,
  onDragStart,
  onDragEnd,
}: {
  w: Widget;
  editing: boolean;
  refresh: number;
  dragging: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  return (
    <div className={`bento-slot span-${w.span}`} data-flip={w.id} data-dragging={dragging || undefined}>
      <WidgetView
        w={w}
        editing={editing}
        refresh={refresh}
        onEdit={onEdit}
        onDelete={onDelete}
        drag={{ onDragStart, onDragEnd, dragging }}
      />
    </div>
  );
}

/**
 * FLIP: when the widget order changes, tween each card from its old box to its
 * new one, so reordering reads as a push-around rather than a snap. The card
 * under the cursor is left alone — the native drag ghost follows the pointer.
 */
function useGridFlip(
  ref: RefObject<HTMLElement | null>,
  orderKey: string,
  /**
   * False while a drag is in flight.
   *
   * `dragover` fires continuously, so the order can change many times a second
   * and this effect would run on every one of them — transforming each card and
   * scheduling a frame to clear it. The next run lands before that frame does,
   * so offsets compound from stale rects: the grid flickers and cards can be
   * translated far enough to look as though they have disappeared. The reflow
   * IS the preview while dragging; FLIP is for the settle afterwards.
   */
  enabled: boolean
) {
  const prev = useRef<Map<string, DOMRect>>(new Map());
  const frames = useRef<number[]>([]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const nodes = Array.from(el.querySelectorAll<HTMLElement>("[data-flip]"));
    const cur = new Map<string, DOMRect>();
    for (const n of nodes) cur.set(n.dataset.flip!, n.getBoundingClientRect());

    // Whatever the last run scheduled is now stale — it would restore a card to
    // a position the grid has already moved on from.
    for (const id of frames.current) cancelAnimationFrame(id);
    frames.current = [];

    if (!enabled) {
      // Leave nothing mid-tween: a card holding a transform while the grid
      // reflows underneath it is exactly the "vanished card".
      for (const n of nodes) {
        if (!n.style.transform && !n.style.transition) continue;
        n.style.transition = "";
        n.style.transform = "";
      }
      prev.current = cur;
      return;
    }

    for (const n of nodes) {
      const id = n.dataset.flip!;
      const p = prev.current.get(id);
      const c = cur.get(id)!;
      if (!p || n.dataset.dragging === "true") continue;
      const dx = p.left - c.left;
      const dy = p.top - c.top;
      if (!dx && !dy) continue;
      n.style.transition = "none";
      n.style.transform = `translate(${dx}px, ${dy}px)`;
      frames.current.push(
        requestAnimationFrame(() => {
          n.style.transition = "transform .24s var(--ease)";
          n.style.transform = "";
        })
      );
    }
    prev.current = cur;
  }, [orderKey, ref, enabled]);

  // Unmounting mid-tween would otherwise leave the frames to fire against
  // detached nodes.
  useEffect(
    () => () => {
      for (const id of frames.current) cancelAnimationFrame(id);
      frames.current = [];
    },
    []
  );
}

/** Room header — the greeting, the dashboard picker, and what the room is. */
function Head() {
  return (
    <div className="room-head">
      <div className="room-kicker">Today · PMS</div>
      <div className="room-title">
        <h2>{greeting()}</h2>
        <label className="ns-pick">
          <span>Dashboard for</span>
          <span className="ns-pick-control">
            {/* One namespace, so the picker has one option — the same control
                SOAR shows on a single-namespace instance. */}
            <select
              className="input"
              value={NS}
              onChange={() => {}}
              aria-label="Dashboard namespace"
            >
              <option value={NS}>{NS}</option>
            </select>
            <ChevronDown size={13} aria-hidden />
          </span>
        </label>
      </div>
      <p className="room-sub">
        A live view of your <b>{NS}</b> data. Every figure shows the query behind it, so you
        can check where it came from.
      </p>
    </div>
  );
}
