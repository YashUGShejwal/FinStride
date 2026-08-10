import { createFileRoute, Link, Outlet, redirect, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Bell, Command as CommandIcon, Eye, EyeOff, LayoutDashboard, LogOut,
  PieChart, Settings, Sparkles, TrendingUp, User, Wallet,
} from "lucide-react";
import { getStoredAuthUser, useAuth } from "@/lib/auth";
import { useStore } from "@/lib/store";
import { inr } from "@/lib/format";
import { useModKeyLabel } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { CommandPalette } from "@/components/CommandPalette";
import { Sensitive } from "@/components/Sensitive";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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

  return <WorkstationShell />;
}

// ─── The 4 primary hubs — the ONLY top-level navigation ─────────────────────
const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/cashflow", label: "Cash Flow", icon: Wallet },
  { to: "/swing", label: "Swing Desk", icon: TrendingUp },
  { to: "/analytics", label: "Portfolio", icon: PieChart },
] as const;

const TAB_SPRING = { type: "spring", stiffness: 420, damping: 34 } as const;

function WorkstationShell() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { user, signOut } = useAuth();
  const { isStealthMode, toggleStealthMode } = useStore();
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Global keyboard bindings: Cmd/Ctrl+K → palette, Cmd/Ctrl+Shift+P → stealth.
  // Read through a ref so the listener is attached exactly once — the store's
  // context value (and therefore toggleStealthMode's identity) changes on
  // every provider render.
  const toggleStealthRef = useRef(toggleStealthMode);
  toggleStealthRef.current = toggleStealthMode;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // !altKey keeps AltGr chords (reported as ctrl+alt on Windows) from
      // being mistaken for shortcut presses.
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "k" && !e.shiftKey) {
        e.preventDefault();
        setPaletteOpen((open) => !open);
      } else if (key === "p" && e.shiftKey) {
        // Note: Firefox reserves Ctrl+Shift+P for New Private Window and never
        // delivers it to the page — the header eye button and the palette
        // entry are the fallbacks there.
        e.preventDefault();
        toggleStealthRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const initial = (user?.name ?? user?.email ?? "U").trim()[0]?.toUpperCase() ?? "U";
  const modKey = useModKeyLabel();

  return (
    <div className="min-h-screen flex flex-col">
      {/* ── Header: brand · 4 hubs · controls ─────────────────────────────── */}
      <header className="sticky top-0 z-40 glass-strong border-b border-glass-border">
        <div className="max-w-6xl mx-auto px-4 md:px-8 h-14 flex items-center gap-3">
          <Link to="/dashboard" className="flex items-center gap-2 shrink-0">
            <div className="size-8 rounded-lg gradient-primary grid place-items-center glow">
              <Sparkles className="size-4 text-primary-foreground" />
            </div>
            <span className="font-semibold tracking-tight hidden sm:inline">FinStride</span>
          </Link>

          {/* Desktop tab rail with sliding spring indicator */}
          <nav className="hidden md:flex items-center gap-1 ml-4">
            {NAV.map((n) => {
              const active = path.startsWith(n.to);
              const Icon = n.icon;
              return (
                <Link
                  key={n.to}
                  to={n.to}
                  className={cn(
                    "relative flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-sm transition-colors",
                    active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="active-tab-indicator"
                      transition={TAB_SPRING}
                      className="absolute inset-0 rounded-lg bg-white/[0.07] border border-white/[0.08]"
                    />
                  )}
                  <Icon className="size-4 relative z-10" />
                  <span className="relative z-10">{n.label}</span>
                </Link>
              );
            })}
          </nav>

          {/* Right-side controls */}
          <div className="ml-auto flex items-center gap-1.5">
            <button
              onClick={() => setPaletteOpen(true)}
              className="flex items-center gap-2 h-8 px-2.5 rounded-lg border border-glass-border text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
              aria-label="Open command palette"
            >
              <CommandIcon className="size-3.5" />
              {modKey && (
                <kbd className="hidden md:inline text-[10px] tracking-widest tnum">{modKey} K</kbd>
              )}
            </button>

            <button
              onClick={toggleStealthMode}
              className={cn(
                "size-8 grid place-items-center rounded-lg border transition-colors",
                isStealthMode
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-glass-border text-muted-foreground hover:text-foreground hover:bg-white/5",
              )}
              aria-label={isStealthMode ? "Disable stealth privacy mode" : "Enable stealth privacy mode"}
              title={`Stealth privacy mode (${modKey ?? "Ctrl"}+Shift+P)`}
            >
              {isStealthMode ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>

            <NotificationsBell />

            <UserMenu initial={initial} name={user?.name} email={user?.email} onSignOut={signOut} />
          </div>
        </div>
      </header>

      {/* ── Content ───────────────────────────────────────────────────────── */}
      <main className="flex-1 w-full max-w-6xl mx-auto px-4 md:px-8 py-6 md:py-8 pb-28 md:pb-10">
        <Outlet />
      </main>

      {/* ── Mobile bottom tab bar (same 4 hubs) ───────────────────────────── */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 glass-strong border-t border-glass-border safe-bottom">
        <div className="grid grid-cols-4">
          {NAV.map((n) => {
            const active = path.startsWith(n.to);
            const Icon = n.icon;
            return (
              <Link
                key={n.to}
                to={n.to}
                className={cn(
                  "relative flex flex-col items-center justify-center gap-1 py-2.5 text-[11px] transition-colors",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {active && (
                  <motion.span
                    // Distinct from the desktop rail's layoutId: both navs stay
                    // mounted (CSS-hidden), and framer-motion can't share one
                    // layoutId between two simultaneously-mounted elements.
                    layoutId="active-tab-indicator-mobile"
                    transition={TAB_SPRING}
                    className="absolute top-1 h-0.5 w-8 rounded-full gradient-primary"
                  />
                )}
                <Icon className="size-4" />
                {n.label}
              </Link>
            );
          })}
        </div>
      </nav>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}

// ─── Quick notifications: unsettled dues derived from the store ─────────────
function NotificationsBell() {
  const { pendingChecklist, blueprintSettings, creditCardDues } = useStore();

  const notifications = useMemo(() => {
    const list: { key: string; label: string; amount: number }[] = [];
    if (blueprintSettings.fixedRunrate > 0 && !pendingChecklist.fixedRunrate) {
      list.push({ key: "fixedRunrate", label: "Rent / fixed runrate due", amount: blueprintSettings.fixedRunrate });
    }
    if (blueprintSettings.scooterEmi > 0 && !pendingChecklist.scooterEmi) {
      list.push({ key: "scooterEmi", label: "Loan / EMI due", amount: blueprintSettings.scooterEmi });
    }
    if (blueprintSettings.growwMfSip > 0 && !pendingChecklist.growwMfSip) {
      list.push({ key: "growwMfSip", label: "Investment SIP due", amount: blueprintSettings.growwMfSip });
    }
    if (creditCardDues > 0 && !pendingChecklist.ccSettled) {
      list.push({ key: "ccSettled", label: "Credit card outstanding", amount: creditCardDues });
    }
    return list;
  }, [pendingChecklist, blueprintSettings, creditCardDues]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="relative size-8 grid place-items-center rounded-lg border border-glass-border text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
          aria-label="Notifications"
        >
          <Bell className="size-4" />
          {notifications.length > 0 && (
            <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-primary glow" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 glass-strong border-glass-border">
        <DropdownMenuLabel className="text-xs uppercase tracking-wider text-muted-foreground">
          This month
        </DropdownMenuLabel>
        {notifications.length === 0 ? (
          <p className="px-2 py-4 text-sm text-muted-foreground text-center">
            All clear — nothing due.
          </p>
        ) : (
          notifications.map((n) => (
            <DropdownMenuItem key={n.key} asChild>
              <Link
                to="/cashflow"
                search={{ tab: "obligations" }}
                className="flex items-center justify-between gap-3 cursor-pointer"
              >
                <span className="text-sm">{n.label}</span>
                <Sensitive>
                  <span className="text-sm font-medium tnum">{inr(n.amount)}</span>
                </Sensitive>
              </Link>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─── Avatar dropdown: profile & settings live here, not in the tab rail ─────
function UserMenu({
  initial,
  name,
  email,
  onSignOut,
}: {
  initial: string;
  name?: string;
  email?: string;
  onSignOut: () => Promise<void> | void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="size-8 rounded-lg gradient-primary grid place-items-center text-sm font-bold text-primary-foreground hover:opacity-90 transition-opacity"
          aria-label="Account menu"
        >
          {initial}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 glass-strong border-glass-border">
        <DropdownMenuLabel>
          <p className="text-sm font-medium truncate">{name ?? "Account"}</p>
          <p className="text-xs text-muted-foreground font-normal truncate">{email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/profile" className="flex items-center gap-2 cursor-pointer">
            <User className="size-4" /> Profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/settings" className="flex items-center gap-2 cursor-pointer">
            <Settings className="size-4" /> Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => void onSignOut()}
          className="flex items-center gap-2 cursor-pointer text-muted-foreground focus:text-foreground"
        >
          <LogOut className="size-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
