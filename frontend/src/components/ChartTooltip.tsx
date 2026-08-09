import type { CSSProperties, ReactNode } from "react";

/**
 * Themed replacement for recharts' built-in tooltip body.
 *
 * Recharts stamps `color: entry.color || '#000'` as an *inline* style on every
 * tooltip row, which beats the `color` we set through `contentStyle`. Pie
 * sectors never put a colour in the tooltip payload, and neither does a <Bar>
 * that gets its colours from per-datum <Cell>s — so those rows fell back to
 * hardcoded black and disappeared against the dark surface. Rendering our own
 * content keeps every row on `--text` in both themes and shows the series
 * colour as a swatch instead of tinting the text.
 *
 * `formatter` / `labelFormatter` are honoured exactly as the default content
 * does, so charts can keep passing them to <Tooltip> unchanged.
 */

/** One row of the payload, as recharts hands it to a custom content element. */
interface TooltipEntry {
  name?: ReactNode;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
  /** recharts marks hidden//placeholder series with type "none". */
  type?: string;
  payload?: Record<string, unknown>;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
interface ChartTooltipProps {
  active?: boolean;
  label?: any;
  payload?: TooltipEntry[];
  /** Forwarded verbatim from <Tooltip formatter={...} />. */
  formatter?: (
    value: any,
    name: any,
    entry: TooltipEntry,
    index: number,
    payload: TooltipEntry[],
  ) => ReactNode | [ReactNode, ReactNode];
  /** Forwarded verbatim from <Tooltip labelFormatter={...} />. */
  labelFormatter?: (label: any, payload: TooltipEntry[]) => ReactNode;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const boxStyle: CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  boxShadow: "var(--shadow)",
  padding: "9px 13px",
  fontSize: 13,
  // Explicit, so nothing inherits a stray colour from the SVG layer.
  color: "var(--text)",
};

const labelStyle: CSSProperties = {
  margin: "0 0 6px",
  fontWeight: 600,
  color: "var(--text)",
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "2px 0",
  whiteSpace: "nowrap",
};

const nameStyle: CSSProperties = { color: "var(--text-muted)" };

const valueStyle: CSSProperties = {
  color: "var(--text)",
  fontWeight: 600,
  fontVariantNumeric: "tabular-nums",
  marginLeft: "auto",
  paddingLeft: 12,
};

const isNumOrStr = (v: unknown): boolean =>
  typeof v === "number" || (typeof v === "string" && v !== "");

export default function ChartTooltip({
  active,
  label,
  payload,
  formatter,
  labelFormatter,
}: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  const rows = payload.filter((entry) => entry.type !== "none");
  if (rows.length === 0) return null;

  // Pie/radial tooltips carry no label. Only format/render a heading when one
  // actually exists — recharts guards `labelFormatter` the same way, and ours
  // (e.g. monthLabel) would throw on undefined.
  let heading: ReactNode = null;
  if (label != null) {
    heading = labelFormatter
      ? labelFormatter(label, payload)
      : isNumOrStr(label)
        ? label
        : null;
  }

  return (
    <div style={boxStyle}>
      {heading != null && heading !== "" && <p style={labelStyle}>{heading}</p>}
      {rows.map((entry, i) => {
        let name: ReactNode = entry.name;
        let value: ReactNode = entry.value;

        if (formatter && entry.value != null && entry.name != null) {
          const formatted = formatter(entry.value, entry.name, entry, i, payload);
          if (Array.isArray(formatted)) {
            [value, name] = formatted;
          } else {
            value = formatted;
          }
        }

        return (
          <div key={`${entry.dataKey ?? ""}-${i}`} style={rowStyle}>
            {entry.color && (
              <span
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: "50%",
                  background: entry.color,
                  flexShrink: 0,
                }}
              />
            )}
            {name != null && <span style={nameStyle}>{name}</span>}
            <span style={valueStyle}>{value}</span>
          </div>
        );
      })}
    </div>
  );
}
