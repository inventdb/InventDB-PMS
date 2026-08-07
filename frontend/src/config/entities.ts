// Declarative field configuration for every PMS module.
// These field names match the live InventDB `pms` namespace schema exactly, so
// tables, forms and detail views read and write the real data directly.

export type FieldType =
  | "text"
  | "textarea"
  | "number"
  | "currency"
  | "date"
  | "select"
  | "boolean"
  | "email"
  | "tel";

export interface FieldDef {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: string[];
  /** Reference another entity; renders a dropdown of that entity's records. */
  ref?: string;
  /** Show this field as a column in the list table. */
  table?: boolean;
  /** Render the value as a coloured status badge. */
  badge?: boolean;
  placeholder?: string;
  step?: number;
  /** Layout hint for the form grid. */
  full?: boolean;
}

export interface EntityConfig {
  name: string;
  label: string;
  labelPlural: string;
  key: string;
  icon: string;
  /** Fields used to build a display title for a record. */
  titleFields: string[];
  /** Hide the leading business-key column (for types without a real id). */
  hideKeyColumn?: boolean;
  fields: FieldDef[];
  defaultSort?: { field: string; dir: "asc" | "desc" };
}

export const ENTITIES: EntityConfig[] = [
  {
    name: "properties",
    label: "Property",
    labelPlural: "Properties",
    key: "property_id",
    icon: "building",
    titleFields: ["street", "city"],
    defaultSort: { field: "street", dir: "asc" },
    fields: [
      { name: "street", label: "Street", type: "text", required: true, table: true },
      { name: "city", label: "City", type: "text", table: true },
      { name: "state", label: "State", type: "text" },
      { name: "zip", label: "ZIP", type: "text" },
      { name: "region", label: "Region", type: "text", table: true },
      { name: "owner_id", label: "Owner", type: "text", ref: "owners" },
      {
        name: "type",
        label: "Type",
        type: "select",
        options: ["Single Family", "Townhouse", "Condo", "Duplex Unit", "Apartment Unit", "Commercial"],
        table: true,
      },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: ["Occupied", "Vacant", "Maintenance"],
        table: true,
        badge: true,
      },
      { name: "beds", label: "Beds", type: "number", table: true },
      { name: "baths", label: "Baths", type: "number", step: 0.5 },
      { name: "sqft", label: "Sq Ft", type: "number" },
      { name: "year_built", label: "Year Built", type: "number" },
      { name: "lot_ac", label: "Lot (acres)", type: "number", step: 0.01 },
      { name: "garage", label: "Garage", type: "text" },
      { name: "market_rent", label: "Market Rent", type: "currency", table: true },
      { name: "market_value", label: "Market Value", type: "currency" },
      { name: "acq_date", label: "Acquired", type: "date" },
      { name: "acq_price", label: "Acquisition Price", type: "currency" },
      { name: "annual_tax", label: "Annual Tax", type: "currency" },
      { name: "annual_insurance", label: "Annual Insurance", type: "currency" },
      { name: "monthly_hoa", label: "Monthly HOA", type: "currency" },
      { name: "unit", label: "Unit", type: "text" },
    ],
  },
  {
    name: "owners",
    label: "Owner",
    labelPlural: "Owners",
    key: "owner_id",
    icon: "user-round",
    titleFields: ["name"],
    defaultSort: { field: "name", dir: "asc" },
    fields: [
      { name: "name", label: "Name", type: "text", required: true, table: true },
      {
        name: "type",
        label: "Type",
        type: "select",
        options: ["Individual", "Joint", "LLC", "Trust", "Corporation"],
        table: true,
      },
      { name: "contact", label: "Primary Contact", type: "text", table: true },
      { name: "phone", label: "Phone", type: "tel", table: true },
      { name: "email", label: "Email", type: "email", table: true },
      { name: "mailing_address", label: "Mailing Address", type: "text", full: true },
      { name: "tax_id", label: "Tax ID", type: "text" },
      { name: "mgmt_fee", label: "Mgmt Fee (rate)", type: "number", step: 0.01 },
      {
        name: "payout_method",
        label: "Payout Method",
        type: "select",
        options: ["ACH", "Check", "Wire"],
      },
      { name: "w_9_on_file", label: "W-9 on File", type: "boolean", table: true },
    ],
  },
  {
    name: "tenants",
    label: "Tenant",
    labelPlural: "Tenants",
    key: "tenant_id",
    icon: "users",
    titleFields: ["first", "last"],
    defaultSort: { field: "last", dir: "asc" },
    fields: [
      { name: "first", label: "First Name", type: "text", required: true, table: true },
      { name: "last", label: "Last Name", type: "text", required: true, table: true },
      { name: "phone", label: "Phone", type: "tel", table: true },
      { name: "email", label: "Email", type: "email", table: true },
      { name: "property_id", label: "Property", type: "text", ref: "properties", table: true },
      { name: "move_in", label: "Move-in", type: "date", table: true },
      { name: "occupants", label: "Occupants", type: "number" },
      { name: "vehicles", label: "Vehicles", type: "number" },
      { name: "pets", label: "Pets", type: "text" },
      { name: "emergency_contact", label: "Emergency Contact", type: "text" },
      { name: "emergency_phone", label: "Emergency Phone", type: "tel" },
    ],
  },
  {
    name: "leases",
    label: "Lease",
    labelPlural: "Leases",
    key: "lease_id",
    icon: "file-text",
    titleFields: ["tenant_name"],
    defaultSort: { field: "lease_start", dir: "desc" },
    fields: [
      { name: "property_id", label: "Property", type: "text", ref: "properties", required: true, table: true },
      { name: "tenant_id", label: "Tenant", type: "text", ref: "tenants" },
      { name: "tenant_name", label: "Tenant Name", type: "text", table: true },
      { name: "lease_start", label: "Start", type: "date", table: true },
      { name: "lease_end", label: "End", type: "date", table: true },
      { name: "term_mo", label: "Term (months)", type: "number" },
      { name: "contract_rent", label: "Contract Rent", type: "currency", table: true },
      { name: "market_rent", label: "Market Rent", type: "currency" },
      { name: "pet_rent", label: "Pet Rent", type: "currency" },
      { name: "deposit_held", label: "Deposit Held", type: "currency" },
      { name: "pet_deposit_held", label: "Pet Deposit", type: "currency" },
      { name: "late_fee", label: "Late Fee", type: "currency" },
      { name: "grace_days", label: "Grace Days", type: "number" },
      {
        name: "renewal_type",
        label: "Renewal",
        type: "select",
        options: ["Auto-renew", "Manual", "Month-to-month"],
      },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: ["Active", "Pending", "Expired", "Terminated"],
        table: true,
        badge: true,
      },
    ],
  },
  {
    name: "work_orders",
    label: "Work Order",
    labelPlural: "Work Orders",
    key: "wo",
    icon: "wrench",
    titleFields: ["issue"],
    defaultSort: { field: "date_opened", dir: "desc" },
    fields: [
      { name: "date_opened", label: "Opened", type: "date", table: true },
      { name: "issue", label: "Issue", type: "text", required: true, table: true },
      { name: "property_id", label: "Property", type: "text", ref: "properties", table: true },
      { name: "tenant_id", label: "Tenant", type: "text", ref: "tenants" },
      {
        name: "category",
        label: "Category",
        type: "select",
        options: [
          "Plumbing", "Electrical", "HVAC", "Appliance", "General", "Doors/Windows",
          "Landscaping", "Roofing", "Pest Control", "Locks/Keys", "Smoke Detector",
          "Painting", "Flooring",
        ],
        table: true,
      },
      {
        name: "priority",
        label: "Priority",
        type: "select",
        options: ["Low", "Medium", "High", "Emergency"],
        table: true,
        badge: true,
      },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: ["Open", "In Progress", "Completed", "Cancelled"],
        table: true,
        badge: true,
      },
      { name: "vendor", label: "Vendor", type: "text", table: true },
      { name: "est_cost", label: "Est. Cost", type: "currency" },
      { name: "actual_cost", label: "Actual Cost", type: "currency", table: true },
      { name: "date_closed", label: "Closed", type: "date" },
    ],
  },
  {
    name: "vendors",
    label: "Vendor",
    labelPlural: "Vendors",
    key: "vendor_id",
    icon: "hard-hat",
    titleFields: ["company"],
    defaultSort: { field: "company", dir: "asc" },
    fields: [
      { name: "company", label: "Company", type: "text", required: true, table: true },
      { name: "trade", label: "Trade", type: "text", table: true },
      { name: "contact", label: "Contact", type: "text", table: true },
      { name: "phone", label: "Phone", type: "tel", table: true },
      { name: "email", label: "Email", type: "email" },
      { name: "license", label: "License #", type: "text" },
      { name: "rating", label: "Rating", type: "number", step: 0.1, table: true },
      { name: "w_9_on_file", label: "W-9 on File", type: "boolean" },
      { name: "coi_on_file", label: "COI on File", type: "boolean" },
      { name: "coi_expiry", label: "COI Expiry", type: "date" },
    ],
  },
  {
    name: "transactions",
    label: "Transaction",
    labelPlural: "Accounting",
    key: "reference",
    icon: "wallet",
    titleFields: ["memo"],
    defaultSort: { field: "date", dir: "desc" },
    fields: [
      { name: "date", label: "Date", type: "date", required: true, table: true },
      {
        name: "type",
        label: "Type",
        type: "select",
        options: ["Income", "Expense"],
        table: true,
        badge: true,
      },
      {
        name: "account_category",
        label: "Category",
        type: "select",
        options: [
          "Rent", "Pet Rent", "Late Fee", "Security Deposit", "Pet Deposit",
          "Application Fee", "Management Fee", "Repairs & Maintenance", "Insurance",
          "Property Tax", "HOA", "Utilities", "Other",
        ],
        table: true,
      },
      { name: "amount", label: "Amount", type: "currency", required: true, table: true },
      { name: "property_id", label: "Property", type: "text", ref: "properties", table: true },
      { name: "owner_id", label: "Owner", type: "text", ref: "owners" },
      { name: "party_tenant_vendor", label: "Party", type: "text", table: true },
      { name: "account", label: "GL Account", type: "text" },
      {
        name: "method",
        label: "Method",
        type: "select",
        options: ["ACH", "Check", "Zelle", "Online Portal", "Cash", "Card"],
      },
      { name: "memo", label: "Memo", type: "text", full: true },
    ],
  },
  {
    name: "inspections",
    label: "Inspection",
    labelPlural: "Inspections",
    key: "inspection_id",
    icon: "clipboard-check",
    titleFields: ["type"],
    defaultSort: { field: "scheduled", dir: "desc" },
    fields: [
      { name: "property_id", label: "Property", type: "text", ref: "properties", required: true, table: true },
      {
        name: "type",
        label: "Type",
        type: "select",
        options: [
          "Move-In", "Move-Out", "Drive-by", "Semi-Annual", "Annual Walk-through",
          "Post-Repair Verification", "Pre-Renewal", "Insurance Survey",
        ],
        table: true,
      },
      { name: "scheduled", label: "Scheduled", type: "date", table: true },
      { name: "inspector", label: "Inspector", type: "text", table: true },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: ["Scheduled", "In Progress", "Completed", "Failed"],
        table: true,
        badge: true,
      },
      { name: "issues_found", label: "Issues Found", type: "text", full: true },
      { name: "follow_up_wo", label: "Follow-up WO", type: "text", ref: "work_orders" },
      { name: "repair_estimate", label: "Repair Estimate", type: "currency" },
      { name: "notes", label: "Notes", type: "textarea", full: true },
    ],
  },
  {
    name: "compliance",
    label: "Compliance Record",
    labelPlural: "Compliance",
    key: "policy",
    icon: "shield",
    titleFields: ["insurance_carrier", "policy"],
    defaultSort: { field: "policy_expiry", dir: "asc" },
    fields: [
      { name: "property_id", label: "Property", type: "text", ref: "properties", required: true, table: true },
      { name: "insurance_carrier", label: "Insurance Carrier", type: "text", table: true },
      { name: "coverage", label: "Coverage", type: "text" },
      { name: "annual_premium", label: "Annual Premium", type: "currency", table: true },
      { name: "policy_expiry", label: "Policy Expiry", type: "date", table: true },
      { name: "smoke_test_date", label: "Smoke Test", type: "date" },
      { name: "co_test_date", label: "CO Test", type: "date" },
      { name: "lead_paint_pre_1978", label: "Lead Paint (pre-1978)", type: "text" },
      { name: "cert_of_occupancy", label: "Cert. of Occupancy", type: "text" },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: ["Compliant", "Renewal due 60d", "Non-Compliant"],
        table: true,
        badge: true,
      },
    ],
  },
  {
    name: "daily_tasks",
    label: "Daily Task",
    labelPlural: "Daily Tasks",
    key: "task",
    icon: "list-checks",
    titleFields: ["task"],
    hideKeyColumn: true,
    defaultSort: { field: "date", dir: "desc" },
    fields: [
      { name: "date", label: "Date", type: "date", table: true },
      { name: "time", label: "Time", type: "text", placeholder: "09:15", table: true },
      { name: "task", label: "Task", type: "text", required: true, table: true },
      { name: "property_id", label: "Property", type: "text", ref: "properties", table: true },
      {
        name: "category",
        label: "Category",
        type: "select",
        options: [
          "Maintenance", "Leasing", "Compliance", "Accounting", "Inspection",
          "Owner Relations", "Turnover", "Marketing", "Collections", "Legal",
        ],
        table: true,
      },
      {
        name: "priority",
        label: "Priority",
        type: "select",
        options: ["Low", "Medium", "High"],
        table: true,
        badge: true,
      },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: ["Todo", "Done"],
        table: true,
        badge: true,
      },
    ],
  },
];

export const ENTITY_BY_NAME: { [name: string]: EntityConfig } = Object.fromEntries(
  ENTITIES.map((e) => [e.name, e])
);

// ---- Status/priority badge tone mapping -----------------------------------
export type Tone = "success" | "warn" | "danger" | "info" | "neutral";

const TONE_MAP: { [value: string]: Tone } = {
  // Positive / active
  occupied: "success",
  active: "success",
  paid: "success",
  completed: "success",
  approved: "success",
  income: "success",
  compliant: "success",
  done: "success",
  "auto-renew": "success",
  // Warnings / in-progress
  vacant: "warn",
  pending: "warn",
  "in progress": "warn",
  scheduled: "info",
  todo: "info",
  late: "warn",
  open: "warn",
  medium: "warn",
  maintenance: "warn",
  "renewal due 60d": "warn",
  // Danger
  expired: "danger",
  terminated: "danger",
  denied: "danger",
  failed: "danger",
  cancelled: "danger",
  "non-compliant": "danger",
  emergency: "danger",
  high: "danger",
  expense: "danger",
  // Neutral
  low: "neutral",
};

export function toneForValue(value: unknown): Tone {
  if (value === null || value === undefined || value === "") return "neutral";
  return TONE_MAP[String(value).trim().toLowerCase()] ?? "neutral";
}

export function recordTitle(cfg: EntityConfig, record: Record<string, unknown>): string {
  const parts = cfg.titleFields
    .map((f) => record[f])
    .filter((v) => v !== undefined && v !== null && v !== "");
  if (parts.length) return parts.join(" ");
  const key = record[cfg.key];
  return key ? String(key) : "(untitled)";
}
