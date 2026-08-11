/**
 * Web search and research results.
 *
 * The agent's hosted `web_search` emits one `web_search_results` step carrying
 * `{queries, sources, citations, search_count, summary}`; `emit_research` emits
 * a `research_results` step with `{title, summary, citations}`. Both render as a
 * calm summary card that leads with the synthesised answer and lets you open
 * every source and citation in place.
 *
 * SOAR routes the full list to its own page; here it expands inline, so opening
 * the sources never costs you the thread you were reading.
 */
import { useState } from "react";
import { ExternalLink, Globe, Search } from "lucide-react";

import type { AgentStep } from "../agent";
import { Markdown } from "../Markdown";

export interface WebSource {
  url?: string;
  title?: string;
  page_age?: string;
}
export interface WebCitation {
  url?: string;
  title?: string;
  cited_text?: string;
}
export interface WebSearchData {
  title?: string;
  queries: string[];
  sources: WebSource[];
  citations: WebCitation[];
  search_count?: number;
  summary?: string;
}
export interface ResearchData {
  title?: string;
  summary?: string;
  citations: WebCitation[];
}

export function webSearchFromSteps(steps: AgentStep[]): WebSearchData | null {
  const step = steps.find((s) => s.type === "web_search_results" && s.chart);
  if (!step) return null;
  const chart: any = step.chart || {};
  const queries = Array.isArray(chart.queries) ? chart.queries.map(String) : [];
  return {
    title: step.content || queries[0] || "Web search",
    queries,
    sources: Array.isArray(chart.sources) ? chart.sources : [],
    citations: Array.isArray(chart.citations) ? chart.citations : [],
    search_count: Number(chart.search_count) || undefined,
    summary: typeof chart.summary === "string" ? chart.summary : "",
  };
}

export function researchFromSteps(steps: AgentStep[]): ResearchData | null {
  const step = steps.find((s) => s.type === "research_results" && s.chart);
  if (!step) return null;
  const chart: any = step.chart || {};
  return {
    title: step.content || chart.title || "Research",
    summary: typeof chart.summary === "string" ? chart.summary : "",
    citations: Array.isArray(chart.citations) ? chart.citations : [],
  };
}

function domainOf(url?: string): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.replace(/^https?:\/\//, "").split("/")[0];
  }
}

function SourceRow({ source }: { source: WebSource | WebCitation }) {
  const domain = domainOf(source.url);
  return (
    <a
      className="an-source"
      href={source.url}
      target="_blank"
      rel="noreferrer"
      title={source.url}
    >
      <span className="an-favicon" aria-hidden>
        {(domain[0] || "·").toUpperCase()}
      </span>
      <span className="an-source-text">
        <span className="an-source-title">{source.title || domain || source.url}</span>
        <span className="an-source-domain">
          {domain}
          {"page_age" in source && source.page_age ? ` · ${source.page_age}` : ""}
        </span>
      </span>
      <ExternalLink size={13} className="an-source-ext" aria-hidden />
    </a>
  );
}

function CitationBlock({ citations }: { citations: WebCitation[] }) {
  if (!citations.length) return null;
  return (
    <>
      <div className="an-card-label">Citations</div>
      <div className="an-cites">
        {citations.map((c, i) => (
          <div className="an-cite" key={i}>
            {c.cited_text && <blockquote>{c.cited_text}</blockquote>}
            <a href={c.url} target="_blank" rel="noreferrer">
              {c.title || domainOf(c.url) || c.url}
              <span className="an-source-domain"> · {domainOf(c.url)}</span>
            </a>
          </div>
        ))}
      </div>
    </>
  );
}

export function WebSearchCard({ data }: { data: WebSearchData }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? data.sources : data.sources.slice(0, 3);
  const more = data.sources.length - shown.length;

  return (
    <div className="an-card">
      <div className="an-card-head">
        <span className="an-mark" aria-hidden>
          <Globe size={17} />
        </span>
        <div className="an-card-titles">
          <div className="an-card-title">Web search</div>
          <div className="an-note">
            {data.search_count
              ? `${data.search_count} search${data.search_count === 1 ? "" : "es"} · `
              : ""}
            {data.sources.length} source{data.sources.length === 1 ? "" : "s"} from the
            public web
          </div>
        </div>
        <span className="an-tag is-ai">✦ blended with the web</span>
      </div>

      {data.queries.length > 0 && (
        <div className="an-chip-rail">
          <span className="an-note">Searched</span>
          {data.queries.map((q, i) => (
            <span className="an-chip is-static" key={i}>
              {q}
            </span>
          ))}
        </div>
      )}

      {data.summary ? (
        <Markdown text={data.summary} />
      ) : (
        <p className="an-note">No written summary for this search.</p>
      )}

      {data.sources.length > 0 && (
        <>
          <div className="an-card-label">Sources</div>
          <div className="an-sources">
            {shown.map((s, i) => (
              <SourceRow key={i} source={s} />
            ))}
          </div>
          {(more > 0 || expanded) && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded
                ? "Show fewer sources"
                : `View all ${data.sources.length} sources${data.citations.length ? " & citations" : ""} →`}
            </button>
          )}
          {expanded && <CitationBlock citations={data.citations} />}
        </>
      )}
    </div>
  );
}

export function ResearchCard({ data }: { data: ResearchData }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? data.citations : data.citations.slice(0, 3);
  const more = data.citations.length - shown.length;

  return (
    <div className="an-card">
      <div className="an-card-head">
        <span className="an-mark" aria-hidden>
          <Search size={17} />
        </span>
        <div className="an-card-titles">
          <div className="an-card-title">{data.title || "Research"}</div>
          <div className="an-note">
            {data.citations.length} source{data.citations.length === 1 ? "" : "s"} from
            the public web
          </div>
        </div>
        <span className="an-tag is-ai">✦ researched with the web</span>
      </div>

      {data.summary ? (
        <Markdown text={data.summary} />
      ) : (
        <p className="an-note">No write-up for this research.</p>
      )}

      {data.citations.length > 0 && (
        <>
          <div className="an-card-label">Citations</div>
          <div className="an-sources">
            {shown.map((c, i) => (
              <SourceRow key={i} source={c} />
            ))}
          </div>
          {(more > 0 || expanded) && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded
                ? "Show fewer citations"
                : `Open all ${data.citations.length} citations →`}
            </button>
          )}
          {expanded && <CitationBlock citations={data.citations} />}
        </>
      )}
    </div>
  );
}
