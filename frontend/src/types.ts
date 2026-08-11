// Shared TypeScript types for the PMS frontend.

export interface AuthUser {
  id?: string;
  username?: string;
  role?: string;
  email?: string;
  isActive?: boolean;
  globalRole?: string;
  [key: string]: unknown;
}

export interface LoginResponse {
  ok: boolean;
  token: string;
  user: AuthUser;
  error?: string;
}

// A record is an arbitrary document; InventDB stamps system fields prefixed "_".
export type Record = { _id?: string; [key: string]: unknown };

export interface ListResponse<T = Record> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface DashboardSummary {
  properties: {
    total: number;
    occupied: number;
    vacant: number;
    occupancy_rate: number;
  };
  tenants: { total: number };
  leases: { total: number; active: number; expiring_soon: number };
  maintenance: { total: number; open: number; in_progress: number };
  financials: {
    income_month: number;
    expense_month: number;
    net_month: number;
    expected_rent: number;
  };
}

export interface NameValue {
  name: string;
  value: number;
}

export interface CashflowPoint {
  month: string;
  income: number;
  expense: number;
  net: number;
}

export interface DashboardCharts {
  cashflow: CashflowPoint[];
  property_status: NameValue[];
  lease_status: NameValue[];
  maintenance_status: NameValue[];
  maintenance_priority: NameValue[];
  expense_breakdown: NameValue[];
}

// ---- Saved reports (defined in InventDB SOAR) -----------------------------
/** A report as it appears in the gallery — metadata only. */
export interface ReportSummary {
  id: string;
  name: string;
  description: string;
  category: string;
  mode: string;
  version?: number;
  created_by: string;
}

/** One input a report asks for before it can be rendered. */
export interface ReportParameter {
  name: string;
  label: string;
  /** InventDB's declared type: text, date, number, … */
  type: string;
  required: boolean;
  default?: string | number | null;
  /** Pre-resolved by the backend when the parameter declares a `source`. */
  options: { value: string; label: string }[];
}

export interface ReportDetail {
  id: string;
  name: string;
  description: string;
  category: string;
  mode: string;
  version?: number;
  parameters: ReportParameter[];
}

export interface ReportRender {
  html: string;
  meta: { elapsed_ms?: number; mode?: string; bytes?: number };
}

// ---- PMS SQL rollups ------------------------------------------------------
export interface Pnl {
  income_total: number;
  expense_total: number;
  net_total: number;
  income_by_category: NameValue[];
  expense_by_category: NameValue[];
}

export interface RentRollRow {
  lease_id?: string;
  tenant_name?: string;
  property_id?: string;
  city?: string;
  state?: string;
  contract_rent?: number;
  market_rent?: number;
  lease_start?: string;
  lease_end?: string;
  status?: string;
}

export interface RenewalRow {
  lease_id?: string;
  tenant_name?: string;
  property_id?: string;
  city?: string;
  lease_end?: string;
  contract_rent?: number;
  market_rent?: number;
  renewal_type?: string;
  rent_gap?: number;
}

export interface WorkOrdersReport {
  by_status: NameValue[];
  by_priority: NameValue[];
  by_category: NameValue[];
  open_cost_estimate: number;
}

// ---- Workflows (InventDB SOAR's engine, authored here) --------------------
// A step is one typed operation. `kind` selects which of the other fields
// apply — `sql_query` carries `sql`, `send_email` carries `to`/`subject`/
// `body`, and so on — which is why the rest is an open index signature rather
// than a union: the engine owns the catalogue, and a kind the PMS has no
// editor for still round-trips through an edit untouched.
export interface WorkflowStep {
  idx: number;
  label?: string;
  narration?: string;
  kind: string;
  /** Binds this step's output to `${name}` for the steps below it. */
  save_as?: string;
  /** Skip-condition: the step runs only when this `${var}` is truthy. */
  when?: string;
  [key: string]: unknown;
}

export interface Workflow {
  _id: string;
  name: string;
  trigger_kind?: string;
  trigger_intent?: string;
  trigger_spec?: { expr?: string; tz?: string; [key: string]: unknown };
  /** Does it fire on its trigger? Independent of `sandbox`. */
  active?: boolean;
  /** True until it has been activated once; it only rehearses until then. */
  pending_approval?: boolean;
  /** Are its side effects (email, SMS, writes) mocked? Independent of `active`. */
  sandbox?: boolean;
  plan?: WorkflowStep[];
  version?: number;
  next_run_at?: string | null;
  last_dispatched_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

/** The editable surface of a workflow — what create and edit send. */
export interface WorkflowDraft {
  name: string;
  trigger_kind: string;
  trigger_intent: string;
  trigger_spec: { expr?: string; tz?: string; [key: string]: unknown };
  plan: WorkflowStep[];
  sandbox: boolean;
}

/** One frozen definition in a workflow's history. */
export interface WorkflowVersion {
  _id?: string;
  workflow_id: string;
  version: number;
  name: string;
  trigger_intent?: string;
  plan?: WorkflowStep[];
  created_at?: string;
}

/** A plan step InventDB refused, and why. */
export interface PlanIssue {
  step_idx?: number;
  severity?: string;
  message: string;
}

export interface WorkflowRun {
  _id: string;
  workflow_id: string;
  status: string;
  started_at?: string;
  ended_at?: string;
  error?: string | null;
  sandbox?: boolean;
}

/**
 * One row of a run's execution timeline.
 *
 * The engine writes two rows per plan step at the same `idx` — the `tool_call`
 * before it runs and the `tool_result` after — so the payload a step actually
 * sent (`tool_args`) and what came back (`tool_result`) are both recorded. That
 * pair is the whole point of the timeline: it is the only place you can read
 * the SQL a run really executed, or the email it really composed, rather than
 * the definition's template of one.
 */
export interface WorkflowRunStep {
  _id?: string;
  run_id?: string;
  idx?: number;
  /** model_in | model_out | tool_call | tool_result | notify | wait_start | … */
  role?: string;
  created_at?: string;
  content?: string;
  tool_name?: string | null;
  tool_args?: unknown;
  tool_result?: unknown;
  correlation_id?: string | null;
}

/** What `GET /api/workflows/runs/<id>` returns: the run and its timeline. */
export interface WorkflowRunDetail {
  run?: WorkflowRun;
  steps?: WorkflowRunStep[];
}

// ---- The inbox (parked runs waiting on a person) --------------------------

/** One field a `form` action collects before the run may continue. */
export interface NotificationFormField {
  name: string;
  /** text | number | select | bool | date */
  type: string;
  required?: boolean;
  label?: string;
  options?: string[];
}

/**
 * One answer the person can give.
 *
 * `kind` is what the *plan* branches on: the engine turns an `approve` into
 * `${decision.approved} = true` and a `decline` into `${decision.declined}`, so
 * these are not cosmetic button styles — they select which steps run next.
 */
export interface NotificationAction {
  id: string;
  label: string;
  kind: "approve" | "decline" | "choice" | "form" | "dismiss" | string;
  form_fields?: NotificationFormField[];
}

/**
 * A message from a workflow run, and — when it carries actions — the decision
 * that run is parked on.
 *
 * The distinction is the whole model of the inbox: a notification with no
 * actions is something that *happened*, and one with actions is something
 * waiting to happen. Only the second kind holds a run open.
 */
export interface AppNotification {
  _id: string;
  title: string;
  body?: string;
  actions?: NotificationAction[];
  workflow_id?: string;
  run_id?: string;
  step_idx?: number;
  created_at?: string;
  read_at?: string | null;
  resolved_action?: string | null;
  resolved_at?: string | null;
  resolved_payload?: unknown;
}

/** What resolving returns — chiefly, that the parked run was released. */
export interface NotificationResolution {
  notification_id?: string;
  resolved_action?: string;
  action_kind?: string;
  approved?: boolean;
  declined?: boolean;
  run_id?: string;
  resumed?: boolean;
}

// ---- Maintenance intake ---------------------------------------------------

/** A vendor who could take a job, with the reason they were ranked there. */
export interface VendorMatch {
  _id?: string;
  vendor_id?: string;
  company: string;
  trade?: string;
  contact?: string;
  phone?: string;
  email?: string;
  rating?: number;
  coi_on_file?: boolean;
  /** True when a certificate of insurance is on file. */
  insured?: boolean;
  /** Plain-language account of why this vendor ranked here. */
  why?: string;
  match_rank?: number;
}

export interface VendorShortlist {
  category: string;
  trades: string[];
  vendors: VendorMatch[];
  total_matched: number;
}

/** Whether a category has anyone on file who can service it. */
export interface CategoryCoverage {
  category: string;
  trades: string[];
  covered: boolean;
}

export interface IntakeStatus {
  installed: boolean;
  workflow: Workflow | null;
  name: string;
  trades_on_file: string[];
  coverage: CategoryCoverage[];
  /** Categories with nobody on file — the intake would park with an empty shortlist. */
  uncovered: string[];
}
