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

/**
 * The report library for one test.
 *
 * Authoring mutates it — a rename changes a name, a delete removes a row, an
 * edit bumps a version — so it has to be per-test like `createStore()`. Sharing
 * the module constants meant a rename in the studio spec renamed the report the
 * rendering spec was waiting for, in whichever test happened to run next in the
 * same worker.
 */
export interface ReportStore {
  templates: Rec[];
  details: { [id: string]: Record<string, unknown> };
  snapshots: Rec[];
}

export function createReportStore(): ReportStore {
  return JSON.parse(
    JSON.stringify({
      templates: REPORT_TEMPLATES,
      details: REPORT_DETAILS,
      snapshots: REPORT_SNAPSHOTS,
    })
  ) as ReportStore;
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
    pending_approval: false,
    // Live: this one really sends. The paused workflow below is the sandboxed
    // case, so the two axes are covered independently.
    sandbox: false,
    version: 2,
    next_run_at: "2025-12-01T06:00:00Z",
    plan: [
      {
        idx: 0,
        kind: "render_report",
        label: "Render Owner Statement",
        narration: "Runs the saved report for each owner.",
        template_id: "owner-statement",
        save_as: "statements",
      },
      {
        idx: 1,
        kind: "send_email",
        label: "Email owners",
        narration: "Attaches the rendered PDF.",
        to: "${statements.email}",
        subject: "Your monthly statement",
        body: "Attached.",
      },
      { idx: 2, kind: "finish", label: "Done", narration: "", summary: "Statements sent." },
    ],
    created_at: "2025-09-01T00:00:00Z",
  },
  {
    _id: "wf-2",
    name: "Emergency work order alert",
    trigger_kind: "event",
    trigger_intent: "Notify the on-call manager the moment a work order is filed as Emergency.",
    active: false,
    pending_approval: false,
    sandbox: true,
    version: 1,
    plan: [
      {
        idx: 0,
        kind: "sql_query",
        label: "Find emergency work orders",
        narration: "",
        sql: "SELECT * FROM pms.work_orders WHERE priority = 'Emergency'",
        save_as: "urgent",
      },
      {
        idx: 1,
        kind: "notify_user",
        label: "Page on-call manager",
        narration: "",
        title: "Emergency work order",
        body: "One just came in.",
        when: "${urgent}",
      },
    ],
    created_at: "2025-09-14T00:00:00Z",
  },
];

/**
 * A long plan, for the card grid.
 *
 * Deliberately NOT in `WORKFLOWS`: real automations run to a dozen steps, but
 * adding one to the shared seed moved every count assertion in three other
 * specs. The one spec that needs it routes it in.
 */
export const WORKFLOW_LONG =
  {
    _id: "wf-long",
    name: "Maintenance email intake & dispatch",
    trigger_kind: "inbound_email",
    trigger_spec: {},
    trigger_intent:
      "When a maintenance request arrives by email — from a tenant, or from someone writing on their behalf.",
    active: true,
    pending_approval: false,
    sandbox: false,
    version: 4,
    plan: [
      { idx: 0, kind: "llm_extract", label: "Read the request", narration: "Pulls out the issue, urgency and trade.", save_as: "req" },
      { idx: 1, kind: "sql_query", label: "Identify the tenant", narration: "Matches the sender against the tenant roll.", save_as: "tenant" },
      { idx: 2, kind: "sql_query", label: "Find the property", narration: "", save_as: "prop" },
      { idx: 3, kind: "insert_record", label: "Open a work order", narration: "Unassigned, before anyone is contacted.", save_as: "wo" },
      { idx: 4, kind: "send_email", label: "Acknowledge the request", narration: "" },
      { idx: 5, kind: "sql_query", label: "Shortlist a contractor", narration: "", save_as: "vendors" },
      { idx: 6, kind: "notify_user", label: "Ask before dispatching", narration: "Parks the run.", save_as: "decision" },
      { idx: 7, kind: "update_record", label: "Assign the contractor", narration: "", when: "${decision.approved}" },
      { idx: 8, kind: "create_calendar_event", label: "Book the visit", narration: "", when: "${decision.approved}" },
      { idx: 9, kind: "send_email", label: "Brief the contractor", narration: "", when: "${decision.approved}" },
      { idx: 10, kind: "send_email", label: "Confirm with the tenant", narration: "", when: "${decision.approved}" },
      { idx: 11, kind: "finish", label: "Done", narration: "", summary: "Request handled." },
    ],
    created_at: "2025-08-01T00:00:00Z",
  };

/**
 * A workflow the assistant built and nobody activated yet.
 *
 * Hidden from the Workflows page by default — which is why adding it does not
 * move the "2 workflow(s)" count the other specs assert — and reachable by
 * `?id=`, the link out of an Analyze thread.
 */
export const WORKFLOW_DRAFT = {
  _id: "wf-3",
  name: "Monthly payment timing report",
  trigger_kind: "cron",
  trigger_intent: "On the 10th of every month at 9:00 AM, email the report.",
  trigger_spec: { expr: "0 9 10 * *", tz: "Asia/Calcutta" },
  active: false,
  pending_approval: true,
  sandbox: true,
  version: 1,
  plan: [
    {
      idx: 0,
      kind: "render_report",
      label: "Render Payment Timing",
      narration: "",
      template_id: "payment-timing",
    },
  ],
  created_at: "2025-11-20T00:00:00Z",
};

/** Prior definitions, keyed by workflow — what the History tab reads. */
export const WORKFLOW_VERSIONS: { [workflowId: string]: Rec[] } = {
  "wf-1": [
    {
      // The engine mints synthetic ids for snapshots: "<workflow>.v<version>".
      _id: "wf-1.v1",
      version: 1,
      workflow_id: "wf-1",
      name: "Monthly owner statements",
      trigger_intent: "Email each owner their statement on the 1st.",
      plan: [{ idx: 0, kind: "render_report", label: "Render Owner Statement", narration: "" }],
      created_at: "2025-09-01T00:00:00Z",
    },
  ],
};

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

/**
 * What each run actually did, keyed by run — the timeline `GET
 * /api/workflows/runs/<id>` returns alongside the run.
 *
 * The engine writes two rows per plan step at the same `idx`: a `tool_call`
 * carrying the payload it is about to send (with `${…}` already resolved) and a
 * `tool_result` carrying what came back. The fixtures keep that pairing,
 * because the UI's whole job here is to show the resolved call next to its
 * outcome — a flattened list of one row per step would let a regression in that
 * pairing pass unnoticed.
 */
export const WORKFLOW_RUN_STEPS: { [runId: string]: Rec[] } = {
  "run-1": [
    {
      _id: "rs-1",
      run_id: "run-1",
      idx: 0,
      role: "tool_call",
      created_at: "2025-11-01T06:00:01Z",
      content: "[Render Owner Statement] Runs the saved report for each owner.",
      tool_name: "render_report",
      tool_args: { template_id: "owner-statement" },
    },
    {
      _id: "rs-2",
      run_id: "run-1",
      idx: 0,
      role: "tool_result",
      created_at: "2025-11-01T06:00:06Z",
      content: "",
      tool_name: "render_report",
      tool_result: [
        { name: "Meridian Holdings", email: "owner@meridian.test", html: "<h1>Statement</h1>" },
      ],
    },
    {
      _id: "rs-3",
      run_id: "run-1",
      idx: 1,
      role: "tool_call",
      created_at: "2025-11-01T06:00:07Z",
      content: "[Email owners] Attaches the rendered PDF.",
      tool_name: "send_email",
      tool_args: {
        to: "owner@meridian.test",
        subject: "Your monthly statement",
        body: "Attached.",
      },
    },
    {
      _id: "rs-4",
      run_id: "run-1",
      idx: 1,
      role: "tool_result",
      created_at: "2025-11-01T06:00:11Z",
      content: "",
      tool_name: "send_email",
      tool_result: { ok: true, sent: 1 },
    },
  ],
  "run-2": [
    {
      _id: "rs-5",
      run_id: "run-2",
      idx: 0,
      role: "tool_call",
      created_at: "2025-10-01T06:00:01Z",
      content: "[Count overdue leases] Finds every lease past its due date.",
      tool_name: "sql_query",
      tool_args: { sql: "SELECT _id, rent FROM pms.leases WHERE status = 'overdue'" },
    },
    {
      _id: "rs-6",
      run_id: "run-2",
      idx: 0,
      role: "tool_result",
      created_at: "2025-10-01T06:00:02Z",
      content: "",
      tool_name: "sql_query",
      tool_result: [{ _id: "L-001", rent: 2400 }],
    },
    {
      _id: "rs-7",
      run_id: "run-2",
      idx: 1,
      role: "tool_result",
      created_at: "2025-10-01T06:00:04Z",
      content: "send_email failed",
      tool_name: "send_email",
      tool_result: { error: "SMTP timeout" },
    },
  ],
  // Mid-flight: one call written, no result yet. This is what the timeline
  // looks like the moment someone opens a running rehearsal.
  "run-3": [
    {
      _id: "rs-8",
      run_id: "run-3",
      idx: 0,
      role: "tool_call",
      created_at: "2025-11-09T11:30:01Z",
      content: "[Notify the on-call manager] Pages whoever is on call.",
      tool_name: "notify_user",
      tool_args: { message: "Emergency work order filed." },
    },
  ],
};

// ---- The inbox -----------------------------------------------------------

/**
 * What the automations have left for a person.
 *
 * The three states the page distinguishes are all here, because they behave
 * differently and each has been a bug at least once: `n-1` is a run parked on a
 * decision (actions, unanswered — the only kind that holds a run open), `n-2` is
 * the same thing after it was answered (actions, resolved — buttons stay
 * visible but disabled), and `n-3` is a bell (no actions, can never be
 * answered, must never count toward the badge).
 *
 * `n-1`'s body is the shape the real intake produces: light HTML with values
 * interpolated from an inbound email. The `<img onerror>` in `n-4` is what an
 * attacker gets to put there, and is what the sanitiser has to survive.
 */
export const NOTIFICATIONS: Rec[] = [
  {
    _id: "n-1",
    title: "Assign a contractor: kitchen tap dripping",
    body:
      "<p><strong>High priority</strong> — Plumbing</p>" +
      "<p><strong>Property:</strong> 12 Marine Drive, Mumbai<br>" +
      "<strong>Tenant:</strong> Meera Iyer (meera.iyer@example.com)<br>" +
      "<strong>Reported:</strong> Kitchen tap dripping constantly for three days</p>" +
      "<p><strong>Recommended:</strong> Coastal Plumbing — Plumbing, rated 4.6, Ravi N.</p>",
    actions: [
      { id: "approve", label: "Assign the recommended contractor", kind: "approve" },
      {
        id: "choose",
        label: "Assign a different contractor",
        kind: "form",
        form_fields: [
          { name: "vendor", type: "text", required: true, label: "Contractor (company name)" },
        ],
      },
      { id: "decline", label: "Not now", kind: "decline" },
    ],
    workflow_id: "wf-intake",
    run_id: "run-intake",
    step_idx: 6,
    created_at: "2026-08-11T06:42:00Z",
    // Explicit nulls, because that is what InventDB sends for an unanswered,
    // unread notification — and `contract.spec.ts` compares the key sets.
    read_at: null,
    resolved_action: null,
  },
  {
    _id: "n-2",
    title: "Approve overtime call-out: no hot water",
    body: "<p>Nimbus Air quoted an out-of-hours call-out.</p>",
    actions: [
      { id: "approve", label: "Approve the call-out", kind: "approve" },
      { id: "decline", label: "Not now", kind: "decline" },
    ],
    workflow_id: "wf-intake",
    run_id: "run-1",
    created_at: "2026-08-09T18:05:00Z",
    read_at: "2026-08-09T18:20:00Z",
    resolved_action: "approve",
    resolved_at: "2026-08-09T18:22:00Z",
  },
  {
    _id: "n-3",
    title: "Monthly owner statements sent",
    body: "12 owners were emailed their statement.",
    actions: [],
    workflow_id: "wf-1",
    run_id: "run-1",
    created_at: "2026-08-01T06:00:12Z",
    read_at: "2026-08-01T08:00:00Z",
  },
  {
    _id: "n-4",
    title: "Assign a contractor: front door lock jammed",
    // The "issue" here is text a stranger emailed the office, interpolated into
    // the body by the plan. Rendering it as markup would run it.
    body:
      "<p><strong>Reported:</strong> lock jammed " +
      "<img src=x onerror=\"window.__xss=1\"> " +
      "<a href=\"javascript:window.__xss=1\">click</a> " +
      "<script>window.__xss=1</script></p>",
    actions: [{ id: "approve", label: "Assign the recommended contractor", kind: "approve" }],
    workflow_id: "wf-intake",
    run_id: "run-intake",
    created_at: "2026-08-11T05:00:00Z",
  },
];

/** The run behind the parked approval — its trail is shown under the decision. */
export const INTAKE_RUN = {
  _id: "run-intake",
  workflow_id: "wf-intake",
  status: "parked",
  started_at: "2026-08-11T06:41:40Z",
  sandbox: false,
};

export const INTAKE_RUN_STEPS: Rec[] = [
  {
    _id: "irs-1",
    run_id: "run-intake",
    idx: 0,
    role: "tool_call",
    created_at: "2026-08-11T06:41:41Z",
    content: "[Read the request] Pulls out what is broken and how urgent it is.",
    tool_name: "llm_extract",
  },
  {
    _id: "irs-2",
    run_id: "run-intake",
    idx: 3,
    role: "tool_result",
    created_at: "2026-08-11T06:41:49Z",
    content: "",
    tool_name: "insert_record",
    tool_result: { ok: true, _id: "wo-new", id: "WO-1003" },
  },
  {
    _id: "irs-3",
    run_id: "run-intake",
    idx: 4,
    role: "tool_call",
    created_at: "2026-08-11T06:41:52Z",
    content: "[Acknowledge the request] Replies to whoever wrote in.",
    tool_name: "send_email",
    tool_args: { to: "meera.iyer@example.com", subject: "Re: dripping tap" },
  },
  {
    _id: "irs-4",
    run_id: "run-intake",
    idx: 5,
    role: "tool_result",
    created_at: "2026-08-11T06:41:58Z",
    content: "",
    tool_name: "sql_query",
    tool_result: [
      { company: "Coastal Plumbing", trade: "Plumbing", rating: 4.6, coi_on_file: true },
    ],
  },
  // Out of order on purpose, and sharing idx 0 with the call above it. The
  // engine orders run steps `BY idx ASC` and nothing more, so the rows it
  // writes at one idx — the call, any recovery it needed, then the result —
  // come back in whatever order storage returns them.
  {
    _id: "irs-0-result",
    run_id: "run-intake",
    idx: 0,
    role: "tool_result",
    created_at: "2026-08-11T06:41:45Z",
    content: "",
    tool_name: "llm_extract",
    tool_result: { issue: "Kitchen tap dripping", trade: "Plumbing" },
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

// ---- Analyze --------------------------------------------------------------
// The agent stream is the one response the frontend parses itself, so the
// fixtures below are shaped exactly like InventDB's own `AgentStep` frames —
// captured from a live turn on the sandbox instance, then trimmed.

export const ANALYZE_MODELS = [
  {
    key: "claude-sonnet-5",
    family: "Claude",
    display: "Claude Sonnet 5",
    is_reasoning: true,
  },
  {
    key: "claude-opus-4-8",
    family: "Claude",
    display: "Claude Opus 4.8",
    is_reasoning: true,
  },
];

/** One complete turn: reasoning, a plan, a query with rows, then the answer. */
export const AGENT_STEPS: Record<string, unknown>[] = [
  { type: "info", content: "Analyzing your question..." },
  { type: "reasoning", content: "", executionTimeMs: 214 },
  { type: "info", content: "Drafting a plan" },
  {
    type: "sql",
    content: "Executing query...",
    sql: "SELECT city, COUNT(*) AS cnt FROM pms.properties GROUP BY city ORDER BY cnt DESC LIMIT 3",
  },
  {
    type: "result",
    content: "Query returned 3 rows",
    sql: "SELECT city, COUNT(*) AS cnt FROM pms.properties GROUP BY city ORDER BY cnt DESC LIMIT 3",
    data: [
      { city: "Richmond", cnt: 12 },
      { city: "Norfolk", cnt: 9 },
      { city: "Vienna", cnt: 4 },
    ],
    executionTimeMs: 3,
  },
  {
    type: "chart",
    content: "Properties by City",
    chart: {
      data: [
        {
          type: "bar",
          x: ["Richmond", "Norfolk", "Vienna"],
          y: [12, 9, 4],
          marker: { color: "#3b82f6" },
        },
      ],
      layout: { title: { text: "Properties by City" } },
    },
  },
  {
    type: "done",
    content:
      "Your three largest markets are **Richmond** (12), **Norfolk** (9) and **Vienna** (4).",
  },
  {
    type: "suggestions",
    content: "",
    chart: {
      followups: ["Which city has the highest average rent?"],
      actions: ["Email this breakdown to the owners"],
    },
  },
];

/** A turn that proposes a record change instead of answering. */
export const AGENT_PROPOSAL_STEPS: Record<string, unknown>[] = [
  { type: "info", content: "Building the form" },
  {
    type: "form",
    content: "Create a vendor",
    chart: {
      operation: "insert",
      entities: [
        {
          namespace: "pms",
          typeName: "vendors",
          existingData: { company: "Blue Ridge Roofing", trade: "Roofing" },
        },
      ],
    },
  },
];

/**
 * A "Describe it" turn: the form's fields, read back out of a sentence.
 *
 * The values are deliberately in the shapes a model actually returns rather
 * than the ones the form wants — a lowercase choice, an owner named instead of
 * keyed, "$2,100" with its symbol and separator, a date written out in words,
 * and a `not_a_field` key the module never declared. Coercion is the whole
 * feature; a fixture that arrived pre-cleaned would test nothing.
 */
export const DESCRIBE_PROPERTY_STEPS: Record<string, unknown>[] = [
  { type: "info", content: "Reading the description" },
  {
    type: "done",
    content: JSON.stringify({
      street: "44 Cedar Lane",
      city: "Richmond",
      state: "VA",
      zip: "23220",
      region: "Mid-Atlantic",
      type: "townhouse",
      status: "vacant",
      owner_id: "Harbourline Holdings",
      beds: 3,
      baths: 2,
      sqft: "1,650",
      year_built: 1998,
      market_rent: "$2,100",
      acq_date: "March 4, 2026",
      not_a_field: "ignored",
    }),
  },
];

/** The same turn, wrapped in the prose and code fence the prompt asked it not to use. */
export const DESCRIBE_FENCED_STEPS: Record<string, unknown>[] = [
  {
    type: "done",
    content:
      "Here are the fields I could read:\n\n```json\n" +
      JSON.stringify({ street: "3 Beacon Row", city: "Norfolk" }, null, 2) +
      "\n```\n\nLet me know if you'd like anything changed.",
  },
];

/** A turn offering a choice that isn't one, and an owner nobody has on file. */
export const DESCRIBE_UNRESOLVED_STEPS: Record<string, unknown>[] = [
  {
    type: "done",
    content: JSON.stringify({
      street: "8 Kestrel Way",
      status: "Under offer",
      owner_id: "Wexford Partners",
    }),
  },
];

/**
 * A turn that builds an automation.
 *
 * `create_workflow` emits a `workflow` step whose `chart.initial` is the saved
 * record — the whole thing, plan included — plus any `issues` InventDB still
 * has with the plan it just accepted. `_id` points at a workflow the mock API
 * knows, because the card refetches the live definition rather than trusting
 * the snapshot the thread is carrying.
 */
export const AGENT_WORKFLOW_STEPS: Record<string, unknown>[] = [
  { type: "info", content: "Working out what should happen, and when" },
  {
    type: "workflow",
    content: "Created workflow 'Monthly owner statements'",
    chart: {
      name: "Monthly owner statements",
      workflow_id: "wf-1",
      initial: WORKFLOWS[0],
      issues: [
        { step_idx: 1, severity: "warning", message: "No recipients matched the filter yet." },
      ],
    },
  },
  { type: "done", content: "Built it. It rehearses until you activate it." },
];

// ---- Files ---------------------------------------------------------------
/**
 * The drive.
 *
 * `folder_path: ""` is a file at its type's root — one that was never put in a
 * folder — which the tree counts on the type node rather than under any folder.
 * The set spans two types on purpose: the tree groups by type first, and a
 * same-named folder in two types must not merge.
 */
export const FILES: Rec[] = [
  {
    _id: "att-1",
    attachment_id: "att-1",
    namespace: "pms",
    record_type: "leases",
    record_id: "lea-1",
    filename: "signed-lease.pdf",
    content_type: "application/pdf",
    size_bytes: 284113,
    version: 2,
    folder_path: "2026",
    created_at: "2026-01-04T09:12:00Z",
    processing_state: "indexed",
  },
  {
    _id: "att-2",
    attachment_id: "att-2",
    namespace: "pms",
    record_type: "leases",
    // `_vault` is InventDB's "no parent record yet" — what a drive-level
    // upload produces, here or in SOAR's Files room. Attaching is what gives
    // it a home, so one fixture file has to be in this state.
    record_id: "_vault",
    filename: "rent-schedule.xlsx",
    content_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    size_bytes: 18442,
    version: 1,
    folder_path: "",
    created_at: "2025-11-02T10:00:00Z",
    processing_state: "indexed",
  },
  {
    _id: "att-3",
    attachment_id: "att-3",
    namespace: "pms",
    record_type: "inspections",
    record_id: "ins-1",
    filename: "kitchen.jpg",
    content_type: "image/jpeg",
    size_bytes: 903221,
    version: 1,
    folder_path: "2026/photos",
    created_at: "2026-02-11T08:30:00Z",
    processing_state: "indexed",
  },
];

/** What the tree is built from — counts per (type, folder), never from results. */
export const FILE_FOLDERS = [
  { namespace: "pms", type: "leases", path: "", count: 1 },
  { namespace: "pms", type: "leases", path: "2026", count: 1 },
  { namespace: "pms", type: "inspections", path: "2026/photos", count: 1 },
];

export const FILE_VERSIONS: { [attachmentId: string]: Rec[] } = {
  "att-1": [
    {
      _id: "att-1.v2",
      version: 2,
      filename: "signed-lease.pdf",
      size: 284113,
      created_at: "2026-01-04T09:12:00Z",
      is_current: true,
    },
    {
      _id: "att-1.v1",
      version: 1,
      filename: "draft-lease.pdf",
      size: 210004,
      created_at: "2025-12-19T14:02:00Z",
      is_current: false,
    },
  ],
};

export const FILE_TEXT: { [attachmentId: string]: string } = {
  "att-1": "RESIDENTIAL LEASE AGREEMENT — 12 Marine Drive, Mumbai. Term 36 months.",
};

/** Serialise steps as the SSE frames the backend relays. */
export function sseBody(steps: Record<string, unknown>[]): string {
  return steps.map((s) => `event: message\ndata: ${JSON.stringify(s)}\n\n`).join("");
}

export const ANALYZE_THREADS = [
  {
    _id: "soar_thread-1",
    label: "Rent roll by property type",
    created: "2026-03-01T09:00:00.000Z",
    _exchanges: [
      {
        question: "Rent roll by property type",
        answer: "Single-family homes carry **$48,200** of the monthly roll.",
        ts: "2026-03-01T09:00:04.000Z",
        steps: [
          {
            type: "sql",
            sql: "SELECT type, SUM(market_rent) AS total FROM pms.properties GROUP BY type",
            ms: 4,
          },
        ],
        artifacts: [],
      },
    ],
  },
];

// ---- Report Studio --------------------------------------------------------

/** A frozen render the assistant stored — the second kind of report. */
export const REPORT_SNAPSHOTS = [
  {
    record_id: "report_20260811_055342",
    attachment_id: "att-rentroll-1",
    name: "Rent Roll — All Properties",
    created_at: "2026-08-11T05:53:42Z",
    from_template: false,
  },
];

/** The report agent's edit stream, shaped exactly as InventDB emits it. */
export function reportEditSse(templateId: string, version: number): string {
  return [
    `event: start
data: ${JSON.stringify({ template_id: templateId, current_version: version - 1 })}

`,
    `event: reasoning
data: ${JSON.stringify({ content: "", tokens: 406 })}

`,
    `event: html
data: ${JSON.stringify({ html: "<h1>Edited</h1>" })}

`,
    `event: saved
data: ${JSON.stringify({ template_id: templateId, version })}

`,
    `event: done
data: {}

`,
  ].join("");
}

/**
 * Saved views, keyed by module.
 *
 * Empty on purpose: every module starts with no views, so the specs that
 * predate this feature see exactly the list they always did. A spec that needs
 * one creates it through the UI, which is also what exercises the save path.
 */
export interface SavedViewFixture {
  id: string;
  name: string;
  search: string;
  sort: { col: string; dir: "asc" | "desc" } | null;
  is_default: boolean;
  mode: "table" | "custom";
  template_id: string | null;
  base_sql: string;
}

/** What the mocked designer returns — a layout plus the query to drive it. */
/**
 * A layout shaped like one the designer really returns: kit classes, a card per
 * record, long values that would overflow a careless layout. Built to a count so
 * a spec can render a tall page and check nothing is clipped.
 */
export function designedLayout(entity: string, count = 12, page = 0): string {
  const card = (i: number) => `
    <div class="vk-card">
      <div class="vk-card-head">
        <div><div class="vk-title">${entity} record ${page * 100 + i}</div>
        <div class="vk-sub">Richmond, VA</div></div>
        <span class="vk-badge is-ok">Active</span>
      </div>
      <div class="vk-figures">
        <div class="vk-figure"><b>$2,100</b><span>Rent</span></div>
        <div class="vk-figure"><b>10%</b><span>Fee</span></div>
      </div>
      <div class="vk-rows">
        <div class="vk-row"><span>Email</span><b>a.very.long.address${i}@team758135.testinator.email</b></div>
        <div class="vk-row"><span>Phone</span><b>(540) 555-50${String(i).padStart(2, "0")}</b></div>
      </div>
      <div class="vk-foot">4522 Pocahontas Tr, Charlottesville, VA 20191</div>
    </div>`;
  return `<html><head><style>
    /* The kind of page styling a model emits unprompted — the app has to
       survive it, so the fixture keeps it. */
    html,body{height:100vh;margin:0;overflow:auto}
    .vk-grid{max-height:70vh;overflow-y:auto}
  </style></head><body>
    <div class="vk-grid" data-page="${page}">
      ${Array.from({ length: count }, (_, i) => card(i + 1)).join("")}
    </div>
  </body></html>`;
}

export const DESIGNED_LAYOUT = designedLayout("record");

export const SAVED_VIEWS: { [entity: string]: SavedViewFixture[] } = {};
