/**
 * Cron schedules, as a picker rather than a syntax.
 *
 * InventDB stores a schedule as a five-field cron expression, which is precise
 * and unreadable. Most schedules a property manager wants are one of four
 * shapes — every day, weekdays, one day a week, one day a month — so the
 * editor offers those and writes the expression.
 *
 * The mapping has to survive a round trip in both directions: a workflow
 * authored in SOAR (or by the AI) can carry any valid expression, including
 * ones no picker can represent — step values, ranges, a specific month. Those
 * are detected and the editor falls back to editing the expression directly,
 * so opening such a workflow and saving an unrelated change cannot quietly
 * rewrite its schedule into something simpler.
 */

export type Frequency = "daily" | "weekdays" | "weekly" | "monthly";

export interface Schedule {
  /** "HH:MM", 24-hour. */
  time: string;
  frequency: Frequency;
  /** Day of week, 0 = Sunday, for `weekly`. */
  dayOfWeek: string;
  /** Day of month, 1-31, for `monthly`. */
  dayOfMonth: string;
  /** True when the expression cannot be represented by the picker. */
  raw: boolean;
  /** The literal expression, used when `raw`. */
  expr: string;
}

export const DAYS_OF_WEEK = [
  { value: "1", label: "Monday" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
  { value: "0", label: "Sunday" },
];

const isNumeric = (s: string) => /^\d+$/.test(s);
const pad = (n: number) => String(n).padStart(2, "0");

export const DEFAULT_CRON = "0 9 * * *";

/** Read a cron expression into the picker's terms. */
export function parseSchedule(expr?: string): Schedule {
  const parts = (expr || DEFAULT_CRON).trim().split(/\s+/);
  while (parts.length < 5) parts.push("*");
  const [minute, hour, dom, month, dow] = parts;

  const simpleTime = isNumeric(minute) && isNumeric(hour);
  let frequency: Frequency = "daily";
  let dayOfWeek = "1";
  let dayOfMonth = "1";

  if (dom !== "*" && dow === "*" && isNumeric(dom)) {
    frequency = "monthly";
    dayOfMonth = dom;
  } else if (dow === "1-5" && dom === "*") {
    frequency = "weekdays";
  } else if (isNumeric(dow) && dom === "*") {
    frequency = "weekly";
    dayOfWeek = dow;
  }

  const representable =
    simpleTime &&
    month === "*" &&
    ((dow === "*" && dom === "*") ||
      (dow === "1-5" && dom === "*") ||
      (isNumeric(dow) && dom === "*") ||
      (isNumeric(dom) && dow === "*"));

  return {
    time: simpleTime ? `${pad(Number(hour))}:${pad(Number(minute))}` : "09:00",
    frequency,
    dayOfWeek,
    dayOfMonth,
    raw: !representable,
    expr: (expr || DEFAULT_CRON).trim(),
  };
}

/** Write the picker's terms back out as a cron expression. */
export function buildCron(s: Schedule): string {
  if (s.raw) return s.expr.trim();
  const [h, m] = s.time.split(":");
  const hour = String(Number(h || "9"));
  const minute = String(Number(m || "0"));
  if (s.frequency === "weekdays") return `${minute} ${hour} * * 1-5`;
  if (s.frequency === "weekly") return `${minute} ${hour} * * ${s.dayOfWeek}`;
  if (s.frequency === "monthly") return `${minute} ${hour} ${s.dayOfMonth} * *`;
  return `${minute} ${hour} * * *`;
}

const ORDINALS: { [n: string]: string } = { "1": "1st", "2": "2nd", "3": "3rd", "21": "21st", "22": "22nd", "23": "23rd", "31": "31st" };
const ordinal = (d: string) => ORDINALS[d] ?? `${d}th`;

/** A one-line reading of a schedule, for the card and the editor preview. */
export function describeSchedule(s: Schedule): string {
  if (s.raw) return `cron ${s.expr}`;
  const at = `at ${s.time}`;
  if (s.frequency === "weekdays") return `Every weekday ${at}`;
  if (s.frequency === "weekly") {
    const day = DAYS_OF_WEEK.find((d) => d.value === s.dayOfWeek)?.label ?? "Monday";
    return `Every ${day} ${at}`;
  }
  if (s.frequency === "monthly") return `On the ${ordinal(s.dayOfMonth)} of each month ${at}`;
  return `Every day ${at}`;
}

/**
 * A short trigger summary for a saved workflow, whatever its kind.
 *
 * Falls back to the kind's own name rather than inventing detail, because a
 * blank here would read as "no trigger" on a workflow that has one.
 */
export function describeTrigger(
  triggerKind?: string,
  spec?: { expr?: string; tz?: string; [k: string]: unknown }
): string {
  if ((triggerKind === "cron" || triggerKind === "schedule") && spec?.expr) {
    const text = describeSchedule(parseSchedule(spec.expr));
    return spec.tz ? `${text} · ${spec.tz}` : text;
  }
  if (triggerKind === "record_event" && spec?.type) {
    return `When a ${String(spec.type)} record changes`;
  }
  return triggerKind ?? "manual";
}

/**
 * Time zones offered by the picker.
 *
 * The browser's own zone is always first so the common case needs no thought;
 * UTC is always present because a schedule shared across regions wants it.
 */
export function timezoneOptions(): string[] {
  let local = "UTC";
  try {
    local = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    // A runtime without a resolvable zone still gets a working picker.
  }
  const common = [
    "UTC",
    "Asia/Kolkata",
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
    "Europe/London",
    "Europe/Berlin",
    "Australia/Sydney",
  ];
  return [local, ...common.filter((z) => z !== local)];
}
