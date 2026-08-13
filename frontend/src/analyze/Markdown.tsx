/**
 * A tiny, dependency-free markdown renderer for the assistant's prose.
 *
 * Deliberately narrow: paragraphs, headings, **bold**, `code`, bullet lists and
 * GitHub tables — which is the whole of what the agent writes. Result grids,
 * charts and cards are rendered as real components elsewhere, so this only ever
 * handles the written reply.
 *
 * `skipTables` drops markdown tables: when the same rows are already on screen
 * as an interactive grid, the model's restated copy is pure duplication.
 */
import type { ReactNode } from "react";
import { ScrollX } from "../components/ScrollX";

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const token = m[0];
    if (token.startsWith("**")) {
      out.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else {
      out.push(
        <code key={key++} className="an-code">
          {token.slice(1, -1)}
        </code>
      );
    }
    last = m.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({
  text,
  skipTables,
}: {
  text: string;
  skipTables?: boolean;
}) {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Table: a row containing pipes, followed by a `---` separator row.
    if (
      /\|/.test(line) &&
      i + 1 < lines.length &&
      /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) &&
      lines[i + 1].includes("-")
    ) {
      if (skipTables) {
        i += 2;
        while (i < lines.length && lines[i].includes("|")) i++;
        continue;
      }
      const header = line
        .split("|")
        .map((s) => s.trim())
        .filter(
          (_, idx, arr) =>
            !(idx === 0 && arr[0] === "") &&
            !(idx === arr.length - 1 && arr[arr.length - 1] === "")
        );
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|")) {
        const cells = lines[i].split("|").map((s) => s.trim());
        if (cells[0] === "") cells.shift();
        if (cells[cells.length - 1] === "") cells.pop();
        rows.push(cells);
        i++;
      }
      blocks.push(
        <ScrollX className="an-table-wrap" key={key++}>
          <table className="an-table">
            <thead>
              <tr>
                {header.map((h, hi) => (
                  <th key={hi}>{inline(h)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, ci) => (
                    <td key={ci}>{inline(c)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollX>
      );
      continue;
    }

    // Bullet list.
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      blocks.push(
        <ul className="an-list" key={key++}>
          {items.map((it, ii) => (
            <li key={ii}>{inline(it)}</li>
          ))}
        </ul>
      );
      continue;
    }

    // Numbered list.
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ""));
        i++;
      }
      blocks.push(
        <ol className="an-list" key={key++}>
          {items.map((it, ii) => (
            <li key={ii}>{inline(it)}</li>
          ))}
        </ol>
      );
      continue;
    }

    if (!line.trim()) {
      i++;
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.*)/);
    if (heading) {
      blocks.push(
        <p className="an-heading" key={key++}>
          {inline(heading[2])}
        </p>
      );
      i++;
      continue;
    }

    // Paragraph: gather consecutive lines that start nothing else.
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+[.)]\s+/.test(lines[i]) &&
      !lines[i].includes("|") &&
      !/^#{1,3}\s/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(
      <p className="an-para" key={key++}>
        {inline(para.join(" "))}
      </p>
    );
  }

  return <div className="an-md">{blocks}</div>;
}
