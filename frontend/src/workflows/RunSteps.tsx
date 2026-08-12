/**
 * One run, step by step — what the workflow actually did.
 *
 * A plan says what a workflow *will* do; this says what it *did*. The engine
 * records two rows per plan step at the same index — a `tool_call` written
 * before the step executes and a `tool_result` written after — so the SQL that
 * really ran, with its `${…}` placeholders already resolved, and the rows or
 * send-outcome it produced are both readable here. That difference is the
 * reason a rehearsal is worth watching: the definition is a template, and this
 * is the run.
 *
 * Shared by the Analyze thread's workflow cards and the Workflows section's
 * detail view, so a run reads the same wherever it is opened.
 */
import { useMemo } from "react";

import { Disclosure, Sql } from "../analyze/ui";
import { DataGrid } from "../analyze/DataGrid";
import { Spinner } from "../components/ui";
import { errorMessage } from "../api/client";
import { useWorkflowRun } from "../api/hooks";
import type { WorkflowRunStep } from "../types";
import { stepIcon } from "./catalog";

/**
 * Rows the engine writes that aren't tool calls still deserve an icon, so the
 * bookkeeping roles borrow the step kind that means the same thing.
 */
const ROLE_KIND: { [role: string]: string } = {
  model_in: "decide",
  model_out: "llm_extract",
  tool_call: "sql_query",
  tool_result: "finish",
  notify: "notify_user",
  wait_start: "wait_for_event",
  wait_resume: "call_workflow",
  decide: "decide",
  skipped: "finish",
  finish: "finish",
};

function asRows(value: unknown): { [key: string]: unknown }[] | null {
  const arr = Array.isArray(value)
    ? value
    : Array.isArray((value as { rows?: unknown })?.rows)
      ? ((value as { rows: unknown[] }).rows as unknown[])
      : null;
  if (!arr || !arr.length) return null;
  return arr.every((r) => r !== null && typeof r === "object" && !Array.isArray(r))
    ? (arr as { [key: string]: unknown }[])
    : null;
}

/**
 * A one-line outcome for a step. The bare `content` is often empty, so without
 * this the timeline reads as a column of dashes — technically a record of the
 * run, and useless as an account of it.
 *
 * `sandbox` changes the wording rather than the fact: a mocked send really did
 * compose the message and really did not deliver it, and a row that said "sent"
 * either way would be the one thing in here you could not trust.
 */
function outcome(
  tool: string,
  result: unknown,
  sandbox: boolean
): { text: string; ok: boolean } | null {
  if (result == null) return null;

  if (/email|sms/i.test(tool)) {
    const verb = /sms/i.test(tool) ? "message" : "email";
    const rows = asRows(result);
    const count = rows?.length ?? 1;
    return sandbox
      ? { text: `${count} ${verb}${count === 1 ? "" : "s"} composed — mocked, nothing sent`, ok: false }
      : { text: `${count} ${verb}${count === 1 ? "" : "s"} sent`, ok: true };
  }

  const rows = asRows(result);
  if (rows) {
    const docs = rows.filter((r) => typeof r.html === "string").length;
    if (docs) return { text: `${docs} document${docs === 1 ? "" : "s"} rendered`, ok: true };
    return { text: `${rows.length} row${rows.length === 1 ? "" : "s"}`, ok: true };
  }

  if (typeof result === "object") {
    const obj = result as { [key: string]: unknown };
    if (typeof obj.error === "string" && obj.error) return { text: obj.error, ok: false };
    if (obj.ok === false) return { text: "did not succeed", ok: false };
    if (typeof obj.count === "number") {
      return { text: `${obj.count} row${obj.count === 1 ? "" : "s"}`, ok: true };
    }
    if (typeof obj.id === "string") return { text: `record ${obj.id}`, ok: true };
    return null;
  }

  const text = String(result).trim();
  if (!text || text === "null") return null;
  return { text: text.slice(0, 200), ok: true };
}

/** HH:MM:SS — the wall clock, so you can see how a run progressed. */
function clockOf(ts?: string): string {
  if (!ts) return "";
  const d = new Date(ts);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
}

function elapsedTitle(ts?: string, from?: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const since = from ? ` · +${((d.getTime() - from) / 1000).toFixed(1)}s from the start` : "";
  return d.toLocaleString() + since;
}

function StepRow({
  step,
  sandbox,
  startedAt,
}: {
  step: WorkflowRunStep;
  sandbox: boolean;
  startedAt?: number;
}) {
  const tool = String(step.tool_name || "");
  const role = String(step.role || "");
  const args = (step.tool_args ?? {}) as { [key: string]: unknown };
  const Ico = stepIcon(tool || ROLE_KIND[role] || "");
  const sql = typeof args.sql === "string" ? args.sql : undefined;
  // The rows a step returned, unless they are rendered documents — a wall of
  // escaped HTML in a table is noise, and the outcome line already counts them.
  const rows = asRows(step.tool_result);
  const records = rows && !rows.some((r) => typeof r.html === "string") ? rows : null;
  const result = outcome(tool, step.tool_result, sandbox);
  const content = String(step.content || "").trim();

  return (
    <div className="wf-rstep">
      <span className="wf-rstep-time" title={elapsedTitle(step.created_at, startedAt)}>
        {clockOf(step.created_at)}
      </span>
      <span className={`wf-rstep-ico ${role === "tool_result" ? "is-done" : ""}`}>
        <Ico size={14} />
      </span>
      <span className="wf-rstep-tool">{tool || role || "step"}</span>
      <div className="wf-rstep-body">
        {content ? (
          <div className="wf-rstep-content">{content.slice(0, 600)}</div>
        ) : (
          !sql && !records && !result && <div className="wf-rstep-empty">—</div>
        )}
        {sql && <Sql>{sql}</Sql>}
        {records && (
          <Disclosure
            summary={`View ${records.length} record${records.length === 1 ? "" : "s"}`}
          >
            <DataGrid rows={records} />
          </Disclosure>
        )}
        {result && (
          <div className={`wf-rstep-result ${result.ok ? "is-ok" : "is-warn"}`}>
            → {result.text}
          </div>
        )}
      </div>
    </div>
  );
}

export function RunSteps({
  runId,
  live,
  sandbox,
}: {
  runId: string;
  /** Opening guess only — the fetched run's own status takes over. */
  live?: boolean;
  sandbox?: boolean;
}) {
  const query = useWorkflowRun(runId, live);

  /**
   * Sorted by step, then by when it happened.
   *
   * The engine orders these `BY idx ASC` and nothing else, but it writes
   * *several* rows at one idx — the `tool_call`, any recovery traces the step
   * needed, then the `tool_result`. Within an idx the order it hands back is
   * therefore whatever storage returns, which in practice interleaves them: a
   * step's result and its retries can appear above the call they belong to,
   * and the run reads as though it did things in an order it did not.
   *
   * `created_at` is the tiebreak because it is what the row means. The `idx`
   * comparison stays primary so a step whose rows share a timestamp — recovery
   * turns are written in one burst — still sits with its own step.
   */
  const steps = useMemo(() => {
    const rows = query.data?.steps ?? [];
    return [...rows].sort(
      (a, b) =>
        (a.idx ?? 0) - (b.idx ?? 0) ||
        String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""))
    );
  }, [query.data]);

  if (query.isLoading) return <Spinner />;
  if (query.isError) return <div className="wf-rsteps-note">{errorMessage(query.error)}</div>;

  const mocked = sandbox ?? !!query.data?.run?.sandbox;
  const error = query.data?.run?.error;

  if (!steps.length) {
    return (
      <div className="wf-rsteps-note">
        {isStarting(query.data?.run?.status)
          ? "Queued — the first step appears here the moment the engine picks it up."
          : "No step events were recorded for this run."}
      </div>
    );
  }

  const startedAt = steps[0]?.created_at ? new Date(steps[0].created_at).getTime() : undefined;

  return (
    <div className="wf-rsteps">
      {steps.map((step, i) => (
        <StepRow
          key={step._id || `${step.idx}-${step.role}-${i}`}
          step={step}
          sandbox={mocked}
          startedAt={Number.isFinite(startedAt) ? startedAt : undefined}
        />
      ))}
      {error && <div className="wf-rsteps-error">{error}</div>}
    </div>
  );
}

function isStarting(status?: string): boolean {
  return /pending|queued|running|^$/i.test(status ?? "");
}
