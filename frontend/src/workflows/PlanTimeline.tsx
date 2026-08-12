/**
 * A workflow's definition, read top to bottom: what starts it, then each step.
 *
 * This is the one rendering of a plan, shared by the card on the Workflows
 * page, the detail view and the editor's live preview. Sharing it is the point
 * — the preview a user approves before saving is drawn by the same code that
 * draws the saved workflow afterwards, so the two cannot disagree.
 */
import { Circle, MoreHorizontal } from "lucide-react";

import type { Workflow, WorkflowStep } from "../types";
import { stepIcon, triggerIcon } from "./catalog";
import { describeTrigger } from "./schedule";
import { summariseStep } from "./draft";

function StepRow({
  step,
  index,
  total,
}: {
  step: WorkflowStep;
  /** Position on the rail, counting the trigger node when one is drawn. */
  index: number;
  total: number;
}) {
  const Ico = stepIcon(String(step.kind ?? ""));
  const detail = summariseStep(step);
  return (
    <div className="wf-step">
      <div className="wf-step-rail">
        <div className="wf-ico">
          <Ico size={15} />
        </div>
        {/* The rail continues while anything follows — including the trigger's
            own connector, which is why the count is offset when it is shown. */}
        {index < total - 1 && <div className="wf-line" />}
      </div>
      <div className="wf-step-body">
        <div className="wf-step-title">
          {String(step.label || step.kind || "Step")}
          <span className="wf-kind">{String(step.kind ?? "step")}</span>
          {step.save_as ? <span className="wf-var">${String(step.save_as)}</span> : null}
          {step.when ? <span className="wf-when">if {String(step.when)}</span> : null}
        </div>
        {detail && <div className="wf-step-desc">{detail}</div>}
      </div>
    </div>
  );
}

export function PlanTimeline({
  workflow,
  showTrigger = false,
  emptyNote = "No steps yet.",
  max,
  onShowAll,
}: {
  workflow: Pick<Workflow, "plan" | "trigger_kind" | "trigger_spec" | "trigger_intent" | "next_run_at">;
  /** Draw the trigger as the first node. Off on the card, where the trigger
   *  already sits in the header and repeating it would just be noise. */
  showTrigger?: boolean;
  emptyNote?: string;
  /**
   * Stop after this many steps and say how many were left.
   *
   * A card is a summary. Drawing all twelve steps of a real intake workflow
   * set the height of its whole grid row, and every shorter card beside it
   * stretched to match — so one long automation left the page mostly empty.
   * Uncapped everywhere the plan *is* the content: the detail view, the
   * editor preview, a version snapshot.
   */
  max?: number;
  /** Where "+N more" leads. Without it the count is stated, not offered. */
  onShowAll?: () => void;
}) {
  const plan = workflow.plan ?? [];
  const TriggerIco = triggerIcon(workflow.trigger_kind);
  const shown = max && plan.length > max ? plan.slice(0, max) : plan;
  const hidden = plan.length - shown.length;
  // The rail's connector is drawn for every row that has something below it —
  // including the last visible step when more follow behind the cut.
  const rows = shown.length + (showTrigger ? 1 : 0) + (hidden > 0 ? 1 : 0);

  if (!plan.length && !showTrigger) {
    return <div className="report-note wf-empty-note">{emptyNote}</div>;
  }

  return (
    <div className="wf-steps">
      {showTrigger && (
        <div className="wf-step">
          <div className="wf-step-rail">
            <div className="wf-ico wf-ico-trigger">
              <TriggerIco size={15} />
            </div>
            {rows > 1 && <div className="wf-line" />}
          </div>
          <div className="wf-step-body">
            <div className="wf-step-title">
              {describeTrigger(workflow.trigger_kind, workflow.trigger_spec)}
              <span className="wf-kind">when</span>
            </div>
            {workflow.trigger_intent && (
              <div className="wf-step-desc">{workflow.trigger_intent}</div>
            )}
          </div>
        </div>
      )}
      {shown.map((step, i) => (
        <StepRow
          key={(step.idx as number) ?? i}
          step={step}
          index={showTrigger ? i + 1 : i}
          total={rows}
        />
      ))}
      {hidden > 0 && (
        <div className="wf-step wf-step-more">
          <div className="wf-step-rail">
            <div className="wf-ico wf-ico-more">
              <MoreHorizontal size={15} />
            </div>
          </div>
          <div className="wf-step-body">
            {onShowAll ? (
              <button type="button" className="wf-more-link" onClick={onShowAll}>
                {hidden} more step{hidden === 1 ? "" : "s"}
              </button>
            ) : (
              <span className="wf-more-note">
                {hidden} more step{hidden === 1 ? "" : "s"}
              </span>
            )}
          </div>
        </div>
      )}
      {!plan.length && (
        <div className="wf-step">
          <div className="wf-step-rail">
            <div className="wf-ico">
              <Circle size={15} />
            </div>
          </div>
          <div className="wf-step-body">
            <div className="wf-step-desc">{emptyNote}</div>
          </div>
        </div>
      )}
    </div>
  );
}
