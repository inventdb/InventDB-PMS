/**
 * Inbox — what the automations need a person for.
 *
 * Every item here was posted by a workflow run. The ones with actions are runs
 * that are *still going*: they reached a step that is not the software's
 * decision, stopped, and are holding until someone answers. That is why the
 * page leads with the count of what is waiting rather than with a list — the
 * question "is anything held up on me" has to be answerable from the doorway.
 *
 * Waiting items sort to the top and stay there whatever their age. A three-day
 * old approval is more urgent than a fresh notice that something succeeded, and
 * a purely chronological inbox buries exactly the thing this page exists for.
 */
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Bell, CheckCircle2, Clock, Inbox as InboxIcon, Search } from "lucide-react";

import { Alert, EmptyState, Spinner } from "../components/ui";
import { errorMessage } from "../api/client";
import {
  isWaiting,
  notificationState,
  useMarkNotificationRead,
  useNotifications,
} from "../api/hooks";
import { ApprovalCard, NothingSelected } from "../inbox/ApprovalCard";
import { bodySnippet } from "../inbox/NotificationBody";
import { IntakeSetup } from "../inbox/IntakeSetup";
import { fmtDateTime } from "../workflows/WorkflowDetail";
import type { AppNotification } from "../types";

/** Waiting first, then most recent. */
function ordered(notes: AppNotification[]): AppNotification[] {
  return [...notes].sort((a, b) => {
    const rank = Number(isWaiting(b)) - Number(isWaiting(a));
    if (rank) return rank;
    return String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""));
  });
}

export default function Inbox() {
  const [params, setParams] = useSearchParams();
  const query = useNotifications();
  const markRead = useMarkNotificationRead();
  const [search, setSearch] = useState("");

  const selectedId = params.get("id");
  const notes = useMemo(() => ordered(query.data?.notifications ?? []), [query.data]);
  const waiting = useMemo(() => notes.filter(isWaiting), [notes]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return notes;
    return notes.filter((n) =>
      `${n.title} ${bodySnippet(n.body, 2000)}`.toLowerCase().includes(needle)
    );
  }, [notes, search]);

  // What is on screen, held separately from the URL.
  //
  // `?id=` means "this one, specifically" — a link someone sent, or a row that
  // was clicked — so arriving without one must not stamp a default into the
  // address bar. But the default cannot be recomputed on every render either:
  // answering an approval moves it out of the waiting group, the list reorders,
  // and "whatever is top" would swap the panel to a *different* approval at the
  // exact moment you wanted to read the outcome of your own decision. So the
  // first thing shown gets pinned, and only an explicit pick moves it.
  const [pinned, setPinned] = useState<string | null>(selectedId);
  useEffect(() => {
    if (selectedId) setPinned(selectedId);
  }, [selectedId]);

  const selected = notes.find((n) => n._id === pinned) ?? notes[0] ?? null;

  useEffect(() => {
    if (selected && pinned !== selected._id) setPinned(selected._id);
  }, [selected, pinned]);

  function pick(id: string) {
    setPinned(id);
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("id", id);
      return next;
    });
  }

  // Opening one marks it seen. Fire-and-forget: a failed read receipt is not
  // worth an error in front of someone reading an approval.
  useEffect(() => {
    if (selected && !selected.read_at && !markRead.isPending) {
      markRead.mutate(selected._id);
    }
    // Only when the selected item changes — not on every mutation state tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?._id]);

  if (query.isLoading) return <Spinner />;
  if (query.isError) {
    return (
      <div className="content">
        <Alert kind="error">{errorMessage(query.error)}</Alert>
      </div>
    );
  }

  return (
    <div className="content">
      <div className="page-head">
        <div className="titles">
          <h2>Inbox</h2>
          <p>
            Decisions your automations are holding for you, and what they have done on their
            own. Answering a decision resumes the workflow run that is waiting on it.
          </p>
        </div>
        <div className="actions">
          <span className={`count-pill ${waiting.length ? "is-warn" : ""}`}>
            <Clock size={13} style={{ verticalAlign: "-2px", marginRight: 6 }} />
            {waiting.length === 0
              ? "Nothing waiting on you"
              : `${waiting.length} waiting on you`}
          </span>
        </div>
      </div>

      <IntakeSetup />

      {notes.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<InboxIcon size={26} />}
            title="Nothing here yet"
            message="When a workflow needs a decision — which contractor to send, whether to spend — it pauses and posts it here. Runs that finish on their own leave a note too."
          />
        </div>
      ) : (
        <div className="nb-split">
          <aside className="nb-list" aria-label="Notifications">
            <div className="nb-search">
              <Search size={14} />
              <input
                className="input"
                type="search"
                value={search}
                placeholder="Search the inbox…"
                aria-label="Search the inbox"
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
            {selected ? <ApprovalCard key={selected._id} notification={selected} /> : <NothingSelected />}
          </div>
        </div>
      )}
    </div>
  );
}
