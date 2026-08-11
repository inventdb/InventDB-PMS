/**
 * Renders the figure the agent authored.
 *
 * The agent emits a Plotly-style spec (`{data: [traces], layout}`) because that
 * is what InventDB's chart tool produces. SOAR ships Plotly itself and renders
 * the spec verbatim; PMS draws every other chart with Recharts in the brand
 * palette, and pulling a second ~4 MB charting engine into this bundle to render
 * one card would be a poor trade. So the spec is translated instead: trace type,
 * series, axis titles and stacking are honoured, and colours come from the PMS
 * chart theme so an agent chart sits beside a dashboard chart without clashing.
 *
 * Anything the translation can't draw faithfully (heatmaps, 3-D, geo) falls back
 * to the figure's own numbers in a table — visible and checkable, never silently
 * dropped or, worse, redrawn as a different chart than the one asked for.
 */
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import ChartTooltip from "../components/ChartTooltip";
import { useChartTheme } from "../theme/charts";
import { titleize } from "./helpers";

interface Trace {
  type?: string;
  mode?: string;
  name?: string;
  x?: unknown[];
  y?: unknown[];
  labels?: unknown[];
  values?: unknown[];
  orientation?: "h" | "v";
  fill?: string;
  stackgroup?: string;
  marker?: { color?: string | string[] };
  line?: { color?: string; shape?: string };
}

/** Trace families this adapter draws. Everything else takes the table path. */
const SUPPORTED = new Set(["bar", "line", "scatter", "scattergl", "area", "pie", "histogram"]);

function traceKind(t: Trace): "bar" | "line" | "area" | "scatter" | "pie" | null {
  const type = String(t.type || "scatter").toLowerCase();
  if (type === "pie") return "pie";
  if (type === "bar" || type === "histogram") return "bar";
  if (type === "scatter" || type === "scattergl") {
    const mode = String(t.mode || "lines").toLowerCase();
    // A Plotly scatter with `fill` or a `stackgroup` is an area chart; one with
    // markers and no line is a true scatter; everything else is a line.
    if (t.fill && t.fill !== "none") return "area";
    if (t.stackgroup) return "area";
    if (mode.includes("markers") && !mode.includes("lines")) return "scatter";
    return "line";
  }
  if (type === "area") return "area";
  return null;
}

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function axisTitle(axis: any): string | undefined {
  const t = axis?.title;
  if (!t) return undefined;
  return typeof t === "string" ? t : t?.text ? String(t.text) : undefined;
}

/** Compact axis ticks: 12500 → 12.5k, 2400000 → 2.4M. */
function tickFormat(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v ?? "");
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  return n.toLocaleString();
}

export function ChartAdapter({ chart }: { chart: any }) {
  const theme = useChartTheme();
  const traces: Trace[] = Array.isArray(chart?.data || chart?.traces)
    ? chart.data || chart.traces
    : [];
  if (!traces.length) return null;

  const layout = chart?.layout || {};
  const title =
    (typeof layout.title === "string" ? layout.title : layout.title?.text) ||
    (typeof chart?.title === "string" ? chart.title : undefined);

  const unsupported = traces.some(
    (t) => !SUPPORTED.has(String(t.type || "scatter").toLowerCase()) || !traceKind(t)
  );
  if (unsupported) return <FigureTable chart={chart} title={title} />;

  const kinds = traces.map(traceKind);
  const isPie = kinds[0] === "pie";

  // ---- pie / donut -------------------------------------------------------
  if (isPie) {
    const t = traces[0];
    const rows = (t.labels || []).map((label, i) => ({
      name: String(label ?? "—"),
      value: num(t.values?.[i]) ?? 0,
    }));
    if (!rows.length) return <FigureTable chart={chart} title={title} />;
    const explicit = Array.isArray(t.marker?.color) ? (t.marker!.color as string[]) : null;
    const hole = Number((t as any).hole) || 0;
    return (
      <figure className="an-figure">
        {title && <figcaption className="an-figure-title">{title}</figcaption>}
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie
              data={rows}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={hole > 0 ? `${Math.round(hole * 100)}%` : 0}
              outerRadius="78%"
              paddingAngle={1}
              stroke="none"
            >
              {rows.map((_, i) => (
                <Cell key={i} fill={explicit?.[i] || theme.seriesAt(i)} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip />} />
            <Legend verticalAlign="bottom" height={28} iconType="circle" iconSize={9} />
          </PieChart>
        </ResponsiveContainer>
      </figure>
    );
  }

  // ---- cartesian ---------------------------------------------------------
  // Plotly holds each series as parallel x/y arrays; Recharts wants one row per
  // category with a key per series. Join on the x value, preserving the order
  // the first trace introduced each category in.
  const horizontal = traces.some((t) => t.orientation === "h");
  const categoryOf = (t: Trace) => (horizontal ? t.y : t.x) || [];
  const valueOf = (t: Trace) => (horizontal ? t.x : t.y) || [];

  const keys = traces.map((t, i) => String(t.name || `Series ${i + 1}`));
  const order: string[] = [];
  const byCategory = new Map<string, Record<string, unknown>>();
  traces.forEach((t, ti) => {
    const cats = categoryOf(t);
    const vals = valueOf(t);
    cats.forEach((c, i) => {
      const key = String(c ?? "—");
      let row = byCategory.get(key);
      if (!row) {
        row = { __x: key };
        byCategory.set(key, row);
        order.push(key);
      }
      row[keys[ti]] = num(vals[i]);
    });
  });
  const rows = order.map((k) => byCategory.get(k)!);
  if (!rows.length) return <FigureTable chart={chart} title={title} />;

  const stacked = traces.some((t) => t.stackgroup) || layout.barmode === "stack";
  const showLegend = traces.length > 1;
  // A figure with one kind of mark draws on that mark's own chart. A mixed one
  // — bars with a trend line over them, which the agent does produce — needs
  // ComposedChart: any other base silently drops the marks it doesn't own.
  const families = new Set(kinds);
  const single = families.size === 1 ? kinds[0] : null;

  const gridAndAxes = (
    <>
      <CartesianGrid stroke={theme.grid} strokeDasharray="3 3" vertical={false} />
      <XAxis
        dataKey="__x"
        type={horizontal ? "number" : "category"}
        stroke={theme.axis}
        tick={{ fontSize: 11, fill: theme.axis }}
        tickLine={false}
        axisLine={{ stroke: theme.grid }}
        tickFormatter={horizontal ? tickFormat : undefined}
        label={
          axisTitle(layout.xaxis)
            ? {
                value: axisTitle(layout.xaxis),
                position: "insideBottom",
                offset: -4,
                fill: theme.axis,
                fontSize: 11,
              }
            : undefined
        }
        height={axisTitle(layout.xaxis) ? 44 : 28}
        interval="preserveStartEnd"
      />
      <YAxis
        type={horizontal ? "category" : "number"}
        dataKey={horizontal ? "__x" : undefined}
        stroke={theme.axis}
        tick={{ fontSize: 11, fill: theme.axis }}
        tickLine={false}
        axisLine={false}
        width={horizontal ? 110 : 56}
        tickFormatter={horizontal ? undefined : tickFormat}
      />
      <Tooltip content={<ChartTooltip />} cursor={{ fill: theme.cursor }} />
      {showLegend && (
        <Legend verticalAlign="bottom" height={28} iconType="circle" iconSize={9} />
      )}
    </>
  );

  // The agent stamps its own default palette on every trace — a generic blue
  // that knows nothing about this app's theme and reads as a foreign element
  // beside the dashboard's charts. A flat per-trace colour is therefore treated
  // as a default and replaced by the brand slot for that series. A per-POINT
  // colour array is different: that is deliberate encoding (this bar is the
  // overdue one), so it is honoured as given.
  const seriesColor = (t: Trace, i: number) =>
    Array.isArray(t.marker?.color)
      ? (t.marker!.color as string[])[0] || theme.seriesAt(i)
      : theme.seriesAt(i);

  const body = traces.map((t, i) => {
    const kind = kinds[i];
    const color = seriesColor(t, i);
    const key = keys[i];
    if (kind === "bar") {
      // A per-point colour array means the agent coloured individual bars on
      // purpose; Recharts expresses that as one <Cell> per datum.
      const perPoint = Array.isArray(t.marker?.color)
        ? (t.marker!.color as string[])
        : null;
      return (
        <Bar
          key={key}
          dataKey={key}
          fill={color}
          stackId={stacked ? "a" : undefined}
          radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
          maxBarSize={54}
        >
          {perPoint &&
            rows.map((_, ri) => <Cell key={ri} fill={perPoint[ri] || color} />)}
        </Bar>
      );
    }
    if (kind === "area") {
      return (
        <Area
          key={key}
          type={t.line?.shape === "linear" ? "linear" : "monotone"}
          dataKey={key}
          stroke={color}
          fill={color}
          fillOpacity={0.18}
          strokeWidth={2}
          stackId={stacked ? "a" : undefined}
          dot={false}
        />
      );
    }
    if (kind === "scatter") {
      return <Scatter key={key} dataKey={key} fill={color} />;
    }
    return (
      <Line
        key={key}
        type={t.line?.shape === "linear" ? "linear" : "monotone"}
        dataKey={key}
        stroke={color}
        strokeWidth={2}
        dot={rows.length <= 24 ? { r: 2.5, strokeWidth: 0, fill: color } : false}
        activeDot={{ r: 4 }}
      />
    );
  });

  const Chart =
    single === "bar"
      ? BarChart
      : single === "area"
        ? AreaChart
        : single === "scatter"
          ? ScatterChart
          : single === "line"
            ? LineChart
            : ComposedChart;

  return (
    <figure className="an-figure">
      {title && <figcaption className="an-figure-title">{title}</figcaption>}
      <ResponsiveContainer width="100%" height={320}>
        <Chart
          data={rows}
          layout={horizontal ? "vertical" : "horizontal"}
          margin={{ top: 8, right: 12, bottom: 4, left: 0 }}
        >
          {gridAndAxes}
          {body}
        </Chart>
      </ResponsiveContainer>
    </figure>
  );
}

/**
 * The fallback for a figure this adapter won't redraw. Showing the numbers is
 * honest; approximating an unfamiliar chart type with a familiar one is not.
 */
function FigureTable({ chart, title }: { chart: any; title?: string }) {
  const traces: Trace[] = Array.isArray(chart?.data || chart?.traces)
    ? chart.data || chart.traces
    : [];
  const rows: { label: string; cells: string[] }[] = [];
  const headers: string[] = ["Category"];

  traces.forEach((t, i) => headers.push(String(t.name || `Series ${i + 1}`)));
  const categories: string[] = [];
  traces.forEach((t) => {
    const cats = (t.labels || t.x || []) as unknown[];
    cats.forEach((c) => {
      const key = String(c ?? "—");
      if (!categories.includes(key)) categories.push(key);
    });
  });
  for (const category of categories) {
    const cells = traces.map((t) => {
      const cats = (t.labels || t.x || []) as unknown[];
      const vals = (t.values || t.y || []) as unknown[];
      const idx = cats.findIndex((c) => String(c ?? "—") === category);
      const v = idx >= 0 ? vals[idx] : undefined;
      return v == null ? "—" : typeof v === "number" ? v.toLocaleString() : String(v);
    });
    rows.push({ label: category, cells });
  }

  if (!rows.length) return null;
  const kind = String(traces[0]?.type || "figure");
  return (
    <div className="an-figure">
      {title && <div className="an-figure-title">{title}</div>}
      <p className="an-note">
        This is a {titleize(kind).toLowerCase()} figure, which this view shows as its
        underlying numbers.
      </p>
      <div className="an-table-wrap">
        <table className="an-table">
          <thead>
            <tr>
              {headers.map((h, i) => (
                <th key={i}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{r.label}</td>
                {r.cells.map((c, ci) => (
                  <td key={ci} className="an-num">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
