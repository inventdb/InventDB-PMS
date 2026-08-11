/**
 * Workflows — the automations that run against this portfolio.
 *
 * The engine is InventDB SOAR's: it owns the schedule, the step executor and
 * the run history, and the same records back SOAR's Operate room. Workflows are
 * authored there (or by describing one in Analyze); this page is where they are
 * read, adjusted and operated — edit the plan, rehearse it, activate or pause
 * it, and watch what it did.
 *
 * One card per workflow, showing its trigger, its plan and its recent outcomes.
 * Opening one gives the full definition, its complete run history and its
 * version history.
 */
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Clock, PencilLine, Play, Zap } from "lucide-react";

import { useToast } from "../components/Toast";
import { errorMessage } from "../api/client";
import { useRunWorkflow, useWorkflow, useWorkflowRuns, useWorkflows } from "../api/hooks";
import { Alert, EmptyState, Spinner } from "../components/ui";
import type { Workflow, WorkflowRun } from "../types";
import { PlanTimeline } from "../workflows/PlanTimeline";
import { WorkflowDetail, StatusIcon, duration, fmtDateTime } from "../workflows/WorkflowDetail";
import { WorkflowEditor } from "../workflows/WorkflowEditor";
import { triggerIcon } from "../workflows/catalog";
import { describeTrigger } from "../workflows/schedule";

export default function Workflows() {
  const workflows = useWorkflows();
  const runs = useWorkflowRuns();
  /**
   * `?id=` names one workflow to show even if it is still a draft — how the
   * "Open in Workflows" link from an Analyze thread arrives. Without it, a
   * workflow the assistant just built would be filtered out of the very page
   * it was sent to, with no way to activate it here.
   */
  const [params] = useSearchParams();
  const focusId = params.get("id");

  const [editing, setEditing] = useState<Workflow | null>(null);
  const [opened, setOpened] = useState<Workflow | null>(null);

  // Opened on arrival, once. Closing it must not immediately reopen it, and
  // returning to the page later should not either — hence the ref rather than
  // keying off `opened` being null.
  const autoOpened = useRef<string | null>(null);
  useEffect(() => {
    if (!focusId || autoOpened.current === focusId) return;
    const found = workflows.data?.workflows?.find((w) => w._id === focusId);
    if (!found) return;
    autoOpened.current = focusId;
    setOpened(found);
  }, [focusId, workflows.data]);

  if (workflows.isLoading) return <Spinner />;
  if (workflows.isError)
    return (
      <div className="content">
        <Alert kind="error">{errorMessage(workflows.error)}</Alert>
      </div>
    );

  /**
   * Drafts are excluded — except one named by `?id=`.
   *
   * A workflow arrives `pending_approval` and stays that way until it is
   * activated, so anything the assistant authored and nobody kept — a re-ask,
   * a revision, a second create inside one turn — lingers as a draft with the
   * same name as the real one. Listing those beside the workflow that is
   * actually running makes the page ambiguous exactly where it needs to be
   * certain: which of these is the automation my portfolio is relying on?
   *
   * The exception is the one you asked for by name. Hiding *that* would break
   * the link out of Analyze, so it is listed, badged as a draft, and can be
   * activated here like anything else. Hiding drafts is about not accumulating
   * a pile; it was never about refusing to show you a workflow you navigated to.
   */
  const allWorkflows = workflows.data?.workflows ?? [];
  const wfList = allWorkflows.filter((w) => !w.pending_approval || w._id === focusId);
  const runList = runs.data?.runs ?? [];

  // The opened workflow is looked up fresh each render so an edit made in the
  // editor is reflected behind it rather than showing the copy it was opened
  // with.
  const openedNow = opened ? wfList.find((w) => w._id === opened._id) ?? opened : null;

  return (
    <div className="content">
      <div className="page-head">
        <div className="titles">
          <h2>Workflows</h2>
          <p>
            Automations that run against your portfolio — scheduled reports, alerts and data
            actions — with their live execution history. They run on InventDB SOAR’s engine,
            and you can edit, rehearse and activate them here.
          </p>
        </div>
        <div className="actions">
          <span className="count-pill">
            <Zap size={13} style={{ verticalAlign: "-2px", marginRight: 6 }} />
            {wfList.length} workflow(s) · {runList.length} run(s)
          </span>
        </div>
      </div>

      {wfList.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Zap size={26} />}
            title="No workflows yet"
            message="Describe the automation you want in Analyze — “email each owner their statement on the 1st” — then rehearse it there and activate it. Activated workflows appear here."
          />
        </div>
      ) : (
        <div className="grid-2">
          {wfList.map((w) => (
            <WorkflowCard
              key={w._id}
              workflow={w}
              runs={runList.filter((r) => r.workflow_id === w._id)}
              onOpen={() => setOpened(w)}
              onEdit={() => setEditing(w)}
            />
          ))}
        </div>
      )}

      {openedNow && (
        <WorkflowDetail
          workflow={openedNow}
          onClose={() => setOpened(null)}
          onEdit={(w) => {
            setOpened(null);
            setEditing(w);
          }}
        />
      )}

      {editing && (
        <WorkflowEditor
          workflow={editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setEditing(null);
            // Back into the detail view, so the saved plan can be read and
            // rehearsed without hunting for the card again.
            if (saved?._id) setOpened(saved);
          }}
        />
      )}
    </div>
  );
}

// ---- Workflow card --------------------------------------------------------
function WorkflowCard({
  workflow,
  runs,
  onOpen,
  onEdit,
}: {
  workflow: Workflow;
  runs: WorkflowRun[];
  onOpen: () => void;
  onEdit: () => void;
}) {
  const toast = useToast();
  const run = useRunWorkflow();
  /**
   * The list does not always carry each workflow's plan — InventDB omits it
   * from `GET /api/workflows` — so the card reads the definition it renders
   * from the detail query. That is the same query key the detail modal uses,
   * so opening a card costs nothing and this costs nothing once it is open.
   */
  const detail = useWorkflow(workflow._id);
  const wf: Workflow = { ...workflow, ...(detail.data ?? {}) };
  const TriggerIcon = triggerIcon(wf.trigger_kind);
  // Only a workflow reached by `?id=` can be pending here; the list filters the
  // rest out. It still has to say so — "Active" on something that has never
  // run would be a lie, and Activate is the whole reason to arrive here.
  const pending = !!wf.pending_approval;
  const active = wf.active ?? !pending;
  const recentRuns = [...runs]
    .sort((a, b) => (b.started_at || "").localeCompare(a.started_at || ""))
    .slice(0, 4);

  /**
   * The card's Rehearse always forces mocked side effects, whatever the
   * workflow's own setting. From a list, one click away from a dozen other
   * cards, "run" should not be able to email owners.
   */
  async function rehearse() {
    try {
      await run.mutateAsync({ id: workflow._id, sandboxOverride: true });
      toast.success(`Rehearsing “${workflow.name}” — open it to watch the run.`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <div className="card card-pad wf-card">
      <div className="wf-card-head">
        <div className="stat-ico" style={{ flexShrink: 0 }}>
          <TriggerIcon size={18} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="wf-card-title">
            <button className="wf-card-name" onClick={onOpen}>
              <h3>{wf.name}</h3>
            </button>
            <span className={`badge ${active ? "success" : "neutral"}`}>
              {pending ? "Draft" : active ? "Active" : "Paused"}
            </span>
            {wf.sandbox && <span className="badge warn">Rehearsing</span>}
          </div>
          <div className="wf-card-trigger">
            <Clock size={13} /> {describeTrigger(wf.trigger_kind, wf.trigger_spec)}
          </div>
          {wf.trigger_intent && <p className="wf-card-intent">{wf.trigger_intent}</p>}
        </div>
      </div>

      {/* "No steps" is only true once the definition has actually arrived —
          claiming it while the plan is still loading reads as a broken
          workflow rather than a slow one. */}
      <PlanTimeline
        workflow={wf}
        emptyNote={detail.isLoading ? "Loading steps…" : "This workflow has no steps."}
      />

      {recentRuns.length > 0 && (
        <div className="wf-card-runs">
          <div className="report-note wf-card-runs-head">Recent runs</div>
          <div className="wf-card-run-list">
            {recentRuns.map((r) => (
              <div key={r._id} className="wf-card-run">
                <StatusIcon status={r.status} />
                <span className="wf-card-run-status">{r.status}</span>
                <span className="wf-card-run-time">{fmtDateTime(r.started_at)}</span>
                <span className="wf-card-run-dur">{duration(r.started_at, r.ended_at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="wf-card-actions">
        <button className="btn btn-sm" onClick={rehearse} disabled={run.isPending}>
          <Play size={14} /> {run.isPending ? "Queuing…" : "Rehearse"}
        </button>
        <button className="btn btn-sm" onClick={onEdit}>
          <PencilLine size={14} /> Edit
        </button>
        <button className="btn btn-ghost btn-sm wf-card-open" onClick={onOpen}>
          Open
        </button>
      </div>
    </div>
  );
}
