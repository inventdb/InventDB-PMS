import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { LogOut, Menu, Moon, Sun } from "lucide-react";

import { ENTITY_BY_NAME } from "../config/entities";
import { useAuth } from "../auth/AuthContext";
import { usePendingApprovalCount } from "../api/hooks";
import { useTheme } from "../theme/ThemeContext";
import { BrandLockup } from "./BrandLockup";
import { Icon } from "./Icon";

interface NavEntry {
  to: string;
  label: string;
  icon: string;
  end?: boolean;
  /** Show the outstanding-approvals count against this entry. */
  badge?: "approvals";
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
      { to: "/analyze", label: "Analyze", icon: "analyze" },
      // The badge rides the Workflows entry because that is where a parked run
      // is answered — the count and the thing it refers to are one click apart.
      { to: "/workflows", label: "Workflows", icon: "workflow", badge: "approvals" },
      { to: "/reports", label: "Reports", icon: "reports" },
      { to: "/files", label: "Files", icon: "files" },
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
  if (seg === "analyze") return "Analyze";
  if (seg === "reports") return "Reports";
  if (seg === "workflows") return "Workflows";
  if (seg === "files") return "Files";
  if (seg === "settings") return "Settings";
  return ENTITY_BY_NAME[seg]?.labelPlural ?? "InventDB PMS";
}

export function Layout() {
  const [open, setOpen] = useState(false);
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const location = useLocation();
  // A workflow parks whenever it reaches a decision — which is to say, while
  // you are somewhere else in the app. Polled from the shell so it keeps
  // arriving without anyone having to sit on the Workflows page waiting for it.
  const waiting = usePendingApprovalCount();

  const initials = String(user?.username ?? "?")
    .split(/[\s._-]+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="app-shell">
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <BrandLockup className="sidebar-brand" tile />
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
                  {item.badge === "approvals" && waiting > 0 && (
                    <span className="nav-badge" aria-label={`${waiting} waiting on you`}>
                      {waiting}
                    </span>
                  )}
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
          {/* Keyed on the route so the old title unmounts and the new one
              animates in, rather than the text swapping in place. */}
          <h1 key={location.pathname}>{pageTitle(location.pathname)}</h1>
          <div className="spacer" />
          <button className="btn-icon" onClick={toggle} aria-label="Toggle theme" title="Toggle theme">
            {theme === "dark" ? <Sun key="sun" size={18} /> : <Moon key="moon" size={18} />}
          </button>
          <button className="btn-icon" onClick={logout} aria-label="Sign out" title="Sign out">
            <LogOut size={18} />
          </button>
          <div className="avatar" title={String(user?.username ?? "")}>
            {initials || "?"}
          </div>
        </header>
        {/* The route key is what drives the page transition: a new pathname
            remounts the subtree, so the entrance animations in global.css
            replay. Without it React reuses the same elements across
            /properties → /owners and nothing would animate. Page components
            already reset their own state per route (EntityListPage keys on
            the entity), so the remount costs no behaviour. */}
        <main className="page" key={location.pathname}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
