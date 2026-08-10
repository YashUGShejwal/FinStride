import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import {
  getSupabaseBrowserClient,
  isSupabaseConfigured,
  type FinStrideClient,
} from "@/lib/db/client";

// NOTE: Dual-mode auth.
//   • Supabase configured  → real email/password + OAuth via @supabase/supabase-js.
//   • Supabase absent      → the original mock (any email + 6-char password),
//                            so the app keeps running on localStorage alone.
// The exported surface is identical in both modes — consumers never branch.

export type AuthUser = { id: string; email: string; name?: string };

/** OAuth providers wired up for this project. */
export type OAuthProvider = "google" | "github";

/**
 * signUp resolves with this instead of void because a Supabase project with
 * email confirmation enabled returns a user but NO session — the account
 * exists yet nobody is signed in. Callers that care can branch on it; callers
 * that just `await signUp(...)` (src/routes/signup.tsx today) are unaffected.
 */
export type SignUpResult = { needsEmailConfirmation: boolean };

type AuthCtx = {
  user: AuthUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name?: string) => Promise<SignUpResult>;
  signOut: () => Promise<void>;
  signInWithOAuth: (provider: OAuthProvider) => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);
const KEY = "finstride.auth.user";

/**
 * localStorage mirror of the signed-in user.
 *
 * WHY THIS EXISTS even when Supabase owns the session: src/routes/_authenticated.tsx
 * guards the route in `beforeLoad`, which is SYNCHRONOUS. Supabase's own
 * `getSession()` is async and cannot be awaited there, so every auth state
 * change writes the resolved user here and getStoredAuthUser() reads it back
 * synchronously. It is a cache for routing only — never a source of truth, and
 * never trusted for data access (Postgres RLS is the real gate).
 */
function readStoredUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as AuthUser;
  } catch {}
  return null;
}

function writeStoredUser(u: AuthUser | null) {
  try {
    if (u) localStorage.setItem(KEY, JSON.stringify(u));
    else localStorage.removeItem(KEY);
  } catch {}
}

/** Sync read for route guards (beforeLoad). Matches AuthProvider localStorage key. */
export function getStoredAuthUser(): AuthUser | null {
  return readStoredUser();
}

/** Supabase user → the app's slim AuthUser shape. */
function toAuthUser(u: User): AuthUser {
  const email = u.email ?? "";
  const meta = u.user_metadata as { full_name?: unknown } | null | undefined;
  const fullName = typeof meta?.full_name === "string" ? meta.full_name.trim() : "";
  return { id: u.id, email, name: fullName || email.split("@")[0] || undefined };
}

/**
 * Resolve the client for a single auth action.
 *
 * Returns null when Supabase isn't configured — the caller then runs the mock
 * path. Throws in the one ambiguous case: Supabase IS configured but the
 * browser client is unavailable (an auth action fired during SSR). That must
 * never silently fall through to the mock and mint a fake local account.
 */
function authClient(): FinStrideClient | null {
  const supabase = getSupabaseBrowserClient();
  if (!supabase && isSupabaseConfigured()) {
    throw new Error("Auth is unavailable in this environment. Please retry from the browser.");
  }
  return supabase;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  /** Single write path: React state and the routing mirror always move together. */
  const persist = (u: AuthUser | null) => {
    setUser(u);
    writeStoredUser(u);
  };

  useEffect(() => {
    // Guards against setState after unmount in the async session restore below.
    let cancelled = false;

    // null during SSR and whenever Supabase isn't configured. useEffect doesn't
    // run on the server, but the null check keeps mock mode honest either way.
    const supabase = getSupabaseBrowserClient();

    // ── Mock mode ─────────────────────────────────────────────────────────
    if (!supabase) {
      setUser(readStoredUser());
      setLoading(false);
      return;
    }

    // ── Supabase mode ─────────────────────────────────────────────────────
    const applySession = (session: Session | null) => {
      const next = session?.user ? toAuthUser(session.user) : null;
      setUser(next);
      writeStoredUser(next);
    };

    // Paint from the mirror first so a returning user isn't flashed as signed
    // out for the round-trip it takes getSession() to resolve.
    const mirrored = readStoredUser();
    if (mirrored) setUser(mirrored);

    void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (cancelled) return;
        applySession(data.session);
      } catch {
        // Session restore failed (offline, storage blocked). Leave whatever the
        // mirror gave us — onAuthStateChange corrects it once the client
        // recovers. What matters is that `loading` still clears below.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    // Keeps React in sync with sign-in, sign-out, token refresh and the OAuth
    // redirect landing back on the app.
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      applySession(session);
      setLoading(false);
    });

    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, []);

  // ── Mock implementations (unchanged behaviour, incl. simulated latency) ──
  const mockSignIn = async (email: string, password: string) => {
    if (!email || password.length < 6) throw new Error("Invalid credentials");
    await new Promise((r) => setTimeout(r, 400));
    persist({ id: crypto.randomUUID(), email, name: email.split("@")[0] });
  };

  const mockSignUp = async (email: string, password: string, name?: string) => {
    if (!email || password.length < 6) throw new Error("Password must be 6+ chars");
    await new Promise((r) => setTimeout(r, 500));
    persist({ id: crypto.randomUUID(), email, name: name || email.split("@")[0] });
  };

  const signIn = async (email: string, password: string) => {
    const supabase = authClient();
    if (!supabase) return mockSignIn(email, password);

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    // onAuthStateChange fires for this too, but writing the mirror here as well
    // guarantees it lands BEFORE this promise resolves — login.tsx navigates
    // straight into a synchronous beforeLoad guard that reads it.
    if (data.session?.user) persist(toAuthUser(data.session.user));
  };

  const signUp = async (email: string, password: string, name?: string): Promise<SignUpResult> => {
    const supabase = authClient();
    if (!supabase) {
      await mockSignUp(email, password, name);
      return { needsEmailConfirmation: false };
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: name } },
    });
    if (error) throw new Error(error.message);

    // Email confirmation enabled: a user row exists but there is no session.
    // Do NOT persist anyone — pretending they're signed in would send them into
    // the app and straight back out at the route guard.
    if (!data.session) return { needsEmailConfirmation: true };

    if (data.session.user) persist(toAuthUser(data.session.user));
    return { needsEmailConfirmation: false };
  };

  const signOut = async () => {
    const supabase = authClient();
    if (supabase) {
      const { error } = await supabase.auth.signOut();
      // Deliberately not rethrown: sign-out call sites (AppShell) don't catch,
      // and a failed remote revoke must never block the local sign-out or leave
      // the route guard believing the user is still in.
      if (error) console.warn("[auth] remote sign-out failed:", error.message);
    }
    persist(null);
  };

  const signInWithOAuth = async (provider: OAuthProvider) => {
    const supabase = authClient();
    if (!supabase) {
      throw new Error(
        "OAuth sign-in requires Supabase. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable it.",
      );
    }

    const redirectTo =
      typeof window !== "undefined" ? `${window.location.origin}/dashboard` : undefined;
    const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo } });
    if (error) throw new Error(error.message);
    // On success the browser leaves for the provider; the session is picked up
    // by onAuthStateChange when it redirects back to /dashboard.
  };

  return (
    <Ctx.Provider value={{ user, loading, signIn, signUp, signOut, signInWithOAuth }}>
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used within AuthProvider");
  return v;
};
