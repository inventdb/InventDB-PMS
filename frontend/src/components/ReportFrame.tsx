import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

/** What a parent can do with a rendered report. */
export interface ReportFrameHandle {
  print: () => void;
}

/**
 * Displays a report rendered by InventDB's report engine.
 *
 * The payload is a whole HTML document — the template's own markup, CSS and
 * inline SVG charts — authored in SOAR, not by this app. That rules out
 * dropping it into the page with `dangerouslySetInnerHTML`:
 *
 *  - its stylesheet would fight (and win against) the app's own; report
 *    templates style bare `table`, `h1`, `body` and so on, and
 *  - anything an inline `onclick`/`onerror` carried would execute with the
 *    app's session in scope.
 *
 * A `srcdoc` iframe sandboxed to `allow-same-origin` (deliberately *without*
 * `allow-scripts`) gives real isolation on both counts: the document gets its
 * own styling context, and no script in it can run. `allow-same-origin` is
 * what lets this component measure the content and drive Print — safe here
 * precisely because scripts are off, so nothing inside can reach back out.
 * The engine's own scripts are `<script type="server">` blocks, executed
 * server-side and stripped before the HTML is returned, so nothing a report
 * needs is lost.
 *
 * The frame grows to its content instead of scrolling internally, so a report
 * reads as one continuous sheet.
 */
/**
 * Force the document to flow at its natural height.
 *
 * A generated layout frequently declares its own page: `html,body{height:100vh}`,
 * or a wrapper with `max-height` and `overflow:auto`. Inside a frame that is
 * sized from its content, that produces the worst of both — the frame measures
 * the collapsed height and the rows scroll in a nested scroller the wheel can
 * barely reach.
 *
 * Only the page box and body's own children are neutralised. Anything deeper
 * keeps its overflow, so a wide table inside a card still scrolls sideways
 * where it should.
 */
const FLOW_RESET = `
<style>
  html, body {
    height: auto !important;
    min-height: 0 !important;
    max-height: none !important;
    overflow: visible !important;
  }
  body > * {
    max-height: none !important;
    overflow-y: visible !important;
  }
</style>`;

/** Append the reset so it wins over whatever the document declared. */
function withFlowReset(html: string): string {
  if (!html) return html;
  return /<\/body>/i.test(html)
    ? html.replace(/<\/body>/i, `${FLOW_RESET}</body>`)
    : html + FLOW_RESET;
}

export const ReportFrame = forwardRef<
  ReportFrameHandle,
  { html: string; title: string }
>(function ReportFrame({ html, title }, handle) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(320);

  useImperativeHandle(handle, () => ({
    print: () => ref.current?.contentWindow?.print(),
  }));

  const measure = useCallback(() => {
    const doc = ref.current?.contentDocument;
    if (!doc?.documentElement) return;
    // scrollHeight on the root, not the body: body alone under-measures when
    // the template sets its own margins.
    const next = Math.max(
      doc.documentElement.scrollHeight,
      doc.body?.scrollHeight ?? 0
    );
    // Never shrink below what has already been shown: a mid-reflow read can
    // come back short and the frame would visibly collapse and re-expand.
    if (next > 0) setHeight((h) => (Math.abs(next - h) < 2 ? h : next));
  }, []);

  // Web fonts and images land after load and change the height, and the frame
  // reflows whenever the column width changes. Watch the document rather than
  // measuring once.
  useEffect(() => {
    const doc = ref.current?.contentDocument;
    if (!doc?.body || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(doc.body);
    return () => ro.disconnect();
  }, [measure, html]);

  return (
    <iframe
      ref={ref}
      className="report-frame"
      title={title}
      srcDoc={withFlowReset(html)}
      onLoad={measure}
      style={{ height }}
      sandbox="allow-same-origin allow-modals"
    />
  );
});

export default ReportFrame;
