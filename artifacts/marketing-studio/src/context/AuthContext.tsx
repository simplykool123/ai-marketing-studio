import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { setAuthTokenGetter } from "@workspace/api-client-react";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const TOKEN_KEY = "ams_token";
const USER_KEY = "ams_user";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const storeSession = useCallback((t: string, u: AuthUser) => {
    localStorage.setItem(TOKEN_KEY, t);
    localStorage.setItem(USER_KEY, JSON.stringify(u));
    setToken(t);
    setUser(u);
    setAuthTokenGetter(() => t);
  }, []);

  const clearSession = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
    setAuthTokenGetter(null);
  }, []);

  useEffect(() => {
    const storedToken = localStorage.getItem(TOKEN_KEY);
    const storedUser = localStorage.getItem(USER_KEY);
    if (storedToken && storedUser) {
      try {
        const parsedUser = JSON.parse(storedUser) as AuthUser;
        setToken(storedToken);
        setUser(parsedUser);
        setAuthTokenGetter(() => storedToken);
        fetch("/api/auth/me", {
          headers: { Authorization: `Bearer ${storedToken}` },
        }).then(r => {
          if (!r.ok) clearSession();
        }).catch(() => clearSession());
      } catch {
        clearSession();
      }
    }
    setIsLoading(false);
  }, [clearSession]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json() as { user?: AuthUser; accessToken?: string; error?: string };
    if (!res.ok) throw new Error(data.error ?? "Login failed");
    storeSession(data.accessToken!, data.user!);
  }, [storeSession]);

  const signup = useCallback(async (name: string, email: string, password: string) => {
    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    });
    const data = await res.json() as { user?: AuthUser; accessToken?: string; error?: string };
    if (!res.ok) throw new Error(data.error ?? "Signup failed");
    if (data.accessToken) storeSession(data.accessToken, data.user!);
    else throw new Error("Account created — please sign in.");
  }, [storeSession]);

  const logout = useCallback(() => {
    const t = token;
    clearSession();
    if (t) {
      fetch("/api/auth/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${t}` },
      }).catch(() => {});
    }
  }, [token, clearSession]);

  return (
    <AuthContext.Provider value={{ user, token, isAuthenticated: !!user, isLoading, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
