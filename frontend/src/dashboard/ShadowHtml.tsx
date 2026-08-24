/**
 * Render engine-produced HTML inline, isolated — ported from InventDB SOAR's
 * `lib/ShadowHtml.tsx`.
 *
 * A mini-report widget is a whole HTML fragment written by the report engine.
 * It mounts in a shadow root so its `<style>` cannot leak into the app and the
 * app's CSS cannot bleed into it, while flowing at its natural height inside
 * the card — no nested scrollbar, no iframe to measure.
 *
 * The shadow root is what makes the widget kit work: kit CSS is injected LAST,
 * so its class rules win over whatever the model emitted and a widget lands on
 * the app's native primitives. An iframe cannot do that.
 *
 * Report Studio renders its reports in a sandboxed iframe instead
 * (`components/ReportFrame.tsx`) precisely so nothing in foreign HTML executes
 * with the session in scope. Shadow DOM has no sandbox, so that guarantee is
 * kept here by other means: `<script>` blocks are stripped, `<script>` set via
 * innerHTML does not execute anyway, and every inline `on*` handler and
 * `javascript:` URL is removed before the markup is mounted.
 */
import { useEffect, useRef, type CSSProperties } from "react";

/** Strip anything that could execute. See the module note. */
function disarm(markup: string): string {
  return markup
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<\s*(script|iframe|object|embed)\b[^>]*>/gi, "")
    // on*="…" / on*='…' / on*=… — the attribute name is matched on a word
    // boundary so `font-weight` and friends are untouched.
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src|xlink:href)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, "$1=$2#$2");
}

export function ShadowHtml({
  html,
  kitStyles,
  className,
  style,
}: {
  html: string;
  /**
   * Design-kit CSS injected AFTER the document's own styles so its class rules
   * win — what forces a generated widget onto the app's native primitives.
   */
  kitStyles?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (!host.shadowRoot) host.attachShadow({ mode: "open" });
    const root = host.shadowRoot!;

    const styleText = Array.from(html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi))
      .map((m) => m[1])
      .join("\n")
      // `body` only where it is a type selector — not `.report-body` — so the
      // document's page styling still lands on the host.
      .replace(/(^|[\s{},>~+])body(?=[\s.:#>{,[]|$)/g, "$1:host")
      // `:root` matches nothing inside a shadow tree: there is no document root
      // element here. A template that declares its whole theme as
      // `:root { --bg: … }` would render with every custom property undefined
      // and collapse to base fallbacks. Remapping to `:host` puts them on the
      // shadow host, where they inherit into the tree as intended.
      .replace(/:root\b/g, ":host");

    // Lift the body, then remove the blocks whose CSS was already extracted —
    // leaving them would render the stylesheet as a raw text node at the top of
    // the widget.
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const inner = disarm(
      (bodyMatch ? bodyMatch[1] : html)
        .replace(/<head[\s\S]*?<\/head>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<\/?(?:!doctype|html|body|meta|title|link)\b[^>]*>/gi, "")
    );

    // Transparent: the card supplies the surface, and `color: inherit` lets the
    // widget follow the app's theme rather than pinning its own.
    const base =
      ":host{display:block;box-sizing:border-box;background:transparent;color:inherit;}";

    // Order matters — base, then the document's own CSS, then the kit LAST so
    // the kit's class rules override what the model emitted.
    root.innerHTML = `<style>${base}\n${styleText}\n${kitStyles || ""}</style>${inner}`;
  }, [html, kitStyles]);

  // overflow-x so a genuinely wide widget table scrolls inside its own card
  // rather than forcing the page sideways. The host flows at natural height, so
  // this never adds a vertical scrollbar.
  return <div ref={hostRef} className={className} style={{ overflowX: "auto", ...style }} />;
}
