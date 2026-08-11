/**
 * Reading an agent turn.
 *
 * A turn arrives as a flat list of steps. These helpers decide what it actually
 * produced — the answer, the deliverable artifact, the query behind it — and
 * which of those the workbench should show. Ported from SOAR's Analyze room,
 * where the same rules keep an intermediate chart from appearing under a final
 * report, or a result grid from duplicating a table the model already wrote out.
 */
import type { AgentStep } from "./agent";
import type { Exchange, Thread } from "./store";
import type { StoredArtifact, StoredExchange, StoredStep } from "./threads";

/** Step types that render an interactive record-change card. */
export const MUTATION_STEP_TYPES = [
  "form",
  "change_set",
  "bulk_update",
  "bulk_intake",
  "attachments_bulk_intake",
  "attachments_bulk",
];

/** Columns whose numeric values should read as money in a result grid. */
export const MONEY_HINT =
  /(rent|cost|amount|price|value|spend|income|expense|tax|payout|balance|fee)/i;

export const newThreadId = (): string =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? `soar_${crypto.randomUUID()}`
    : `soar_${Date.now()}_${Math.random().toString(36).slice(2)}`;

export function titleize(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function money(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function isJsonBlob(text: string): boolean {
  const t = (text || "").trim();
  if (!(t.startsWith("{") || t.startsWith("["))) return false;
  try {
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
}

/**
 * The agent's loop narrates its own retries ("attempt 1/2", "asking the agent to
 * address it"). That is bookkeeping, not a step the user did anything with — the
 * real outcome shows as the answer, a card, or the diagnostics block.
 */
export const INTERNAL_STEP =
  /asking the agent to address it|unresolved error\b|re-?prompt|auto-?recovery|attempt \d+\s*\/\s*\d+/i;

/**
 * Describe what a query DOES in a few words, derived entirely client-side so the
 * timeline can narrate every step without spending a single extra token.
 */
export function describeSql(sql: string): string {
  const s = (sql || "").replace(/\s+/g, " ").trim();
  if (!s) return "Running a query";
  const from = s.match(/\bFROM\s+(?:[A-Za-z0-9_]+\.)?([A-Za-z0-9_]+)/i);
  const subject = (from ? titleize(from[1]) : "records").toLowerCase();
  const group = s.match(/\bGROUP\s+BY\s+(?:[A-Za-z0-9_]+\.)?([A-Za-z0-9_".]+)/i);
  const limit = s.match(/\bLIMIT\s+(\d+)/i);
  const isCount = /SELECT\s+COUNT\s*\(/i.test(s);
  const hasAggregate = /\b(SUM|AVG|MIN|MAX)\s*\(/i.test(s);
  const filtered = /\bWHERE\b/i.test(s);
  const column = group
    ? group[1].replace(/["'.]/g, " ").trim().split(" ").pop() || ""
    : "";

  let phrase: string;
  if (group) {
    phrase = `${isCount ? "Counting" : hasAggregate ? "Summarizing" : "Grouping"} ${subject} by ${column}`;
  } else if (isCount) {
    phrase = `Counting ${subject}`;
  } else if (limit) {
    phrase = `Listing ${limit[1]} ${subject}`;
  } else {
    phrase = `Reading ${subject}`;
  }
  if (filtered && !group) phrase += " (filtered)";
  return phrase;
}

const STEP_LABELS: Record<string, string> = {
  chart: "Building a chart",
  workflow: "Setting up a workflow",
  report: "Rendering a report",
  email_compose: "Drafting an email",
  bulk_email: "Preparing a bulk email",
  event_compose: "Drafting a calendar event",
  bulk_events: "Preparing calendar events",
  saved_view: "Opening a saved view",
  attachments: "Searching documents",
};

/** A few-word description of one step, or '' when it isn't worth a row. */
export function describeStep(step: AgentStep): string {
  if ((step.type === "sql" || step.type === "result") && step.sql)
    return describeSql(step.sql);
  if (STEP_LABELS[step.type]) return STEP_LABELS[step.type];
  const content = (step.content || "").trim();
  if (content && INTERNAL_STEP.test(content)) return "";
  if (content && !isJsonBlob(content))
    return content.length > 160 ? `${content.slice(0, 157)}…` : content;
  if (step.type === "plan") return "Planning the approach";
  return "";
}

/**
 * The canonical answer for an exchange.
 *
 * The agent closes every turn with a `done` step carrying the COMPLETE answer;
 * the intermediate `text`/`answer` deltas are the same prose arriving in pieces,
 * so joining them all would print the answer twice. Prefer the final `done` and
 * fall back to the streamed text only before it lands.
 */
export function answerOf(steps: AgentStep[]): string {
  // A web-search turn puts the real answer in the card's summary; its `done`
  // step is only a pointer to it. Prefer the summary so history keeps the answer.
  const webSearch = steps.find(
    (s) =>
      s.type === "web_search_results" &&
      typeof s.chart?.summary === "string" &&
      s.chart.summary.trim()
  );
  if (webSearch) return String(webSearch.chart.summary);

  const finals = steps.filter(
    (s) => s.type === "done" && s.content && !isJsonBlob(s.content)
  );
  if (finals.length) return stripSuggestMarker(finals[finals.length - 1].content);

  return stripSuggestMarker(
    steps
      .filter(
        (s) =>
          (s.type === "answer" || s.type === "text") &&
          s.content &&
          !isJsonBlob(s.content)
      )
      .map((s) => s.content)
      .join("\n\n")
  );
}

/**
 * Strip the trailing SUGGESTIONS_JSON marker. The server already removes it from
 * the final `done` step, but the answer can stream as `text` deltas with the
 * marker tail visible before `done` lands, so strip it defensively too.
 */
function stripSuggestMarker(text: string): string {
  return text.replace(/\n*\s*SUGGESTIONS_JSON:[\s\S]*$/i, "").trimEnd();
}

export function chartIsReport(chart: any): boolean {
  return (
    !!chart &&
    typeof chart === "object" &&
    (chart.downloadUrl || chart.templateId || chart.html)
  );
}

/** True when a figure has something plottable — x/y series, or labels/values. */
export function chartPlottable(chart: any): boolean {
  const traces = Array.isArray(chart?.data || chart?.traces)
    ? chart.data || chart.traces
    : null;
  const first = traces?.[0];
  if (!first) return false;
  return !!(
    (Array.isArray(first.x) && Array.isArray(first.y) && first.x.length) ||
    (Array.isArray(first.labels) &&
      Array.isArray(first.values) &&
      first.values.length)
  );
}

/** Parse `FROM <ns>.<type>` so result rows can click through to the record. */
export function tableFromSql(sql?: string): { ns: string; type: string } | null {
  if (!sql) return null;
  const m = sql.match(/\bfrom\s+([a-z_][\w]*)\.([a-z_][\w]*)/i);
  return m ? { ns: m[1], type: m[2] } : null;
}

/**
 * The SINGLE owning type of a result, or null when the rows don't come from one
 * type. A joined or multi-table row maps to no single record, so it can't open.
 */
export function singleTypeFromSql(
  sql?: string
): { ns: string; type: string } | null {
  if (!sql) return null;
  const s = sql.replace(/\s+/g, " ");
  if (/\bJOIN\b/i.test(s)) return null;
  const m = s.match(
    /\bFROM\s+([a-z_][\w]*)\.([a-z_][\w]*)\s*((?:,\s*[a-z_][\w.]*\s*)*)/i
  );
  if (!m) return null;
  if (m[3] && m[3].trim()) return null; // FROM a.x, b.y → multi-type
  return { ns: m[1], type: m[2] };
}

/** Aggregated rows are group summaries, not records, so they aren't openable. */
export function isAggregateSql(sql?: string): boolean {
  if (!sql) return false;
  const s = sql.replace(/\s+/g, " ");
  return /\bGROUP\s+BY\b/i.test(s) || /\b(COUNT|SUM|AVG|MIN|MAX)\s*\(/i.test(s);
}

export interface ReportRef {
  name?: string;
  downloadUrl?: string;
  templateId?: string;
}

/**
 * Find the report a turn produced.
 *
 * The name usually lands on a different step than the render result — typically
 * an earlier "Saved template '<name>'" note — while the render step carries only
 * the id. Scan every step for a name so the card and the "schedule it" prompt
 * both reference the real report.
 */
export function extractReport(steps: AgentStep[]): ReportRef | null {
  let found: ReportRef | null = null;
  let name: string | undefined;
  const takeName = (n?: string) => {
    const t = n?.trim();
    if (t && !name) name = t;
  };

  for (const step of steps) {
    takeName((step.chart as any)?.name || (step.chart as any)?.templateName);
    if (step.content) {
      const m = step.content.match(
        /Saved template ['"‘’“”]([^'"‘’“”]+)['"‘’“”]/i
      );
      if (m) takeName(m[1]);
    }
    if (!found) {
      if (chartIsReport(step.chart)) {
        found = {
          name: step.chart.name || step.chart.templateName,
          downloadUrl: step.chart.downloadUrl,
          templateId: step.chart.templateId,
        };
      } else if (step.content && isJsonBlob(step.content)) {
        try {
          const o = JSON.parse(step.content.trim());
          if (o.downloadUrl || o.templateId) {
            found = {
              name: o.name,
              downloadUrl: o.downloadUrl,
              templateId: o.templateId,
            };
          }
        } catch {
          /* not a report blob */
        }
      }
    }
  }
  if (found && !found.name?.trim() && name) found.name = name;
  return found;
}

/**
 * The report template the user has "open" in this thread — the most recent
 * exchange that rendered a saved report. Passing it back tells the agent WHICH
 * template an "edit this report" follow-up means, so it revises that one instead
 * of authoring a duplicate.
 */
export function focusedReportOf(thread: Thread): string | undefined {
  for (let i = thread.exchanges.length - 1; i >= 0; i--) {
    const id = extractReport(thread.exchanges[i].steps)?.templateId?.trim();
    if (id) return id;
  }
  return undefined;
}

/**
 * The attachments card's step: prefer a resolved file list, then a query spec
 * the card resolves itself, then a scopes index. All three render the same card.
 */
export function findAttachStep(steps: AgentStep[]): AgentStep | undefined {
  const candidates = steps.filter(
    (s) => (s.type === "attachments" || s.type === "attachments_index") && s.chart
  );
  return (
    candidates.find(
      (s) =>
        Array.isArray((s.chart as any).attachments) &&
        (s.chart as any).attachments.length
    ) ||
    candidates.find((s) => (s.chart as any).query) ||
    candidates.find(
      (s) => Array.isArray((s.chart as any).scopes) && (s.chart as any).scopes.length
    )
  );
}

/**
 * The durable artifacts an exchange produced, so its cards re-render after the
 * thread is reloaded. The answer text alone would lose them.
 */
export function deriveArtifacts(ex: Exchange): StoredArtifact[] {
  const artifacts: StoredArtifact[] = [];

  const workflow = ex.steps.find(
    (s) => s.type === "workflow" && (s.chart?.initial?._id || s.chart?.workflow_id)
  );
  // Pin the version: persist the workflow as authored, so the card keeps showing
  // that snapshot even after the live workflow moves on.
  if (workflow) {
    artifacts.push({
      kind: "workflow",
      id: String(workflow.chart?.initial?._id || workflow.chart?.workflow_id || ""),
      name: workflow.chart?.initial?.name,
      payload: workflow.chart?.initial,
    });
  }

  const savedView = ex.steps.find(
    (s) => s.type === "saved_view" && (s.chart as any)?.viewId && s.sql
  );
  if (savedView) {
    artifacts.push({
      kind: "saved_view",
      id: String((savedView.chart as any).viewId),
      name: savedView.content,
      payload: { chart: savedView.chart, sql: savedView.sql },
    });
  }

  const attach = findAttachStep(ex.steps);
  if (attach?.chart)
    artifacts.push({ kind: "attachments", name: "Files", payload: attach.chart });

  const report = extractReport(ex.steps);
  if (report && (report.templateId || report.downloadUrl)) {
    artifacts.push({
      kind: "report",
      id: report.templateId,
      name: report.name,
      url: report.downloadUrl,
    });
  }

  const webSearch = ex.steps.find((s) => s.type === "web_search_results" && s.chart);
  if (webSearch?.chart)
    artifacts.push({ kind: "websearch", name: webSearch.content, payload: webSearch.chart });

  const research = ex.steps.find((s) => s.type === "research_results" && s.chart);
  if (research?.chart)
    artifacts.push({ kind: "research", name: research.content, payload: research.chart });

  const email = ex.steps.find((s) => s.type === "email_compose" && s.chart);
  if (email?.chart)
    artifacts.push({
      kind: "email",
      name: String(email.chart.subject || "Email"),
      payload: email.chart,
    });

  const bulkEmail = ex.steps.find((s) => s.type === "bulk_email" && s.chart);
  if (bulkEmail?.chart)
    artifacts.push({ kind: "bulk_email", name: "Bulk email", payload: bulkEmail.chart });

  const event = ex.steps.find((s) => s.type === "event_compose" && s.chart);
  if (event?.chart)
    artifacts.push({
      kind: "event",
      name: String(event.chart.summary || "Event"),
      payload: event.chart,
    });

  const bulkEvents = ex.steps.find((s) => s.type === "bulk_events" && s.chart);
  if (bulkEvents?.chart)
    artifacts.push({ kind: "bulk_events", name: "Bulk events", payload: bulkEvents.chart });

  // Mutation cards: persist the spec so the card survives a refresh. Without it
  // the card vanishes and only an orphaned "Opened the edit form…" note remains,
  // which reads as "nothing to do".
  const mutation = ex.steps.find(
    (s) => MUTATION_STEP_TYPES.includes(s.type) && s.chart
  );
  if (mutation?.chart) {
    artifacts.push({
      kind: "mutation",
      name: mutation.content || "Proposed change",
      payload: { stepType: mutation.type, chart: mutation.chart },
    });
  }

  // A chart that IS the answer. Captured before the data snapshot below, so a
  // chart-answer turn doesn't also persist its intermediate grid.
  const chartStep = [...ex.steps]
    .reverse()
    .find(
      (s) =>
        s.chart &&
        s.type !== "workflow" &&
        s.type !== "workflow_run" &&
        s.type !== "workflow_runs" &&
        !chartIsReport(s.chart) &&
        chartPlottable(s.chart)
    );
  if (chartStep?.chart)
    artifacts.push({ kind: "chart", name: "Chart", payload: chartStep.chart });

  // A pure-read result that IS the answer → snapshot the first 50 rows plus the
  // SQL. Re-running the query later could return different data, so we pin what
  // was actually shown.
  if (!artifacts.length) {
    const dataStep = [...ex.steps].reverse().find((s) => s.data && s.data.length);
    const lastSql = [...ex.steps].reverse().find((s) => s.sql)?.sql;
    if (dataStep?.data?.length) {
      artifacts.push({
        kind: "data",
        name: "Result",
        payload: { rows: dataStep.data.slice(0, 50), sql: lastSql },
      });
    }
  }

  return artifacts.filter((a) => a.id || a.url || a.payload);
}

/** Compact the work steps for persistence, so the timeline survives a reload. */
export function deriveSteps(ex: Exchange): StoredStep[] {
  return ex.steps
    .filter((s) => ["plan", "info", "sql", "result"].includes(s.type))
    .map((s) => ({
      type: s.type === "result" ? "sql" : s.type,
      content: s.content || undefined,
      sql: s.sql || undefined,
      ms: s.executionTimeMs,
    }))
    .slice(0, 60);
}

/** Rebuild the minimal step stream from a stored exchange. Mirrors the above. */
export function stepsFromStored(ex: StoredExchange): AgentStep[] {
  const steps: AgentStep[] = [];
  for (const w of ex.steps || []) {
    steps.push({
      type: w.type,
      content: w.content || "",
      sql: w.sql,
      executionTimeMs: w.ms,
    } as AgentStep);
  }
  if (ex.answer) steps.push({ type: "done", content: ex.answer } as AgentStep);

  for (const a of ex.artifacts || []) {
    if (a.kind === "workflow" && a.id) {
      steps.push({
        type: "workflow",
        content: "",
        chart: { initial: a.payload || { _id: a.id, name: a.name || "Workflow" } },
      } as AgentStep);
    } else if (a.kind === "report") {
      steps.push({
        type: "info",
        content: "",
        chart: { name: a.name, templateId: a.id, downloadUrl: a.url },
      } as AgentStep);
    } else if (a.kind === "saved_view" && a.payload) {
      steps.push({
        type: "saved_view",
        content: a.name || "",
        sql: a.payload.sql,
        chart: a.payload.chart,
      } as AgentStep);
    } else if (a.kind === "attachments" && a.payload) {
      steps.push({
        type: "attachments",
        content: a.name || "",
        chart: a.payload,
      } as AgentStep);
    } else if (a.kind === "websearch" && a.payload) {
      steps.push({
        type: "web_search_results",
        content: a.name || "Web search",
        chart: a.payload,
      } as AgentStep);
    } else if (a.kind === "research" && a.payload) {
      steps.push({
        type: "research_results",
        content: a.name || "Research",
        chart: a.payload,
      } as AgentStep);
    } else if (a.kind === "email" && a.payload) {
      steps.push({
        type: "email_compose",
        content: a.name || "Email",
        chart: a.payload,
      } as AgentStep);
    } else if (a.kind === "bulk_email" && a.payload) {
      steps.push({
        type: "bulk_email",
        content: a.name || "Bulk email",
        chart: a.payload,
      } as AgentStep);
    } else if (a.kind === "event" && a.payload) {
      steps.push({
        type: "event_compose",
        content: a.name || "Event",
        chart: a.payload,
      } as AgentStep);
    } else if (a.kind === "bulk_events" && a.payload) {
      steps.push({
        type: "bulk_events",
        content: a.name || "Bulk events",
        chart: a.payload,
      } as AgentStep);
    } else if (a.kind === "mutation" && a.payload?.chart) {
      steps.push({
        type: a.payload.stepType || "change_set",
        content: a.name || "",
        chart: a.payload.chart,
      } as AgentStep);
    } else if (a.kind === "data" && a.payload?.rows) {
      steps.push({
        type: "sql",
        content: "",
        sql: a.payload.sql,
        data: a.payload.rows,
      } as AgentStep);
    } else if (a.kind === "chart" && a.payload) {
      steps.push({ type: "chart", content: "", chart: a.payload } as AgentStep);
    }
  }
  return steps;
}
