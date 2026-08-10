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
  CalendarClock,
  FileStack,
  DollarSign,
  Percent,
  TrendingDown,
  TrendingUp,
  Users,
  Wrench,
} from "lucide-react";

import { useDashboardCharts, useDashboardSummary } from "../api/hooks";
import { errorMessage } from "../api/client";
import { foldToOther, useChartTheme } from "../theme/charts";
import { Alert, Spinner } from "../components/ui";
import ChartTooltip from "../components/ChartTooltip";
import { BrandMark } from "../components/BrandMark";
import { formatCurrency } from "../utils/format";
import type { ReactNode } from "react";

function monthLabel(m: string): string {
  const [y, mm] = m.split("-");
  const d = new Date(Number(y), Number(mm) - 1, 1);
  return d.toLocaleDateString(undefined, { month: "short" });
}

/**
 * Direct slice labels. Three of the lighter palette slots sit under 3:1 on a
 * white card, which is only legal with a relief channel — these labels (plus
 * the legend) are it, so a slice is never identified by its fill alone.
 */
interface PieLabelProps {
  name?: string;
  percent?: number;
}
const pieLabel = ({ name, percent }: PieLabelProps) =>
  `${name ?? ""} · ${Math.round((percent ?? 0) * 100)}%`;

export default function Dashboard() {
  const summary = useDashboardSummary();
  const charts = useDashboardCharts();
  const chart = useChartTheme();
  const navigate = useNavigate();

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
  // Cap the breakdown at the palette's slot count so a long category list
  // never wraps around and reuses slot 1 for an unrelated category.
  const expenseBreakdown = foldToOther(c?.expense_breakdown);
  const propertyStatus = c?.property_status ?? [];
  const maintenanceStatus = c?.maintenance_status ?? [];

  return (
    <div className="content">
      <div className="page-head">
        <div className="titles">
          <h2>Dashboard</h2>
          <p>A live overview of your portfolio's performance.</p>
        </div>
      </div>

      {/* All eight stay visible everywhere. Below 700px they go two-up at a
          reduced density, and the four marked `primary` lead — CSS-only, in
          the media query, so the desktop sequence is untouched. */}
      <div className="stat-grid">
        <Stat
          primary
          label="Occupancy Rate"
          value={`${s.properties.occupancy_rate}%`}
          sub={`${s.properties.occupied} occupied · ${s.properties.vacant} vacant`}
          icon={<Percent size={18} />}
        />
        <Stat
          label="Properties"
          value={s.properties.total}
          sub={`${s.properties.occupied} occupied · ${s.properties.vacant} vacant`}
          icon={<BrandMark size={18} />}
        />
        <Stat
          primary
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
          primary
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
          primary
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
          icon={<FileStack size={18} />}
        />
      </div>

      <div className="grid-2">
        <div className="card chart-card">
          <h3>Cash Flow</h3>
          <div className="chart-sub">Income vs. expenses over the last 6 months</div>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={c?.cashflow ?? []}>
              {/* Income and expense carry polarity, so they wear the reserved
                  state colours rather than categorical slots. The legend names
                  them — the colour never carries the meaning alone. */}
              <defs>
                <linearGradient id="gInc" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={chart.status.success} stopOpacity={0.22} />
                  <stop offset="95%" stopColor={chart.status.success} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gExp" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={chart.status.danger} stopOpacity={0.22} />
                  <stop offset="95%" stopColor={chart.status.danger} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
              <XAxis
                dataKey="month"
                tickFormatter={monthLabel}
                stroke={chart.axis}
                fontSize={12}
                tickLine={false}
              />
              <YAxis stroke={chart.axis} fontSize={12} tickLine={false} axisLine={false} />
              <Tooltip
                content={<ChartTooltip />}
                formatter={(v: number) => formatCurrency(v)}
                labelFormatter={monthLabel}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Area
                type="monotone"
                dataKey="income"
                name="Income"
                stroke={chart.status.success}
                fill="url(#gInc)"
                strokeWidth={2}
              />
              <Area
                type="monotone"
                dataKey="expense"
                name="Expense"
                stroke={chart.status.danger}
                fill="url(#gExp)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="card chart-card">
          <h3>Expense Breakdown</h3>
          <div className="chart-sub">Where money is going, by category</div>
          <ChartOrEmpty data={expenseBreakdown}>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={expenseBreakdown}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={54}
                  outerRadius={82}
                  paddingAngle={2}
                  label={pieLabel}
                  labelLine={{ stroke: chart.axis }}
                >
                  {expenseBreakdown.map((row, i) => (
                    <Cell key={row.name} fill={chart.seriesAt(i)} />
                  ))}
                </Pie>
                <Tooltip content={<ChartTooltip />} formatter={(v: number) => formatCurrency(v)} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </ChartOrEmpty>
        </div>

        <div className="card chart-card">
          <h3>Maintenance by Status</h3>
          <div className="chart-sub">Current work order pipeline</div>
          {/* One series: bar length carries the value and the axis tick carries
              the identity, so every bar takes slot 1 rather than a rainbow. */}
          <ChartOrEmpty data={maintenanceStatus}>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={maintenanceStatus}>
                <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
                <XAxis dataKey="name" stroke={chart.axis} fontSize={12} tickLine={false} />
                <YAxis stroke={chart.axis} fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: chart.cursor }} />
                <Bar
                  dataKey="value"
                  name="Requests"
                  fill={chart.series[0]}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={54}
                />
              </BarChart>
            </ResponsiveContainer>
          </ChartOrEmpty>
        </div>

        <div className="card chart-card">
          <h3>Property Status</h3>
          <div className="chart-sub">Portfolio occupancy split</div>
          <ChartOrEmpty data={propertyStatus}>
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={propertyStatus}
                  dataKey="value"
                  nameKey="name"
                  outerRadius={80}
                  label={pieLabel}
                  labelLine={{ stroke: chart.axis }}
                >
                  {propertyStatus.map((row, i) => (
                    <Cell key={row.name ?? i} fill={chart.seriesAt(i)} />
                  ))}
                </Pie>
                <Tooltip content={<ChartTooltip />} />
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
  primary,
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  icon: ReactNode;
  /** Kept visible on a phone; the rest collapse behind "Show all". */
  primary?: boolean;
}) {
  return (
    <div className={`card stat${primary ? " stat-primary" : ""}`}>
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
