import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, Wallet, TrendingUp, User, LogOut, Sparkles, ListChecks, Zap } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { PwaInstallBanner } from "@/lib/pwa";
import { cn } from "@/lib/utils";

const nav = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/cashflow",  label: "Cashflow",  icon: Wallet },
  { to: "/swing",     label: "Swing",     icon: TrendingUp },
  { to: "/grind",     label: "Grind",     icon: Zap },
  { to: "/pending",   label: "Pending",   icon: ListChecks },
  { to: "/profile",   label: "Profile",   icon: User },
] as const;

export function AppShell() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { user, signOut } = useAuth();

  return (
    <div className="min-h-screen flex w-full">
      {/* Sidebar (desktop) */}
      <aside className="hidden md:flex w-64 shrink-0 flex-col p-4 glass border-r border-glass-border">
        <Link to="/dashboard" className="flex items-center gap-2 px-2 py-3 mb-2">
          <div className="size-9 rounded-xl gradient-primary grid place-items-center glow">
            <Sparkles className="size-5 text-primary-foreground" />
          </div>
          <div>
            <p className="font-semibold leading-none">FinStride</p>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground mt-1">Blueprint v1</p>
          </div>
        </Link>

        <nav className="mt-4 space-y-1">
          {nav.map((n) => {
            const active = path.startsWith(n.to);
            const Icon = n.icon;
            return (
              <Link
                key={n.to}
                to={n.to}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all",
                  active
                    ? "gradient-primary text-primary-foreground glow"
                    : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                )}
              >
                <Icon className="size-4" />
                {n.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto glass rounded-xl p-3">
          <p className="text-xs text-muted-foreground">Signed in</p>
          <p className="text-sm font-medium truncate">{user?.email}</p>
          <button
            onClick={() => signOut()}
            className="mt-2 w-full flex items-center justify-center gap-2 text-xs py-2 rounded-lg border border-glass-border hover:bg-white/5"
          >
            <LogOut className="size-3.5" /> Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0 flex flex-col">
        {/* Mobile header */}
        <header className="md:hidden sticky top-0 z-30 glass-strong px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="size-8 rounded-lg gradient-primary grid place-items-center">
              <Sparkles className="size-4 text-primary-foreground" />
            </div>
            <p className="font-semibold">FinStride</p>
          </div>
          <button onClick={() => signOut()} className="text-xs text-muted-foreground flex items-center gap-1">
            <LogOut className="size-3.5" /> Exit
          </button>
        </header>

        <div className="flex-1 px-4 md:px-8 py-5 md:py-8 pb-28 md:pb-8 max-w-6xl w-full mx-auto">
          <Outlet />
        </div>

        {/* Bottom nav (mobile) */}
        <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 glass-strong border-t border-glass-border safe-bottom">
          <div className="grid grid-cols-4">
            {nav.map((n) => {
              const active = path.startsWith(n.to);
              const Icon = n.icon;
              return (
                <Link
                  key={n.to}
                  to={n.to}
                  className={cn(
                    "flex flex-col items-center justify-center gap-1 py-3 text-[11px] transition-colors",
                    active ? "text-foreground" : "text-muted-foreground"
                  )}
                >
                  <div
                    className={cn(
                      "size-9 grid place-items-center rounded-xl transition-all",
                      active && "gradient-primary glow"
                    )}
                  >
                    <Icon className={cn("size-4", active && "text-primary-foreground")} />
                  </div>
                  {n.label}
                </Link>
              );
            })}
          </div>
        </nav>
      </main>

      <PwaInstallBanner />
    </div>
  );
}
