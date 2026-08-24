/**
 * One workflow, opened: its plan, its run history, its versions, and the
 * controls that change what it does next.
 *
 * The controls sit on two axes that are easy to conflate and expensive to get
 * wrong, so the UI keeps them visibly apart:
 *
 * * **Active or paused** — does it fire on its trigger at all?
 * * **Rehearsing or live** — when it fires, are the emails real?
 *
 * A workflow can be active *and* rehearsing, which is how one is iterated on
 * against real data without anyone receiving anything. Pausing therefore never
 * changes the rehearsal flag, and going live is its own deliberate click.
 *
 * The console below the modal chrome is exported on its own, because the
 * Analyze thread shows the very same thing inline when the assistant builds a
 * workflow. Sharing it is the point: a workflow the agent just wrote is not a
 * lesser object than one opened from the Workflows page, and two renderings of
 * the same controls would eventually disagree about what Activate means.
 */
import { useState } from "react";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock,
  FlaskConical,
  History,
  Loader2,
  Pause,
  Play,
  Power,
  RotateCcw,
  Trash2,
  XCircle,
} from "lucide-react";

import { Modal, ConfirmDialog } from "../components/Modal";
import { Alert, EmptyState, Spinner } from "../components/ui";
import { useToast } from "../components/Toast";
import { errorMessage } from "../api/client";
import {
  isLiveRun,
  useCancelRun,
  useClearWorkflowVersions,
  useDeleteWorkflow,
  useDeleteWorkflowVersion,
  useRollbackWorkflow,
  useRunWorkflow,
  useWorkflow,
  useWorkflowLifecycle,
  useUpdateWorkflow,
  useWorkflowRunsFor,
  useWorkflowVersion,
  useWorkflowVersions,
} from "../api/hooks";
import { statusColor, useChartTheme } from "../theme/charts";
import type { Workflow, WorkflowRun, WorkflowVersion } from "../types";
import { EditableName } from "./EditableName";
import { PlanTimeline } from "./PlanTimeline";
import { RunSteps } from "./RunSteps";
import { describeTrigger } from "./schedule";

export function fmtDateTime(v?: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function duration(a?: string, b?: string): string {
  if (!a || !b) return "—";
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export function StatusIcon({ status, size = 15 }: { status: string; size?: number }) {
  const chart = useChartTheme();
  const s = status.toLowerCase();
  const color = statusColor(status, chart);
  if (s === "succeeded" || s === "success") return <CheckCircle2 size={size} color={color} />;
  if (s === "failed" || s === "error") return <XCircle size={size} color={color} />;
  if (s === "running" || s === "parked")
    return <Loader2 size={size} color={color} className="spin" />;
  return <Circle size={size} color={color} />;
}

type Tab = "plan" | "runs" | "history";

export function WorkflowDetail({
  workflow,
  onClose,
}: {
  workflow: Workflow;
  onClose: () => void;
}) {
  // Shares the console's query key, so this costs no extra request — it only
  // keeps the modal's title honest when the workflow is renamed elsewhere.
  const detail = useWorkflow(workflow._id);

  // `hideTitle`: the console leads with the name as an editable heading, so
  // drawing it in the chrome as well would show it twice — once renameable and
  // once not. `title` still names the dialog for assistive tech.
  return (
    <Modal title={detail.data?.name ?? workflow.name} onClose={onClose} hideTitle>
      <WorkflowConsole workflow={workflow} onDeleted={onClose} />
    </Modal>
  );
}

/**
 * The workflow itself — state, controls, plan, runs, history — with no
 * surrounding chrome, so it can sit in a modal or inline in a chat thread.
 */
export function WorkflowConsole({
  workflow,
  onDeleted,
}: {
  workflow: Workflow;
  onDeleted: () => void;
}) {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("plan");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The caller carries a snapshot; the detail query is the authoritative copy.
  // Re-reading matters because the same workflow can be edited from SOAR — and
  // because an Analyze thread keeps the definition as it was written, which
  // may be many edits ago. Acting on a stale plan is the mistake worth
  // designing out.
  const detail = useWorkflow(workflow._id);
  const wf: Workflow = { ...workflow, ...(detail.data ?? {}) };

  const runs = useWorkflowRunsFor(workflow._id);
  const lifecycle = useWorkflowLifecycle();
  const run = useRunWorkflow();
  const remove = useDeleteWorkflow();
  const update = useUpdateWorkflow();
  const busy =
    lifecycle.isPending || run.isPending || remove.isPending || update.isPending;

  const pending = !!wf.pending_approval;
  const active = wf.active ?? !pending;
  const sandboxed = !!wf.sandbox;

  async function act(action: "activate" | "pause" | "resume", sandbox?: boolean) {
    setError(null);
    try {
      await lifecycle.mutateAsync({ id: wf._id, action, sandbox });
      toast.success(
        action === "pause"
          ? "Paused — it won’t fire until you resume it."
          : sandbox === false
          ? "Live — this workflow can now send for real."
          : "Active — it fires on its trigger. Side effects stay mocked while it’s rehearsing."
      );
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function fire(rehearse: boolean) {
    setError(null);
    try {
      await run.mutateAsync({ id: wf._id, sandboxOverride: rehearse ? true : undefined });
      setTab("runs");
      toast.success(rehearse ? "Rehearsal queued — watch it under Runs." : "Run queued.");
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  /**
   * Flip the rehearsal flag on its own.
   *
   * Sent as an ordinary field update rather than through activate, because the
   * two axes are independent: a paused workflow can be taken live, and an
   * active one can be put back to rehearsing without pausing it first. Routing
   * this through `activate` would silently un-pause a paused workflow.
   */
  async function setSandbox(next: boolean) {
    setError(null);
    try {
      await update.mutateAsync({ id: wf._id, patch: { sandbox: next } });
      toast.success(
        next
          ? "Rehearsing again — emails, texts and record changes are mocked."
          : "Live — this workflow can now send for real."
      );
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function confirmDelete() {
    try {
      await remove.mutateAsync(wf._id);
      toast.success(`Deleted “${wf.name}”.`);
      onDeleted();
    } catch (err) {
      setConfirmingDelete(false);
      setError(errorMessage(err));
    }
  }

  /** Rename in place. Throws so the inline editor can keep the draft on error. */
  async function rename(next: string) {
    // Only the name — omitting the plan is what keeps a rename from minting a
    // version, so the history stays a record of definition changes.
    await update.mutateAsync({ id: wf._id, patch: { name: next } });
    toast.success("Renamed.");
  }

  // Deleted out from under us — from the Workflows page, from SOAR, or in an
  // earlier turn of the very thread this console might be sitting in. Showing
  // the controls anyway would offer an Activate that can only 404.
  if (isMissing(detail.error)) {
    return (
      <div className="wf-detail">
        <EmptyState
          icon={<Trash2 size={24} />}
          title={`“${workflow.name}” no longer exists`}
          message="This workflow was deleted, so there is nothing left here to run or activate. Its past runs are kept in the run history."
        />
      </div>
    );
  }

  return (
    <>
      <div className="wf-detail">
        {error && <Alert kind="error">{error}</Alert>}

        {/* ---- Name and state ---------------------------------------------- */}
        <div className="wf-name-row">
          <EditableName
            value={wf.name}
            ariaLabel="Rename workflow"
            disabled={busy}
            onCommit={rename}
          />
        </div>

        <div className="wf-state">
          <span className={`badge ${active ? "success" : "neutral"}`}>
            {pending ? "Never activated" : active ? "Active" : "Paused"}
          </span>
          <span className={`badge ${sandboxed ? "warn" : "info"}`}>
            {sandboxed ? "Rehearsing" : "Live"}
          </span>
          <span className="wf-state-trigger">
            <Clock size={13} /> {describeTrigger(wf.trigger_kind, wf.trigger_spec)}
          </span>
          {wf.next_run_at && (
            <span className="wf-state-next">Next run {fmtDateTime(wf.next_run_at)}</span>
          )}
        </div>

        {wf.trigger_intent && <p className="wf-intent">{wf.trigger_intent}</p>}

        {sandboxed && !pending && (
          <Alert kind="info">
            This workflow is rehearsing: it runs on schedule and its queries are real, but emails,
            texts and record changes are mocked. Nothing leaves the system until you take it live.
          </Alert>
        )}

        {/* ---- Actions ----------------------------------------------------- */}
        <div className="wf-actions">
          <button className="btn btn-sm" onClick={() => fire(true)} disabled={busy}>
            <Play size={14} /> Rehearse now
          </button>
          {!sandboxed && (
            <button className="btn btn-sm" onClick={() => fire(false)} disabled={busy}>
              <Play size={14} /> Run now
            </button>
          )}
          {pending ? (
            <button
              className="btn btn-primary btn-sm"
              onClick={() => act("activate")}
              disabled={busy}
            >
              <Power size={14} /> Activate
            </button>
          ) : active ? (
            <button className="btn btn-sm" onClick={() => act("pause")} disabled={busy}>
              <Pause size={14} /> Pause
            </button>
          ) : (
            <button
              className="btn btn-primary btn-sm"
              onClick={() => act("resume")}
              disabled={busy}
            >
              <Play size={14} /> Resume
            </button>
          )}
          {/* Rehearsing is a switch, not a door. Going live is the deliberate
              step, but a workflow that has just misfired has to be able to go
              back to mocking without being paused, edited or re-created. */}
          {sandboxed ? (
            <button
              className="btn btn-sm wf-golive"
              onClick={() => setSandbox(false)}
              disabled={busy}
              title="Stop mocking side effects — from now on this workflow really sends."
            >
              <AlertTriangle size={14} /> Take it live
            </button>
          ) : (
            <button
              className="btn btn-sm"
              onClick={() => setSandbox(true)}
              disabled={busy}
              title="Go back to mocking emails, texts and record changes. It keeps firing on its trigger."
            >
              <FlaskConical size={14} /> Back to rehearsing
            </button>
          )}
          <button
            className="btn btn-danger btn-sm wf-action-end"
            onClick={() => setConfirmingDelete(true)}
            disabled={busy}
          >
            <Trash2 size={14} /> Delete
          </button>
        </div>

        {/* ---- Tabs -------------------------------------------------------- */}
        <div className="wf-tabs" role="tablist">
          {(
            [
              ["plan", `Steps${wf.plan?.length ? ` (${wf.plan.length})` : ""}`],
              ["runs", `Runs${runs.data?.runs?.length ? ` (${runs.data.runs.length})` : ""}`],
              ["history", "History"],
            ] as [Tab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              className={`wf-tab ${tab === key ? "active" : ""}`}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "plan" &&
          (detail.isLoading && !wf.plan ? (
            <Spinner />
          ) : (
            <PlanTimeline workflow={wf} showTrigger emptyNote="This workflow has no steps yet." />
          ))}

        {tab === "runs" && <RunList query={runs} />}

        {tab === "history" && (
          <VersionList
            workflowId={wf._id}
            currentVersion={wf.version}
            onError={setError}
            onRan={() => setTab("runs")}
          />
        )}
      </div>

      {confirmingDelete && (
        <ConfirmDialog
          title={`Delete “${wf.name}”?`}
          message="It stops running immediately, and it disappears from InventDB SOAR too. Past runs are kept."
          confirmLabel="Delete workflow"
          busy={remove.isPending}
          onConfirm={confirmDelete}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </>
  );
}

// ---- Runs -----------------------------------------------------------------

function RunList({
  query,
}: {
  query: ReturnType<typeof useWorkflowRunsFor>;
}) {
  if (query.isLoading) return <Spinner />;
  if (query.isError) return <Alert kind="error">{errorMessage(query.error)}</Alert>;

  const runs = [...(query.data?.runs ?? [])].sort((a, b) =>
    (b.started_at || "").localeCompare(a.started_at || "")
  );

  if (!runs.length) {
    return (
      <EmptyState
        icon={<Play size={24} />}
        title="No runs yet"
        message="Rehearse it, or wait for its trigger. Each run appears here with its outcome."
      />
    );
  }

  return (
    <div className="wf-runs">
      {runs.map((r) => (
        <RunRow key={r._id} run={r} />
      ))}
    </div>
  );
}

/**
 * A run, openable.
 *
 * Collapsed it says whether the run worked; opened it says what the run *did* —
 * the resolved SQL, the rows, the messages it composed. A status word on its
 * own cannot answer "so did the owners get their statements or not", which is
 * the only question anyone actually opens a run to settle.
 */
function RunRow({ run }: { run: WorkflowRun }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancel = useCancelRun();
  const toast = useToast();
  const live = isLiveRun(run.status);

  async function stop() {
    setError(null);
    try {
      await cancel.mutateAsync(run._id);
      toast.success("Run cancelled.");
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className={`wf-run-item ${open ? "is-open" : ""}`}>
      <div className="wf-run-line">
        <button
          type="button"
          className="wf-run"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <StatusIcon status={run.status} />
          <span className="wf-run-status">
            {run.status}
            {live ? "…" : ""}
          </span>
          <span className="wf-run-time">{fmtDateTime(run.started_at)}</span>
          {run.sandbox && (
            <span className="wf-run-tag" title="Queries were real; side effects were mocked.">
              rehearsal
            </span>
          )}
          {run.error && (
            <span className="wf-run-error" title={run.error}>
              {run.error}
            </span>
          )}
          <span className="wf-run-dur">{duration(run.started_at, run.ended_at)}</span>
        </button>
        {/* A parked run waits indefinitely. If the decision it needs is never
            going to be made, cancelling is the only thing that closes it. */}
        {live && (
          <button
            className="btn btn-ghost btn-sm wf-run-cancel"
            disabled={cancel.isPending}
            title={
              /park/i.test(run.status)
                ? "Stop waiting for a decision and end this run"
                : "Stop this run"
            }
            onClick={stop}
          >
            <Ban size={13} /> {cancel.isPending ? "Cancelling…" : "Cancel"}
          </button>
        )}
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {open && <RunSteps runId={run._id} live={live} sandbox={run.sandbox} />}
    </div>
  );
}

/** True for the 404 that means the workflow is gone, not that the fetch broke. */
function isMissing(error: unknown): boolean {
  return (error as { response?: { status?: number } } | null)?.response?.status === 404;
}

// ---- Versions -------------------------------------------------------------

/** One historical definition, openable — its plan read step by step. */
function VersionRow({
  workflowId,
  version,
  current,
  busy,
  onRestore,
  onRun,
  onDelete,
}: {
  workflowId: string;
  version: WorkflowVersion;
  current: boolean;
  busy: string | null;
  onRestore: (n: number) => void;
  onRun: (n: number) => void;
  onDelete: (n: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const n = version.version;
  // Only fetched once opened: the list can be long and every entry carries a
  // whole plan.
  const snapshot = useWorkflowVersion(workflowId, open ? n : null);
  const steps = version.plan?.length ?? 0;

  return (
    <div className={`wf-version-item ${open ? "is-open" : ""}`}>
      <div className="wf-version">
        <button
          type="button"
          className="wf-version-open"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <span className="wf-version-no">v{n}</span>
          <span className="wf-version-name">
            {version.name}
            {version.trigger_intent && (
              <span className="wf-version-intent">{version.trigger_intent}</span>
            )}
          </span>
        </button>
        <span className="wf-version-meta">
          {steps} step{steps === 1 ? "" : "s"} · {fmtDateTime(version.created_at)}
          {version.source_version ? ` · from v${version.source_version}` : ""}
        </span>
        {current && <span className="badge success">Current</span>}
        <span className="wf-version-actions">
          {/* Firing an old definition always rehearses. Running a superseded
              plan for real, from a history list, is not something to make one
              click away — restore it first if that is genuinely the intent. */}
          <button
            className="btn btn-ghost btn-sm"
            disabled={!!busy}
            title="Rehearse this version — queries run, side effects are mocked"
            onClick={() => onRun(n)}
          >
            <Play size={13} /> {busy === `run-${n}` ? "…" : "Rehearse"}
          </button>
          {!current && (
            <>
              <button
                className="btn btn-ghost btn-sm"
                disabled={!!busy}
                onClick={() => onRestore(n)}
              >
                <RotateCcw size={13} /> {busy === `restore-${n}` ? "Restoring…" : "Restore"}
              </button>
              <button
                className="btn-icon danger"
                disabled={!!busy}
                aria-label={`Delete version ${n}`}
                title={`Delete v${n} from the history`}
                onClick={() => onDelete(n)}
              >
                <Trash2 size={13} />
              </button>
            </>
          )}
        </span>
      </div>
      {open && (
        <div className="wf-version-plan">
          {snapshot.isLoading ? (
            <Spinner />
          ) : snapshot.isError ? (
            <Alert kind="error">{errorMessage(snapshot.error)}</Alert>
          ) : (
            <PlanTimeline
              workflow={{ ...(snapshot.data ?? version), _id: workflowId } as Workflow}
              showTrigger
              emptyNote="This version had no steps."
            />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Every definition edit mints a version, so this is the way back from a change
 * that turned out wrong. Restoring saves the old definition as a *new* latest
 * version rather than rewinding, which keeps the history honest about what
 * actually happened.
 */
function VersionList({
  workflowId,
  currentVersion,
  onError,
  onRan,
}: {
  workflowId: string;
  currentVersion?: number;
  onError: (message: string) => void;
  onRan: () => void;
}) {
  const toast = useToast();
  const versions = useWorkflowVersions(workflowId);
  const rollback = useRollbackWorkflow();
  const run = useRunWorkflow();
  const removeVersion = useDeleteWorkflowVersion();
  const clearHistory = useClearWorkflowVersions();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{ kind: "one"; version: number } | { kind: "all" } | null>(
    null
  );

  const rows = [...(versions.data?.versions ?? [])].sort((a, b) => b.version - a.version);

  async function act(key: string, run: () => Promise<unknown>, done: string) {
    setBusy(key);
    try {
      await run();
      toast.success(done);
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  }

  if (versions.isLoading) return <Spinner />;
  if (versions.isError) return <Alert kind="error">{errorMessage(versions.error)}</Alert>;

  if (!rows.length) {
    return (
      <EmptyState
        icon={<History size={24} />}
        title="No earlier versions"
        message="Editing this workflow saves the previous definition here, so you can go back."
      />
    );
  }

  const older = rows.filter((v) => v.version !== currentVersion).length;

  return (
    <>
      <div className="wf-versions">
        <div className="wf-versions-head">
          <span className="report-note">
            {rows.length} version{rows.length === 1 ? "" : "s"} · only the latest is editable —
            restore an older one to make it current
          </span>
          {older > 0 && (
            <button
              className="btn btn-ghost btn-sm wf-versions-clear"
              disabled={!!busy}
              onClick={() => setConfirming({ kind: "all" })}
            >
              Clear history
            </button>
          )}
        </div>

        {rows.map((v) => (
          <VersionRow
            key={v.version}
            workflowId={workflowId}
            version={v}
            current={v.version === currentVersion}
            busy={busy}
            onRestore={(n) =>
              act(
                `restore-${n}`,
                () => rollback.mutateAsync({ id: workflowId, version: n }),
                `Restored v${n} as the current definition.`
              )
            }
            onRun={(n) =>
              act(
                `run-${n}`,
                () => run.mutateAsync({ id: workflowId, version: n, sandboxOverride: true }),
                `Rehearsing v${n} — watch it under Runs.`
              ).then(onRan)
            }
            onDelete={(n) => setConfirming({ kind: "one", version: n })}
          />
        ))}
      </div>

      {confirming?.kind === "one" && (
        <ConfirmDialog
          title={`Delete v${confirming.version}?`}
          message="It goes from the history for good. The definition in force is unaffected, and past runs keep their own record of what they ran."
          confirmLabel="Delete version"
          busy={removeVersion.isPending}
          onConfirm={() =>
            void act(
              `del-${confirming.version}`,
              () => removeVersion.mutateAsync({ id: workflowId, version: confirming.version }),
              `Deleted v${confirming.version}.`
            )
          }
          onCancel={() => setConfirming(null)}
        />
      )}

      {confirming?.kind === "all" && (
        <ConfirmDialog
          title="Clear the version history?"
          message="Every earlier definition is deleted and there is nothing left to restore. The version in force stays exactly as it is."
          confirmLabel="Clear history"
          busy={clearHistory.isPending}
          onConfirm={() =>
            void act("clear", () => clearHistory.mutateAsync(workflowId), "Version history cleared.")
          }
          onCancel={() => setConfirming(null)}
        />
      )}
    </>
  );
}
