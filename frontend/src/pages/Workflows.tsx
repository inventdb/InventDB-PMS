import {
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import {
  Bell,
  CalendarClock,
  CheckCircle2,
  Circle,
  Clock,
  Database,
  FileBarChart,
  Loader2,
  Mail,
  PencilLine,
  Play,
  PlusCircle,
  Webhook,
  XCircle,
  Zap,
  type LucideIcon,
} from "lucide-react";

import { useWorkflow, useWorkflowRuns, useWorkflows } from "../api/hooks";
import { errorMessage } from "../api/client";
import { statusColor, useChartTheme } from "../theme/charts";
import { Alert, EmptyState, Spinner } from "../components/ui";
import type { Workflow, WorkflowRun, WorkflowStep } from "../types";

// ---- Icon maps ------------------------------------------------------------
const STEP_ICONS: { [kind: string]: LucideIcon } = {
  render_report: FileBarChart,
  send_email: Mail,
  notify_user: Bell,
  sql_query: Database,
  insert_record: PlusCircle,
  create_record: PlusCircle,
  update_record: PencilLine,
  finish: CheckCircle2,
};

const TRIGGER_ICONS: { [kind: string]: LucideIcon } = {
  cron: CalendarClock,
  schedule: CalendarClock,
  webhook: Webhook,
  event: Zap,
  manual: Play,
};

/** Run outcomes wear the reserved state colours, always beside an icon + label. */
function StatusIcon({ status, size = 15 }: { status: string; size?: number }) {
  const chart = useChartTheme();
  const s = status.toLowerCase();
  const color = statusColor(status, chart);
  if (s === "succeeded" || s === "success")
    return <CheckCircle2 size={size} color={color} />;
  if (s === "failed" || s === "error") return <XCircle size={size} color={color} />;
  if (s === "running" || s === "parked")
    return <Loader2 size={size} color={color} className="spin" />;
  return <Circle size={size} color={color} />;
}

function fmtDateTime(v?: string): string {
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

function duration(a?: string, b?: string): string {
  if (!a || !b) return "—";
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function cronHint(w: Workflow): string {
  if (w.trigger_kind === "cron" && w.trigger_spec?.expr) {
    const tz = w.trigger_spec.tz ? ` · ${w.trigger_spec.tz}` : "";
    return `cron: ${w.trigger_spec.expr}${tz}`;
  }
  return w.trigger_kind ?? "manual";
}

export default function Workflows() {
  const workflows = useWorkflows();
  const runs = useWorkflowRuns();

  if (workflows.isLoading) return <Spinner />;
  if (workflows.isError)
    return (
      <div className="content">
        <Alert kind="error">{errorMessage(workflows.error)}</Alert>
      </div>
    );

  const wfList = workflows.data?.workflows ?? [];
  const runList = runs.data?.runs ?? [];
  const nameById: { [id: string]: string } = {};
  wfList.forEach((w) => (nameById[w._id] = w.name));

  return (
    <div className="content">
      <div className="page-head">
        <div className="titles">
          <h2>Workflows</h2>
          <p>
            Automations running in InventDB SOAR — scheduled reports, alerts and data
            actions, with their live execution history.
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
            message="Create workflows in InventDB SOAR to automate reports and alerts; they'll appear here with a run timeline."
          />
        </div>
      ) : (
        <>
          <RunTimeline runs={runList} nameById={nameById} />
          <div className="grid-2" style={{ marginTop: 16 }}>
            {wfList.map((w) => (
              <WorkflowCard key={w._id} workflow={w} runs={runList.filter((r) => r.workflow_id === w._id)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ---- Runs timeline chart --------------------------------------------------
function RunTimeline({
  runs,
  nameById,
}: {
  runs: WorkflowRun[];
  nameById: { [id: string]: string };
}) {
  const chart = useChartTheme();

  // Assign each workflow a Y row.
  const ids = Array.from(new Set(runs.map((r) => r.workflow_id)));
  const rowOf: { [id: string]: number } = {};
  ids.forEach((id, i) => (rowOf[id] = i + 1));

  const points = runs
    .filter((r) => r.started_at)
    .map((r) => ({
      x: new Date(r.started_at as string).getTime(),
      y: rowOf[r.workflow_id],
      z: Math.max(1, new Date(r.ended_at || r.started_at || 0).getTime() - new Date(r.started_at as string).getTime()),
      status: r.status,
      name: nameById[r.workflow_id] ?? r.workflow_id,
      started: r.started_at,
      ended: r.ended_at,
    }));

  if (points.length === 0) {
    return (
      <div className="card chart-card">
        <h3>Run Timeline</h3>
        <div className="chart-sub">No runs recorded yet.</div>
      </div>
    );
  }

  const shortName = (n: string) => (n.length > 22 ? n.slice(0, 21) + "…" : n);

  return (
    <div className="card chart-card">
      <h3>Run Timeline</h3>
      <div className="chart-sub">Each point is a workflow run, coloured by outcome</div>
      <ResponsiveContainer width="100%" height={80 + ids.length * 56}>
        <ScatterChart margin={{ top: 10, right: 24, bottom: 20, left: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
          <XAxis
            type="number"
            dataKey="x"
            domain={["dataMin - 3600000", "dataMax + 3600000"]}
            scale="time"
            tickFormatter={(t) => fmtDateTime(new Date(t).toISOString())}
            stroke={chart.axis}
            fontSize={11}
          />
          <YAxis
            type="number"
            dataKey="y"
            domain={[0, ids.length + 1]}
            ticks={ids.map((_, i) => i + 1)}
            tickFormatter={(v) => {
              const id = ids[(v as number) - 1];
              return id ? shortName(nameById[id] ?? id) : "";
            }}
            width={140}
            stroke={chart.axis}
            fontSize={11}
          />
          <ZAxis type="number" dataKey="z" range={[70, 320]} />
          <Tooltip
            cursor={{ strokeDasharray: "3 3" }}
            content={({ active, payload }) => {
              if (!active || !payload || !payload.length) return null;
              const d = payload[0].payload as (typeof points)[number];
              return (
                <div
                  style={{
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius)",
                    padding: "9px 13px",
                    fontSize: 12.5,
                    color: "var(--text)",
                    boxShadow: "var(--shadow)",
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>{d.name}</div>
                  <div style={{ textTransform: "capitalize" }}>Status: {d.status}</div>
                  <div>Started: {fmtDateTime(d.started)}</div>
                  <div>Duration: {duration(d.started, d.ended)}</div>
                </div>
              );
            }}
          />
          <Scatter data={points}>
            {points.map((pt, i) => (
              <Cell key={i} fill={statusColor(pt.status, chart)} />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
      <div className="wf-legend">
        {[
          { label: "Succeeded", c: chart.status.success },
          { label: "Failed", c: chart.status.danger },
          { label: "Running", c: chart.status.warn },
        ].map((l) => (
          <span key={l.label}>
            <span className="dot" style={{ background: l.c }} />
            {l.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---- Workflow card with plan step timeline --------------------------------
function WorkflowCard({ workflow, runs }: { workflow: Workflow; runs: WorkflowRun[] }) {
  const detail = useWorkflow(workflow._id);
  const plan: WorkflowStep[] = detail.data?.plan ?? workflow.plan ?? [];
  const TriggerIcon = TRIGGER_ICONS[workflow.trigger_kind ?? "manual"] ?? Clock;
  const recentRuns = [...runs]
    .sort((a, b) => (b.started_at || "").localeCompare(a.started_at || ""))
    .slice(0, 4);

  return (
    <div className="card card-pad">
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div className="stat-ico" style={{ flexShrink: 0 }}>
          <TriggerIcon size={18} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <h3 style={{ fontSize: 15 }}>{workflow.name}</h3>
            <span className={`badge ${workflow.active ? "success" : "neutral"}`}>
              {workflow.active ? "Active" : "Paused"}
            </span>
          </div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-muted)", fontSize: 12, marginTop: 4 }}>
            <Clock size={13} /> {cronHint(workflow)}
          </div>
          {workflow.trigger_intent && (
            <p style={{ color: "var(--text-muted)", fontSize: 12.5, margin: "8px 0 0" }}>
              {workflow.trigger_intent}
            </p>
          )}
        </div>
      </div>

      {/* Plan step timeline */}
      <div className="wf-steps">
        {detail.isLoading && plan.length === 0 ? (
          <div className="report-note" style={{ padding: "10px 0" }}>Loading steps…</div>
        ) : (
          plan.map((step, i) => {
            const Ico = STEP_ICONS[step.kind] ?? Circle;
            return (
              <div className="wf-step" key={step.idx ?? i}>
                <div className="wf-step-rail">
                  <div className="wf-ico">
                    <Ico size={15} />
                  </div>
                  {i < plan.length - 1 && <div className="wf-line" />}
                </div>
                <div className="wf-step-body">
                  <div className="wf-step-title">
                    {step.label || step.kind}
                    <span className="wf-kind">{step.kind}</span>
                  </div>
                  {step.narration && <div className="wf-step-desc">{step.narration}</div>}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Recent runs */}
      {recentRuns.length > 0 && (
        <div style={{ marginTop: 14, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
          <div className="report-note" style={{ marginBottom: 8, fontWeight: 600 }}>Recent runs</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {recentRuns.map((r) => (
              <div key={r._id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
                <StatusIcon status={r.status} />
                <span style={{ textTransform: "capitalize", minWidth: 74 }}>{r.status}</span>
                <span style={{ color: "var(--text-muted)" }}>{fmtDateTime(r.started_at)}</span>
                <span style={{ marginLeft: "auto", color: "var(--text-faint)" }}>
                  {duration(r.started_at, r.ended_at)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
