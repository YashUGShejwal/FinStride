import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Zap } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Collapsible "⚡ Quick Log" drawer for entry forms. Collapsed by default at
 * call sites so the page leads with the live ledger/feed; expanding animates
 * height smoothly. Controlled, because some triggers live outside the drawer
 * (e.g. cashflow's preset chips auto-expand it).
 */
export function QuickLogDrawer({
  label,
  open,
  onToggle,
  children,
  className,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("glass-strong rounded-2xl overflow-hidden", className)}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-5 md:px-6 py-4 hover:bg-white/5 transition-colors"
      >
        <span className="font-display font-semibold tracking-tight flex items-center gap-2">
          <Zap className="size-4 text-primary" /> {label}
        </span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronDown className="size-4 text-muted-foreground" />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="px-5 md:px-6 pb-5 md:pb-6">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
