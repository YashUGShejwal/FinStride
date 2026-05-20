import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

// NOTE: Mock auth backed by localStorage. Designed so the surface mirrors
// Supabase Auth (signIn/signUp/signOut/user/session). Swap implementations
// later with @supabase/supabase-js without changing the consumer code.

export type AuthUser = { id: string; email: string; name?: string };

type AuthCtx = {
  user: AuthUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name?: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);
const KEY = "swingdash.auth.user";

/** Sync read for route guards (beforeLoad). Matches AuthProvider localStorage key. */
export function getStoredAuthUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as AuthUser;
  } catch {}
  return null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setUser(JSON.parse(raw));
    } catch {}
    setLoading(false);
  }, []);

  const persist = (u: AuthUser | null) => {
    setUser(u);
    if (u) localStorage.setItem(KEY, JSON.stringify(u));
    else localStorage.removeItem(KEY);
  };

  const signIn = async (email: string, password: string) => {
    if (!email || password.length < 6) throw new Error("Invalid credentials");
    await new Promise((r) => setTimeout(r, 400));
    persist({ id: crypto.randomUUID(), email, name: email.split("@")[0] });
  };

  const signUp = async (email: string, password: string, name?: string) => {
    if (!email || password.length < 6) throw new Error("Password must be 6+ chars");
    await new Promise((r) => setTimeout(r, 500));
    persist({ id: crypto.randomUUID(), email, name: name || email.split("@")[0] });
  };

  const signOut = async () => persist(null);

  return <Ctx.Provider value={{ user, loading, signIn, signUp, signOut }}>{children}</Ctx.Provider>;
}

export const useAuth = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used within AuthProvider");
  return v;
};
