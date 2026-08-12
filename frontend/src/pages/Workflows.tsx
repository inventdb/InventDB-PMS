/**
 * Workflows — the automations that run against this portfolio, and the
 * decisions they are holding.
 *
 * The engine is InventDB SOAR's: it owns the schedule, the step executor and
 * the run history, and the same records back SOAR's Operate room. Workflows are
 * authored there (or by describing one in Analyze); this page is where they are
 * read, adjusted and operated — edit the plan, rehearse it, activate or pause
 * it, and watch what it did.
 *
 * The page reads top-down as urgency. **Notifications first**: a run parks when
 * it reaches a step that is not the software's decision, and until someone
 * answers, that run is stopped. Then one card per workflow, showing its trigger,
 * its plan and its recent outcomes; opening one gives the full definition, its
 * complete run history and its version history.
 *
 * Notifications live here rather than on a page of their own because a parked
 * run *is* a workflow, mid-flight — which is exactly why SOAR's Operate room
 * keeps the two lists side by side. Split them and the run sits in one room
 * while the decision it is waiting on sits in another.
 */
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Clock, PencilLine, Play, Plus, Search, Trash2, Zap } from "lucide-react";

import { useToast } from "../components/Toast";
import { ConfirmDialog } from "../components/Modal";
import { errorMessage } from "../api/client";
import {
  useDeleteWorkflow,
  useRunWorkflow,
  useWorkflow,
  useWorkflowRuns,
  useWorkflows,
} from "../api/hooks";
import { Alert, EmptyState, Spinner } from "../components/ui";
import { NotificationsPanel } from "../notifications/NotificationsPanel";
import type { Workflow, WorkflowRun } from "../types";
import { PlanTimeline } from "../workflows/PlanTimeline";
import { WorkflowDetail, StatusIcon, duration, fmtDateTime } from "../workflows/WorkflowDetail";
import { WorkflowEditor } from "../workflows/WorkflowEditor";
import { triggerIcon } from "../workflows/catalog";
import { describeTrigger } from "../workflows/schedule";

/** Which live states the list is narrowed to. */
type StateFilter = "all" | "active" | "paused" | "rehearsing";

/**
 * How much of a plan a card shows before it says how much is left.
 *
 * Five is enough to recognise a workflow by its shape — read, look up, write,
 * ask, send — and short enough that a twelve-step automation no longer decides
 * how tall every card beside it has to be.
 */
const CARD_STEPS = 5;

/**
 * What the New workflow button asks Analyze.
 *
 * Carrying the ask across matters: dropping someone into an empty chat makes
 * them work out the wording, and the wording is what decides whether the
 * assistant builds something rehearsable or starts guessing.
 */
const NEW_WORKFLOW_ASK =
  "Create a workflow for me. Ask me what should trigger it and what steps it " +
  "should take, then build it in the sandbox so I can rehearse it before it " +
  "goes live.";

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
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<StateFilter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmingBulk, setConfirmingBulk] = useState(false);
  const remove = useDeleteWorkflow();
  const toast = useToast();

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
  const listed = allWorkflows.filter((w) => !w.pending_approval || w._id === focusId);
  const runList = runs.data?.runs ?? [];

  // Search over the name and what it says it does — the two things anyone
  // remembers about a workflow. The state chips answer the other question the
  // list gets asked: "what is actually live right now?"
  const needle = search.trim().toLowerCase();
  const filtering = !!needle || stateFilter !== "all";
  const wfList = listed.filter((w) => {
    if (needle && !`${w.name} ${w.trigger_intent ?? ""}`.toLowerCase().includes(needle)) {
      return false;
    }
    const isActive = w.active ?? !w.pending_approval;
    if (stateFilter === "active") return isActive;
    if (stateFilter === "paused") return !isActive;
    if (stateFilter === "rehearsing") return !!w.sandbox;
    return true;
  });

  const bulkBusy = remove.isPending;

  /**
   * Delete the checked workflows, one call each.
   *
   * Sequential rather than parallel, and it keeps going past a failure: a
   * partial delete is a real outcome and the report says exactly how partial.
   * Anything that failed stays checked, so retrying does not re-attempt the
   * ones that already went.
   */
  async function deleteSelected() {
    const ids = [...selected];
    const failed: string[] = [];
    for (const id of ids) {
      try {
        await remove.mutateAsync(id);
      } catch {
        failed.push(id);
      }
    }
    setSelected(new Set(failed));
    setConfirmingBulk(false);
    const done = ids.length - failed.length;
    if (failed.length) {
      toast.error(
        `Deleted ${done} of ${ids.length}. ${failed.length} could not be deleted and stay selected.`
      );
    } else {
      toast.success(`Deleted ${done} workflow${done === 1 ? "" : "s"}.`);
    }
  }

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
            {wfList.length} workflow{wfList.length === 1 ? "" : "s"} · {runList.length}{" "}
            run{runList.length === 1 ? "" : "s"}
          </span>
          {/* Authoring happens in Analyze — describing an automation is how one
              gets written. This carries the ask across rather than dropping the
              user into an empty chat to work out the wording themselves. */}
          <Link className="btn btn-primary" to={`/analyze?q=${encodeURIComponent(NEW_WORKFLOW_ASK)}`}>
            <Plus size={15} /> New workflow
          </Link>
        </div>
      </div>

      {/* What needs a person, before what is merely running. A parked run is
          holding until it is answered, so it outranks everything below it. */}
      <NotificationsPanel />

      {allWorkflows.length > 0 && (
        <div className="wf-toolbar">
          <div className="wf-filter">
            <Search size={14} />
            <input
              className="input"
              type="search"
              value={search}
              placeholder="Search workflows…"
              aria-label="Search workflows"
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="wf-chips" role="group" aria-label="Filter by state">
            {(
              [
                ["all", "All"],
                ["active", "Active"],
                ["paused", "Paused"],
                ["rehearsing", "Rehearsing"],
              ] as [StateFilter, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`wf-chip ${stateFilter === key ? "active" : ""}`}
                aria-pressed={stateFilter === key}
                onClick={() => setStateFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>
          {selected.size > 0 && (
            <button
              className="btn btn-danger btn-sm wf-bulk"
              onClick={() => setConfirmingBulk(true)}
              disabled={bulkBusy}
            >
              <Trash2 size={14} /> Delete {selected.size} selected
            </button>
          )}
        </div>
      )}

      {wfList.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Zap size={26} />}
            title={filtering ? "Nothing matches that" : "No workflows yet"}
            message={
              filtering
                ? "No workflow matches your search and filter. Clear them to see everything again."
                : "Describe the automation you want in Analyze — “email each owner their statement on the 1st” — then rehearse it there and activate it. Activated workflows appear here."
            }
            action={
              filtering ? (
                <button
                  className="btn btn-sm"
                  onClick={() => {
                    setSearch("");
                    setStateFilter("all");
                  }}
                >
                  Clear filters
                </button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="grid-2 wf-grid">
          {wfList.map((w) => (
            <WorkflowCard
              key={w._id}
              workflow={w}
              runs={runList.filter((r) => r.workflow_id === w._id)}
              selected={selected.has(w._id)}
              onSelect={(on) =>
                setSelected((prev) => {
                  const next = new Set(prev);
                  if (on) next.add(w._id);
                  else next.delete(w._id);
                  return next;
                })
              }
              onOpen={() => setOpened(w)}
              onEdit={() => setEditing(w)}
            />
          ))}
        </div>
      )}

      {confirmingBulk && (
        <ConfirmDialog
          title={`Delete ${selected.size} workflow${selected.size === 1 ? "" : "s"}?`}
          message="They stop running immediately and disappear from InventDB SOAR too. Past runs are kept. This cannot be undone."
          confirmLabel={`Delete ${selected.size}`}
          busy={bulkBusy}
          onConfirm={deleteSelected}
          onCancel={() => setConfirmingBulk(false)}
        />
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
  selected,
  onSelect,
  onOpen,
  onEdit,
}: {
  workflow: Workflow;
  runs: WorkflowRun[];
  selected: boolean;
  onSelect: (on: boolean) => void;
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
    <div className={`card card-pad wf-card ${selected ? "is-selected" : ""}`}>
      <div className="wf-card-head">
        <label className="wf-card-pick" title={`Select “${workflow.name}”`}>
          <input
            type="checkbox"
            checked={selected}
            aria-label={`Select ${workflow.name}`}
            onChange={(e) => onSelect(e.target.checked)}
          />
        </label>
        <div className="stat-ico" style={{ flexShrink: 0 }}>
          <TriggerIcon size={18} />
        </div>
        {/* Name, then state, then what fires it — the same three rows on every
            card, whatever the name's length. Letting the badges share a line
            with the title made them wrap differently on each card, so a grid
            of them read as ragged rather than as a set. */}
        <div className="wf-card-titles">
          <button className="wf-card-name" onClick={onOpen}>
            <h3>{wf.name}</h3>
          </button>
          <div className="wf-card-meta">
            <span className={`badge ${active ? "success" : "neutral"}`}>
              {pending ? "Draft" : active ? "Active" : "Paused"}
            </span>
            {wf.sandbox && <span className="badge warn">Rehearsing</span>}
            <span className="wf-card-trigger">
              <Clock size={13} /> {describeTrigger(wf.trigger_kind, wf.trigger_spec)}
            </span>
          </div>
          {wf.trigger_intent && <p className="wf-card-intent">{wf.trigger_intent}</p>}
        </div>
      </div>

      {/* Capped: a card is a summary, and a twelve-step plan drawn in full set
          the height of its whole grid row. "No steps" is only true once the
          definition has actually arrived — claiming it while the plan is still
          loading reads as a broken workflow rather than a slow one. */}
      <PlanTimeline
        workflow={wf}
        max={CARD_STEPS}
        onShowAll={onOpen}
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
