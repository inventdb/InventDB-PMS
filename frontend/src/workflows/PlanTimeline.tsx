/**
 * A workflow's definition, read top to bottom: what starts it, then each step.
 *
 * This is the one rendering of a plan, shared by the card on the Workflows
 * page, the detail view and the editor's live preview. Sharing it is the point
 * — the preview a user approves before saving is drawn by the same code that
 * draws the saved workflow afterwards, so the two cannot disagree.
 */
import { Circle } from "lucide-react";

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
}: {
  workflow: Pick<Workflow, "plan" | "trigger_kind" | "trigger_spec" | "trigger_intent" | "next_run_at">;
  /** Draw the trigger as the first node. Off on the card, where the trigger
   *  already sits in the header and repeating it would just be noise. */
  showTrigger?: boolean;
  emptyNote?: string;
}) {
  const plan = workflow.plan ?? [];
  const TriggerIco = triggerIcon(workflow.trigger_kind);
  const rows = plan.length + (showTrigger ? 1 : 0);

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
      {plan.map((step, i) => (
        <StepRow
          key={(step.idx as number) ?? i}
          step={step}
          index={showTrigger ? i + 1 : i}
          total={rows}
        />
      ))}
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
