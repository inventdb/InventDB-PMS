/**
 * Workflow cards.
 *
 * When a turn builds or inspects an automation, the agent emits a `workflow`
 * step (the workflow as authored), a `workflow_run` step (one run with its
 * event timeline) or a `workflow_runs` step (a run list). Each renders here.
 *
 * These are the real thing, not a summary of it. Asking the assistant to build
 * an automation and being handed a stub that says "3 steps · open it elsewhere"
 * makes you go and check its work in another section — which is the same as not
 * having asked here. So the card below is the Workflows section's own console,
 * rendered inline: the full plan step by step, the runs with what each one
 * actually did, the version history, and the rehearse → activate ladder.
 *
 * Everything it shows comes from the live record, refetched by id. The thread
 * keeps the definition as it was written, and a workflow that was edited or
 * deleted three turns ago must not still offer an Activate button.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Workflow as WorkflowIcon } from "lucide-react";

import { Alert } from "../../components/ui";
import { WorkflowConsole, StatusIcon, fmtDateTime } from "../../workflows/WorkflowDetail";
import { RunSteps } from "../../workflows/RunSteps";
import { isLiveRun } from "../../api/hooks";
import type { PlanIssue, Workflow } from "../../types";

/**
 * The agent hands back InventDB's own workflow record. Only the id is load
 * bearing — everything else the console refetches — and the step carries it
 * twice, so a snapshot that arrives without one still resolves.
 */
function asWorkflow(value: unknown, fallbackId?: string): Workflow | null {
  const wf = (value && typeof value === "object" ? value : {}) as Partial<Workflow>;
  const id = wf._id || fallbackId;
  if (!id) return null;
  return { ...(wf as Workflow), _id: id, name: wf.name || "Workflow" };
}

export function WorkflowCard({
  workflow,
  workflowId,
  issues,
}: {
  workflow: unknown;
  /** The step's own `chart.workflow_id`, in case the snapshot has no `_id`. */
  workflowId?: string;
  /** Plan problems InventDB flagged when it accepted the workflow. */
  issues?: PlanIssue[];
}) {
  const wf = asWorkflow(workflow, workflowId);
  const [deleted, setDeleted] = useState(false);

  if (!wf) return null;

  const flagged = (issues ?? []).filter((i) => i && i.message);

  return (
    <div className="an-card an-wf-card">
      <div className="an-card-head">
        <span className="an-mark" aria-hidden>
          <WorkflowIcon size={17} />
        </span>
        <div className="an-card-titles">
          {/* The console below leads with the name, and renames in place. Two
              copies of it would leave the editable one looking like a field
              that changes something other than the heading above it. */}
          <div className="an-card-label">
            {deleted ? "Deleted workflow" : "Built by the assistant"}
          </div>
          <div className="an-note">
            {deleted ? wf.name : "Runs on InventDB SOAR’s engine"}
          </div>
        </div>
        {/* Naming the workflow in the link matters: the Workflows page hides
            drafts, so a workflow that has not been activated yet would not be
            there to find. Arriving with its id opens it regardless. */}
        <Link className="btn btn-ghost btn-sm" to={`/workflows?id=${encodeURIComponent(wf._id)}`}>
          Open in Workflows →
        </Link>
      </div>

      {/* InventDB accepts a plan it can still see problems in, and says so.
          Those warnings belong next to the Activate button, not in a log. */}
      {flagged.length > 0 && !deleted && (
        <Alert kind="warn">
          <strong>
            <AlertTriangle size={14} /> InventDB flagged{" "}
            {flagged.length === 1 ? "a problem" : `${flagged.length} problems`} with this plan
          </strong>
          <ul className="an-wf-issues">
            {flagged.map((issue, i) => (
              <li key={i}>
                {issue.step_idx != null && <span className="an-strong">Step {issue.step_idx + 1}: </span>}
                {issue.message}
              </li>
            ))}
          </ul>
        </Alert>
      )}

      {deleted ? (
        <p className="an-note">
          This workflow has been deleted. Its past runs are kept in the Workflows section.
        </p>
      ) : (
        <WorkflowConsole workflow={wf} onDeleted={() => setDeleted(true)} />
      )}
    </div>
  );
}

/** One run and its step-by-step event timeline. */
export function WorkflowRunCard({ chart }: { chart: any }) {
  const run = chart?.run ?? chart?.initial?.data?.run ?? {};
  const runId = String(chart?.run_id || run?._id || run?.run_id || "");
  if (!runId) return null;

  const status = String(run?.status || "").toLowerCase();
  const live = isLiveRun(status);

  return (
    <div className="an-card an-wf-card">
      <div className="an-card-head">
        <span className="an-mark" aria-hidden>
          <WorkflowIcon size={17} />
        </span>
        <div className="an-card-titles">
          <div className="an-card-title">
            {run?.workflow_name || run?.workflow_snapshot?.name || run?.name || "Workflow run"}
          </div>
          <div className="an-note">
            {run?.started_at ? fmtDateTime(String(run.started_at)) : ""}
            {status ? ` · ${status}${live ? "…" : ""}` : ""}
            {run?.sandbox ? " · rehearsal, side effects mocked" : ""}
          </div>
        </div>
        <Link className="btn btn-ghost btn-sm" to="/workflows">
          Open in Workflows →
        </Link>
      </div>

      <RunSteps runId={runId} live={live} sandbox={run?.sandbox} />
    </div>
  );
}

/** A list of runs — each row expands to what that run actually did. */
export function WorkflowRunsCard({ chart }: { chart: any }) {
  const runs: any[] = Array.isArray(chart?.runs) ? chart.runs : [];
  // One run needs no picking between: open it.
  const [open, setOpen] = useState<string | null>(
    runs.length === 1 ? String(runs[0]?._id ?? "") : null
  );
  if (!runs.length) return null;

  return (
    <div className="an-card an-wf-card">
      <div className="an-card-head">
        <span className="an-mark" aria-hidden>
          <WorkflowIcon size={17} />
        </span>
        <div className="an-card-titles">
          <div className="an-card-title">Workflow runs</div>
          <div className="an-note">
            {runs.length} run{runs.length === 1 ? "" : "s"}
          </div>
        </div>
        <Link className="btn btn-ghost btn-sm" to="/workflows">
          Open in Workflows →
        </Link>
      </div>

      <div className="wf-runs">
        {runs.map((run, i) => {
          const id = String(run?._id ?? run?.run_id ?? i);
          const isOpen = open === id;
          const live = isLiveRun(String(run?.status || ""));
          return (
            <div key={id} className={`wf-run-item ${isOpen ? "is-open" : ""}`}>
              <button
                type="button"
                className="wf-run"
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? null : id)}
              >
                <StatusIcon status={String(run?.status || "")} />
                <span className="wf-run-status">
                  {run?.status || "—"}
                  {live ? "…" : ""}
                </span>
                <span className="wf-run-time">
                  {fmtDateTime(run?.started_at ?? run?.created_at)}
                </span>
                {run?.workflow_name && <span className="an-note">{run.workflow_name}</span>}
                {run?.sandbox && (
                  <span className="wf-run-tag" title="Queries were real; side effects were mocked.">
                    rehearsal
                  </span>
                )}
                {run?.error && (
                  <span className="wf-run-error" title={String(run.error)}>
                    {String(run.error)}
                  </span>
                )}
              </button>
              {isOpen && run?._id && (
                <RunSteps runId={String(run._id)} live={live} sandbox={!!run.sandbox} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
