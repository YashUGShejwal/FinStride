import { createFileRoute, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { getStoredAuthUser, useAuth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: () => {
    // getStoredAuthUser() reads a client-only localStorage mirror. During SSR —
    // which TanStack Start runs on every hard reload / direct URL load —
    // localStorage doesn't exist, so this would ALWAYS read "no user" and
    // redirect an already-signed-in visitor straight to /login. Only trust
    // this synchronous check on the client, where the mirror is meaningful;
    // Layout's effect below is the real guard once auth has actually hydrated.
    if (typeof window !== "undefined" && !getStoredAuthUser()) {
      throw redirect({ to: "/login" });
    }
  },
  component: Layout,
});

function Layout() {
  const { user, loading } = useAuth();
  const nav = useNavigate();

  // The authoritative guard: only redirect once the initial session check has
  // actually resolved. Redirecting on `loading` (as the old beforeLoad-only
  // check effectively did, by ignoring loading state entirely) is exactly
  // what sent a real, still-hydrating session to /login.
  useEffect(() => {
    if (!loading && !user) {
      nav({ to: "/login", replace: true });
    }
  }, [loading, user, nav]);

  if (loading || !user) {
    return (
      <div className="min-h-screen grid place-items-center">
        {/* No-JS fallback: without client JS, the redirect effect above never
            runs, and (correctly, since SSR can't trust localStorage) neither
            does beforeLoad's check — so a genuinely signed-out visitor would
            otherwise be stuck on this spinner forever with no way to reach
            /login. A meta-refresh works with scripting disabled; browsers
            with JS enabled just never render <noscript> content at all. */}
        <noscript>
          <meta httpEquiv="refresh" content="0; url=/login" />
        </noscript>
        <div className="size-10 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  return <AppShell />;
}

// Render <Outlet/> inside AppShell — keep reference to satisfy tree-shaking checks.
void Outlet;
