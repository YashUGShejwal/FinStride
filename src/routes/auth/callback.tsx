import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { LogoMark } from "@/components/Logo";
import { useAuth } from "@/lib/auth";
import { getSupabaseBrowserClient } from "@/lib/db/client";
import { toast } from "sonner";

// Sibling to /login, NOT nested under /_authenticated — the whole point of
// this page is to sit through the moment where the user isn't signed in yet.
export const Route = createFileRoute("/auth/callback")({ component: AuthCallbackPage });

type ExchangeState = "pending" | "done" | "failed";

function AuthCallbackPage() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const [oauthError, setOauthError] = useState<string | null>(null);
  // Tracks the EXPLICIT exchangeCodeForSession() call this page drives itself
  // (see the effect below) — distinct from AuthProvider's `loading`, which
  // only reflects the initial getSession()/onAuthStateChange bootstrap and,
  // since detectSessionInUrl is disabled (src/lib/db/client.ts), no longer
  // does the exchange on its own. Navigating on `loading` alone — without
  // this — was the race: it could flip to false from the bootstrap's OWN
  // getSession() call, before this page's exchange had actually completed
  // and updated the session in the client's memory, sending the very next
  // request (Analytics' fetchAllUserData in store.tsx) out with no valid
  // access token yet, which Postgres/PostgREST reports as 401 Unauthorized.
  const [exchange, setExchange] = useState<ExchangeState>("pending");

  // Some providers (and Supabase itself, on a denied/failed consent) report
  // the failure via query params on this same redirect URL rather than by
  // simply not producing a session — check for that up front.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get("error_description") || params.get("error");
    if (err) {
      setOauthError(err);
      setExchange("failed");
    }
  }, []);

  // Drive the code exchange explicitly and exactly once. Only after THIS
  // resolves do we know the session is actually saved in the client's memory
  // — onAuthStateChange (subscribed app-wide in AuthProvider) fires as part
  // of that save, which is what updates `user` below.
  useEffect(() => {
    if (oauthError) return;

    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      // Supabase isn't configured in this environment at all — nothing to
      // exchange. Fall through to the loading/user effect below, which will
      // send an unauthenticated visitor back to /login.
      setExchange("done");
      return;
    }

    const code = new URLSearchParams(window.location.search).get("code");
    if (!code) {
      // Landed here with no ?code= and no ?error= (e.g. a stale/reloaded
      // callback URL, or link shared out of context) — nothing to exchange.
      setExchange("done");
      return;
    }

    let cancelled = false;
    void (async () => {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (cancelled) return;
      if (error) {
        setOauthError(error.message);
        setExchange("failed");
        return;
      }
      // Success: the session is now saved in the client's memory and
      // onAuthStateChange has already fired for it. `setExchange("done")`
      // still doesn't navigate by itself — the effect below waits for
      // AuthProvider's `user` to actually reflect that before moving on.
      setExchange("done");
    })();

    return () => {
      cancelled = true;
    };
  }, [oauthError]);

  useEffect(() => {
    if (oauthError) return;
    // Wait for BOTH: our own explicit exchange to finish, AND AuthProvider's
    // `loading`/`user` to reflect its result. The exchange resolving is what
    // guarantees the session is saved (fixes the 401 race); waiting on
    // `loading` too keeps this in sync with the single source of truth for
    // `user` rather than duplicating that logic here.
    if (exchange === "pending" || loading) return;
    if (!user) {
      // A URL-level ?error= is caught above and shown on this page directly.
      // A failed exchange is caught in the effect above and also shown there.
      // This is the residual case: the exchange reported success (or there
      // was no code to exchange) yet no session materialized — treat it the
      // same way, since silently bouncing to /login with no explanation is
      // worse than a slightly redundant message.
      toast.error("Sign-in didn't complete. Please try again.");
    }
    nav({ to: user ? "/dashboard" : "/login", replace: true });
  }, [loading, user, oauthError, exchange, nav]);

  useEffect(() => {
    if (oauthError) toast.error(oauthError);
  }, [oauthError]);

  if (oauthError) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-md glass-strong rounded-2xl p-8 text-center">
          <h1 className="text-lg font-semibold">Sign-in didn't complete</h1>
          <p className="text-sm text-muted-foreground mt-2">{oauthError}</p>
          <button
            onClick={() => nav({ to: "/login" })}
            className="mt-6 gradient-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium"
          >
            Back to sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-4">
      <LogoMark className="size-11" />
      <div className="size-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      <p className="text-sm text-muted-foreground">Completing sign-in…</p>
    </div>
  );
}
