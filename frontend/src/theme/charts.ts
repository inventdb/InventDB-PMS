import { useMemo } from "react";

import { useTheme, type Theme } from "./ThemeContext";

/**
 * Chart colours for the InventDB brand theme.
 *
 * Recharts writes colours into SVG attributes and into its own legend/tooltip
 * markup, so charts need concrete values rather than `var(--chart-1)`. These
 * arrays are the JS mirror of the `--chart-*` tokens in `styles/global.css` —
 * keep the two in step.
 *
 * The palette is CATEGORICAL: it encodes which series a mark belongs to, never
 * how large it is. Slots are handed out in fixed order and never cycled, so a
 * category keeps its colour when the series count changes. Slot 1 is the brand
 * purple, stepped into each mode's lightness band (Cosmic Indigo #6a229d sits
 * a hair under the light floor; Wisteria Bloom #c696e8 sits over the dark cap).
 *
 * Validated in both modes for lightness band, chroma floor, colour-vision
 * separation (Machado 2009 protan/deutan at full severity), a normal-vision
 * floor and contrast against the card surface. Two consequences bind callers:
 *
 *  - In light mode slots 3, 4 and 5 fall below 3:1 on white, which is only
 *    legal alongside a relief channel. Every chart here ships a legend plus
 *    direct labels or the same figures in a table.
 *  - Forms where any two marks can touch (scatter, bubble) are capped at
 *    `SCATTER_MAX_SERIES` slots, the set that clears the harder all-pairs gate.
 */
const SERIES: Record<Theme, readonly string[]> = {
  light: [
    "#6d25a2", // brand purple
    "#eb6834", // orange
    "#1baf7a", // aqua
    "#eda100", // yellow
    "#e87ba4", // magenta
    "#008300", // green
    "#2a78d6", // blue
    "#e34948", // red
  ],
  dark: [
    "#a67ce0",
    "#d95926",
    "#199e70",
    "#c98500",
    "#d55181",
    "#008300",
    "#3987e5",
    "#e66767",
  ],
};

/** Everything past the last slot folds into one neutral "Other". */
const OTHER: Record<Theme, string> = { light: "#6b6672", dark: "#9f9ba4" };

/**
 * Axis ink, gridlines and the hover cursor wash, per mode. Axis ticks are
 * text, so they carry the same 4.5:1 bar as captions — Steel Mist (#9f9ba4)
 * only clears it on the dark surface.
 */
const CHROME: Record<Theme, { axis: string; grid: string; cursor: string }> = {
  light: { axis: "#736e7b", grid: "#ece9ef", cursor: "rgba(72,23,106,0.06)" },
  dark: { axis: "#9f9ba4", grid: "#302c33", cursor: "rgba(198,150,232,0.10)" },
};

/** Reserved state colours — never reused as a series colour. */
const STATUS: Record<
  Theme,
  { success: string; warn: string; danger: string; neutral: string; brand: string }
> = {
  light: {
    success: "#1d7a4b",
    warn: "#8a6200",
    danger: "#b23a42",
    neutral: "#6b6672",
    brand: "#48176a",
  },
  dark: {
    success: "#56bd87",
    warn: "#e3b75e",
    danger: "#e08589",
    neutral: "#9f9ba4",
    brand: "#c696e8",
  },
};

/** Slots that clear the all-pairs separation gate, for scatter/bubble charts. */
export const SCATTER_MAX_SERIES = 3;

/** Slots available to bar/line/area/pie before folding into "Other". */
export const MAX_SERIES = SERIES.light.length;

export interface ChartTheme {
  /** Categorical slots, in fixed assignment order. */
  series: readonly string[];
  /** Colour for the "Other" bucket and for anything past the last slot. */
  other: string;
  axis: string;
  grid: string;
  /** Fill for the bar/area hover cursor. */
  cursor: string;
  status: (typeof STATUS)[Theme];
  /** Slot `i`, clamped to "Other" rather than wrapping around the palette. */
  seriesAt: (i: number) => string;
}

export function useChartTheme(): ChartTheme {
  const { theme } = useTheme();

  return useMemo<ChartTheme>(() => {
    const series = SERIES[theme];
    const other = OTHER[theme];
    return {
      series,
      other,
      ...CHROME[theme],
      status: STATUS[theme],
      seriesAt: (i: number) => (i >= 0 && i < series.length ? series[i] : other),
    };
  }, [theme]);
}

/** Maps a work-order / run status onto its reserved state colour. */
export function statusColor(status: string, t: ChartTheme): string {
  const s = status.toLowerCase();
  if (s === "succeeded" || s === "success" || s === "completed") return t.status.success;
  if (s === "failed" || s === "error") return t.status.danger;
  if (s === "running" || s === "parked" || s === "in_progress") return t.status.warn;
  return t.status.neutral;
}

/**
 * Caps a categorical breakdown at `max` slices, merging the tail into a single
 * "Other" row. Keeps the palette from cycling — an unbounded category list
 * would otherwise reuse slot 1 for the ninth item and imply a relationship
 * that isn't there.
 */
export function foldToOther<T extends { name?: string; value?: number }>(
  data: readonly T[] | undefined,
  max: number = MAX_SERIES,
): Array<{ name: string; value: number }> {
  const rows = (data ?? [])
    .map((d) => ({ name: String(d.name ?? "—"), value: Number(d.value ?? 0) }))
    .sort((a, b) => b.value - a.value);

  if (rows.length <= max) return rows;

  const head = rows.slice(0, max - 1);
  const tail = rows.slice(max - 1);
  head.push({
    name: `Other (${tail.length})`,
    value: tail.reduce((sum, r) => sum + r.value, 0),
  });
  return head;
}
