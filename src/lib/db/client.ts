import { createBrowserClient, createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

/**
 * Supabase access layer.
 *
 * Supabase is OPTIONAL. When VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not
 * configured, every accessor returns null and the app runs entirely on
 * localStorage (see src/lib/store.tsx). This is what makes the app work
 * offline, in local dev without a project, and for unauthenticated visitors.
 */

export type FinStrideClient = SupabaseClient<Database>;

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL?.trim() ?? "";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? "";

/** True when both env vars are present — cheap, synchronous, safe during SSR. */
export function isSupabaseConfigured(): boolean {
  return SUPABASE_URL !== "" && SUPABASE_ANON_KEY !== "";
}

let browserClient: FinStrideClient | null = null;

/**
 * Singleton browser client. Returns null when Supabase isn't configured or when
 * called during SSR (no document/cookie jar to bind the auth session to).
 *
 * A singleton matters here: each createBrowserClient() call registers its own
 * auth listener and token-refresh timer, so creating one per render would leak.
 */
export function getSupabaseBrowserClient(): FinStrideClient | null {
  if (!isSupabaseConfigured()) return null;
  if (typeof window === "undefined") return null;
  if (!browserClient) {
    // detectSessionInUrl defaults to true, which makes the client auto-detect
    // and exchange a ?code=/#access_token= fragment on ANY page the first
    // time it's used — including a race against src/routes/auth/callback.tsx
    // explicitly driving the SAME exchange itself (a single-use PKCE code
    // exchanged twice fails the second time, and there is no reliable way to
    // tell from the callback page whether the auto-detect path already won
    // the race). Disabling it here makes /auth/callback the ONE place the
    // exchange ever happens, called explicitly via exchangeCodeForSession().
    browserClient = createBrowserClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { detectSessionInUrl: false },
    });
  }
  return browserClient;
}

/** Minimal cookie shape accepted by createSupabaseServerClient (SSR / server fns). */
export type ServerCookieAdapter = {
  getAll: () => { name: string; value: string }[];
  setAll: (cookies: { name: string; value: string; options?: Record<string, unknown> }[]) => void;
};

/**
 * Per-request server client for SSR loaders / server functions.
 *
 * Never cache this across requests — it is bound to one request's cookies, so
 * reusing it would leak one user's session into another user's response.
 */
export function createSupabaseServerClient(cookies: ServerCookieAdapter): FinStrideClient | null {
  if (!isSupabaseConfigured()) return null;
  return createServerClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => cookies.getAll(),
      setAll: (cookiesToSet) => {
        try {
          cookies.setAll(cookiesToSet);
        } catch {
          // Called from a context that can't set cookies (e.g. a read-only
          // render pass). Safe to ignore — the session is refreshed elsewhere.
        }
      },
    },
  });
}
