/**
 * Notifications — what the automations need a person for.
 *
 * This sits at the top of the Workflows page for the same reason SOAR's Operate
 * room puts it beside the workflow list: a parked run *is* a workflow, mid-flight,
 * and the question "is anything held up on me" belongs in the same place as
 * "what is running". Splitting them onto separate pages means the run and the
 * decision it is waiting on live in two rooms.
 *
 * Items with actions are runs that stopped at a step that is not the software's
 * decision. Those sort to the top and stay there whatever their age: a
 * three-day-old approval matters more than a fresh notice that something
 * succeeded, and a purely chronological list buries exactly the thing this
 * panel exists for.
 */
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Bell, CheckCircle2, Clock, Search, Trash2 } from "lucide-react";

import { Alert, Spinner } from "../components/ui";
import { ConfirmDialog } from "../components/Modal";
import { useToast } from "../components/Toast";
import { errorMessage } from "../api/client";
import {
  isWaiting,
  notificationState,
  useDismissNotification,
  useMarkNotificationRead,
  useNotifications,
} from "../api/hooks";
import { fmtDateTime } from "../workflows/WorkflowDetail";
import type { AppNotification } from "../types";
import { ApprovalCard } from "./ApprovalCard";
import { bodySnippet } from "./NotificationBody";

/** Waiting first, then most recent. */
function ordered(notes: AppNotification[]): AppNotification[] {
  return [...notes].sort((a, b) => {
    const rank = Number(isWaiting(b)) - Number(isWaiting(a));
    if (rank) return rank;
    return String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""));
  });
}

export function NotificationsPanel() {
  // `note`, not `id`: this page already spends `?id=` on opening a workflow,
  // and one parameter cannot mean two things.
  const [params, setParams] = useSearchParams();
  const query = useNotifications();
  const markRead = useMarkNotificationRead();
  const dismiss = useDismissNotification();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [confirmingClear, setConfirmingClear] = useState(false);

  const selectedId = params.get("note");
  const notes = useMemo(() => ordered(query.data?.notifications ?? []), [query.data]);
  const waiting = useMemo(() => notes.filter(isWaiting), [notes]);
  // Everything dealt with — answered decisions and plain notices. Never
  // something still holding a run open.
  const clearable = useMemo(() => notes.filter((n) => !isWaiting(n)), [notes]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return notes;
    return notes.filter((n) =>
      `${n.title} ${bodySnippet(n.body, 2000)}`.toLowerCase().includes(needle)
    );
  }, [notes, search]);

  // What is on screen, held separately from the URL.
  //
  // `?note=` means "this one, specifically" — a link someone sent, or a row
  // that was clicked — so arriving without one must not stamp a default into
  // the address bar. But the default cannot be recomputed on every render
  // either: answering an approval moves it out of the waiting group, the list
  // reorders, and "whatever is top" would swap the panel to a *different*
  // approval at the exact moment you wanted to read the outcome of your own
  // decision. So the first thing shown gets pinned, and only an explicit pick
  // moves it.
  const [pinned, setPinned] = useState<string | null>(selectedId);
  useEffect(() => {
    if (selectedId) setPinned(selectedId);
  }, [selectedId]);

  const selected = notes.find((n) => n._id === pinned) ?? notes[0] ?? null;

  useEffect(() => {
    if (selected && pinned !== selected._id) setPinned(selected._id);
  }, [selected, pinned]);

  // Opening one marks it seen. Fire-and-forget: a failed read receipt is not
  // worth an error in front of someone reading an approval.
  useEffect(() => {
    if (selected && !selected.read_at && !markRead.isPending) {
      markRead.mutate(selected._id);
    }
    // Only when the selected item changes — not on every mutation state tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?._id]);

  function pick(id: string) {
    setPinned(id);
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("note", id);
      return next;
    });
  }

  /**
   * Clear everything that has been dealt with.
   *
   * Only answered decisions and informational notes — never something still
   * waiting. Clearing an outstanding decision would hide a run that is still
   * parked, leaving nothing anywhere in the app to say it is stuck.
   */
  async function clearAnswered() {
    const ids = clearable.map((n) => n._id);
    let failed = 0;
    for (const id of ids) {
      try {
        await dismiss.mutateAsync(id);
      } catch {
        failed += 1;
      }
    }
    setConfirmingClear(false);
    const done = ids.length - failed;
    if (failed) toast.error(`Cleared ${done} of ${ids.length}. ${failed} could not be cleared.`);
    else toast.success(`Cleared ${done} notification${done === 1 ? "" : "s"}.`);
  }

  if (query.isLoading) return <Spinner />;
  if (query.isError) {
    return <Alert kind="error">{errorMessage(query.error)}</Alert>;
  }

  // Nothing has ever parked. A full empty state here would put a large box
  // about a thing that has not happened above the workflows that have.
  if (!notes.length) {
    return (
      <section className="nb-panel is-empty" aria-label="Notifications">
        <div className="nb-panel-head">
          <Bell size={15} />
          <h3>Notifications</h3>
          <span className="report-note">
            When a workflow needs a decision it pauses and posts it here.
          </span>
        </div>
      </section>
    );
  }

  return (
    <section className="nb-panel" aria-label="Notifications">
      <div className="nb-panel-head">
        <Bell size={15} />
        <h3>Notifications</h3>
        {/* Labelled, and not a pill. A bare digit beside a bell reads as "one
            thing needs you" wherever it appears — so a total that included
            answered items looked like an alert that could not be cleared. The
            amber badge below is the only thing here allowed to mean that. */}
        <span className="nb-panel-count">
          {notes.length} notification{notes.length === 1 ? "" : "s"}
        </span>
        {waiting.length > 0 && (
          <span className="badge warn">{waiting.length} waiting on you</span>
        )}
        {clearable.length > 0 ? (
          <button
            className="btn btn-ghost btn-sm nb-panel-clear"
            disabled={dismiss.isPending}
            onClick={() => setConfirmingClear(true)}
          >
            <Trash2 size={13} />{" "}
            {dismiss.isPending ? "Clearing…" : `Clear ${clearable.length} answered`}
          </button>
        ) : (
          <span className="report-note nb-panel-blurb">
            Answering a decision resumes the workflow run that is waiting on it.
          </span>
        )}
      </div>

      <div className="nb-split">
        <aside className="nb-list" aria-label="All notifications">
          <div className="nb-search">
            <Search size={14} />
            <input
              className="input"
              type="search"
              value={search}
              placeholder="Search notifications…"
              aria-label="Search notifications"
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {visible.length === 0 ? (
            <p className="report-note nb-no-match">Nothing matches “{search.trim()}”.</p>
          ) : (
            visible.map((n) => {
              const state = notificationState(n);
              return (
                <button
                  key={n._id}
                  type="button"
                  className={`nb-row ${selected?._id === n._id ? "active" : ""} ${
                    !n.read_at ? "is-unread" : ""
                  }`}
                  aria-current={selected?._id === n._id}
                  onClick={() => pick(n._id)}
                >
                  <span className={`nb-row-ico is-${state}`}>
                    {state === "waiting" ? (
                      <Clock size={14} />
                    ) : state === "done" ? (
                      <CheckCircle2 size={14} />
                    ) : (
                      <Bell size={14} />
                    )}
                  </span>
                  <span className="nb-row-text">
                    <span className="nb-row-title">{n.title}</span>
                    <span className="nb-row-sub">{bodySnippet(n.body)}</span>
                    <span className="nb-row-when">{fmtDateTime(n.created_at)}</span>
                  </span>
                  {state === "waiting" && <span className="badge warn">Needs you</span>}
                </button>
              );
            })
          )}
        </aside>

        <div className="nb-detail">
          {selected && <ApprovalCard key={selected._id} notification={selected} />}
        </div>
      </div>

      {confirmingClear && (
        <ConfirmDialog
          title={`Clear ${clearable.length} notification${clearable.length === 1 ? "" : "s"}?`}
          message="Only the ones already dealt with. Anything still waiting on you stays, and no run is affected either way — the history lives with the runs."
          confirmLabel={`Clear ${clearable.length}`}
          busy={dismiss.isPending}
          onConfirm={clearAnswered}
          onCancel={() => setConfirmingClear(false)}
        />
      )}
    </section>
  );
}
