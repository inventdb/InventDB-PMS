/**
 * The rail: the agent's work as flat timeline nodes threaded on one hairline.
 *
 * Every step, the answer and each artifact render as one node — a glyph in the
 * gutter and its content beside it. No boxes; the rail and the icons carry the
 * structure. This is what makes an answer checkable: you can see it plan, see
 * each query, and open the SQL behind any of them.
 */
import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

import { stepLabel, type AgentStep } from "./agent";
import { describeStep } from "./helpers";
import { AnimatedNumber, Sql, useThrottledValue } from "./ui";

/** Step type → a flat line glyph. Keys mirror the step types InventDB emits. */
const STEP_ICON_PATHS: Record<string, string> = {
  sql: "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6",
  plan: "M8 6h12M8 12h12M8 18h12M3.5 6h.01M3.5 12h.01M3.5 18h.01",
  chart: "M4 4v16h16M8 16v-5M13 16V8M18 16v-3",
  report:
    "M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM13 3v6h7M8 13h8M8 17h6",
  workflow:
    "M6 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM18 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM8 6h6a4 4 0 0 1 4 4v6",
  email_compose:
    "M3 6.5A1.5 1.5 0 0 1 4.5 5h15A1.5 1.5 0 0 1 21 6.5v11A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5zM3.5 7l8.5 6 8.5-6",
  bulk_email:
    "M3 6.5A1.5 1.5 0 0 1 4.5 5h15A1.5 1.5 0 0 1 21 6.5v11A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5zM3.5 7l8.5 6 8.5-6",
  event_compose: "M4 5h16a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM3 9h18M8 3v4M16 3v4",
  bulk_events: "M4 5h16a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM3 9h18M8 3v4M16 3v4",
  info: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8h.01M11 12h1v4h1",
  thinking:
    "M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.6.6 1 1.4 1 2.2V16h6v-.3c0-.8.4-1.6 1-2.2A6 6 0 0 0 12 3z",
  answer: "M12 3l2.1 5.6L20 10l-5.9 1.4L12 17l-2.1-5.6L4 10l5.9-1.4z",
  done: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8.5 12l2.4 2.4 4.6-5.1",
  table: "M4 5h16v14H4zM4 10h16M4 15h16M10 5v14",
  web: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3.5 12h17M12 3c2.8 2.4 2.8 15.6 0 18M12 3c-2.8 2.4-2.8 15.6 0 18",
  mutation: "M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17zM13.5 6.5l3 3",
  saved_view: "M4 5h16v14H4zM4 10h16M9 10v9",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20.5 20.5L16 16",
};

export function StepIcon({ type }: { type: string }) {
  const d = STEP_ICON_PATHS[type] || STEP_ICON_PATHS.info;
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}

function Chev({ open }: { open: boolean }) {
  return <ChevronDown size={12} className={`an-chev ${open ? "is-open" : ""}`} />;
}

/**
 * One node on the rail. `tone` colours the glyph — accent for a deliverable,
 * muted for a working step — and `live` adds the pulse while it is happening.
 */
export function AtlNode({
  type,
  tone,
  live,
  children,
}: {
  type: string;
  tone?: "accent" | "done" | "muted";
  live?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`atl-node${tone ? ` is-${tone}` : ""}${live ? " is-live" : ""}`}>
      <div className="atl-gutter">
        <span className="atl-icon">
          <StepIcon type={type} />
        </span>
      </div>
      <div className="atl-body">{children}</div>
    </div>
  );
}

/** A work step. Clicking a SQL step reveals the query it ran, inline. */
function WorkNode({ step, label }: { step: AgentStep; label: string }) {
  const [showSql, setShowSql] = useState(false);
  const hasSql = !!step.sql;
  return (
    <AtlNode type={step.type === "result" ? "sql" : step.type} tone="muted">
      <div className="atl-label">
        {hasSql ? (
          <button
            type="button"
            className="atl-toggle"
            onClick={() => setShowSql((v) => !v)}
            title="Show the query"
          >
            <span>{label}</span>
            <Chev open={showSql} />
          </button>
        ) : (
          <span>{label}</span>
        )}
        {step.executionTimeMs != null && (
          <span className="atl-time">{step.executionTimeMs} ms</span>
        )}
      </div>
      {hasSql && showSql && (
        <div className="atl-detail">
          <Sql>{step.sql!}</Sql>
        </div>
      )}
    </AtlNode>
  );
}

/**
 * The agent's work: a reasoning node (token count plus the expandable verbatim
 * trace), one node per meaningful step, and — while running — a pulsing live
 * node showing what it is doing right now.
 */
export function AgentTimeline({
  steps,
  running,
}: {
  steps: AgentStep[];
  running: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [secs, setSecs] = useState(0);

  useEffect(() => {
    if (!running) {
      setSecs(0);
      return;
    }
    const started = Date.now();
    const id = window.setInterval(
      () => setSecs(Math.round((Date.now() - started) / 1000)),
      500
    );
    return () => window.clearInterval(id);
  }, [running]);

  const reasoning = steps.filter((s) => s.type === "reasoning");
  // A "tick" is a heartbeat line ending in "(Ns)". They drive the live label and
  // the token total but are never concatenated into the trace — that produced
  // the old "Reasoning… (8s)Reasoning… (16s)…" repetition.
  const isTick = (s: AgentStep) => /\(\d+s\)\s*$/.test((s.content || "").trim());
  const blocks = reasoning.filter((s) => !isTick(s) && (s.content || "").trim());
  const totalTokens = reasoning.reduce((a, s) => a + (s.executionTimeMs || 0), 0);
  const verbatim = blocks.map((s) => s.content || "").join("").trim();

  const work = steps.filter((s) =>
    ["plan", "info", "sql", "result"].includes(s.type)
  );
  const items = (() => {
    const out: { step: AgentStep; label: string }[] = [];
    let previous = "";
    for (const step of work) {
      const label = describeStep(step);
      if (!label || label === previous) continue;
      previous = label;
      out.push({ step, label });
    }
    return out;
  })();

  // The live line prefers the model's own latest reasoning sentence, then the
  // heartbeat label, then the current step. Tool-call syntax is filtered out —
  // it's internal mechanics, not status.
  const isToolNoise = (l: string) =>
    /<\/?tool_call>|^[[\]{}"':,]*$|^"?(name|arguments|parameters)"?\s*:|^[{}]/.test(l);
  const lastLine = (() => {
    const lines = verbatim
      .split("\n")
      .map((l) => l.replace(/<\/?tool_call>/g, "").trim())
      .filter((l) => l && !isToolNoise(l));
    return lines.length ? lines[lines.length - 1] : "";
  })();
  const ticks = reasoning.filter(isTick);
  const lastTick = (ticks.length ? ticks[ticks.length - 1].content || "" : "")
    .replace(/\s*\(\d+s\)\s*$/, "")
    .trim();
  const statusStep = [...steps]
    .reverse()
    .find((s) => s.type !== "reasoning" && s.type !== "error");
  const liveRaw =
    lastLine || lastTick || (statusStep ? stepLabel(statusStep) : "") || "Working…";
  const liveLine = useThrottledValue(
    running ? (liveRaw.length > 140 ? `${liveRaw.slice(0, 138)}…` : liveRaw) : "",
    400
  );

  if (!steps.length && !running) return null;

  return (
    <>
      {reasoning.length > 0 && (
        <AtlNode type="thinking" tone="muted">
          <div className="atl-label">
            {verbatim ? (
              <button
                type="button"
                className="atl-toggle"
                onClick={() => setOpen((v) => !v)}
              >
                <span>
                  {running && !items.length ? "Thinking" : "Reasoned through it"}
                </span>
                <Chev open={open} />
              </button>
            ) : (
              <span>{running ? "Thinking" : "Reasoned through it"}</span>
            )}
            {totalTokens > 0 && (
              <span className="atl-tok">
                <AnimatedNumber value={totalTokens} /> tokens
              </span>
            )}
          </div>
          {open && verbatim && (
            <div className="atl-detail">
              <pre className="atl-trace">{verbatim}</pre>
            </div>
          )}
        </AtlNode>
      )}

      {items.map((item, i) => (
        <WorkNode key={i} step={item.step} label={item.label} />
      ))}

      {running && (
        <AtlNode type="info" live>
          <div className="atl-label">
            <span className="atl-live-line" key={liveLine}>
              {liveLine || "Working…"}
            </span>
            {secs > 0 && <span className="atl-time">{secs}s</span>}
          </div>
        </AtlNode>
      )}
    </>
  );
}
