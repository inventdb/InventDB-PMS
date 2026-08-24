/**
 * Dashboard charts — ported from InventDB SOAR's `lib/charts.tsx`.
 *
 * Calm inline SVG and CSS: 2px strokes with rounded caps, horizontal-only
 * gridlines at 5% opacity, a single-hue area fading to transparent, 11–12px
 * muted axis labels. No chart borders, no gauges, nothing three-dimensional.
 * One hue throughout — except category share, where a flat pie or donut with a
 * legend reads best.
 *
 * SOAR's tokens are renamed to the PMS's (`--fg` → `--text`, `--bg-raised` →
 * `--surface`, `--accent-solid` → `--brand-solid`); the geometry, the hover
 * behaviour and the label thinning are unchanged.
 */
import { useState } from "react";

/** A tick label: month buckets and ISO dates read compactly, anything else is
 *  passed through as it came. */
export function axisLabel(v: unknown): string {
  const s = String(v ?? "").trim();
  if (!s) return "";
  const m = /^(\d{4})-(\d{2})$/.exec(s);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, 1);
    return isNaN(d.getTime())
      ? s
      : d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
  }
  if (/^\d{4}-\d{2}-\d{2}([T ]|$)/.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime())
      ? s
      : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  return s;
}

export interface Point {
  label: string;
  value: number;
}

/* ── Pie / donut ────────────────────────────────────────────────────────── */

/** Flat category share. Hovering a slice or its legend row highlights the pair. */
export function PieChart({ data, donut = false }: { data: Point[]; donut?: boolean }) {
  const [hov, setHov] = useState<number | null>(null);
  const rows = data.filter((d) => Number.isFinite(d.value));
  const total = rows.reduce((s, d) => s + (d.value || 0), 0) || 1;
  // Distinct flat hues stepped around the brand indigo — theme-aware, no 3D.
  const hue = (i: number) => `hsl(${(264 + i * 47) % 360} 52% ${58 - (i % 3) * 9}%)`;
  const C = 100;
  const R = 92;
  let acc = 0;

  const segs = rows.map((d, i) => {
    const frac = (d.value || 0) / total;
    const a0 = acc * 2 * Math.PI - Math.PI / 2;
    acc += frac;
    const a1 = acc * 2 * Math.PI - Math.PI / 2;
    const large = frac > 0.5 ? 1 : 0;
    // A single full-circle slice cannot be drawn with one arc (start === end),
    // so it becomes a plain circle instead.
    const x0 = C + R * Math.cos(a0);
    const y0 = C + R * Math.sin(a0);
    const x1 = C + R * Math.cos(a1);
    const y1 = C + R * Math.sin(a1);
    const path =
      frac >= 0.999
        ? null
        : `M${C},${C} L${x0.toFixed(2)},${y0.toFixed(2)} A${R},${R} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)} Z`;
    return { d, i, path, frac, full: frac >= 0.999 };
  });

  return (
    <div className="wg-pie">
      <svg viewBox="0 0 200 200" role="img" aria-label="pie chart">
        {segs.map((s) =>
          s.full ? (
            <circle
              key={s.i}
              cx={C}
              cy={C}
              r={R}
              fill={hue(s.i)}
              onMouseEnter={() => setHov(s.i)}
              onMouseLeave={() => setHov(null)}
            >
              <title>{`${s.d.label}: ${s.d.value} (100%)`}</title>
            </circle>
          ) : (
            <path
              key={s.i}
              d={s.path!}
              fill={hue(s.i)}
              stroke="var(--surface)"
              strokeWidth={1}
              opacity={hov === null || hov === s.i ? 1 : 0.35}
              style={{ transition: "opacity .15s" }}
              onMouseEnter={() => setHov(s.i)}
              onMouseLeave={() => setHov(null)}
            >
              <title>{`${s.d.label}: ${s.d.value} (${(s.frac * 100).toFixed(1)}%)`}</title>
            </path>
          )
        )}
        {donut && <circle cx={C} cy={C} r={R * 0.58} fill="var(--surface)" />}
      </svg>
      <div className="wg-legend">
        {segs.map((s) => (
          <div
            key={s.i}
            className="wg-legend-row"
            style={{ opacity: hov === null || hov === s.i ? 1 : 0.5 }}
            onMouseEnter={() => setHov(s.i)}
            onMouseLeave={() => setHov(null)}
          >
            <span className="wg-swatch" style={{ background: hue(s.i) }} />
            <span className="wg-legend-label">{axisLabel(s.d.label)}</span>
            <span className="wg-legend-value">{s.d.value.toLocaleString()}</span>
            <span className="wg-legend-pct">{(s.frac * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Grouped bars ───────────────────────────────────────────────────────── */

export function GroupedBars({
  categories,
  series,
}: {
  categories: string[];
  series: { name: string; values: number[]; color?: string }[];
}) {
  const [hov, setHov] = useState<string | null>(null);
  const max = Math.max(1, ...series.flatMap((s) => s.values.map((v) => v || 0)));
  const palette = [
    "var(--brand-solid)",
    "var(--brand-strong)",
    "#10b981",
    "#f59e0b",
    "#ef4444",
    "#8b5cf6",
  ];
  const colorOf = (s: { color?: string }, i: number) => s.color || palette[i % palette.length];

  return (
    <div>
      <div className="wg-groups">
        {categories.map((cat, ci) => (
          <div key={ci} className="wg-group">
            <div className="wg-group-bars">
              {series.map((s, si) => {
                const v = s.values[ci] || 0;
                const key = `${ci}:${si}`;
                return (
                  <span
                    key={si}
                    title={`${s.name} · ${axisLabel(cat)}: ${v.toLocaleString()}`}
                    onMouseEnter={() => setHov(key)}
                    onMouseLeave={() => setHov(null)}
                    style={{
                      height: `${(v / max) * 100}%`,
                      background: colorOf(s, si),
                      opacity: hov === null || hov === key ? 1 : 0.4,
                    }}
                  />
                );
              })}
            </div>
            <span className="wg-group-label">{axisLabel(cat)}</span>
          </div>
        ))}
      </div>
      <div className="wg-legend-inline">
        {series.map((s, si) => (
          <span key={si}>
            <span className="wg-swatch" style={{ background: colorOf(s, si) }} />{" "}
            {s.name || `Series ${si + 1}`}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ── Area / line ────────────────────────────────────────────────────────── */

export function AreaLine({ points, height = 120 }: { points: Point[]; height?: number }) {
  const [hov, setHov] = useState<number | null>(null);
  if (!points.length) return null;

  const w = 100;
  const h = height;
  const max = Math.max(1, ...points.map((p) => p.value));
  const min = Math.min(0, ...points.map((p) => p.value));
  const span = max - min || 1;
  const step = points.length > 1 ? w / (points.length - 1) : w;
  const xy = points.map((p, i): [number, number] => [
    i * step,
    h - ((p.value - min) / span) * (h - 12) - 6,
  ]);
  const line = xy
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
  const area = `${line} L${w},${h} L0,${h} Z`;

  // At most ~7 evenly spaced ticks, always including the last, so a long daily
  // series doesn't crush into an unreadable wall of dates.
  const maxTicks = 7;
  const stepL = points.length <= maxTicks ? 1 : Math.ceil(points.length / maxTicks);
  const tickIdx: number[] = [];
  for (let i = 0; i < points.length; i += stepL) tickIdx.push(i);
  if (tickIdx.length && tickIdx[tickIdx.length - 1] !== points.length - 1)
    tickIdx.push(points.length - 1);

  const xPct = (i: number) => (points.length > 1 ? (i / (points.length - 1)) * 100 : 50);
  const yPct = (i: number) => (xy[i][1] / h) * 100;

  return (
    <div>
      <div style={{ position: "relative" }}>
        <svg
          viewBox={`0 0 ${w} ${h}`}
          preserveAspectRatio="none"
          style={{ width: "100%", height, display: "block" }}
        >
          {[0.25, 0.5, 0.75].map((g) => (
            <line
              key={g}
              x1={0}
              x2={w}
              y1={h * g}
              y2={h * g}
              stroke="var(--text)"
              strokeOpacity={0.05}
              strokeWidth={1}
            />
          ))}
          <path d={area} fill="var(--brand)" fillOpacity={0.09} />
          <path
            d={line}
            fill="none"
            stroke="var(--brand-solid)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          {hov !== null && (
            <line
              x1={xy[hov][0]}
              x2={xy[hov][0]}
              y1={0}
              y2={h}
              stroke="var(--brand)"
              strokeOpacity={0.35}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        {/* An HTML overlay, so the dot and tooltip aren't distorted by the
            stretched (preserveAspectRatio: none) SVG. */}
        <div style={{ position: "absolute", inset: 0 }}>
          {points.map((_, i) => (
            <div
              key={i}
              onMouseEnter={() => setHov(i)}
              onMouseLeave={() => setHov(null)}
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: `${Math.max(0, xPct(i) - 50 / points.length)}%`,
                width: `${100 / points.length}%`,
                cursor: "default",
              }}
            />
          ))}
          {hov !== null && (
            <span className="wg-dot" style={{ left: `${xPct(hov)}%`, top: `${yPct(hov)}%` }} />
          )}
          {hov !== null && (
            <span
              className="wg-tip"
              style={{
                left: `${Math.min(90, Math.max(4, xPct(hov)))}%`,
                top: `${yPct(hov)}%`,
              }}
            >
              {axisLabel(points[hov].label)}: {points[hov].value.toLocaleString()}
            </span>
          )}
        </div>
      </div>
      <div className="wg-ticks">
        {tickIdx.map((i) => (
          <span key={i}>{axisLabel(points[i].label)}</span>
        ))}
      </div>
    </div>
  );
}

/* ── Scatter ────────────────────────────────────────────────────────────── */

export function ScatterPlot({
  points,
  height = 170,
}: {
  points: { x: number; y: number; label?: string }[];
  height?: number;
}) {
  const pts = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (!pts.length) return null;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const xmin = Math.min(...xs);
  const xmax = Math.max(...xs);
  const ymin = Math.min(...ys);
  const ymax = Math.max(...ys);
  const xr = xmax - xmin || 1;
  const yr = ymax - ymin || 1;

  return (
    <div>
      <div className="wg-scatter" style={{ height }}>
        {[0.25, 0.5, 0.75].map((g) => (
          <div key={g} className="wg-gridline" style={{ top: `${g * 100}%` }} />
        ))}
        {pts.map((p, i) => (
          <span
            key={i}
            className="wg-point"
            title={`${p.label ? p.label + ": " : ""}(${p.x.toLocaleString()}, ${p.y.toLocaleString()})`}
            style={{
              left: `${((p.x - xmin) / xr) * 96 + 2}%`,
              top: `${(1 - (p.y - ymin) / yr) * 90 + 5}%`,
            }}
          />
        ))}
      </div>
      <div className="wg-ticks">
        <span>{xmin.toLocaleString()}</span>
        <span>{xmax.toLocaleString()}</span>
      </div>
    </div>
  );
}

/* ── Heatmap ────────────────────────────────────────────────────────────── */

export function Heatmap({
  matrix,
  xLabels,
  yLabels,
}: {
  matrix: number[][];
  xLabels: string[];
  yLabels: string[];
}) {
  const flat = matrix.flat().filter((v) => Number.isFinite(v));
  if (!flat.length) return null;
  const lo = Math.min(...flat);
  const hi = Math.max(...flat);
  const span = hi - lo || 1;
  const color = (v: number) => `hsl(264 60% ${(92 - ((v - lo) / span) * 46).toFixed(0)}%)`;
  const fmt = (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`);

  return (
    <div style={{ overflowX: "auto" }}>
      <table className="wg-heat">
        <tbody>
          {matrix.map((row, ri) => (
            <tr key={ri}>
              <td className="wg-heat-y">{yLabels[ri] ?? ""}</td>
              {row.map((v, ci) => (
                <td
                  key={ci}
                  className="wg-heat-cell"
                  title={String(v)}
                  style={{ background: color(v) }}
                >
                  {Number.isFinite(v) ? fmt(v) : ""}
                </td>
              ))}
            </tr>
          ))}
          <tr>
            <td />
            {xLabels.map((x, ci) => (
              <td key={ci} className="wg-heat-x">
                {axisLabel(x)}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/* ── Horizontal bars ────────────────────────────────────────────────────── */

export function HBars({ data, fmt }: { data: Point[]; fmt?: (n: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="wg-hbars">
      {data.map((d, i) => (
        <div
          key={i}
          className="wg-hbar"
          title={`${axisLabel(d.label)}: ${fmt ? fmt(d.value) : d.value.toLocaleString()}`}
        >
          <span className="wg-hbar-label">{axisLabel(d.label)}</span>
          <div className="wg-hbar-track">
            <span style={{ width: `${(d.value / max) * 100}%` }} />
          </div>
          <span className="wg-hbar-value">{fmt ? fmt(d.value) : d.value}</span>
        </div>
      ))}
    </div>
  );
}
