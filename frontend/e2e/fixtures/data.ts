/**
 * Seed data for the mocked API.
 *
 * Field names mirror `src/config/entities.ts` exactly — the UI reads records by
 * those names, so a drifting fixture shows up as a blank cell rather than a
 * test failure. `_id` is what the edit/delete paths key off, so every record
 * carries one.
 */

export type Rec = { _id: string; [k: string]: unknown };
export type Store = { [entity: string]: Rec[] };

/** Business key per entity, mirroring EntityConfig.key. */
export const ENTITY_KEYS: { [entity: string]: string } = {
  properties: "property_id",
  owners: "owner_id",
  tenants: "tenant_id",
  leases: "lease_id",
  work_orders: "wo",
  vendors: "vendor_id",
  transactions: "reference",
  inspections: "inspection_id",
  compliance: "policy",
  daily_tasks: "task",
};

/** Every module, with the label the sidebar and page head show for it. */
export const MODULES = [
  { name: "properties", label: "Property", plural: "Properties" },
  { name: "owners", label: "Owner", plural: "Owners" },
  { name: "tenants", label: "Tenant", plural: "Tenants" },
  { name: "leases", label: "Lease", plural: "Leases" },
  { name: "work_orders", label: "Work Order", plural: "Work Orders" },
  { name: "vendors", label: "Vendor", plural: "Vendors" },
  { name: "inspections", label: "Inspection", plural: "Inspections" },
  { name: "compliance", label: "Compliance Record", plural: "Compliance" },
  { name: "daily_tasks", label: "Daily Task", plural: "Daily Tasks" },
  { name: "transactions", label: "Transaction", plural: "Accounting" },
] as const;

export const AUTH_USER = {
  id: "u-1",
  username: "e2e.manager",
  email: "e2e.manager@inventdb.com",
  role: "manager",
  isActive: true,
};

export const AUTH_TOKEN = "e2e-test-token";

export const HEALTH = {
  ok: true,
  version: "1.0.0",
  inventdb_base_url: "https://e2e.sandbox.inventdb.com",
  namespace: "pms",
  frontend_bundled: false,
};

/** A fresh copy of the seed data — never share arrays between tests. */
export function createStore(): Store {
  return JSON.parse(JSON.stringify(SEED)) as Store;
}

const SEED: Store = {
  properties: [
    {
      _id: "prop-1",
      property_id: "P-001",
      street: "12 Marine Drive",
      city: "Mumbai",
      state: "MH",
      zip: "400020",
      region: "West",
      owner_id: "O-001",
      type: "Condo",
      status: "Occupied",
      beds: 3,
      baths: 2,
      sqft: 1450,
      year_built: 2011,
      market_rent: 2400,
      market_value: 410000,
      acq_date: "2019-04-15",
    },
    {
      _id: "prop-2",
      property_id: "P-002",
      street: "9 Park Street",
      city: "Kolkata",
      state: "WB",
      zip: "700016",
      region: "East",
      owner_id: "O-002",
      type: "Single Family",
      status: "Vacant",
      beds: 4,
      baths: 3,
      sqft: 2100,
      year_built: 2004,
      market_rent: 3100,
      market_value: 525000,
      acq_date: "2020-08-02",
    },
    {
      _id: "prop-3",
      property_id: "P-003",
      street: "44 Residency Road",
      city: "Bengaluru",
      state: "KA",
      zip: "560025",
      region: "South",
      owner_id: "O-001",
      type: "Apartment Unit",
      status: "Maintenance",
      beds: 2,
      baths: 1,
      sqft: 980,
      year_built: 2016,
      market_rent: 1850,
      market_value: 298000,
      acq_date: "2021-01-20",
    },
  ],

  owners: [
    {
      _id: "own-1",
      owner_id: "O-001",
      name: "Harbourline Holdings",
      type: "LLC",
      contact: "Anita Rao",
      phone: "+91 22 5550 1188",
      email: "anita@harbourline.example",
      mailing_address: "Level 8, Nariman Point, Mumbai",
      payout_method: "ACH",
      w_9_on_file: true,
    },
    {
      _id: "own-2",
      owner_id: "O-002",
      name: "Devraj Family Trust",
      type: "Trust",
      contact: "S. Devraj",
      phone: "+91 33 5550 2244",
      email: "devraj@trust.example",
      payout_method: "Check",
      w_9_on_file: false,
    },
  ],

  tenants: [
    {
      _id: "ten-1",
      tenant_id: "T-001",
      first: "Meera",
      last: "Iyer",
      phone: "+91 98200 11111",
      email: "meera.iyer@example.com",
      property_id: "P-001",
      move_in: "2023-06-01",
      occupants: 3,
    },
    {
      _id: "ten-2",
      tenant_id: "T-002",
      first: "Arjun",
      last: "Bose",
      phone: "+91 98300 22222",
      email: "arjun.bose@example.com",
      property_id: "P-003",
      move_in: "2024-02-15",
      occupants: 1,
    },
  ],

  leases: [
    {
      _id: "lea-1",
      lease_id: "L-001",
      property_id: "P-001",
      tenant_id: "T-001",
      tenant_name: "Meera Iyer",
      lease_start: "2023-06-01",
      lease_end: "2026-05-31",
      term_mo: 36,
      contract_rent: 2400,
      market_rent: 2500,
      deposit_held: 4800,
      renewal_type: "Auto-renew",
      status: "Active",
    },
    {
      _id: "lea-2",
      lease_id: "L-002",
      property_id: "P-003",
      tenant_id: "T-002",
      tenant_name: "Arjun Bose",
      lease_start: "2024-02-15",
      lease_end: "2025-02-14",
      term_mo: 12,
      contract_rent: 1800,
      market_rent: 1850,
      deposit_held: 3600,
      renewal_type: "Manual",
      status: "Expired",
    },
  ],

  work_orders: [
    {
      _id: "wo-1",
      wo: "WO-1001",
      date_opened: "2025-11-04",
      issue: "Kitchen tap dripping",
      property_id: "P-001",
      tenant_id: "T-001",
      category: "Plumbing",
      priority: "Medium",
      status: "Open",
      vendor: "Coastal Plumbing",
      est_cost: 120,
    },
    {
      _id: "wo-2",
      wo: "WO-1002",
      date_opened: "2025-10-22",
      issue: "AC not cooling",
      property_id: "P-003",
      category: "HVAC",
      priority: "Emergency",
      status: "In Progress",
      vendor: "Nimbus Air",
      est_cost: 450,
      actual_cost: 415,
    },
  ],

  vendors: [
    {
      _id: "ven-1",
      vendor_id: "V-001",
      company: "Coastal Plumbing",
      trade: "Plumbing",
      contact: "Ravi N.",
      phone: "+91 22 5550 7788",
      email: "ops@coastalplumbing.example",
      rating: 4.6,
      w_9_on_file: true,
      coi_on_file: true,
    },
    {
      _id: "ven-2",
      vendor_id: "V-002",
      company: "Nimbus Air",
      trade: "HVAC",
      contact: "Priya K.",
      phone: "+91 80 5550 9911",
      rating: 4.2,
      w_9_on_file: false,
      coi_on_file: false,
    },
  ],

  transactions: [
    {
      _id: "txn-1",
      reference: "TX-9001",
      date: "2025-11-01",
      type: "Income",
      account_category: "Rent",
      amount: 2400,
      property_id: "P-001",
      owner_id: "O-001",
      party_tenant_vendor: "Meera Iyer",
      method: "ACH",
      memo: "November rent",
    },
    {
      _id: "txn-2",
      reference: "TX-9002",
      date: "2025-11-05",
      type: "Expense",
      account_category: "Repairs & Maintenance",
      amount: 415,
      property_id: "P-003",
      owner_id: "O-001",
      party_tenant_vendor: "Nimbus Air",
      method: "Check",
      memo: "AC compressor repair",
    },
  ],

  inspections: [
    {
      _id: "ins-1",
      inspection_id: "I-001",
      property_id: "P-001",
      type: "Semi-Annual",
      scheduled: "2025-12-10",
      inspector: "D. Kulkarni",
      status: "Scheduled",
    },
    {
      _id: "ins-2",
      inspection_id: "I-002",
      property_id: "P-002",
      type: "Move-Out",
      scheduled: "2025-10-30",
      inspector: "D. Kulkarni",
      status: "Completed",
      issues_found: "Carpet staining in living room",
      repair_estimate: 300,
    },
  ],

  compliance: [
    {
      _id: "cmp-1",
      policy: "POL-77120",
      property_id: "P-001",
      insurance_carrier: "Meridian Assurance",
      coverage: "Landlord / All Risk",
      annual_premium: 1850,
      policy_expiry: "2026-03-31",
      status: "Compliant",
    },
    {
      _id: "cmp-2",
      policy: "POL-77121",
      property_id: "P-002",
      insurance_carrier: "Anchor Mutual",
      coverage: "Landlord",
      annual_premium: 2100,
      policy_expiry: "2026-01-15",
      status: "Renewal due 60d",
    },
  ],

  daily_tasks: [
    {
      _id: "tsk-1",
      date: "2025-11-10",
      time: "09:15",
      task: "Call Nimbus Air for AC ETA",
      property_id: "P-003",
      category: "Maintenance",
      priority: "High",
      status: "Todo",
    },
    {
      _id: "tsk-2",
      date: "2025-11-10",
      time: "14:00",
      task: "Post November owner statements",
      property_id: "P-001",
      category: "Accounting",
      priority: "Medium",
      status: "Done",
    },
  ],
};

// ---- Dashboard ------------------------------------------------------------

export const DASHBOARD_SUMMARY = {
  properties: { total: 3, occupied: 1, vacant: 1, occupancy_rate: 33.3 },
  tenants: { total: 2 },
  leases: { total: 2, active: 1, expiring_soon: 1 },
  maintenance: { total: 2, open: 1, in_progress: 1 },
  financials: {
    income_month: 2400,
    expense_month: 415,
    net_month: 1985,
    expected_rent: 4200,
  },
};

export const DASHBOARD_CHARTS = {
  cashflow: [
    { month: "2025-06", income: 4200, expense: 900, net: 3300 },
    { month: "2025-07", income: 4200, expense: 1500, net: 2700 },
    { month: "2025-08", income: 4200, expense: 700, net: 3500 },
    { month: "2025-09", income: 4200, expense: 2200, net: 2000 },
    { month: "2025-10", income: 4200, expense: 1100, net: 3100 },
    { month: "2025-11", income: 2400, expense: 415, net: 1985 },
  ],
  property_status: [
    { name: "Occupied", value: 1 },
    { name: "Vacant", value: 1 },
    { name: "Maintenance", value: 1 },
  ],
  lease_status: [
    { name: "Active", value: 1 },
    { name: "Expired", value: 1 },
  ],
  maintenance_status: [
    { name: "Open", value: 1 },
    { name: "In Progress", value: 1 },
  ],
  maintenance_priority: [
    { name: "Medium", value: 1 },
    { name: "Emergency", value: 1 },
  ],
  expense_breakdown: [
    { name: "Repairs & Maintenance", value: 415 },
    { name: "Insurance", value: 1850 },
  ],
};

/** Charts with every series empty — drives the "No data yet" branch. */
export const DASHBOARD_CHARTS_EMPTY = {
  cashflow: [],
  property_status: [],
  lease_status: [],
  maintenance_status: [],
  maintenance_priority: [],
  expense_breakdown: [],
};

// ---- Saved reports --------------------------------------------------------

export const REPORT_TEMPLATES = [
  {
    id: "rpt-owner-statement",
    name: "Owner Statement",
    description: "Monthly income and expense summary per owner.",
    category: "Financial",
    mode: "sql",
    version: 3,
    created_by: "e2e.manager",
  },
  {
    id: "rpt-rent-roll",
    name: "Rent Roll",
    description: "Every active lease with contract and market rent.",
    category: "Leasing",
    mode: "sql",
    version: 1,
    created_by: "e2e.manager",
  },
  {
    id: "rpt-region-audit",
    name: "Region Audit",
    description: "Spend and occupancy for one region.",
    category: "Financial",
    mode: "sql",
    version: 2,
    created_by: "e2e.manager",
  },
];

/**
 * `Owner Statement` declares a required picker, so it renders only after the
 * user submits. `Rent Roll` has no parameters and renders on open — the two
 * branches of ReportSheet's seeding effect.
 */
export const REPORT_DETAILS: { [id: string]: Record<string, unknown> } = {
  "rpt-owner-statement": {
    id: "rpt-owner-statement",
    name: "Owner Statement",
    description: "Monthly income and expense summary per owner.",
    category: "Financial",
    mode: "sql",
    version: 3,
    parameters: [
      {
        name: "owner_id",
        label: "Owner",
        type: "text",
        required: true,
        default: null,
        options: [
          { value: "O-001", label: "Harbourline Holdings" },
          { value: "O-002", label: "Devraj Family Trust" },
        ],
      },
      {
        name: "as_of",
        label: "As of",
        type: "date",
        required: false,
        default: "2025-11-30",
        options: [],
      },
    ],
  },
  "rpt-rent-roll": {
    id: "rpt-rent-roll",
    name: "Rent Roll",
    description: "Every active lease with contract and market rent.",
    category: "Leasing",
    mode: "sql",
    version: 1,
    parameters: [],
  },
  // A required input with neither a default nor a picker: nothing to seed
  // from, so ReportSheet leaves `applied` null and waits rather than
  // rendering on open. This is the branch that shows "Set the inputs above".
  "rpt-region-audit": {
    id: "rpt-region-audit",
    name: "Region Audit",
    description: "Spend and occupancy for one region.",
    category: "Financial",
    mode: "sql",
    version: 2,
    parameters: [
      {
        name: "region",
        label: "Region",
        type: "text",
        required: true,
        default: null,
        options: [],
      },
    ],
  },
};

export function reportHtml(title: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { font-family: system-ui, sans-serif; margin: 24px; }
    h1 { font-size: 20px; }
  </style></head><body>
    <h1>${title}</h1>
    <table><thead><tr><th>Property</th><th>Amount</th></tr></thead>
    <tbody><tr><td>P-001</td><td>$2,400</td></tr></tbody></table>
  </body></html>`;
}

// ---- Workflows ------------------------------------------------------------

export const WORKFLOWS = [
  {
    _id: "wf-1",
    name: "Monthly owner statements",
    trigger_kind: "cron",
    trigger_intent: "Render and email each owner their statement on the 1st.",
    trigger_spec: { expr: "0 6 1 * *", tz: "Asia/Kolkata" },
    active: true,
    plan: [
      { idx: 0, kind: "render_report", label: "Render Owner Statement", narration: "Runs the saved report for each owner." },
      { idx: 1, kind: "send_email", label: "Email owners", narration: "Attaches the rendered PDF." },
      { idx: 2, kind: "finish", label: "Done" },
    ],
    created_at: "2025-09-01T00:00:00Z",
  },
  {
    _id: "wf-2",
    name: "Emergency work order alert",
    trigger_kind: "event",
    trigger_intent: "Notify the on-call manager the moment a work order is filed as Emergency.",
    active: false,
    plan: [
      { idx: 0, kind: "sql_query", label: "Find emergency work orders" },
      { idx: 1, kind: "notify_user", label: "Page on-call manager" },
    ],
    created_at: "2025-09-14T00:00:00Z",
  },
];

export const WORKFLOW_RUNS = [
  {
    _id: "run-1",
    workflow_id: "wf-1",
    status: "succeeded",
    started_at: "2025-11-01T06:00:00Z",
    ended_at: "2025-11-01T06:00:12Z",
  },
  {
    _id: "run-2",
    workflow_id: "wf-1",
    status: "failed",
    started_at: "2025-10-01T06:00:00Z",
    ended_at: "2025-10-01T06:00:04Z",
    error: "SMTP timeout",
  },
  {
    _id: "run-3",
    workflow_id: "wf-2",
    status: "running",
    started_at: "2025-11-09T11:30:00Z",
  },
];

// ---- SQL rollups used by the Reports hooks -------------------------------

export const PNL = {
  income_total: 25200,
  expense_total: 6815,
  net_total: 18385,
  income_by_category: [{ name: "Rent", value: 25200 }],
  expense_by_category: [
    { name: "Repairs & Maintenance", value: 4965 },
    { name: "Insurance", value: 1850 },
  ],
};

export const RENT_ROLL = {
  rows: [
    {
      lease_id: "L-001",
      tenant_name: "Meera Iyer",
      property_id: "P-001",
      city: "Mumbai",
      state: "MH",
      contract_rent: 2400,
      market_rent: 2500,
      lease_start: "2023-06-01",
      lease_end: "2026-05-31",
      status: "Active",
    },
  ],
  count: 1,
  monthly_total: 2400,
};

export const RENEWALS = { rows: [], count: 0, days: 90 };

export const OCCUPANCY = {
  distribution: [
    { name: "Occupied", value: 1 },
    { name: "Vacant", value: 1 },
    { name: "Maintenance", value: 1 },
  ],
  total: 3,
  occupied: 1,
  occupancy_rate: 33.3,
};

export const WORK_ORDERS_REPORT = {
  by_status: [
    { name: "Open", value: 1 },
    { name: "In Progress", value: 1 },
  ],
  by_priority: [
    { name: "Medium", value: 1 },
    { name: "Emergency", value: 1 },
  ],
  by_category: [
    { name: "Plumbing", value: 1 },
    { name: "HVAC", value: 1 },
  ],
  open_cost_estimate: 570,
};
