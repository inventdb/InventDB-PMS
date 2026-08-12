/**
 * One notification, opened.
 *
 * When it carries actions, this is a run held mid-flight: the workflow reached
 * a step that is not the software's decision, posted this, and stopped. The
 * buttons below are that run's next step. So the card is built around three
 * rules:
 *
 * * **Say what answering does before it is answered.** Each button's
 *   consequence is spelled out under it, because "Approve" on its own does not
 *   tell you a contractor is about to be emailed.
 * * **Show the working.** The run's own timeline sits under the decision — the
 *   acknowledgement that went out, the query that produced the shortlist. A
 *   recommendation you cannot check is one you have to take on faith.
 * * **An answered decision stays visible.** The buttons remain, disabled, with
 *   the chosen one marked. Hiding them would make the record of what was
 *   decided disappear at the moment it became history.
 */
import { useState, type FormEvent } from "react";
import { Bell, Check, CheckCircle2, Clock, Trash2 } from "lucide-react";

import { Alert } from "../components/ui";
import { useToast } from "../components/Toast";
import { errorMessage } from "../api/client";
import {
  notificationState,
  useDismissNotification,
  useResolveNotification,
} from "../api/hooks";
import { RunSteps } from "../workflows/RunSteps";
import { fmtDateTime } from "../workflows/WorkflowDetail";
import type { AppNotification, NotificationAction } from "../types";
import { NotificationBody } from "./NotificationBody";

/** What each kind of answer will actually do, said in advance. */
const CONSEQUENCE: { [kind: string]: string } = {
  approve: "Releases the run — it carries out the rest of its steps for real.",
  decline: "The run skips the steps that were waiting on a yes.",
  form: "Answers with what you enter, then releases the run.",
  choice: "Releases the run down the branch you pick.",
  dismiss: "Closes this without releasing the run.",
};

function ActionButton({
  action,
  notification,
  busy,
  onRun,
}: {
  action: NotificationAction;
  notification: AppNotification;
  busy: string | null;
  onRun: (action: NotificationAction, payload?: { [k: string]: unknown }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<{ [field: string]: string }>({});
  const resolved = !!notification.resolved_action;
  const chosen = resolved && notification.resolved_action === action.id;
  const working = busy === action.id;
  const fields = action.form_fields ?? [];

  // A form action cannot answer straight from the button — it has something to
  // collect first, and submitting blank would resume the run with nothing.
  if (action.kind === "form" && fields.length) {
    if (resolved) {
      return (
        <button className="btn btn-sm" disabled title={chosen ? "Your answer" : "Already answered"}>
          {chosen && <Check size={14} />} {action.label}
        </button>
      );
    }
    return (
      <>
        <button
          type="button"
          className={`btn btn-sm ${open ? "active" : ""}`}
          onClick={() => setOpen((v) => !v)}
          disabled={!!busy}
        >
          {action.label}
        </button>
        {open && (
          <form
            className="nb-form"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              onRun(action, values);
            }}
          >
            {fields.map((field) => (
              <div className="field" key={field.name}>
                <label htmlFor={`nb-${action.id}-${field.name}`}>
                  {field.label || field.name}
                  {field.required !== false && <span className="req">*</span>}
                </label>
                {field.options?.length ? (
                  <select
                    id={`nb-${action.id}-${field.name}`}
                    className="select"
                    value={values[field.name] ?? ""}
                    required={field.required !== false}
                    onChange={(e) =>
                      setValues((v) => ({ ...v, [field.name]: e.target.value }))
                    }
                  >
                    <option value="">Choose…</option>
                    {field.options.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={`nb-${action.id}-${field.name}`}
                    className="input"
                    type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
                    value={values[field.name] ?? ""}
                    required={field.required !== false}
                    onChange={(e) =>
                      setValues((v) => ({ ...v, [field.name]: e.target.value }))
                    }
                  />
                )}
              </div>
            ))}
            <div className="nb-form-actions">
              <button className="btn btn-primary btn-sm" type="submit" disabled={!!busy}>
                {working ? "Sending…" : "Submit and release the run"}
              </button>
              <button
                className="btn btn-ghost btn-sm"
                type="button"
                onClick={() => setOpen(false)}
                disabled={!!busy}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </>
    );
  }

  return (
    <button
      type="button"
      className={`btn btn-sm ${chosen || (!resolved && action.kind === "approve") ? "btn-primary" : ""} ${
        !resolved && action.kind === "decline" ? "btn-danger-ghost" : ""
      }`}
      disabled={resolved || !!busy}
      onClick={() => onRun(action)}
      title={resolved ? (chosen ? "Your answer" : "Already answered") : CONSEQUENCE[action.kind]}
    >
      {chosen && <Check size={14} />}
      {working ? "Working…" : action.label}
    </button>
  );
}

export function ApprovalCard({ notification }: { notification: AppNotification }) {
  const toast = useToast();
  const resolve = useResolveNotification();
  const dismiss = useDismissNotification();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showTrail, setShowTrail] = useState(false);

  const state = notificationState(notification);
  const actions = notification.actions ?? [];

  async function run(action: NotificationAction, payload?: { [k: string]: unknown }) {
    setBusy(action.id);
    setError(null);
    try {
      const result = await resolve.mutateAsync({
        id: notification._id,
        actionId: action.id,
        payload,
      });
      toast.success(
        result?.approved
          ? "Approved — the run has picked up where it left off."
          : result?.declined
            ? "Declined. The run skipped the steps that needed a yes."
            : "Answered — the run has resumed."
      );
      // The run does its remaining work now, so its trail is the interesting
      // thing to look at next.
      setShowTrail(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function clear() {
    setError(null);
    try {
      await dismiss.mutateAsync(notification._id);
      toast.success("Cleared from your inbox.");
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const when =
    state === "done" && notification.resolved_at
      ? `Answered ${fmtDateTime(notification.resolved_at)}`
      : state === "waiting"
        ? `Waiting since ${fmtDateTime(notification.created_at)}`
        : `Received ${fmtDateTime(notification.created_at)}`;

  return (
    <div className="card card-pad nb-card">
      <div className="nb-card-head">
        <div className={`stat-ico nb-mark is-${state}`}>
          {state === "waiting" ? (
            <Clock size={18} />
          ) : state === "done" ? (
            <CheckCircle2 size={18} />
          ) : (
            <Bell size={18} />
          )}
        </div>
        <div className="nb-card-titles">
          <h3>{notification.title}</h3>
          <div className="nb-when">{when}</div>
        </div>
        <span className={`badge ${state === "waiting" ? "warn" : state === "done" ? "success" : "neutral"}`}>
          {state === "waiting" ? "Needs you" : state === "done" ? "Answered" : "For information"}
        </span>
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      {state === "waiting" && (
        <Alert kind="warn">
          A workflow run is paused on this. Nothing further happens — no email, no
          assignment — until you answer.
        </Alert>
      )}

      {notification.body && <NotificationBody body={notification.body} />}

      {actions.length > 0 && (
        <div className="nb-actions">
          {actions.map((action) => (
            <ActionButton
              key={action.id}
              action={action}
              notification={notification}
              busy={busy}
              onRun={run}
            />
          ))}
        </div>
      )}

      {state === "waiting" && actions.length > 0 && (
        <ul className="nb-consequences">
          {actions.map((action) => (
            <li key={action.id}>
              <span className="an-strong">{action.label}</span> —{" "}
              {CONSEQUENCE[action.kind] ?? "Releases the run."}
            </li>
          ))}
        </ul>
      )}

      <div className="nb-card-foot">
        {notification.run_id && (
          <button className="btn btn-ghost btn-sm" onClick={() => setShowTrail((v) => !v)}>
            {showTrail ? "Hide" : "Show"} what the run has done
          </button>
        )}
        {/* Clearing an unanswered decision would hide a run that is still
            parked, so it is offered only once there is nothing outstanding. */}
        {state !== "waiting" && (
          <button
            className="btn btn-ghost btn-sm nb-clear"
            onClick={clear}
            disabled={dismiss.isPending}
          >
            <Trash2 size={14} /> {dismiss.isPending ? "Clearing…" : "Clear"}
          </button>
        )}
      </div>

      {showTrail && notification.run_id && (
        <RunSteps runId={notification.run_id} live={state === "waiting"} />
      )}
    </div>
  );
}
