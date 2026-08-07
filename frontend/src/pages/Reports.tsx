import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Database } from "lucide-react";

import {
  useOccupancyReport,
  usePnl,
  useRenewals,
  useRentRoll,
  useReportCashflow,
  useWorkOrdersReport,
} from "../api/hooks";
import { errorMessage } from "../api/client";
import { useTheme } from "../theme/ThemeContext";
import { Alert, Badge, Spinner } from "../components/ui";
import { formatCurrency, formatDate } from "../utils/format";

const PALETTE = ["#0ea5b7", "#f59e0b", "#6366f1", "#ef4444", "#22c55e", "#ec4899", "#14b8a6", "#a855f7"];

function monthLabel(m: string): string {
  const [y, mm] = m.split("-");
  return new Date(Number(y), Number(mm) - 1, 1).toLocaleDateString(undefined, {
    month: "short",
    year: "2-digit",
  });
}

export default function Reports() {
  const pnl = usePnl();
  const cashflow = useReportCashflow();
  const rentRoll = useRentRoll();
  const renewals = useRenewals(90);
  const occupancy = useOccupancyReport();
  const workOrders = useWorkOrdersReport();
  const { theme } = useTheme();

  const axisColor = theme === "dark" ? "#94a3b8" : "#64748b";
  const gridColor = theme === "dark" ? "#1f2a3d" : "#e2e8f0";
  const tip = {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 10,
    color: "var(--text)",
    fontSize: 13,
  } as const;

  if (pnl.isLoading || cashflow.isLoading) return <Spinner />;
  if (pnl.isError)
    return (
      <div className="content">
        <Alert kind="error">{errorMessage(pnl.error)}</Alert>
      </div>
    );

  const p = pnl.data!;
  const cf = cashflow.data?.cashflow ?? [];
  const wo = workOrders.data;

  return (
    <div className="content">
      <div className="page-head">
        <div className="titles">
          <h2>Reports</h2>
          <p>
            Financial &amp; operational reporting — every figure computed live by the
            InventDB SOAR SQL engine.
          </p>
        </div>
        <div className="actions">
          <span className="count-pill">
            <Database size={13} style={{ verticalAlign: "-2px", marginRight: 6 }} />
            Source: InventDB SQL
          </span>
        </div>
      </div>

      {/* P&L summary */}
      <div className="stat-grid">
        <Fin label="Total Income" value={formatCurrency(p.income_total)} tone="success" />
        <Fin label="Total Expenses" value={formatCurrency(p.expense_total)} tone="danger" />
        <Fin
          label="Net Operating Income"
          value={formatCurrency(p.net_total)}
          tone={p.net_total >= 0 ? "success" : "danger"}
        />
        <Fin
          label="Occupancy"
          value={`${occupancy.data?.occupancy_rate ?? 0}%`}
          tone="info"
        />
      </div>

      <div className="grid-2">
        <div className="card chart-card">
          <h3>Monthly Cash Flow</h3>
          <div className="chart-sub">Income, expense &amp; net by month</div>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={cf}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
              <XAxis dataKey="month" tickFormatter={monthLabel} stroke={axisColor} fontSize={12} tickLine={false} />
              <YAxis stroke={axisColor} fontSize={12} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={tip} formatter={(v: number) => formatCurrency(v)} labelFormatter={monthLabel} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="income" name="Income" fill={PALETTE[4]} radius={[4, 4, 0, 0]} />
              <Bar dataKey="expense" name="Expense" fill={PALETTE[3]} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card chart-card">
          <h3>Expense Breakdown</h3>
          <div className="chart-sub">Expenses by category</div>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie
                data={p.expense_by_category}
                dataKey="value"
                nameKey="name"
                innerRadius={60}
                outerRadius={98}
                paddingAngle={2}
              >
                {p.expense_by_category.map((_, i) => (
                  <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={tip} formatter={(v: number) => formatCurrency(v)} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Lease renewals due — mirrors the InventDB saved report */}
      <ReportTable
        title="Lease Renewals Due (next 90 days)"
        note={`${renewals.data?.count ?? 0} lease(s)`}
        loading={renewals.isLoading}
        empty="No leases ending in the next 90 days."
        head={["Tenant", "Property", "City", "Ends", "Current Rent", "Market Rent", "Gap", "Renewal"]}
        rows={(renewals.data?.rows ?? []).map((r) => [
          r.tenant_name ?? "—",
          r.property_id ?? "—",
          r.city ?? "—",
          formatDate(r.lease_end),
          formatCurrency(r.contract_rent),
          formatCurrency(r.market_rent),
          <span style={{ color: (r.rent_gap ?? 0) > 0 ? "var(--success)" : "var(--text-muted)" }}>
            {(r.rent_gap ?? 0) > 0 ? "+" : ""}
            {formatCurrency(r.rent_gap)}
          </span>,
          <Badge value={r.renewal_type} />,
        ])}
      />

      {/* Rent roll */}
      <ReportTable
        title="Rent Roll — Active Leases"
        note={`${rentRoll.data?.count ?? 0} active · ${formatCurrency(rentRoll.data?.monthly_total)} / month`}
        loading={rentRoll.isLoading}
        empty="No active leases."
        head={["Lease", "Tenant", "Property", "City", "Rent", "Start", "End", "Status"]}
        rows={(rentRoll.data?.rows ?? []).map((r) => [
          r.lease_id ?? "—",
          r.tenant_name ?? "—",
          r.property_id ?? "—",
          r.city ?? "—",
          formatCurrency(r.contract_rent),
          formatDate(r.lease_start),
          formatDate(r.lease_end),
          <Badge value={r.status} />,
        ])}
      />

      {/* Work order pipeline */}
      <div className="grid-2" style={{ marginTop: 16 }}>
        <div className="card chart-card">
          <h3>Work Orders by Status</h3>
          <div className="chart-sub">
            Open cost estimate: {formatCurrency(wo?.open_cost_estimate)}
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={wo?.by_status ?? []}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
              <XAxis dataKey="name" stroke={axisColor} fontSize={12} tickLine={false} />
              <YAxis stroke={axisColor} fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip contentStyle={tip} cursor={{ fill: "var(--surface-2)" }} />
              <Bar dataKey="value" name="Work orders" radius={[6, 6, 0, 0]}>
                {(wo?.by_status ?? []).map((_, i) => (
                  <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card chart-card">
          <h3>Work Orders by Category</h3>
          <div className="chart-sub">Maintenance demand by trade</div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={wo?.by_category ?? []} layout="vertical" margin={{ left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} horizontal={false} />
              <XAxis type="number" stroke={axisColor} fontSize={12} tickLine={false} allowDecimals={false} />
              <YAxis type="category" dataKey="name" stroke={axisColor} fontSize={11} tickLine={false} width={100} />
              <Tooltip contentStyle={tip} cursor={{ fill: "var(--surface-2)" }} />
              <Bar dataKey="value" name="Work orders" radius={[0, 6, 6, 0]}>
                {(wo?.by_category ?? []).map((_, i) => (
                  <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function Fin({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "success" | "danger" | "info";
}) {
  const color =
    tone === "success" ? "var(--success)" : tone === "danger" ? "var(--danger)" : "var(--info)";
  return (
    <div className="card stat">
      <span className="stat-label">{label}</span>
      <div className="stat-value" style={{ color, fontSize: 22 }}>
        {value}
      </div>
    </div>
  );
}

function ReportTable({
  title,
  note,
  head,
  rows,
  loading,
  empty,
}: {
  title: string;
  note?: string;
  head: string[];
  rows: React.ReactNode[][];
  loading?: boolean;
  empty: string;
}) {
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-pad" style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <h3 style={{ fontSize: 15 }}>{title}</h3>
        {note && <span className="report-note">{note}</span>}
      </div>
      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <div className="card-pad report-note">{empty}</div>
      ) : (
        <div className="table-wrap" style={{ border: "none", borderRadius: 0 }}>
          <table className="data">
            <thead>
              <tr>
                {head.map((h) => (
                  <th key={h} className="no-sort">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((cells, i) => (
                <tr key={i}>
                  {cells.map((cell, j) => (
                    <td key={j}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
