import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Building2, LogOut, Menu, Moon, Sun } from "lucide-react";

import { ENTITY_BY_NAME } from "../config/entities";
import { useAuth } from "../auth/AuthContext";
import { useTheme } from "../theme/ThemeContext";
import { Icon } from "./Icon";

interface NavEntry {
  to: string;
  label: string;
  icon: string;
  end?: boolean;
}
interface NavGroup {
  section: string | null;
  items: NavEntry[];
}

function entityEntry(name: string): NavEntry {
  const cfg = ENTITY_BY_NAME[name];
  return { to: `/${name}`, label: cfg.labelPlural, icon: cfg.icon };
}

const NAV: NavGroup[] = [
  { section: null, items: [{ to: "/", label: "Dashboard", icon: "dashboard", end: true }] },
  {
    section: "Portfolio",
    items: ["properties", "owners"].map(entityEntry),
  },
  {
    section: "Leasing",
    items: ["tenants", "leases"].map(entityEntry),
  },
  {
    section: "Operations",
    items: ["work_orders", "vendors", "inspections"].map(entityEntry),
  },
  {
    section: "Compliance & Tasks",
    items: ["compliance", "daily_tasks"].map(entityEntry),
  },
  { section: "Finance", items: ["transactions"].map(entityEntry) },
  {
    section: "Automation & Insights",
    items: [
      { to: "/workflows", label: "Workflows", icon: "workflow" },
      { to: "/reports", label: "Reports", icon: "reports" },
    ],
  },
  {
    section: null,
    items: [{ to: "/settings", label: "Settings", icon: "settings" }],
  },
];

function pageTitle(pathname: string): string {
  if (pathname === "/") return "Dashboard";
  const seg = pathname.split("/").filter(Boolean)[0] ?? "";
  if (seg === "reports") return "Reports";
  if (seg === "workflows") return "Workflows";
  if (seg === "settings") return "Settings";
  return ENTITY_BY_NAME[seg]?.labelPlural ?? "InventDB PMS";
}

export function Layout() {
  const [open, setOpen] = useState(false);
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const location = useLocation();

  const initials = String(user?.username ?? "?")
    .split(/[\s._-]+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="app-shell">
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <div className="sidebar-brand">
          <span className="logo">
            <Building2 size={19} />
          </span>
          InventDB PMS
        </div>
        <nav className="nav" onClick={() => setOpen(false)}>
          {NAV.map((group, gi) => (
            <div key={gi}>
              {group.section && <div className="nav-section">{group.section}</div>}
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
                >
                  <Icon name={item.icon} size={18} />
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      <div className={`backdrop ${open ? "show" : ""}`} onClick={() => setOpen(false)} />

      <div className="main">
        <header className="topbar">
          <button className="btn-icon menu-btn" onClick={() => setOpen((o) => !o)} aria-label="Menu">
            <Menu size={20} />
          </button>
          <h1>{pageTitle(location.pathname)}</h1>
          <div className="spacer" />
          <button className="btn-icon" onClick={toggle} aria-label="Toggle theme" title="Toggle theme">
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button className="btn-icon" onClick={logout} aria-label="Sign out" title="Sign out">
            <LogOut size={18} />
          </button>
          <div className="avatar" title={String(user?.username ?? "")}>
            {initials || "?"}
          </div>
        </header>
        <main>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
