import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard, Wallet, TrendingUp, PieChart, Rocket, Settings, User,
  Plus, Camera, Download, Eye, EyeOff, HelpCircle, Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { useStore } from "@/lib/store";
import { useModKeyLabel } from "@/lib/platform";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput,
  CommandItem, CommandList, CommandSeparator, CommandShortcut,
} from "@/components/ui/command";

/**
 * Global Cmd+K command palette. The authenticated layout owns the open state
 * and the keyboard bindings (Cmd+K here, Cmd+Shift+P for stealth) so the
 * palette itself stays a pure controlled dialog.
 */
export function CommandPalette({
  open,
  onOpenChange,
  onOpenTour,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Opens InteractiveTour — owned by the authenticated layout, same as onOpenChange. */
  onOpenTour: () => void;
}) {
  const nav = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const {
    exportData, isStealthMode, toggleStealthMode,
    isSandboxMode, loadDemoData, exitSandboxMode,
  } = useStore();
  const modKey = useModKeyLabel();

  // Close first so the palette never lingers over the destination view.
  const run = (action: () => void) => {
    onOpenChange(false);
    action();
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Type a command or search…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Navigate">
          <CommandItem onSelect={() => run(() => nav({ to: "/dashboard" }))}>
            <LayoutDashboard /> Dashboard
          </CommandItem>
          <CommandItem onSelect={() => run(() => nav({ to: "/cashflow" }))}>
            <Wallet /> Cash Flow
          </CommandItem>
          <CommandItem onSelect={() => run(() => nav({ to: "/swing" }))}>
            <TrendingUp /> Swing Desk
          </CommandItem>
          <CommandItem onSelect={() => run(() => nav({ to: "/analytics" }))}>
            <PieChart /> Portfolio
          </CommandItem>
          <CommandItem onSelect={() => run(() => nav({ to: "/wealth" }))}>
            <Rocket /> Wealth
          </CommandItem>
          <CommandItem onSelect={() => run(() => nav({ to: "/settings" }))}>
            <Settings /> Settings
          </CommandItem>
          <CommandItem onSelect={() => run(() => nav({ to: "/profile" }))}>
            <User /> Profile
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Quick Actions">
          <CommandItem
            onSelect={() =>
              run(() =>
                nav({
                  to: "/cashflow",
                  search: { tab: "ledger", action: "add" },
                  // Replace-in-place when already on the page: the action
                  // param self-clears via replace, and push-then-replace
                  // would leave a duplicate history entry (same fix as the
                  // analytics add-snapshot deep link).
                  replace: path.startsWith("/cashflow"),
                }),
              )
            }
          >
            <Plus /> Add Transaction
          </CommandItem>
          <CommandItem
            onSelect={() =>
              run(() =>
                nav({
                  to: "/swing",
                  search: { action: "add" },
                  replace: path.startsWith("/swing"),
                }),
              )
            }
          >
            <TrendingUp /> New Swing Trade
          </CommandItem>
          <CommandItem
            onSelect={() =>
              run(() =>
                nav({
                  to: "/analytics",
                  search: { action: "add-snapshot" },
                  // When already on /analytics, a push followed by the page's
                  // param-clearing replace would leave two identical history
                  // entries and make the first Back press a no-op — replace
                  // in place instead.
                  replace: path.startsWith("/analytics"),
                }),
              )
            }
          >
            <Camera /> Add Portfolio Snapshot
          </CommandItem>
          <CommandItem
            onSelect={() =>
              run(() => {
                if (exportData()) toast.success("Backup downloaded");
                else toast.error("Couldn't create the backup file");
              })
            }
          >
            <Download /> Export Data (JSON)
          </CommandItem>
          <CommandItem onSelect={() => run(onOpenTour)}>
            <HelpCircle /> Take Product Tour
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Toggles">
          <CommandItem onSelect={() => run(toggleStealthMode)}>
            {isStealthMode ? <Eye /> : <EyeOff />}
            {isStealthMode ? "Disable Stealth Privacy Mode" : "Enable Stealth Privacy Mode"}
            {modKey && <CommandShortcut>{modKey}+Shift+P</CommandShortcut>}
          </CommandItem>
          <CommandItem onSelect={() => run(isSandboxMode ? exitSandboxMode : loadDemoData)}>
            <Sparkles />
            {isSandboxMode ? "Exit Demo Sandbox Mode" : "Enter Demo Sandbox Mode"}
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
