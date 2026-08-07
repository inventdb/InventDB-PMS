import { useNavigate } from "react-router-dom";
import {
  Area,
  AreaChart,
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
import {
  Building2,
  CalendarClock,
  DollarSign,
  Percent,
  TrendingDown,
  TrendingUp,
  Users,
  Wrench,
} from "lucide-react";

import { useDashboardCharts, useDashboardSummary } from "../api/hooks";
import { errorMessage } from "../api/client";
import { useTheme } from "../theme/ThemeContext";
import { Alert, Spinner } from "../components/ui";
import { formatCurrency } from "../utils/format";
import type { ReactNode } from "react";

const PALETTE = [
  "#0ea5b7",
  "#f59e0b",
  "#6366f1",
  "#ef4444",
  "#22c55e",
  "#ec4899",
  "#14b8a6",
  "#a855f7",
];

function monthLabel(m: string): string {
  const [y, mm] = m.split("-");
  const d = new Date(Number(y), Number(mm) - 1, 1);
  return d.toLocaleDateString(undefined, { month: "short" });
}

export default function Dashboard() {
  const summary = useDashboardSummary();
  const charts = useDashboardCharts();
  const { theme } = useTheme();
  const navigate = useNavigate();

  const axisColor = theme === "dark" ? "#94a3b8" : "#64748b";
  const gridColor = theme === "dark" ? "#1f2a3d" : "#e2e8f0";
  const tooltipStyle = {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 10,
    color: "var(--text)",
    fontSize: 13,
  } as const;

  if (summary.isLoading || charts.isLoading) return <Spinner />;

  if (summary.isError) {
    return (
      <div className="content">
        <Alert kind="error">{errorMessage(summary.error)}</Alert>
      </div>
    );
  }

  const s = summary.data!;
  const c = charts.data;

  return (
    <div className="content">
      <div className="page-head">
        <div className="titles">
          <h2>Dashboard</h2>
          <p>A live overview of your portfolio's performance.</p>
        </div>
      </div>

      <div className="stat-grid">
        <Stat
          label="Occupancy Rate"
          value={`${s.properties.occupancy_rate}%`}
          sub={`${s.properties.occupied} occupied · ${s.properties.vacant} vacant`}
          icon={<Percent size={18} />}
        />
        <Stat
          label="Properties"
          value={s.properties.total}
          sub={`${s.properties.occupied} occupied · ${s.properties.vacant} vacant`}
          icon={<Building2 size={18} />}
        />
        <Stat
          label="Active Leases"
          value={s.leases.active}
          sub={`${s.leases.expiring_soon} expiring within 90 days`}
          icon={<CalendarClock size={18} />}
        />
        <Stat
          label="Tenants"
          value={s.tenants.total}
          sub="Across all properties"
          icon={<Users size={18} />}
        />
        <Stat
          label="Net Income (mo.)"
          value={formatCurrency(s.financials.net_month)}
          sub={`${formatCurrency(s.financials.income_month)} in · ${formatCurrency(
            s.financials.expense_month
          )} out`}
          icon={
            s.financials.net_month >= 0 ? (
              <TrendingUp size={18} />
            ) : (
              <TrendingDown size={18} />
            )
          }
        />
        <Stat
          label="Open Maintenance"
          value={s.maintenance.open + s.maintenance.in_progress}
          sub={`${s.maintenance.open} open · ${s.maintenance.in_progress} in progress`}
          icon={<Wrench size={18} />}
        />
        <Stat
          label="Expected Rent (mo.)"
          value={formatCurrency(s.financials.expected_rent)}
          sub="From active leases"
          icon={<DollarSign size={18} />}
        />
        <Stat
          label="Total Leases"
          value={s.leases.total}
          sub="All statuses"
          icon={<CalendarClock size={18} />}
        />
      </div>

      <div className="grid-2">
        <div className="card chart-card">
          <h3>Cash Flow</h3>
          <div className="chart-sub">Income vs. expenses over the last 6 months</div>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={c?.cashflow ?? []}>
              <defs>
                <linearGradient id="gInc" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={PALETTE[0]} stopOpacity={0.35} />
                  <stop offset="95%" stopColor={PALETTE[0]} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gExp" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={PALETTE[3]} stopOpacity={0.35} />
                  <stop offset="95%" stopColor={PALETTE[3]} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
              <XAxis
                dataKey="month"
                tickFormatter={monthLabel}
                stroke={axisColor}
                fontSize={12}
                tickLine={false}
              />
              <YAxis stroke={axisColor} fontSize={12} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v: number) => formatCurrency(v)}
                labelFormatter={monthLabel}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Area
                type="monotone"
                dataKey="income"
                name="Income"
                stroke={PALETTE[0]}
                fill="url(#gInc)"
                strokeWidth={2}
              />
              <Area
                type="monotone"
                dataKey="expense"
                name="Expense"
                stroke={PALETTE[3]}
                fill="url(#gExp)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="card chart-card">
          <h3>Expense Breakdown</h3>
          <div className="chart-sub">Where money is going, by category</div>
          <ChartOrEmpty data={c?.expense_breakdown ?? []}>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={c?.expense_breakdown ?? []}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={62}
                  outerRadius={98}
                  paddingAngle={2}
                >
                  {(c?.expense_breakdown ?? []).map((_, i) => (
                    <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => formatCurrency(v)} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </ChartOrEmpty>
        </div>

        <div className="card chart-card">
          <h3>Maintenance by Status</h3>
          <div className="chart-sub">Current work order pipeline</div>
          <ChartOrEmpty data={c?.maintenance_status ?? []}>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={c?.maintenance_status ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                <XAxis dataKey="name" stroke={axisColor} fontSize={12} tickLine={false} />
                <YAxis stroke={axisColor} fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--surface-2)" }} />
                <Bar dataKey="value" name="Requests" radius={[6, 6, 0, 0]}>
                  {(c?.maintenance_status ?? []).map((_, i) => (
                    <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartOrEmpty>
        </div>

        <div className="card chart-card">
          <h3>Property Status</h3>
          <div className="chart-sub">Portfolio occupancy split</div>
          <ChartOrEmpty data={c?.property_status ?? []}>
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={c?.property_status ?? []}
                  dataKey="value"
                  nameKey="name"
                  outerRadius={98}
                  label
                >
                  {(c?.property_status ?? []).map((_, i) => (
                    <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </ChartOrEmpty>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <button className="btn btn-ghost" onClick={() => navigate("/reports")}>
          <TrendingUp size={16} /> View full reports
        </button>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  icon: ReactNode;
}) {
  return (
    <div className="card stat">
      <div className="stat-top">
        <span className="stat-label">{label}</span>
        <span className="stat-ico">{icon}</span>
      </div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

function ChartOrEmpty({
  data,
  children,
}: {
  data: unknown[];
  children: ReactNode;
}) {
  if (!data || data.length === 0) {
    return (
      <div style={{ height: 260, display: "grid", placeItems: "center", color: "var(--text-faint)" }}>
        No data yet
      </div>
    );
  }
  return <>{children}</>;
}
