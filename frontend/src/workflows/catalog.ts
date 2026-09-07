/**
 * The workflow step and trigger catalogue.
 *
 * InventDB's executor walks a plan of typed steps: `kind` selects the
 * operation and the remaining keys are that operation's arguments, flattened
 * onto the step (`{kind: "sql_query", sql: "…"}`). The engine deserialises
 * strictly, so a step missing a required key is rejected for the whole plan.
 *
 * Rather than hand-roll a form per kind, each kind is described once here and
 * the editor renders from the description. That keeps the editor, the step
 * summaries on the timeline and the validation in step with each other — and
 * adding a kind the engine gains is a single entry rather than a new component.
 *
 * A kind that is *not* listed still round-trips safely: the editor shows its
 * raw JSON rather than dropping fields it does not recognise, so a plan
 * authored in SOAR with a newer step kind survives an edit made here.
 */
import {
  Bell,
  Braces,
  CalendarClock,
  CalendarPlus,
  CheckCircle2,
  Circle,
  Database,
  FileBarChart,
  GitBranch,
  Hand,
  Mail,
  MessageSquare,
  PencilLine,
  PlusCircle,
  Sparkles,
  Timer,
  Trash2,
  Webhook,
  Workflow as WorkflowIcon,
  Zap,
  type LucideIcon,
} from "lucide-react";

import { ENTITIES } from "../config/entities";

export type FieldType =
  | "text"
  | "textarea"
  | "sql"
  | "json"
  | "list"
  | "boolean"
  | "select";

export interface StepField {
  /** Key written onto the step object, exactly as the engine expects it. */
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  placeholder?: string;
  /** Shown under the control — say what the field does, not what it is. */
  hint?: string;
  /** For `select`: the allowed values. */
  options?: readonly string[];
  /** Prefilled when the field is first shown. */
  defaultValue?: string;
}

export interface StepKind {
  kind: string;
  label: string;
  /** One line, present tense: what this step does when the run reaches it. */
  blurb: string;
  icon: LucideIcon;
  fields: StepField[];
  /** True when this step can send something outside the system. */
  sideEffecting?: boolean;
}

/**
 * `${var}` interpolation is the thread running through a plan: a step binds
 * its output with `save_as`, and later steps read it back by name. Repeating
 * that in every hint would be noise, so it is said once per field that takes
 * a template.
 */
const TEMPLATED = "Supports ${variable} references to earlier steps.";

export const STEP_KINDS: StepKind[] = [
  {
    kind: "sql_query",
    label: "Run a query",
    blurb: "Reads from your data and hands the rows to the steps below.",
    icon: Database,
    fields: [
      {
        name: "sql",
        label: "SQL",
        type: "sql",
        required: true,
        placeholder: "SELECT * FROM pms.leases WHERE end_date < '2026-01-01'",
        hint: "SELECT only — the SQL step cannot write. Use the record steps to write.",
      },
    ],
  },
  {
    kind: "render_report",
    label: "Render a report",
    blurb: "Runs a saved report template and keeps the result to send on.",
    icon: FileBarChart,
    fields: [
      {
        name: "template_id",
        label: "Report template",
        type: "text",
        required: true,
        hint: "The id of a report saved on this instance — see the Reports page.",
      },
      { name: "params", label: "Parameters", type: "json", placeholder: '{"month": "2026-01"}' },
      {
        name: "for_each",
        label: "Once per row of",
        type: "text",
        placeholder: "owners",
        hint: "Name a variable from an earlier step to render one report per row.",
      },
    ],
  },
  {
    kind: "send_email",
    label: "Send an email",
    blurb: "Sends mail from the connected mailbox.",
    icon: Mail,
    sideEffecting: true,
    fields: [
      { name: "to", label: "To", type: "text", required: true, placeholder: "${owners.email}", hint: TEMPLATED },
      { name: "subject", label: "Subject", type: "text", required: true, hint: TEMPLATED },
      { name: "body", label: "Body", type: "textarea", required: true, hint: TEMPLATED },
      { name: "cc", label: "Cc", type: "list", placeholder: "a@example.com, b@example.com" },
      {
        name: "for_each",
        label: "Once per row of",
        type: "text",
        placeholder: "overdue",
        hint: "Name a variable to send one email per row instead of one to everyone.",
      },
    ],
  },
  {
    kind: "send_sms",
    label: "Send an SMS",
    blurb: "Texts a number through the connected SMS provider.",
    icon: MessageSquare,
    sideEffecting: true,
    fields: [
      { name: "to", label: "To", type: "text", required: true, hint: TEMPLATED },
      { name: "body", label: "Message", type: "textarea", required: true, hint: TEMPLATED },
    ],
  },
  {
    kind: "notify_user",
    label: "Ask for approval",
    blurb: "Puts a notification in the approvals inbox; pair it with a wait step to hold the run.",
    icon: Bell,
    fields: [
      { name: "title", label: "Title", type: "text", required: true },
      { name: "body", label: "Body", type: "textarea", required: true, hint: TEMPLATED },
      { name: "audience_user_id", label: "Notify user id", type: "text", hint: "Leave blank to notify the owner." },
      { name: "also_email", label: "Also email it", type: "boolean" },
    ],
  },
  {
    kind: "create_calendar_event",
    label: "Create a calendar event",
    blurb: "Adds an event to the connected calendar.",
    icon: CalendarPlus,
    sideEffecting: true,
    fields: [
      { name: "title", label: "Title", type: "text", required: true },
      { name: "start", label: "Starts", type: "text", required: true, placeholder: "2026-02-01T09:00:00Z" },
      { name: "end", label: "Ends", type: "text", required: true, placeholder: "2026-02-01T09:30:00Z" },
      { name: "attendees", label: "Attendees", type: "list" },
      { name: "description", label: "Description", type: "textarea" },
    ],
  },
  {
    kind: "insert_record",
    label: "Create a record",
    blurb: "Writes a new row — a work order, a task, a ledger entry.",
    icon: PlusCircle,
    sideEffecting: true,
    fields: [
      { name: "namespace", label: "Namespace", type: "text", required: true, placeholder: "pms" },
      { name: "type_name", label: "Type", type: "text", required: true, placeholder: "work_orders" },
      { name: "record", label: "Fields", type: "json", required: true, placeholder: '{"status": "Open"}', hint: TEMPLATED },
    ],
  },
  {
    kind: "update_record",
    label: "Update a record",
    blurb: "Changes only the fields you list on one existing row.",
    icon: PencilLine,
    sideEffecting: true,
    fields: [
      { name: "namespace", label: "Namespace", type: "text", required: true, placeholder: "pms" },
      { name: "type_name", label: "Type", type: "text", required: true, placeholder: "leases" },
      {
        name: "record_id",
        label: "Record id",
        type: "text",
        required: true,
        placeholder: "${expiring.first._id}",
        hint: "Usually taken from a query step above.",
      },
      { name: "fields", label: "Fields to change", type: "json", required: true, hint: TEMPLATED },
    ],
  },
  {
    kind: "delete_record",
    label: "Delete a record",
    blurb: "Removes one row, subject to the same referential checks as the UI.",
    icon: Trash2,
    sideEffecting: true,
    fields: [
      { name: "namespace", label: "Namespace", type: "text", required: true, placeholder: "pms" },
      { name: "type_name", label: "Type", type: "text", required: true },
      { name: "record_id", label: "Record id", type: "text", required: true },
    ],
  },
  {
    kind: "wait_for_event",
    label: "Wait",
    blurb: "Parks the run until something matching arrives, or the timeout passes.",
    icon: Timer,
    fields: [
      { name: "description", label: "Waiting for", type: "text", required: true },
      { name: "correlation_hint", label: "Match on", type: "text", required: true, hint: "What ties the reply back to this run — an id, an address." },
      { name: "timeout", label: "Give up after", type: "text", required: true, placeholder: "48h" },
      { name: "on_timeout", label: "On timeout", type: "text", placeholder: "continue" },
    ],
  },
  {
    kind: "decide",
    label: "Record a decision",
    blurb: "Writes down which branch was taken and why. Audit only — it changes nothing.",
    icon: GitBranch,
    fields: [
      { name: "chosen", label: "Chose", type: "text", required: true },
      { name: "reason", label: "Because", type: "textarea", required: true },
    ],
  },
  {
    kind: "call_workflow",
    label: "Call another workflow",
    blurb: "Runs a second workflow as a step of this one.",
    icon: WorkflowIcon,
    fields: [
      { name: "workflow_id", label: "Workflow id", type: "text", required: true },
      { name: "params", label: "Parameters", type: "json" },
      { name: "for_each", label: "Once per row of", type: "text" },
    ],
  },
  {
    kind: "llm_extract",
    label: "Extract with AI",
    blurb: "Pulls structured fields out of free text. The one AI step allowed mid-run.",
    icon: Sparkles,
    fields: [
      { name: "prompt", label: "Prompt", type: "textarea", required: true },
      { name: "source", label: "Read from", type: "text", required: true, placeholder: "${event.body}" },
      {
        name: "schema",
        label: "Output shape",
        type: "json",
        required: true,
        placeholder: '{"type": "object", "properties": {"amount": {"type": "number"}}}',
        hint: "A JSON Schema — it constrains the output so later steps see a predictable shape.",
      },
    ],
  },
  {
    kind: "finish",
    label: "Finish",
    blurb: "Ends the run and records this summary against it.",
    icon: CheckCircle2,
    fields: [{ name: "summary", label: "Summary", type: "text", required: true }],
  },
];

const BY_KIND = new Map(STEP_KINDS.map((s) => [s.kind, s]));

export function stepKind(kind: string): StepKind | undefined {
  return BY_KIND.get(kind);
}

export function stepIcon(kind: string): LucideIcon {
  return BY_KIND.get(kind)?.icon ?? Circle;
}

/** "send_email" -> "Send an email"; an unknown kind reads as itself. */
export function stepLabel(kind: string): string {
  return BY_KIND.get(kind)?.label ?? kind.replace(/_/g, " ");
}

// ---- Triggers -------------------------------------------------------------

export interface TriggerKind {
  kind: string;
  label: string;
  blurb: string;
  icon: LucideIcon;
  /**
   * Fields written into `trigger_spec`. `cron` is absent from this list on
   * purpose — its schedule has a picker of its own rather than a text box.
   *
   * These are not decoration: InventDB refuses to create a `record_event`
   * workflow without `ns` and `type`, so a trigger offered without its fields
   * would be an option that can only fail.
   */
  specFields?: StepField[];
}

/** The PMS types a record-change trigger can watch. */
const PMS_TYPES = ENTITIES.map((e) => e.name);

/** What can start a run. */
export const TRIGGER_KINDS: TriggerKind[] = [
  {
    kind: "cron",
    label: "On a schedule",
    blurb: "Runs at a fixed time — daily, weekly, monthly.",
    icon: CalendarClock,
  },
  {
    kind: "manual",
    label: "Only when I run it",
    blurb: "Never fires on its own. Useful while you are still building it.",
    icon: Hand,
  },
  {
    kind: "record_event",
    label: "When a record changes",
    blurb: "Fires when a row of the type you name is created, updated or deleted.",
    icon: Zap,
    specFields: [
      {
        name: "type",
        label: "Watch which records",
        type: "select",
        required: true,
        options: PMS_TYPES,
        defaultValue: PMS_TYPES[0],
      },
      {
        name: "ops",
        label: "On",
        type: "list",
        placeholder: "create, update, delete",
        defaultValue: "create, update",
        hint: "Which changes count. Leave blank for all of them.",
      },
      {
        name: "ns",
        label: "Namespace",
        type: "text",
        required: true,
        defaultValue: "pms",
        hint: "Where your PMS data lives. Change this only if you know you need to.",
      },
    ],
  },
  {
    kind: "inbound_email",
    label: "When an email arrives",
    blurb: "Fires on new mail in the connected mailbox.",
    icon: Mail,
    specFields: [
      {
        name: "gmail_label",
        label: "Only mail labelled",
        type: "text",
        placeholder: "maintenance",
        hint: "Leave blank to watch the whole inbox.",
      },
    ],
  },
  {
    kind: "inbound_webhook",
    label: "When a webhook fires",
    blurb: "Fires when another system posts to this workflow's URL.",
    icon: Webhook,
    specFields: [
      {
        name: "secret_ref",
        label: "Shared secret",
        type: "text",
        hint: "Callers must present this, so nobody else can fire the workflow.",
      },
    ],
  },
];

const TRIGGER_BY_KIND = new Map(TRIGGER_KINDS.map((t) => [t.kind, t]));

export function triggerKind(kind?: string): TriggerKind | undefined {
  return TRIGGER_BY_KIND.get(kind ?? "");
}

export function triggerIcon(kind?: string): LucideIcon {
  // `event` and `schedule` are older spellings that still appear on workflows
  // authored before the kinds settled; map them rather than show a blank.
  if (kind === "schedule") return CalendarClock;
  if (kind === "event") return Zap;
  return TRIGGER_BY_KIND.get(kind ?? "")?.icon ?? Braces;
}

export function triggerLabel(kind?: string): string {
  if (kind === "schedule") return "On a schedule";
  if (kind === "event") return "When a record changes";
  return TRIGGER_BY_KIND.get(kind ?? "")?.label ?? kind ?? "Manual";
}
