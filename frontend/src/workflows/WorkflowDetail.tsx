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
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock,
  History,
  Loader2,
  Pause,
  PencilLine,
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
  useDeleteWorkflow,
  useRollbackWorkflow,
  useRunWorkflow,
  useWorkflow,
  useWorkflowLifecycle,
  useWorkflowRunsFor,
  useWorkflowVersions,
} from "../api/hooks";
import { statusColor, useChartTheme } from "../theme/charts";
import type { Workflow, WorkflowRun } from "../types";
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
  onEdit,
}: {
  workflow: Workflow;
  onClose: () => void;
  onEdit: (workflow: Workflow) => void;
}) {
  // Shares the console's query key, so this costs no extra request — it only
  // keeps the modal's title honest when the workflow is renamed elsewhere.
  const detail = useWorkflow(workflow._id);

  return (
    <Modal title={detail.data?.name ?? workflow.name} onClose={onClose}>
      <WorkflowConsole workflow={workflow} onEdit={onEdit} onDeleted={onClose} />
    </Modal>
  );
}

/**
 * The workflow itself — state, controls, plan, runs, history — with no
 * surrounding chrome, so it can sit in a modal or inline in a chat thread.
 */
export function WorkflowConsole({
  workflow,
  onEdit,
  onDeleted,
}: {
  workflow: Workflow;
  onEdit: (workflow: Workflow) => void;
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
  const busy = lifecycle.isPending || run.isPending || remove.isPending;

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

        {/* ---- State ------------------------------------------------------ */}
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
          {sandboxed && (
            <button
              className="btn btn-sm wf-golive"
              onClick={() => act("activate", false)}
              disabled={busy}
              title="Stop mocking side effects — from now on this workflow really sends."
            >
              <AlertTriangle size={14} /> Take it live
            </button>
          )}
          <button className="btn btn-sm" onClick={() => onEdit(wf)} disabled={busy}>
            <PencilLine size={14} /> Edit
          </button>
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
          <VersionList workflowId={wf._id} currentVersion={wf.version} onError={setError} />
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

function RunList({ query }: { query: ReturnType<typeof useWorkflowRunsFor> }) {
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
  const live = isLiveRun(run.status);
  return (
    <div className={`wf-run-item ${open ? "is-open" : ""}`}>
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
      {open && <RunSteps runId={run._id} live={live} sandbox={run.sandbox} />}
    </div>
  );
}

/** True for the 404 that means the workflow is gone, not that the fetch broke. */
function isMissing(error: unknown): boolean {
  return (error as { response?: { status?: number } } | null)?.response?.status === 404;
}

// ---- Versions -------------------------------------------------------------

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
}: {
  workflowId: string;
  currentVersion?: number;
  onError: (message: string) => void;
}) {
  const toast = useToast();
  const versions = useWorkflowVersions(workflowId);
  const rollback = useRollbackWorkflow();
  const [restoring, setRestoring] = useState<number | null>(null);

  if (versions.isLoading) return <Spinner />;
  if (versions.isError) return <Alert kind="error">{errorMessage(versions.error)}</Alert>;

  const rows = [...(versions.data?.versions ?? [])].sort((a, b) => b.version - a.version);
  if (!rows.length) {
    return (
      <EmptyState
        icon={<History size={24} />}
        title="No earlier versions"
        message="Editing this workflow saves the previous definition here, so you can go back."
      />
    );
  }

  async function restore(version: number) {
    setRestoring(version);
    try {
      await rollback.mutateAsync({ id: workflowId, version });
      toast.success(`Restored version ${version} as the current definition.`);
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setRestoring(null);
    }
  }

  return (
    <div className="wf-versions">
      {rows.map((v) => {
        const current = v.version === currentVersion;
        return (
          <div key={v.version} className="wf-version">
            <span className="wf-version-no">v{v.version}</span>
            <span className="wf-version-name">
              {v.name}
              {v.trigger_intent && <span className="wf-version-intent">{v.trigger_intent}</span>}
            </span>
            <span className="wf-version-meta">
              {v.plan?.length ?? 0} step{(v.plan?.length ?? 0) === 1 ? "" : "s"} ·{" "}
              {fmtDateTime(v.created_at)}
            </span>
            {current ? (
              <span className="badge success">Current</span>
            ) : (
              <button
                className="btn btn-ghost btn-sm"
                disabled={restoring !== null}
                onClick={() => restore(v.version)}
              >
                <RotateCcw size={13} /> {restoring === v.version ? "Restoring…" : "Restore"}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
