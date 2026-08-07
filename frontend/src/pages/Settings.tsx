import { useEffect, useState, type FormEvent } from "react";
import { Moon, Sun } from "lucide-react";

import { api, errorMessage } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useTheme } from "../theme/ThemeContext";
import { useToast } from "../components/Toast";
import { Alert } from "../components/ui";

interface HealthInfo {
  ok: boolean;
  version?: string;
  inventdb_base_url?: string;
  namespace?: string;
  frontend_bundled?: boolean;
}

export default function Settings() {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();

  const [health, setHealth] = useState<HealthInfo | null>(null);
  useEffect(() => {
    api
      .get<HealthInfo>("/health")
      .then((r) => setHealth(r.data))
      .catch(() => setHealth(null));
  }, []);

  return (
    <div className="content">
      <div className="page-head">
        <div className="titles">
          <h2>Settings</h2>
          <p>Account, appearance, connection and data management.</p>
        </div>
      </div>

      <div className="grid-2">
        {/* Account */}
        <div className="card card-pad">
          <h3 style={{ fontSize: 15, marginBottom: 14 }}>Account</h3>
          <dl className="kv">
            <dt>Username</dt>
            <dd>{String(user?.username ?? "—")}</dd>
            <dt>Email</dt>
            <dd>{String(user?.email ?? "—")}</dd>
            <dt>Role</dt>
            <dd>{String(user?.role ?? user?.globalRole ?? "—")}</dd>
          </dl>
          <div style={{ marginTop: 16 }}>
            <button className="btn btn-ghost" onClick={logout}>
              Sign out
            </button>
          </div>
        </div>

        {/* Appearance */}
        <div className="card card-pad">
          <h3 style={{ fontSize: 15, marginBottom: 14 }}>Appearance</h3>
          <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 0 }}>
            Choose a light or dark theme. Your preference is saved on this device.
          </p>
          <button className="btn btn-ghost" onClick={toggle}>
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            Switch to {theme === "dark" ? "light" : "dark"} mode
          </button>
        </div>

        {/* Connection */}
        <div className="card card-pad">
          <h3 style={{ fontSize: 15, marginBottom: 14 }}>InventDB Connection</h3>
          {health ? (
            <dl className="kv">
              <dt>Status</dt>
              <dd>
                <span className={`badge ${health.ok ? "success" : "danger"}`}>
                  {health.ok ? "Connected" : "Unavailable"}
                </span>
              </dd>
              <dt>Base URL</dt>
              <dd style={{ wordBreak: "break-all" }}>{health.inventdb_base_url ?? "—"}</dd>
              <dt>Namespace</dt>
              <dd>{health.namespace ?? "—"}</dd>
              <dt>API version</dt>
              <dd>{health.version ?? "—"}</dd>
            </dl>
          ) : (
            <Alert kind="error">Could not reach the PMS API.</Alert>
          )}
        </div>

        {/* Change password */}
        <ChangePasswordCard />
      </div>
    </div>
  );
}

function ChangePasswordCard() {
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/auth/change-password", {
        current_password: current,
        new_password: next,
      });
      toast.success("Password changed");
      setCurrent("");
      setNext("");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card card-pad">
      <h3 style={{ fontSize: 15, marginBottom: 14 }}>Change Password</h3>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="field">
          <label htmlFor="cur">Current password</label>
          <input
            id="cur"
            className="input"
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="new">New password</label>
          <input
            id="new"
            className="input"
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            required
          />
        </div>
        <div>
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? "Updating…" : "Update password"}
          </button>
        </div>
      </form>
    </div>
  );
}
