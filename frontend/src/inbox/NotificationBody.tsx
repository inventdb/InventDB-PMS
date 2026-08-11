/**
 * A notification body, rendered safely.
 *
 * The plan authors these in light HTML — `<p>`, `<strong>`, a `<br>` — so they
 * read as a briefing rather than a wall. But the *values* inside them come from
 * the trigger: `${req.issue}` is a sentence a stranger emailed the office, and
 * `${tenant.first.last}` is whatever is in the record. Injecting that with
 * `dangerouslySetInnerHTML`, which is the obvious way to do this, means anyone
 * who can email the intake address can run script in a property manager's
 * session — on the very screen where they approve spending.
 *
 * So nothing here is injected as markup. The body is parsed into an inert
 * document, walked against an allowlist of *structural tags only*, and rebuilt
 * as real DOM nodes. Every attribute is dropped without exception, which is
 * what closes `onerror=`, `href="javascript:"`, `style="…"` and the rest as a
 * class rather than one at a time. A tag that is not on the list contributes
 * its text and nothing else, so a sanitised body still says what it said.
 *
 * Plain-text bodies (the agent writes markdown when it authors its own
 * workflows) get the same treatment after a minimal bold/code/newline pass.
 */
import { useEffect, useRef } from "react";

/** Structure only. No `a`, no `img`, nothing that carries a URL or a handler. */
const ALLOWED = new Set([
  "P",
  "BR",
  "STRONG",
  "B",
  "EM",
  "I",
  "U",
  "UL",
  "OL",
  "LI",
  "CODE",
  "PRE",
  "SPAN",
  "DIV",
  "H3",
  "H4",
  "H5",
  "HR",
  "TABLE",
  "THEAD",
  "TBODY",
  "TR",
  "TH",
  "TD",
  "BLOCKQUOTE",
]);

/** Never contribute their text either — a dropped `<style>` must not print. */
const DROP_ENTIRELY = new Set(["SCRIPT", "STYLE", "HEAD", "TITLE", "IFRAME", "OBJECT", "EMBED"]);

const looksLikeHtml = (s: string) => /<\/?[a-z][\s\S]*?>/i.test(s);

/**
 * Rebuild `source` into `target` keeping only allowlisted elements and text.
 *
 * Elements are recreated with `createElement` rather than cloned, because a
 * clone carries its attributes with it and stripping them afterwards is a list
 * that has to stay complete forever. Creating fresh guarantees the new node has
 * nothing on it but what is copied over — which is nothing.
 */
function transplant(source: Node, target: Node, doc: Document): void {
  source.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      target.appendChild(doc.createTextNode(child.textContent ?? ""));
      return;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return;

    const tag = (child as Element).tagName.toUpperCase();
    if (DROP_ENTIRELY.has(tag)) return;
    if (!ALLOWED.has(tag)) {
      // Unknown wrapper: keep what it contained, discard the wrapper itself.
      transplant(child, target, doc);
      return;
    }
    const clean = doc.createElement(tag.toLowerCase());
    transplant(child, clean, doc);
    target.appendChild(clean);
  });
}

/** Bold, inline code and line breaks from a plain-text body. Escaping is not
 *  needed: the result goes back through the same sanitiser as everything else. */
function markdownLiteToHtml(text: string): string {
  return text
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\n{2,}/g, "</p><p>")
    .replace(/\n/g, "<br>");
}

export function NotificationBody({ body }: { body: string }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    el.replaceChildren();

    const markup = looksLikeHtml(body) ? body : `<p>${markdownLiteToHtml(body)}</p>`;
    // `text/html` parsing is inert: no script runs, no image is fetched, and
    // the document is detached from the page. Nothing here is ever attached to
    // the live DOM — only the rebuilt copy is.
    const parsed = new DOMParser().parseFromString(markup, "text/html");
    const fragment = document.createDocumentFragment();
    transplant(parsed.body, fragment, document);
    el.appendChild(fragment);
  }, [body]);

  return <div className="nb-body" ref={host} />;
}

/**
 * A one-line preview for the list, with the markup taken back out.
 *
 * The dropped elements are removed from the parsed tree *before* the text is
 * read, because `textContent` happily returns the source of a `<script>` — so
 * the naive version prints the payload of the very attack the renderer above
 * defends against, straight into the list.
 */
export function bodySnippet(body: string | undefined, max = 150): string {
  const raw = String(body ?? "");
  if (!raw) return "";
  let text: string;
  try {
    const parsed = new DOMParser().parseFromString(raw, "text/html");
    parsed.body
      .querySelectorAll([...DROP_ENTIRELY].join(","))
      .forEach((node) => node.remove());
    // `textContent` concatenates without regard for layout, so a body of
    // `<p>Plumbing</p><p>Property: …</p>` previews as "PlumbingProperty:".
    // Separating the blocks first is what makes the one-liner readable.
    parsed.body
      .querySelectorAll("p, div, br, li, tr, h1, h2, h3, h4, h5, blockquote")
      .forEach((node) => node.insertAdjacentText("afterend", " "));
    text = parsed.body.textContent ?? "";
  } catch {
    text = raw.replace(/<[^>]+>/g, " ");
  }
  text = text.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
