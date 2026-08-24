/**
 * The widget kit — ported from InventDB SOAR's `rooms/dashboard/widgetKit.ts`.
 *
 * One source of truth that makes an assistant-built mini-report render
 * IDENTICALLY to a native widget. Two halves, kept in lock-step:
 *
 *  • WIDGET_KIT_CSS — the app's real widget primitives (.kpi / .metric-row /
 *    .delta …). It is injected LAST into the widget's shadow root, so these
 *    class rules WIN over anything the model emitted, and it force-normalises
 *    the font so figures can never come back monospaced.
 *
 *  • WIDGET_KIT_GUIDE — handed to the layout generator so it BUILDS with
 *    exactly these classes. The same vocabulary on both sides means the
 *    generated markup lands on the native CSS and looks native, with light and
 *    dark theming for free — the PMS tokens inherit through the shadow
 *    boundary.
 *
 * SOAR's tokens are renamed to the PMS's here (`--fg` → `--text`, `--line` →
 * `--border`, and so on) and its font-size scale is written out, since the PMS
 * sizes type per component rather than from a scale. Nothing else differs.
 */

export const WIDGET_KIT_CSS = `
/* font + box normalise — figures are NEVER monospace (kills the #1 mismatch) */
:host, :host * { font-family: var(--font) !important; box-sizing: border-box; }
:host { display:block; color: var(--text-muted); font-size: 13px; line-height: 1.5; background: transparent; }
:host h1, :host h2, :host h3, :host h4 { color: var(--text); margin: 0 0 .4em; font-weight: 600; letter-spacing: -.01em; }
:host h2 { font-size: 15px; } :host h3 { font-size: 13px; }
:host small, .muted { color: var(--text-faint); font-size: 12px; }
:host strong { color: var(--text); font-weight: 600; }

/* ── KPI cluster: one headline figure ──────────────────────────────────── */
.kpi { display:flex; flex-direction:column; gap:2px; min-width:0; }
.kpi-label { font-size: 12px; font-weight:500; color: var(--text-muted); display:flex; align-items:center; gap:8px; }
.kpi-value { font-size: 30px; font-weight:600; color: var(--text); line-height:1.1; letter-spacing:-.02em; font-variant-numeric: tabular-nums; }
.kpi-value .unit { font-size: 13px; color: var(--text-faint); font-weight:500; letter-spacing:0; }
.kpi-context { display:flex; align-items:center; gap:8px; flex-wrap:wrap; font-size: 12px; color: var(--text-faint); margin-top:2px; }
/* multiple figures side-by-side — fluid, no fixed widths */
.kpi-grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(min(150px, 100%), 1fr)); gap: 16px 24px; }

/* ── label → value rows (a list) ───────────────────────────────────────── */
.metric-row { display:flex; align-items:baseline; justify-content:space-between; gap:12px; padding:7px 0; border-bottom:1px solid var(--border); }
.metric-row:last-child { border-bottom:none; }
.metric-row .m-label { color: var(--text-muted); font-size: 13px; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.metric-row .m-value { font-variant-numeric: tabular-nums; font-weight:600; color: var(--text); flex:none; }

/* ── up/down delta (semantic colour) ───────────────────────────────────── */
.delta { display:inline-flex; align-items:center; gap:4px; font-size: 12px; font-weight:600; font-variant-numeric: tabular-nums; }
.delta.up { color: var(--success); } .delta.down { color: var(--danger); }

/* ── a quiet inset panel ONLY when grouping is genuinely needed ─────────── */
.w-panel { background: var(--surface-2); border-radius: var(--radius-sm); padding: 12px; }

/* compact table matching the app's data tables. Cells DON'T wrap: a wide table
   keeps its natural width and the host's overflow-x scrolls it INSIDE the card,
   rather than cramming text into stacked lines on a phone. */
table { border-collapse: collapse; width: 100%; font-size: 13px; }
th { text-align:left; font-weight:600; color: var(--text-muted); padding:6px 10px; border-bottom:1px solid var(--border); white-space:nowrap; }
td { padding:6px 10px; border-bottom:1px solid var(--border); color: var(--text); font-variant-numeric: tabular-nums; white-space:nowrap; }
tr:last-child td { border-bottom:none; }
`;

/**
 * Domain-neutral, and describes the SAME classes the CSS above styles — so the
 * model emits markup that lands on the native primitives.
 */
export const WIDGET_KIT_GUIDE = [
  "RENDER AS A NATIVE WIDGET. A widget-kit stylesheet is ALREADY injected — you MUST build with these exact classes and you MUST NOT restyle them (no custom font, size, colour, border, padding, or text-transform on them). Add a <style> block ONLY for layout that the kit does not cover (e.g. a wrapping grid/flex), never to change a kit class.",
  "",
  "CLASSES (use exactly):",
  '• One headline figure:  <div class="kpi"><span class="kpi-label">Label</span><span class="kpi-value">VALUE</span><span class="kpi-context">small note</span></div>',
  '• Several figures side-by-side: wrap the .kpi blocks in <div class="kpi-grid"> … </div> (it lays them out fluidly — do NOT put each in a bordered box).',
  '• Label → value rows (a list): <div class="metric-row"><span class="m-label">…</span><span class="m-value">…</span></div> (repeat; last row auto-loses its divider).',
  '• Up/down change: <span class="delta up">▲ 4%</span> or <span class="delta down">▼ 2%</span>.',
  "• A table is fine — a bare <table><thead>…<tbody> picks up native styling automatically.",
  "",
  "RULES:",
  "• Background MUST be transparent (the card supplies the surface). No page chrome, title, or margins.",
  "• ALL text and numbers use the UI font — NEVER a monospace/code font. Figures are aligned via tabular-nums (the kit handles it), not by monospacing.",
  "• Labels are sentence case, NOT UPPERCASE (the kit styles .kpi-label correctly — don't override it).",
  '• Format money with fmt.currency(n) (e.g. "$93,550"), counts with fmt.number(n), dates with fmt.date(s). Do NOT hand-write "USD 18,339,000" — use the $ currency format.',
  "• Colours come only from tokens: var(--text)/var(--text-muted)/var(--text-faint) text, var(--brand) emphasis, var(--success)/var(--danger) for positive/negative. Never hard-code a hex colour.",
].join("\n");
