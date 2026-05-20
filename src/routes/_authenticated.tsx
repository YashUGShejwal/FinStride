import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { getStoredAuthUser, useAuth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: () => {
    if (!getStoredAuthUser()) {
      throw redirect({ to: "/login" });
    }
  },
  component: Layout,
});

function Layout() {
  const { loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center">
        <div className="size-10 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }
  return <AppShell />;
}

// Render <Outlet/> inside AppShell — keep reference to satisfy tree-shaking checks.
void Outlet;
