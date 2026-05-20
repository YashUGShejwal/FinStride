import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/_authenticated")({
  component: Layout,
});

function Layout() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center">
        <div className="size-10 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }
  if (!user) {
    // Client-side gate (mock auth is in localStorage). throw redirect during render is supported.
    throw redirect({ to: "/login" });
  }
  return <AppShell />;
}

// Render <Outlet/> inside AppShell — keep reference to satisfy tree-shaking checks.
void Outlet;
