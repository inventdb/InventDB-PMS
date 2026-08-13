/**
 * Plain-English record creation — the prompt, and the coercion that turns the
 * assistant's answer back into form values.
 *
 * This is the same move InventDB SOAR makes on its "New <type>" button: you say
 * what the thing is in ordinary words and the assistant does the transcription.
 * The difference is where the schema comes from. SOAR discovers a type's shape
 * at runtime and lets the assistant *design* the form, because it has no idea
 * what an invoice is until it looks. The PMS already knows: `config/entities.ts`
 * declares every module's fields, its choice lists and its references. So the
 * assistant is handed that schema and asked only to fill it — which makes the
 * result checkable, and keeps the form the user reviews the same form they have
 * always saved.
 *
 * Nothing here writes. The assistant proposes values into the open form; the
 * person still reads them and still presses Save. That boundary is deliberate:
 * a description is evidence of intent, not consent to a record.
 *
 * Everything in this module is pure, so the mapping rules can be reasoned about
 * (and tested) without a model in the loop.
 */
import type { EntityConfig, FieldDef } from "../config/entities";
import type { RefOption } from "./references";

export interface FillResult {
  /** Field name → the string its form control expects. */
  values: { [name: string]: string };
  /**
   * What the assistant offered that the form could not accept — an unknown
   * status, a property nothing matched. Shown to the user rather than dropped:
   * silently discarding half a description is how a form ends up saved wrong.
   */
  unresolved: string[];
}

// ---- text matching --------------------------------------------------------

/** Lowercase, punctuation-free, single-spaced — the form both sides compare in. */
function norm(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(value: string): string[] {
  return norm(value).split(" ").filter(Boolean);
}

/**
 * Score how well `query` names `candidate`, 0 = no relation.
 *
 * Deliberately conservative. An exact or containing match scores far above a
 * partial one, and a single shared token scores low enough that the caller's
 * threshold rejects it — "Park" should not silently select "9 Park Street" when
 * "Parkview Apartments" is also on the books.
 */
function score(query: string, candidate: string): number {
  const q = norm(query);
  const c = norm(candidate);
  if (!q || !c) return 0;
  if (q === c) return 100;
  if (c.includes(q)) return 80 - Math.min(20, c.length - q.length) / 4;
  if (q.includes(c)) return 70;
  const qt = tokens(q);
  const ct = new Set(tokens(c));
  const shared = qt.filter((t) => ct.has(t)).length;
  if (!shared) return 0;
  // Every word of the query accounted for is a real match; a fragment is not.
  return shared === qt.length ? 55 : (shared / qt.length) * 30;
}

/** Best match above the bar, or null when nothing fits or two options tie. */
function bestMatch<T>(
  items: T[],
  text: (item: T) => string,
  query: string,
  floor = 40
): T | null {
  let best: T | null = null;
  let bestScore = 0;
  let tied = false;
  for (const item of items) {
    const s = score(query, text(item));
    if (s > bestScore) {
      best = item;
      bestScore = s;
      tied = false;
    } else if (s === bestScore && s > 0) {
      tied = true;
    }
  }
  if (!best || bestScore < floor || tied) return null;
  return best;
}

// ---- value coercion -------------------------------------------------------

const TRUE_WORDS = ["true", "yes", "y", "1", "on file", "on", "have", "has"];
const FALSE_WORDS = ["false", "no", "n", "0", "none", "not on file", "off"];

function toBoolean(raw: unknown): string | null {
  if (typeof raw === "boolean") return raw ? "true" : "false";
  const v = norm(raw);
  if (!v) return null;
  if (TRUE_WORDS.includes(v)) return "true";
  if (FALSE_WORDS.includes(v)) return "false";
  return null;
}

function toNumeric(raw: unknown): string | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? String(raw) : null;
  // Currency symbols, thousands separators and stray spaces are the assistant
  // echoing the description's own formatting; a stray "%" or "per month" is a
  // unit we would be guessing at, so it fails into a note instead.
  const cleaned = String(raw ?? "")
    .replace(/[$£€₹,\s]/g, "")
    .trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? String(n) : null;
}

/** `<input type="date">` only accepts YYYY-MM-DD. */
function toDateValue(raw: unknown): string | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
}

/**
 * Fold one proposed value into the form, or explain why it could not go in.
 *
 * Returns null for "nothing to say" — an omitted field. A rejection always
 * carries a note, because a value the assistant clearly meant and the form
 * quietly dropped is the one failure the user cannot see.
 */
function coerceField(
  field: FieldDef,
  raw: unknown,
  refOptions: { [entity: string]: RefOption[] }
): { value: string } | { note: string } | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "object") return null;
  const text = String(raw).trim();
  if (!text) return null;

  if (field.ref) {
    const options = refOptions[field.ref] ?? [];
    // An id the description stated outright wins over any label matching.
    const exact = options.find((o) => o.value.toLowerCase() === text.toLowerCase());
    if (exact) return { value: exact.value };
    const match = bestMatch(options, (o) => o.label, text);
    if (match) return { value: match.value };
    return {
      note: options.length
        ? `No ${field.label.toLowerCase()} on file matches “${text}” — pick one below.`
        : `There are no ${field.label.toLowerCase()} records to link “${text}” to.`,
    };
  }

  if (field.type === "select") {
    const options = field.options ?? [];
    const match = bestMatch(options, (o) => o, text);
    if (match) return { value: match };
    return {
      note: `“${text}” isn’t one of the ${field.label} choices (${options.join(", ")}).`,
    };
  }

  if (field.type === "boolean") {
    const value = toBoolean(raw);
    return value ? { value } : { note: `Couldn’t read “${text}” as a yes/no for ${field.label}.` };
  }

  if (field.type === "number" || field.type === "currency") {
    const value = toNumeric(raw);
    return value ? { value } : { note: `Couldn’t read “${text}” as a number for ${field.label}.` };
  }

  if (field.type === "date") {
    const value = toDateValue(raw);
    return value ? { value } : { note: `Couldn’t read “${text}” as a date for ${field.label}.` };
  }

  return { value: text };
}

/**
 * Turn the assistant's JSON into form values.
 *
 * Keys the module doesn't declare are ignored outright. The assistant is told
 * the exact field list, so an unknown key is an invention — and inventing a
 * column is how you write a record nothing else in the portfolio can read.
 */
export function coerceFill(
  config: EntityConfig,
  raw: { [key: string]: unknown },
  refOptions: { [entity: string]: RefOption[] } = {}
): FillResult {
  const values: { [name: string]: string } = {};
  const unresolved: string[] = [];
  for (const field of config.fields) {
    const outcome = coerceField(field, raw[field.name], refOptions);
    if (!outcome) continue;
    if ("value" in outcome) values[field.name] = outcome.value;
    else unresolved.push(outcome.note);
  }
  return { values, unresolved };
}

// ---- reading the answer ---------------------------------------------------

/**
 * Pull the JSON object out of an answer.
 *
 * Asking for "only JSON" is a request, not a guarantee — a model that adds a
 * sentence of preamble or wraps the object in a fence has still done the work,
 * and throwing that away would make the feature feel unreliable for a reason
 * the user can neither see nor fix. Braces are balanced with string awareness
 * so a `}` inside a value can't end the scan early.
 */
export function extractJsonObject(answer: string): { [key: string]: unknown } | null {
  const text = String(answer ?? "");
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(text.slice(start, i + 1));
          return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? (parsed as { [key: string]: unknown })
            : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

// ---- the prompt -----------------------------------------------------------

/** Today in the browser's own zone — what "next Friday" is measured from. */
export function todayISO(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function describeField(field: FieldDef, config: EntityConfig): string {
  const parts: string[] = [`- ${field.name} (${field.label})`];
  if (field.ref) {
    const target = field.ref.replace(/_/g, " ");
    parts.push(
      `reference to a ${target} record — give the name, address or id as the description states it; it is matched to an existing record here`
    );
  } else if (field.type === "select") {
    parts.push(`exactly one of: ${(field.options ?? []).join(" | ")}`);
  } else if (field.type === "boolean") {
    parts.push("true or false");
  } else if (field.type === "currency") {
    parts.push("money — a plain number, no symbols or separators");
  } else if (field.type === "number") {
    parts.push("a plain number");
  } else if (field.type === "date") {
    parts.push("a date as YYYY-MM-DD");
  } else if (field.type === "email") {
    parts.push("an email address");
  } else if (field.type === "tel") {
    parts.push("a phone number");
  } else if (field.type === "textarea") {
    parts.push("free text");
  } else {
    parts.push("text");
  }
  if (field.required) parts.push("REQUIRED");
  if (field.name === config.key) parts.push("(the business key — omit unless stated)");
  return parts.join(" · ");
}

/**
 * The instruction that turns a sentence into a row.
 *
 * Two rules carry most of the weight. **Omit what isn't there** — a form that
 * arrives pre-filled with a plausible invented rent is worse than one with a
 * blank, because the blank is obviously unfinished and the invention is not.
 * And **no tools**: the agent behind this endpoint can query the portfolio, but
 * a description is self-contained, and a multi-step tool loop would turn a
 * two-second fill into a thirty-second one for no gain.
 *
 * `current` makes the second ask a refinement rather than a reset: with the
 * form's existing values in hand, "actually make it a duplex" edits one field
 * instead of re-deriving all of them from a sentence that no longer says the
 * rest.
 */
export function fillPrompt(
  config: EntityConfig,
  description: string,
  current: { [name: string]: string } = {},
  today: string = todayISO()
): string {
  const filled = Object.entries(current).filter(([, v]) => String(v ?? "").trim() !== "");
  return [
    `You are filling in the "New ${config.label}" form of a property-management app.`,
    `Turn the manager's description into field values.`,
    ``,
    `TODAY is ${today} — resolve relative dates ("next Friday", "in 30 days") against it.`,
    ``,
    `FIELDS — use the exact name before the parenthesis as the JSON key:`,
    ...config.fields.map((f) => describeField(f, config)),
    ``,
    ...(filled.length
      ? [
          `ALREADY ON THE FORM: ${JSON.stringify(Object.fromEntries(filled))}`,
          `The description below REFINES this — keep these values unless it changes them, and return them again alongside anything new.`,
          ``,
        ]
      : []),
    `DESCRIPTION:`,
    `"""`,
    description,
    `"""`,
    ``,
    `RULES`,
    `- Reply with ONLY a JSON object mapping field name to value. No prose, no code fences, no explanation.`,
    `- Omit any field the description does not support. Never invent an address, a name, an amount or a date that is not stated or directly implied.`,
    `- Do NOT run any tools or queries — answer from the description alone.`,
  ].join("\n");
}
