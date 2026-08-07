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

// ---- Reports (computed by InventDB SQL) ----------------------------------
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

// ---- Workflows (from InventDB SOAR) --------------------------------------
export interface WorkflowStep {
  idx: number;
  label?: string;
  narration?: string;
  kind: string;
  [key: string]: unknown;
}

export interface Workflow {
  _id: string;
  name: string;
  trigger_kind?: string;
  trigger_intent?: string;
  trigger_spec?: { expr?: string; tz?: string };
  active?: boolean;
  plan?: WorkflowStep[];
  last_dispatched_at?: string | null;
  created_at?: string;
  updated_at?: string;
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
