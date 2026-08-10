import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

// Sibling to /login, NOT nested under /_authenticated — the whole point of
// this page is to sit through the moment where the user isn't signed in yet.
export const Route = createFileRoute("/auth/callback")({ component: AuthCallbackPage });

function AuthCallbackPage() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const [oauthError, setOauthError] = useState<string | null>(null);

  // Some providers (and Supabase itself, on a denied/failed consent) report
  // the failure via query params on this same redirect URL rather than by
  // simply not producing a session — check for that up front.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get("error_description") || params.get("error");
    if (err) setOauthError(err);
  }, []);

  useEffect(() => {
    if (oauthError) return;
    // @supabase/ssr's browser client auto-detects the ?code= param from the
    // OAuth redirect and exchanges it for a session as part of its own
    // initialization — AuthProvider's getSession()/onAuthStateChange (already
    // running app-wide) picks that up with no extra work needed here. Once it
    // resolves either way, move on: dashboard on success, back to login if
    // the exchange failed to produce a session.
    if (loading) return;
    if (!user) {
      // A URL-level ?error= is caught above and shown on this page directly.
      // This branch is the OTHER failure mode: the code exchange itself
      // failed with no session and no URL error param — an expired/reused
      // code, a missing PKCE verifier (e.g. the consent screen was completed
      // in a different browser/tab than the one that started the flow), or a
      // transient error against Supabase's token endpoint. @supabase/auth-js
      // swallows that failure internally rather than surfacing it, so this is
      // the only place left to tell the user anything went wrong at all.
      toast.error("Sign-in didn't complete. Please try again.");
    }
    nav({ to: user ? "/dashboard" : "/login", replace: true });
  }, [loading, user, oauthError, nav]);

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
      <div className="size-11 rounded-2xl gradient-primary grid place-items-center glow">
        <Sparkles className="size-5 text-primary-foreground" />
      </div>
      <div className="size-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      <p className="text-sm text-muted-foreground">Completing sign-in…</p>
    </div>
  );
}
