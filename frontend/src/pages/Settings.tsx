import { useEffect, useState, type FormEvent } from "react";
import { Moon, Sun } from "lucide-react";

import { api, errorMessage } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useTheme } from "../theme/ThemeContext";
import { useToast } from "../components/Toast";
import { Alert } from "../components/ui";
import { ConfirmDialog } from "../components/Modal";

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
        <ConnectionCard health={health} onLogout={logout} />

        {/* Change password */}
        <ChangePasswordCard />
      </div>
    </div>
  );
}

interface Connection {
  base_url: string;
  namespace: string;
  configured_base_url: string;
  overridden: boolean;
}

/**
 * Which InventDB instance the app talks to.
 *
 * Editable because it is the one setting an operator genuinely needs to change
 * without a redeploy — pointing the app at their own instance rather than the
 * bundled sandbox. It is also the address every login goes to, so saving is a
 * deliberate act: the new host is checked from the server before the change is
 * kept, and because the current token belongs to the instance being left
 * behind, saving signs you out rather than leaving a token that is now
 * meaningless.
 */
function ConnectionCard({
  health,
  onLogout,
}: {
  health: HealthInfo | null;
  onLogout: () => void;
}) {
  const toast = useToast();
  const [connection, setConnection] = useState<Connection | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<"save" | "reset" | null>(null);

  useEffect(() => {
    api
      .get<Connection>("/settings/connection")
      .then((r) => {
        setConnection(r.data);
        setDraft(r.data.base_url);
      })
      .catch(() => setConnection(null));
  }, []);

  const trimmed = draft.trim().replace(/\/+$/, "");
  const dirty = !!connection && trimmed !== connection.base_url;

  async function apply(kind: "save" | "reset") {
    setBusy(true);
    setError(null);
    try {
      const { data } =
        kind === "save"
          ? await api.put("/settings/connection", { base_url: trimmed })
          : await api.delete("/settings/connection");
      setConnection(data);
      setDraft(data.base_url);
      if (data.sign_out_required) {
        // The token was minted by the instance we just left.
        toast.success(`Now connected to ${data.base_url} — sign in again`);
        onLogout();
      } else {
        toast.success("Connection unchanged");
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  }

  return (
    <div className="card card-pad">
      <h3 style={{ fontSize: 15, marginBottom: 14 }}>InventDB Connection</h3>

      {!health && <Alert kind="error">Could not reach the PMS API.</Alert>}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (dirty) setConfirming("save");
        }}
        style={{ display: "flex", flexDirection: "column", gap: 12 }}
      >
        <div className="field">
          <label htmlFor="base-url">Base URL</label>
          <input
            id="base-url"
            className="input"
            type="url"
            inputMode="url"
            spellCheck={false}
            placeholder="https://your-slug.sandbox.inventdb.com"
            value={draft}
            disabled={busy || !connection}
            onChange={(e) => {
              setDraft(e.target.value);
              setError(null);
            }}
          />
          <p className="field-hint">
            The instance this app reads, writes and signs in against. Changing it
            signs you out, because your session belongs to the current one.
          </p>
        </div>

        {error && <Alert kind="error">{error}</Alert>}

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="btn btn-primary" type="submit" disabled={!dirty || busy}>
            {busy ? "Checking…" : "Save & reconnect"}
          </button>
          {dirty && (
            <button
              className="btn btn-ghost"
              type="button"
              disabled={busy}
              onClick={() => {
                setDraft(connection!.base_url);
                setError(null);
              }}
            >
              Cancel
            </button>
          )}
          {!dirty && connection?.overridden && (
            <button
              className="btn btn-ghost"
              type="button"
              disabled={busy}
              onClick={() => setConfirming("reset")}
              title={`Back to ${connection.configured_base_url}`}
            >
              Reset to configured
            </button>
          )}
        </div>
      </form>

      <dl className="kv" style={{ marginTop: 16 }}>
        <dt>Status</dt>
        <dd>
          <span className={`badge ${health?.ok ? "success" : "danger"}`}>
            {health?.ok ? "Connected" : "Unavailable"}
          </span>
        </dd>
        <dt>Namespace</dt>
        <dd>{connection?.namespace ?? health?.namespace ?? "—"}</dd>
        <dt>API version</dt>
        <dd>{health?.version ?? "—"}</dd>
      </dl>

      {confirming && (
        <ConfirmDialog
          title={
            confirming === "save" ? "Connect to a different instance?" : "Reset the connection?"
          }
          message={
            confirming === "save"
              ? `The app will read and write ${trimmed} instead of ${connection?.base_url}. You'll be signed out and will need to sign in there — with an account on that instance.`
              : `The app will go back to ${connection?.configured_base_url}. You'll be signed out.`
          }
          confirmLabel={confirming === "save" ? "Connect" : "Reset"}
          busy={busy}
          onConfirm={() => void apply(confirming)}
          onCancel={() => setConfirming(null)}
        />
      )}
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
