import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { api, errorMessage, getToken, setToken, setUnauthorizedHandler } from "../api/client";
import { resetAnalyzeState } from "../analyze/store";
import type { AuthUser, LoginResponse } from "../types";

const USER_KEY = "pms.user";

interface AuthState {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

function loadUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => loadUser());
  const [token, setTokenState] = useState<string | null>(() => getToken());
  const [loading, setLoading] = useState(false);

  const logout = useCallback(() => {
    setToken(null);
    localStorage.removeItem(USER_KEY);
    setUser(null);
    setTokenState(null);
    // Analyze holds its threads at module scope so a running analysis survives
    // navigation — which means signing out has to clear them explicitly, or the
    // next person to sign in on this tab would find the last one's questions
    // (and any stream still in flight) waiting for them.
    resetAnalyzeState();
  }, []);

  // Any 401 from the API layer forces a logout.
  useEffect(() => {
    setUnauthorizedHandler(logout);
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  const login = useCallback(async (username: string, password: string) => {
    setLoading(true);
    try {
      const { data } = await api.post<LoginResponse>("/auth/login", {
        username,
        password,
      });
      if (!data.token) {
        throw new Error(data.error || "Login failed");
      }
      setToken(data.token);
      localStorage.setItem(USER_KEY, JSON.stringify(data.user ?? {}));
      setTokenState(data.token);
      setUser(data.user ?? {});
    } catch (err) {
      throw new Error(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, token, loading, login, logout }),
    [user, token, loading, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
