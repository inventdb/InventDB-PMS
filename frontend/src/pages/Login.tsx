import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import {
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  User,
} from "lucide-react";

import { useAuth } from "../auth/AuthContext";
import { BrandLockup } from "../components/BrandLockup";
import { Alert } from "../components/ui";

const FEATURES = [
  "Properties, units, tenants & leases in one place",
  "Maintenance work orders and vendor tracking",
  "Accounting, rent payments & owner reporting",
  "Powered by InventDB SOAR — secure & real-time",
];

// InventDB is the identity provider, so new users register their workspace
// there rather than in this app.
const INVENTDB_URL = "https://www.inventdb.com";

export default function Login() {
  const { user, token, login, loading } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (user && token) return <Navigate to="/" replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    }
  };

  return (
    <div className="login-page">
      <div className="login-hero">
        <div>
          <BrandLockup className="hero-badge" size="lg" />
          <h1>Property management, modernised.</h1>
          <p>
            A single, fast workspace for managers to run their entire portfolio —
            built on the InventDB SOAR database.
          </p>
          <div className="hero-feats">
            {FEATURES.map((f) => (
              <div className="hero-feat" key={f}>
                <CheckCircle2 size={18} /> {f}
              </div>
            ))}
          </div>
        </div>
        <div className="hero-foot">
          Need an account? Register your InventDB workspace at{" "}
          <a href={INVENTDB_URL} target="_blank" rel="noreferrer noopener">
            inventdb.com
          </a>
        </div>
      </div>

      <div className="login-form-wrap">
        <div className="login-card card card-pad">
          <div className="lc-head">
            <h2>Welcome back</h2>
            <p>Sign in with your InventDB credentials to continue.</p>
          </div>
          <form onSubmit={onSubmit}>
            {error && <Alert kind="error">{error}</Alert>}
            <div className="field">
              <label htmlFor="username">Username</label>
              <div className="input-icon">
                <User size={16} />
                <input
                  id="username"
                  className="input"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="your.username"
                  required
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <div className="input-icon">
                <Lock size={16} />
                <input
                  id="password"
                  className="input has-toggle"
                  type={show ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                />
                <button
                  type="button"
                  className="btn-icon input-toggle"
                  onClick={() => setShow((s) => !s)}
                  aria-label={show ? "Hide password" : "Show password"}
                  tabIndex={-1}
                >
                  {show ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <button className="btn btn-primary btn-block" type="submit" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 size={16} className="spin" /> Signing in…
                </>
              ) : (
                "Sign in"
              )}
            </button>
          </form>
          <div className="login-meta">
            Don&apos;t have an account?{" "}
            <a href={INVENTDB_URL} target="_blank" rel="noreferrer noopener">
              Register on InventDB
              <ExternalLink size={12} />
            </a>
            <div className="login-meta-sub">
              Authentication is handled directly by InventDB.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
