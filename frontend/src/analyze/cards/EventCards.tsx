/**
 * Calendar composers.
 *
 * `create_event` emits an `event_compose` step; `bulk_create_events` emits a
 * `bulk_events` step with many drafts. Both render as an editable review
 * surface — nothing reaches anyone's calendar until the Save button here is
 * clicked, and the outcome is stamped back onto the thread.
 */
import { Fragment, useState } from "react";
import { CalendarDays } from "lucide-react";

import { errorMessage } from "../../api/client";
import { bulkCreateEvents, createEvent } from "../api";
import { MONEY_HINT, money, titleize } from "../helpers";
import { ActionProgress } from "../ui";
import { ScrollX } from "../../components/ScrollX";

function connectionAwareError(err: unknown, fallback: string): string {
  const message = errorMessage(err) || fallback;
  return /not connected|connect/i.test(message)
    ? "Google Calendar isn’t connected on this InventDB instance — connect it in SOAR under Engine → Connections, then try again."
    : message;
}

export interface EventDraft {
  summary?: string;
  description?: string;
  location?: string;
  /** RFC 3339 datetime, or YYYY-MM-DD when all-day. */
  start?: string;
  end?: string;
  time_zone?: string;
  all_day?: boolean;
  attendees?: string[];
  calendar_id?: string;
  add_meet?: boolean;
  summary_text?: string;
  saved?: boolean;
  htmlLink?: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** RFC 3339 → the value a datetime-local / date input expects (local time). */
function toLocalInput(value: string | undefined, allDay: boolean): string {
  if (!value) return "";
  if (allDay) return value.slice(0, 10);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value.slice(0, 16);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Input value → what the server wants: a date for all-day, else local ISO. */
function fromLocalInput(value: string, allDay: boolean): string {
  if (!value) return "";
  if (allDay) return value.slice(0, 10);
  return value.length === 16 ? `${value}:00` : value;
}

const browserTz = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
};

export function CalendarEventCard({
  data,
  onSaved,
}: {
  data: EventDraft;
  onSaved?: (patch: Partial<EventDraft>) => void;
}) {
  const [allDay, setAllDay] = useState(!!data.all_day);
  const [summary, setSummary] = useState(String(data.summary || ""));
  const [start, setStart] = useState(toLocalInput(data.start, !!data.all_day));
  const [end, setEnd] = useState(toLocalInput(data.end, !!data.all_day));
  const [tz, setTz] = useState(String(data.time_zone || browserTz()));
  const [attendees, setAttendees] = useState((data.attendees || []).join(", "));
  const [location, setLocation] = useState(String(data.location || ""));
  const [description, setDescription] = useState(String(data.description || ""));
  const [addMeet, setAddMeet] = useState(!!data.add_meet);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ link?: string } | null>(
    data.saved ? { link: data.htmlLink } : null
  );
  const done = !!saved;

  /** Keep the date inputs valid as the all-day toggle flips their type. */
  function toggleAllDay(next: boolean) {
    setStart((s) => (next ? s.slice(0, 10) : s.length === 10 ? `${s}T09:00` : s));
    setEnd((e) => (next ? e.slice(0, 10) : e.length === 10 ? `${e}T10:00` : e));
    setAllDay(next);
  }

  async function save() {
    if (!summary.trim()) {
      setError("Give the event a title.");
      return;
    }
    if (!start) {
      setError("Set a start time.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await createEvent({
        summary: summary.trim(),
        description: description.trim() || undefined,
        location: location.trim() || undefined,
        start: fromLocalInput(start, allDay),
        end: fromLocalInput(end || start, allDay),
        all_day: allDay,
        // A timed event must carry an IANA zone or Google rejects it outright.
        time_zone: allDay ? undefined : tz.trim() || undefined,
        attendees: attendees.split(",").map((s) => s.trim()).filter(Boolean),
        calendar_id: data.calendar_id || undefined,
        add_meet: addMeet,
      });
      const link = result?.html_link || result?.htmlLink || "";
      setSaved({ link });
      onSaved?.({ saved: true, htmlLink: link });
    } catch (err) {
      setError(connectionAwareError(err, "Could not create the event"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={`an-card ${done ? "is-done" : ""}`}>
      <div className="an-card-head">
        <span className="an-mark" aria-hidden>
          <CalendarDays size={17} />
        </span>
        <div className="an-card-titles">
          <div className="an-card-title">
            Calendar — {done ? "saved" : "review & save"}
          </div>
          {data.summary_text && <div className="an-note">{data.summary_text}</div>}
        </div>
        {done ? (
          <span className="an-tag is-good">SAVED ✓</span>
        ) : (
          <span className="an-tag is-warn">NOT SAVED YET</span>
        )}
      </div>

      <label className="an-field">
        <span>Title</span>
        <input
          className="input"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          disabled={done}
        />
      </label>

      <label className="an-check">
        <input
          type="checkbox"
          checked={allDay}
          onChange={(e) => toggleAllDay(e.target.checked)}
          disabled={done}
        />
        All-day event
      </label>

      <div className="an-field-grid">
        <label className="an-field">
          <span>Starts</span>
          <input
            className="input"
            type={allDay ? "date" : "datetime-local"}
            value={start}
            onChange={(e) => setStart(e.target.value)}
            disabled={done}
          />
        </label>
        <label className="an-field">
          <span>Ends</span>
          <input
            className="input"
            type={allDay ? "date" : "datetime-local"}
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            disabled={done}
          />
        </label>
      </div>

      {!allDay && (
        <label className="an-field">
          <span>Time zone</span>
          <input
            className="input"
            value={tz}
            onChange={(e) => setTz(e.target.value)}
            placeholder="America/New_York"
            disabled={done}
          />
        </label>
      )}

      <label className="an-field">
        <span>Guests (comma-separated emails)</span>
        <input
          className="input"
          value={attendees}
          onChange={(e) => setAttendees(e.target.value)}
          disabled={done}
        />
      </label>
      <label className="an-field">
        <span>Where (optional)</span>
        <input
          className="input"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          disabled={done}
        />
      </label>
      <label className="an-field">
        <span>Notes (optional)</span>
        <textarea
          className="input an-textarea"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={done}
        />
      </label>
      {!done && (
        <label className="an-check">
          <input
            type="checkbox"
            checked={addMeet}
            onChange={(e) => setAddMeet(e.target.checked)}
          />
          Add a Google Meet link
        </label>
      )}

      {error && <div className="alert error">{error}</div>}

      {done ? (
        <p className="an-note an-good">
          <b>Added</b> to your calendar — invites go out through Google.{" "}
          {saved?.link && (
            <a href={saved.link} target="_blank" rel="noreferrer">
              Open in Google Calendar →
            </a>
          )}
        </p>
      ) : (
        <div className="an-card-actions">
          <button
            className="btn btn-primary btn-sm"
            disabled={saving || !summary.trim() || !start}
            onClick={() => void save()}
          >
            {saving ? "Saving…" : "Save event"}
          </button>
          <span className="an-note">
            Runs as you · nothing is created until you click
          </span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- bulk events

export interface BulkEvent {
  summary?: string;
  description?: string;
  location?: string;
  start?: string;
  end?: string;
  time_zone?: string;
  all_day?: boolean;
  attendees?: string[];
  calendar_id?: string;
  add_meet?: boolean;
  [key: string]: unknown;
}
export interface BulkEventResult {
  summary: string;
  ok: boolean;
  html_link?: string;
  error?: string;
}
export interface BulkEventsData {
  events?: BulkEvent[];
  columns?: string[];
  summary_text?: string;
  calendar_id?: string;
  saved?: boolean;
  selected?: number[];
  results?: BulkEventResult[];
}

function whenOf(event: BulkEvent): string {
  if (!event.start) return "—";
  if (event.all_day) return event.start.slice(0, 10);
  const d = new Date(event.start);
  if (Number.isNaN(d.getTime())) return event.start;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function cellText(value: unknown, key: string): string {
  if (value == null) return "—";
  if (Array.isArray(value)) return value.length ? String(value.length) : "—";
  if (typeof value === "number")
    return MONEY_HINT.test(key) ? money(value) : value.toLocaleString();
  return String(value);
}

export function BulkEventsCard({
  data,
  onDone,
}: {
  data: BulkEventsData;
  onDone?: (patch: Partial<BulkEventsData>) => void;
}) {
  const events = data.events || [];
  const columns = (data.columns || []).filter(
    (c) => !["summary", "start", "end", "description"].includes(c)
  );

  const [saved, setSaved] = useState(!!data.saved);
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(data.selected ?? events.map((_, i) => i))
  );
  const [expanded, setExpanded] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [results, setResults] = useState<Record<number, BulkEventResult>>(() => {
    const map: Record<number, BulkEventResult> = {};
    if (data.saved && Array.isArray(data.results) && Array.isArray(data.selected)) {
      data.selected.forEach((i, k) => {
        if (data.results![k]) map[i] = data.results![k];
      });
    }
    return map;
  });

  const allOn = events.length > 0 && selected.size === events.length;
  const toggle = (i: number) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  const setAll = (on: boolean) =>
    setSelected(on ? new Set(events.map((_, i) => i)) : new Set());

  async function save() {
    const indexes = [...selected].sort((a, b) => a - b);
    if (!indexes.length) {
      setError("Select at least one event.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const payload = indexes.map((i) => {
        const e = events[i];
        return {
          summary: String(e.summary || ""),
          description: e.description,
          location: e.location,
          start: e.start,
          end: e.end || e.start,
          all_day: !!e.all_day,
          // The model's zone first, the browser's as a fallback — a timed event
          // with a naive datetime is rejected outright by Google.
          time_zone: e.all_day ? undefined : e.time_zone || browserTz() || undefined,
          attendees: e.attendees || [],
          calendar_id: e.calendar_id || data.calendar_id || undefined,
          add_meet: !!e.add_meet,
        };
      });
      const rows = await bulkCreateEvents(payload);
      const byIndex: Record<number, BulkEventResult> = {};
      indexes.forEach((i, k) => {
        byIndex[i] = rows[k] || { summary: payload[k].summary, ok: true };
      });
      setResults(byIndex);
      setSaved(true);
      setExpanded(null);
      onDone?.({
        saved: true,
        selected: indexes,
        results: indexes.map((i) => byIndex[i]),
      });
    } catch (err) {
      setError(connectionAwareError(err, "Could not create the events"));
    } finally {
      setSaving(false);
    }
  }

  const savedCount = Object.values(results).filter((r) => r.ok).length;
  const failCount = Object.values(results).filter((r) => !r.ok).length;
  const colSpan = (saved ? 0 : 1) + 3 + columns.length;

  return (
    <div className="an-card">
      <div className="an-card-head">
        <span className="an-mark" aria-hidden>
          <CalendarDays size={17} />
        </span>
        <div className="an-card-titles">
          <div className="an-card-title">
            Calendar, bulk — {saved ? "saved" : "review & save"}
          </div>
          <div className="an-note">
            {events.length} event{events.length === 1 ? "" : "s"}
          </div>
        </div>
        {saved ? (
          <span className="an-tag is-good">
            SAVED {savedCount}
            {failCount ? ` · ${failCount} failed` : ""} ✓
          </span>
        ) : (
          <span className="an-tag is-warn">NOT SAVED YET</span>
        )}
      </div>

      {data.summary_text && <p className="an-note">{data.summary_text}</p>}

      {!saved && (
        <div className="an-select-row">
          <span className="an-note">
            <b>{selected.size}</b> of {events.length} selected
          </span>
          <button className="an-linkbtn" onClick={() => setAll(true)} disabled={allOn}>
            Select all
          </button>
          <button
            className="an-linkbtn"
            onClick={() => setAll(false)}
            disabled={selected.size === 0}
          >
            Clear
          </button>
        </div>
      )}

      <ScrollX className="an-table-wrap">
        <table className="an-table">
          <thead>
            <tr>
              {!saved && (
                <th style={{ width: 30 }}>
                  <input
                    type="checkbox"
                    checked={allOn}
                    onChange={(e) => setAll(e.target.checked)}
                    aria-label="Select all events"
                  />
                </th>
              )}
              <th>Event</th>
              <th>When</th>
              {columns.map((c) => (
                <th key={c}>{titleize(c)}</th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {events.map((event, i) => {
              const result = results[i];
              return (
                <Fragment key={i}>
                  <tr className={saved && !result ? "is-muted" : undefined}>
                    {!saved && (
                      <td>
                        <input
                          type="checkbox"
                          checked={selected.has(i)}
                          onChange={() => toggle(i)}
                          aria-label={`Select ${event.summary}`}
                        />
                      </td>
                    )}
                    <td>
                      <div className="an-strong">{event.summary || "(untitled)"}</div>
                      {event.location && <div className="an-note">{event.location}</div>}
                    </td>
                    <td className="an-nowrap">
                      {whenOf(event)}
                      {event.all_day && <span className="an-note"> · all-day</span>}
                    </td>
                    {columns.map((c) => (
                      <td key={c} className="an-num">
                        {cellText(event[c], c)}
                      </td>
                    ))}
                    <td className="an-row-end">
                      {result ? (
                        result.ok ? (
                          result.html_link ? (
                            <a
                              className="an-tag is-good"
                              href={result.html_link}
                              target="_blank"
                              rel="noreferrer"
                            >
                              saved ✓
                            </a>
                          ) : (
                            <span className="an-tag is-good">saved ✓</span>
                          )
                        ) : (
                          <span className="an-tag is-bad" title={result.error || ""}>
                            failed
                          </span>
                        )
                      ) : (
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => setExpanded((e) => (e === i ? null : i))}
                        >
                          {expanded === i ? "Hide" : "Details"}
                        </button>
                      )}
                    </td>
                  </tr>
                  {expanded === i && !result && (
                    <tr>
                      <td colSpan={colSpan} className="an-expand-cell">
                        <div className="an-preview">
                          {event.description && <p>{event.description}</p>}
                          <p className="an-note">
                            Ends{" "}
                            {event.end
                              ? whenOf({ ...event, start: event.end })
                              : "—"}
                            {event.time_zone && !event.all_day
                              ? ` · ${event.time_zone}`
                              : ""}
                          </p>
                          {!!event.attendees?.length && (
                            <p className="an-note">
                              Guests: {event.attendees.join(", ")}
                            </p>
                          )}
                          {event.add_meet && (
                            <p className="an-note">Includes a Google Meet link</p>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </ScrollX>

      {error && <div className="alert error">{error}</div>}

      {saved ? (
        <p className="an-note an-good">
          <b>Added {savedCount}</b> to your calendar
          {failCount ? ` · ${failCount} failed` : ""} — invites go out through Google.
        </p>
      ) : (
        <div className="an-card-actions">
          {saving ? (
            <ActionProgress
              label={`Adding ${selected.size} event${selected.size === 1 ? "" : "s"}…`}
            />
          ) : (
            <>
              <button
                className="btn btn-primary btn-sm"
                disabled={selected.size === 0}
                onClick={() => void save()}
              >
                Save {selected.size} selected
              </button>
              <span className="an-note">
                Runs as you · review any row · nothing is created until you click
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
