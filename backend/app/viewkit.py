"""The view kit — one house style every designed view is built against.

A layout the designer invents from scratch looks like whatever the model felt
like that run: emails overflowing their column, cards of three different
heights, labels welded to their values, a grid that scrolls inside itself. The
fix is the one SOAR uses for dashboard widgets — hand the designer a small,
fixed vocabulary of classes, and supply the CSS for them at render time. Same
names on both sides, so the generated markup lands on styling this app controls.

``VIEW_KIT_GUIDE`` goes to the designer with every instruction.
``VIEW_KIT_CSS`` is injected into the rendered document, last, so these rules
beat anything the model emitted for the same class.
"""

from __future__ import annotations

#: Injected after the document's own styles. Deliberately narrow: it styles the
#: kit's classes and normalises the page box, and leaves everything else alone.
VIEW_KIT_CSS = """
:root {
  --vk-fg: #201e21;
  --vk-muted: #56515c;
  --vk-faint: #857f8c;
  --vk-line: #e4e2e5;
  --vk-surface: #ffffff;
  --vk-inset: #faf7fc;
  --vk-brand: #48176a;
  --vk-ok-bg: #e6f3eb; --vk-ok-fg: #1d7a4b;
  --vk-warn-bg: #fdf4e4; --vk-warn-fg: #8a5300;
  --vk-bad-bg: #f9edee; --vk-bad-fg: #b23a42;
}
* { box-sizing: border-box; }
html, body {
  height: auto; min-height: 0; max-height: none; overflow: visible;
  margin: 0; padding: 0; background: transparent;
  font-family: "Poppins", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: var(--vk-fg); font-size: 13.5px; line-height: 1.5;
}

/* ---- the grid of records ------------------------------------------------
   auto-fill with a floor, so cards keep a readable width at any container
   size and never scroll inside themselves. */
.vk-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(270px, 100%), 1fr));
  gap: 12px;
  padding: 14px;
  align-items: start;
}

/* ---- one record ---------------------------------------------------------
   A column, so every card in a row is the same height and its foot sits at
   the bottom rather than floating under a short body. */
.vk-card {
  display: flex; flex-direction: column; gap: 8px;
  min-width: 0;
  padding: 14px;
  border: 1px solid var(--vk-line);
  border-radius: 10px;
  background: var(--vk-surface);
}
.vk-card-head { display: flex; align-items: flex-start; gap: 8px; }
.vk-title {
  flex: 1; min-width: 0;
  font-size: 14.5px; font-weight: 620; letter-spacing: -0.01em;
  overflow-wrap: anywhere;
}
.vk-sub { font-size: 12px; color: var(--vk-faint); }

/* ---- figures ------------------------------------------------------------ */
.vk-figures {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100px, 100%), 1fr));
  gap: 10px;
  padding: 8px 0;
  border-top: 1px solid var(--vk-line);
  border-bottom: 1px solid var(--vk-line);
}
.vk-figure { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.vk-figure b {
  font-size: 17px; font-weight: 650; font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
}
.vk-figure span { font-size: 11px; color: var(--vk-faint); }

/* ---- label -> value rows ------------------------------------------------
   The value may be a long email or address, so it is allowed to wrap and the
   label is not. This is what stops text running out of the card. */
.vk-rows { display: grid; gap: 5px; }
.vk-row {
  display: grid; grid-template-columns: minmax(58px, auto) 1fr; gap: 10px;
  align-items: baseline; font-size: 12.5px;
}
.vk-row > span { color: var(--vk-muted); white-space: nowrap; }
.vk-row > b {
  font-weight: 550; text-align: right; min-width: 0;
  overflow-wrap: anywhere; word-break: break-word;
}

/* ---- foot --------------------------------------------------------------- */
.vk-foot {
  margin-top: auto; padding-top: 8px;
  border-top: 1px solid var(--vk-line);
  font-size: 12px; color: var(--vk-faint);
  overflow-wrap: anywhere;
}

/* ---- status ------------------------------------------------------------- */
.vk-badge {
  flex: none;
  padding: 2px 9px; border-radius: 999px;
  font-size: 11px; font-weight: 600; white-space: nowrap;
  background: var(--vk-inset); color: var(--vk-muted);
}
.vk-badge.is-ok   { background: var(--vk-ok-bg);   color: var(--vk-ok-fg); }
.vk-badge.is-warn { background: var(--vk-warn-bg); color: var(--vk-warn-fg); }
.vk-badge.is-bad  { background: var(--vk-bad-bg);  color: var(--vk-bad-fg); }

/* ---- a table view ------------------------------------------------------- */
.vk-table-wrap { overflow-x: auto; padding: 14px; }
.vk-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.vk-table th {
  text-align: left; font-weight: 600; color: var(--vk-muted);
  padding: 7px 10px; border-bottom: 1px solid var(--vk-line); white-space: nowrap;
}
.vk-table td {
  padding: 7px 10px; border-bottom: 1px solid var(--vk-line);
  vertical-align: top;
}
.vk-table tr:last-child td { border-bottom: none; }
.vk-num { text-align: right; font-variant-numeric: tabular-nums; }

/* ---- section heading ---------------------------------------------------- */
.vk-section {
  padding: 14px 14px 0;
  font-size: 12px; font-weight: 600; letter-spacing: 0.04em;
  text-transform: uppercase; color: var(--vk-faint);
}
.vk-empty { padding: 24px 14px; color: var(--vk-faint); }
"""

#: Appended to every design instruction. Domain-neutral, and describes exactly
#: the classes the CSS above styles.
VIEW_KIT_GUIDE = """
BUILD WITH THE VIEW KIT. A stylesheet for these exact classes is already
injected and it OVERRIDES anything you write for them. Use them, and do not
restyle them — no custom font, size, colour, border, padding or radius on a
`vk-` class. Add a <style> block only for something the kit has no class for.

CLASSES:
- Records grid:  <div class="vk-grid"> … one .vk-card per record … </div>
- One record:
    <div class="vk-card">
      <div class="vk-card-head">
        <div><div class="vk-title">Main name</div><div class="vk-sub">secondary</div></div>
        <span class="vk-badge is-ok">Active</span>
      </div>
      <div class="vk-figures">
        <div class="vk-figure"><b>$2,100</b><span>Rent</span></div>
      </div>
      <div class="vk-rows">
        <div class="vk-row"><span>Email</span><b>someone@example.com</b></div>
      </div>
      <div class="vk-foot">44 Cedar Lane, Richmond VA</div>
    </div>
- Badge tone: is-ok (good/active/paid), is-warn (pending/due), is-bad
  (overdue/vacant/failed), or no modifier when it is merely a label.
- A table instead of cards:
    <div class="vk-table-wrap"><table class="vk-table"> … </table></div>
  Put class="vk-num" on numeric cells so figures align.
- A heading above a block: <div class="vk-section">Overdue</div>
- Nothing to show: <div class="vk-empty">No records match this view.</div>

RULES:
- NEVER set a height, max-height or overflow on html, body or any wrapper. The
  page grows to its content and the app scrolls it; an inner scroller traps the
  rows where the reader cannot reach them.
- No page chrome: no page title, no toolbar, no pagination, no record count.
  The app supplies all of that around your layout.
- Use at most 3 figures and 5 rows per card. A card that lists every column is
  a table with extra steps.
- Long values (emails, addresses, notes) go in .vk-row or .vk-foot, which wrap
  them. Never put one in .vk-figure.
- Money as $1,234 (no decimals unless they matter), dates as short readable
  dates, counts plain. Never print a raw ISO timestamp.
- Colour only through the badge modifiers. Do not hard-code a hex value.
"""
