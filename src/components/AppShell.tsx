import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import {
  LayoutDashboard, Wallet, TrendingUp, User, LogOut, Sparkles,
  ListChecks, Zap, Settings, PieChart, MoreHorizontal, X,
} from "lucide-react";
import { Drawer } from "vaul";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

// Full nav — used in desktop sidebar
const allNav = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/cashflow",  label: "Cashflow",  icon: Wallet },
  { to: "/swing",     label: "Swing",     icon: TrendingUp },
  { to: "/analytics", label: "Analytics", icon: PieChart },
  { to: "/grind",     label: "Grind",     icon: Zap },
  { to: "/pending",   label: "Pending",   icon: ListChecks },
  { to: "/settings",  label: "Settings",  icon: Settings },
  { to: "/profile",   label: "Profile",   icon: User },
] as const;

// 4 primary items always visible on mobile bottom nav
const primaryMobileNav = allNav.slice(0, 4); // Dashboard, Cashflow, Swing, Analytics

// The rest go into the "More" drawer
const moreMobileNav = allNav.slice(4);       // Grind, Pending, Settings, Profile

export function AppShell() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { user, signOut } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="min-h-screen flex w-full">
      {/* ── Desktop sidebar ──────────────────────────────────────────────── */}
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
          {allNav.map((n) => {
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
                    : "text-muted-foreground hover:text-foreground hover:bg-white/5",
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

      {/* ── Main ─────────────────────────────────────────────────────────── */}
      <main className="flex-1 min-w-0 flex flex-col">
        {/* Mobile header */}
        <header className="md:hidden sticky top-0 z-30 glass-strong px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="size-8 rounded-lg gradient-primary grid place-items-center">
              <Sparkles className="size-4 text-primary-foreground" />
            </div>
            <p className="font-semibold">FinStride</p>
          </div>
          <button
            onClick={() => signOut()}
            className="text-xs text-muted-foreground flex items-center gap-1"
          >
            <LogOut className="size-3.5" /> Exit
          </button>
        </header>

        <div className="flex-1 px-4 md:px-8 py-5 md:py-8 pb-28 md:pb-8 max-w-6xl w-full mx-auto">
          <Outlet />
        </div>

        {/* ── Mobile bottom nav (4 primary + More) ─────────────────────── */}
        <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 glass-strong border-t border-glass-border safe-bottom">
          <div className="grid grid-cols-5">
            {primaryMobileNav.map((n) => {
              const active = path.startsWith(n.to);
              const Icon = n.icon;
              return (
                <Link
                  key={n.to}
                  to={n.to}
                  className={cn(
                    "flex flex-col items-center justify-center gap-1 py-3 text-[11px] transition-colors",
                    active ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  <div
                    className={cn(
                      "size-9 grid place-items-center rounded-xl transition-all",
                      active && "gradient-primary glow",
                    )}
                  >
                    <Icon className={cn("size-4", active && "text-primary-foreground")} />
                  </div>
                  {n.label}
                </Link>
              );
            })}

            {/* More button */}
            <button
              onClick={() => setDrawerOpen(true)}
              className={cn(
                "flex flex-col items-center justify-center gap-1 py-3 text-[11px] transition-colors",
                moreMobileNav.some((n) => path.startsWith(n.to))
                  ? "text-foreground"
                  : "text-muted-foreground",
              )}
            >
              <div
                className={cn(
                  "size-9 grid place-items-center rounded-xl transition-all",
                  moreMobileNav.some((n) => path.startsWith(n.to)) && "gradient-primary glow",
                )}
              >
                <MoreHorizontal
                  className={cn(
                    "size-4",
                    moreMobileNav.some((n) => path.startsWith(n.to)) && "text-primary-foreground",
                  )}
                />
              </div>
              More
            </button>
          </div>
        </nav>
      </main>

      {/* ── "More" Drawer ────────────────────────────────────────────────── */}
      <Drawer.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
          <Drawer.Content className="fixed bottom-0 left-0 right-0 z-50 glass-strong border-t border-glass-border rounded-t-2xl outline-none">
            <div className="px-4 pt-4 pb-8">
              {/* Handle + header */}
              <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-white/20" />
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                  More
                </p>
                <button
                  onClick={() => setDrawerOpen(false)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              </div>

              {/* Nav items */}
              <div className="grid grid-cols-2 gap-2">
                {moreMobileNav.map((n) => {
                  const active = path.startsWith(n.to);
                  const Icon = n.icon;
                  return (
                    <Link
                      key={n.to}
                      to={n.to}
                      onClick={() => setDrawerOpen(false)}
                      className={cn(
                        "flex items-center gap-3 px-4 py-3.5 rounded-xl text-sm transition-all border",
                        active
                          ? "gradient-primary text-primary-foreground border-transparent glow"
                          : "text-muted-foreground border-glass-border hover:text-foreground hover:bg-white/5",
                      )}
                    >
                      <Icon className="size-4 shrink-0" />
                      {n.label}
                    </Link>
                  );
                })}
              </div>

              {/* Sign out */}
              <button
                onClick={async () => { setDrawerOpen(false); await signOut(); }}
                className="mt-3 w-full flex items-center justify-center gap-2 text-sm py-3 rounded-xl border border-glass-border text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
              >
                <LogOut className="size-4" /> Sign out
              </button>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </div>
  );
}
