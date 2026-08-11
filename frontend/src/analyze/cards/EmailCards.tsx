/**
 * Email composers.
 *
 * `send_email` emits an `email_compose` step; `bulk_send_email` emits a
 * `bulk_email` step with a recipient list and a per-recipient template (either
 * inline `{{key}}` HTML, or a saved report rendered per row). Both render here
 * as an editable review surface — and nothing leaves the building until the
 * Send button on the card is clicked.
 *
 * After sending, the card stays put in a locked, sent state; that outcome is
 * stamped back onto the thread so reloading shows what actually went out.
 */
import { Fragment, useEffect, useState } from "react";
import { Mail } from "lucide-react";

import { errorMessage } from "../../api/client";
import { bulkSendEmail, renderReportTemplate, sendEmail } from "../api";
import { MONEY_HINT, money, titleize } from "../helpers";
import { ActionProgress } from "../ui";

/** Gmail isn't wired up on every instance; say so in plain words when it isn't. */
function connectionAwareError(err: unknown, fallback: string): string {
  const message = errorMessage(err) || fallback;
  return /not connected|connect/i.test(message)
    ? "Gmail isn’t connected on this InventDB instance — connect it in SOAR under Engine → Connections, then try again."
    : message;
}

export interface EmailDraft {
  to?: string;
  cc?: string[];
  bcc?: string[];
  subject?: string;
  body_html?: string;
  sent?: boolean;
  sentTo?: string;
}

export function GmailComposeCard({
  data,
  onSent,
}: {
  data: EmailDraft;
  onSent?: (to: string) => void;
}) {
  const [to, setTo] = useState(String(data?.to || ""));
  const [cc, setCc] = useState((data?.cc || []).join(", "));
  const [bcc, setBcc] = useState((data?.bcc || []).join(", "));
  const [subject, setSubject] = useState(String(data?.subject || ""));
  const [body, setBody] = useState(String(data?.body_html || ""));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Seeded from the persisted payload, so a reloaded thread shows it as sent.
  const [sent, setSent] = useState<string | null>(
    data?.sent ? String(data?.sentTo || data?.to || "") : null
  );
  const done = !!sent;

  async function send() {
    if (!to.trim()) {
      setError("Add a recipient.");
      return;
    }
    if (!subject.trim()) {
      setError("Add a subject.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      await sendEmail({
        to: to.trim(),
        cc: cc.split(",").map((s) => s.trim()).filter(Boolean),
        bcc: bcc.split(",").map((s) => s.trim()).filter(Boolean),
        subject: subject.trim(),
        body_html: body,
      });
      setSent(to.trim());
      onSent?.(to.trim());
    } catch (err) {
      setError(connectionAwareError(err, "Send failed"));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className={`an-card ${done ? "is-done" : ""}`}>
      <div className="an-card-head">
        <span className="an-mark" aria-hidden>
          <Mail size={17} />
        </span>
        <div className="an-card-titles">
          <div className="an-card-title">
            Email — {done ? "sent" : "review & send"}
          </div>
        </div>
        {done ? (
          <span className="an-tag is-good">SENT ✓</span>
        ) : (
          <span className="an-tag is-warn">NOT SENT YET</span>
        )}
      </div>

      <label className="an-field">
        <span>To</span>
        <input
          className="input"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="recipient@example.com"
          disabled={done}
        />
      </label>
      <div className="an-field-grid">
        <label className="an-field">
          <span>Cc (comma-separated)</span>
          <input
            className="input"
            value={cc}
            onChange={(e) => setCc(e.target.value)}
            disabled={done}
          />
        </label>
        <label className="an-field">
          <span>Bcc (comma-separated)</span>
          <input
            className="input"
            value={bcc}
            onChange={(e) => setBcc(e.target.value)}
            disabled={done}
          />
        </label>
      </div>
      <label className="an-field">
        <span>Subject</span>
        <input
          className="input"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          disabled={done}
        />
      </label>
      <div className="an-field">
        <span>Message</span>
        {done ? (
          <div
            className="an-email-preview"
            // The body is HTML the agent composed for a mail client, and it is
            // shown here exactly as it will arrive. It is rendered only after
            // the user has already sent it, from the payload they reviewed.
            dangerouslySetInnerHTML={{
              __html: body || "<p>(empty)</p>",
            }}
          />
        ) : (
          <textarea
            className="input an-email-editor"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            spellCheck={false}
          />
        )}
      </div>

      {error && <div className="alert error">{error}</div>}

      {done ? (
        <p className="an-note an-good">
          <b>Sent</b> to {sent} through the connected mailbox — kept here for your
          records.
        </p>
      ) : (
        <div className="an-card-actions">
          <button
            className="btn btn-primary btn-sm"
            disabled={sending || !to.trim() || !subject.trim()}
            onClick={() => void send()}
          >
            {sending ? "Sending…" : "Send email"}
          </button>
          <span className="an-note">
            Runs as you · edit anything above · nothing sends until you click
          </span>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ bulk send

export interface BulkRecipient {
  email: string;
  displayLabel?: string;
  params?: Record<string, unknown>;
  [key: string]: unknown;
}
export interface BulkRowResult {
  to: string;
  ok: boolean;
  error?: string;
}
export interface BulkEmailData {
  summary?: string;
  subject_template?: string;
  body_html_template?: string;
  report_template_id?: string;
  recipients?: BulkRecipient[];
  columns?: string[];
  sent?: boolean;
  selected?: number[];
  results?: BulkRowResult[];
}

const fieldsOf = (r: BulkRecipient): Record<string, unknown> => ({
  ...(r || {}),
  ...((r?.params as Record<string, unknown>) || {}),
});

/**
 * Substitute both `{{key}}` and `{key}`. The agent is told to use the double
 * form but frequently emits the single one, which would otherwise ship literal
 * "{rent}" to a tenant. Double braces are replaced unconditionally; single
 * braces only for keys the recipient actually has, so braces inside CSS or JS in
 * the body are left alone.
 */
function substitute(template: string, values: Record<string, unknown>): string {
  return String(template || "")
    .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => {
      const v = values[k];
      return v == null ? "" : String(v);
    })
    .replace(/\{\s*([\w.]+)\s*\}/g, (whole, k) =>
      Object.prototype.hasOwnProperty.call(values, k) ? String(values[k] ?? "") : whole
    );
}

function cellText(value: unknown, key: string): string {
  if (value == null) return "—";
  if (typeof value === "number")
    return MONEY_HINT.test(key) ? money(value) : value.toLocaleString();
  return String(value);
}

export function BulkEmailCard({
  data,
  onDone,
}: {
  data: BulkEmailData;
  onDone?: (patch: Partial<BulkEmailData>) => void;
}) {
  const recipients = data.recipients || [];
  const columns = (data.columns || []).filter(
    (c) => c !== "email" && c !== "displayLabel"
  );
  const usesSavedReport = !!data.report_template_id;

  const [sent, setSent] = useState(!!data.sent);
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(data.selected ?? recipients.map((_, i) => i))
  );
  const [expanded, setExpanded] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<Record<number, BulkRowResult>>(() => {
    const map: Record<number, BulkRowResult> = {};
    if (data.sent && Array.isArray(data.results) && Array.isArray(data.selected)) {
      data.selected.forEach((i, k) => {
        if (data.results![k]) map[i] = data.results![k];
      });
    }
    return map;
  });

  const allOn = recipients.length > 0 && selected.size === recipients.length;
  const toggle = (i: number) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  const setAll = (on: boolean) =>
    setSelected(on ? new Set(recipients.map((_, i) => i)) : new Set());

  /** Build one recipient's final email — the same path preview and send use. */
  async function resolveEmail(i: number) {
    const recipient = recipients[i];
    const values = fieldsOf(recipient);
    const subject = substitute(data.subject_template || "", values);
    const body = usesSavedReport
      ? await renderReportTemplate(data.report_template_id!, values)
      : substitute(data.body_html_template || "", values);
    return { to: String(recipient.email || ""), subject, body_html: body };
  }

  async function send() {
    const indexes = [...selected].sort((a, b) => a - b);
    if (!indexes.length) {
      setError("Select at least one recipient.");
      return;
    }
    setError(null);
    setProgress({ done: 0, total: indexes.length });
    try {
      // Two phases: build each message (a saved report is re-rendered per
      // recipient, which takes a moment each), then one bulk send.
      const emails: { to: string; subject: string; body_html: string }[] = [];
      for (let k = 0; k < indexes.length; k++) {
        emails.push(await resolveEmail(indexes[k]));
        setProgress({ done: k + 1, total: indexes.length });
      }
      const rows = await bulkSendEmail(emails);
      const byIndex: Record<number, BulkRowResult> = {};
      indexes.forEach((i, k) => {
        byIndex[i] = rows[k] || { to: emails[k].to, ok: true };
      });
      setResults(byIndex);
      setSent(true);
      setExpanded(null);
      onDone?.({ sent: true, selected: indexes, results: indexes.map((i) => byIndex[i]) });
    } catch (err) {
      setError(connectionAwareError(err, "Bulk send failed"));
    } finally {
      setProgress(null);
    }
  }

  const sentCount = Object.values(results).filter((r) => r.ok).length;
  const failCount = Object.values(results).filter((r) => !r.ok).length;
  const colSpan = (sent ? 0 : 1) + 2 + columns.length;

  return (
    <div className="an-card">
      <div className="an-card-head">
        <span className="an-mark" aria-hidden>
          <Mail size={17} />
        </span>
        <div className="an-card-titles">
          <div className="an-card-title">
            Bulk email — {sent ? "sent" : "review & send"}
          </div>
          <div className="an-note">
            {recipients.length} recipient{recipients.length === 1 ? "" : "s"}
            {usesSavedReport ? " · each gets a saved report rendered for them" : ""}
          </div>
        </div>
        {sent ? (
          <span className="an-tag is-good">
            SENT {sentCount}
            {failCount ? ` · ${failCount} failed` : ""} ✓
          </span>
        ) : (
          <span className="an-tag is-warn">NOT SENT YET</span>
        )}
      </div>

      {data.summary && <p className="an-note">{data.summary}</p>}
      <p className="an-note">
        <b>Subject</b> {data.subject_template || "(none)"}
      </p>

      {!sent && (
        <div className="an-select-row">
          <span className="an-note">
            <b>{selected.size}</b> of {recipients.length} selected
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

      <div className="an-table-wrap">
        <table className="an-table">
          <thead>
            <tr>
              {!sent && (
                <th style={{ width: 30 }}>
                  <input
                    type="checkbox"
                    checked={allOn}
                    onChange={(e) => setAll(e.target.checked)}
                    aria-label="Select all recipients"
                  />
                </th>
              )}
              <th>Recipient</th>
              {columns.map((c) => (
                <th key={c}>{titleize(c)}</th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {recipients.map((recipient, i) => {
              const result = results[i];
              return (
                <Fragment key={i}>
                  <tr className={sent && !result ? "is-muted" : undefined}>
                    {!sent && (
                      <td>
                        <input
                          type="checkbox"
                          checked={selected.has(i)}
                          onChange={() => toggle(i)}
                          aria-label={`Select ${recipient.email}`}
                        />
                      </td>
                    )}
                    <td>
                      <div className="an-strong">
                        {recipient.displayLabel || recipient.email}
                      </div>
                      {recipient.displayLabel && (
                        <div className="an-note">{recipient.email}</div>
                      )}
                    </td>
                    {columns.map((c) => (
                      <td key={c} className="an-num">
                        {cellText(recipient[c], c)}
                      </td>
                    ))}
                    <td className="an-row-end">
                      {result ? (
                        result.ok ? (
                          <span className="an-tag is-good">sent ✓</span>
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
                          {expanded === i ? "Hide" : "Preview"}
                        </button>
                      )}
                    </td>
                  </tr>
                  {expanded === i && !result && (
                    <tr>
                      <td colSpan={colSpan} className="an-expand-cell">
                        <EmailPreview
                          load={() => resolveEmail(i)}
                          savedReport={usesSavedReport}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {error && <div className="alert error">{error}</div>}

      {sent ? (
        <p className="an-note an-good">
          <b>Sent {sentCount}</b>
          {failCount ? ` · ${failCount} failed` : ""} through the connected mailbox.
        </p>
      ) : (
        <div className="an-card-actions">
          {progress ? (
            <ActionProgress
              label="Preparing and sending…"
              done={progress.done}
              total={progress.total}
            />
          ) : (
            <>
              <button
                className="btn btn-primary btn-sm"
                disabled={selected.size === 0}
                onClick={() => void send()}
              >
                Send {selected.size} selected
              </button>
              <span className="an-note">
                Runs as you · preview any row · nothing sends until you click
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Renders one recipient's resolved message, exactly as it would be sent. */
function EmailPreview({
  load,
  savedReport,
}: {
  load: () => Promise<{ to: string; subject: string; body_html: string }>;
  savedReport: boolean;
}) {
  const [state, setState] = useState<{
    loading: boolean;
    error?: string;
    email?: { to: string; subject: string; body_html: string };
  }>({ loading: true });

  useEffect(() => {
    let alive = true;
    void load()
      .then((email) => alive && setState({ loading: false, email }))
      .catch((err) => alive && setState({ loading: false, error: errorMessage(err) }));
    return () => {
      alive = false;
    };
    // `load` closes over the recipient index, which is fixed for this row.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state.loading)
    return (
      <p className="an-note">
        {savedReport ? "Rendering this recipient's report…" : "Building the message…"}
      </p>
    );
  if (state.error) return <div className="alert error">{state.error}</div>;
  if (!state.email) return null;

  return (
    <div className="an-preview">
      <div className="an-note">
        <b>To</b> {state.email.to} · <b>Subject</b> {state.email.subject}
      </div>
      <div
        className="an-email-preview"
        // The exact HTML this recipient will receive, shown before anything is
        // sent — the point of the preview is to see it as it really is.
        dangerouslySetInnerHTML={{ __html: state.email.body_html || "<p>(empty)</p>" }}
      />
    </div>
  );
}
