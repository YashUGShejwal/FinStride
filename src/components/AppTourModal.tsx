import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check, ChevronLeft, ChevronRight, LayoutDashboard, PieChart, Rocket,
  Sparkles, TrendingUp, Wallet, X,
} from "lucide-react";
import { toast } from "sonner";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const TOUR_STEPS = [
  {
    icon: LayoutDashboard,
    title: "Dashboard",
    tagline: "Your command center — everything else in FinStride rolls up here.",
    highlights: [
      "Net worth and monthly cash flow at a glance",
      "Pending obligations and dues, surfaced automatically",
      "One-tap shortcuts to log a transaction, trade, or snapshot",
    ],
  },
  {
    icon: Wallet,
    title: "Cash Flow",
    tagline: "Every rupee in, every rupee out — organized by account and category.",
    highlights: [
      "Log income and expenses across banks, cards, and UPI",
      "Track fixed obligations like rent and EMIs each month",
      "See spending broken down by category over time",
    ],
  },
  {
    icon: TrendingUp,
    title: "Swing Desk",
    tagline: "Your trading journal — equity and F&O, entry to exit.",
    highlights: [
      "Log trades with targets, stop-losses, and exit reasons",
      "A full P&L heatmap of your trading performance",
      "Optional F&O tracking for options and futures",
    ],
  },
  {
    icon: PieChart,
    title: "Portfolio",
    tagline: "Every broker and partition, rolled into one total.",
    highlights: [
      "Snapshot your holdings across long-term, MF, and cash",
      "Watch your total portfolio value grow over time",
      "Compare performance across every broker partition",
    ],
  },
  {
    icon: Rocket,
    title: "Wealth",
    tagline: "Project decades ahead, and set real milestones to hit.",
    highlights: [
      "Compound your SIP forward with an interactive projection curve",
      "Set milestones — a home down payment, ₹1 Cr net worth, anything",
      "See exactly when you'll get there, adjusted for inflation",
    ],
  },
] as const;

/**
 * Controlled — unlike OnboardingWizard's self-contained visibility, this
 * needs to be openable on demand from the header "(?) Tour" button and the
 * command palette, so the parent (WorkstationShell) owns `open` and the
 * auto-trigger-on-first-login condition; this component only owns what
 * happens once it's open.
 */
export function AppTourModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { setHasCompletedTour, loadDemoData, isSandboxMode } = useStore();
  const [step, setStep] = useState(0);

  // Any dismissal path — Skip, Escape, backdrop click, or the final "Get
  // Started" — marks the tour complete. Mirrors OnboardingWizard's dismiss():
  // re-showing an unwanted tour on every reload is worse than a user who
  // closed it by accident having to reopen it via the always-available
  // header button.
  const finish = () => {
    setHasCompletedTour(true);
    onOpenChange(false);
    setStep(0);
  };

  const goNext = () => {
    if (step === TOUR_STEPS.length - 1) finish();
    else setStep((s) => s + 1);
  };
  const goPrev = () => setStep((s) => Math.max(0, s - 1));

  // Arrow-key navigation while open. Escape-to-close is already handled by
  // Dialog's own onOpenChange below. Read the current step through a ref so
  // this listener attaches exactly once instead of re-subscribing on every
  // step change.
  const stepRef = useRef(step);
  stepRef.current = step;
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") {
        e.preventDefault();
        if (stepRef.current === TOUR_STEPS.length - 1) finish();
        else setStep((s) => s + 1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setStep((s) => Math.max(0, s - 1));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleLoadDemo = () => {
    loadDemoData();
    toast.success("Demo data loaded — explore every hub with realistic numbers.");
  };

  const current = TOUR_STEPS[step];
  const Icon = current.icon;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) finish(); }}>
      <DialogContent className="glass-strong border-glass-border max-w-xl p-0 overflow-hidden [&>button]:hidden">
        <DialogTitle className="sr-only">Take the FinStride tour</DialogTitle>
        <DialogDescription className="sr-only">
          A quick walkthrough of the 5 hubs FinStride tracks — Dashboard, Cash Flow, Swing Desk, Portfolio, and Wealth.
        </DialogDescription>

        <div className="flex items-center justify-between px-6 pt-6">
          <div className="flex items-center gap-2">
            {TOUR_STEPS.map((s, i) => (
              <div key={s.title} className="flex items-center gap-2">
                <div
                  className={cn(
                    "size-7 rounded-full grid place-items-center text-xs font-semibold transition-colors",
                    i === step
                      ? "gradient-primary text-primary-foreground glow"
                      : i < step
                        ? "bg-[oklch(0.72_0.18_155/0.2)] text-[oklch(0.82_0.16_155)]"
                        : "bg-white/5 text-muted-foreground",
                  )}
                >
                  {i < step ? <Check className="size-3.5" /> : i + 1}
                </div>
                {i < TOUR_STEPS.length - 1 && (
                  <div className={cn("h-px w-4", i < step ? "bg-[oklch(0.72_0.18_155/0.4)]" : "bg-white/10")} />
                )}
              </div>
            ))}
          </div>
          <button
            onClick={finish}
            aria-label="Skip tour"
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="px-6 py-6 min-h-[320px] max-h-[60vh] overflow-y-auto">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
              className="flex flex-col items-center text-center"
            >
              <div className="size-14 rounded-2xl gradient-primary glow grid place-items-center mb-4">
                <Icon className="size-7 text-primary-foreground" />
              </div>
              <h3 className="font-display font-semibold tracking-tight text-xl">{current.title}</h3>
              <p className="text-sm text-muted-foreground mt-1.5 max-w-sm">{current.tagline}</p>
              <ul className="mt-5 space-y-2.5 text-left w-full max-w-sm">
                {current.highlights.map((h) => (
                  <li key={h} className="flex items-start gap-2.5 text-sm text-foreground/85">
                    <Check className="size-4 text-primary shrink-0 mt-0.5" />
                    {h}
                  </li>
                ))}
              </ul>
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-glass-border bg-white/[0.02]">
          <Button
            type="button"
            variant="ghost"
            onClick={handleLoadDemo}
            disabled={isSandboxMode}
            className="gap-1.5 text-muted-foreground"
          >
            <Sparkles className="size-4" />
            {isSandboxMode ? "Demo Loaded" : "Load Demo Sandbox"}
          </Button>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <Button type="button" variant="secondary" onClick={goPrev} className="gap-1.5">
                <ChevronLeft className="size-4" /> Previous
              </Button>
            )}
            {step < TOUR_STEPS.length - 1 ? (
              <Button
                type="button"
                onClick={goNext}
                className="gap-1.5 gradient-primary text-primary-foreground border-0"
              >
                Next <ChevronRight className="size-4" />
              </Button>
            ) : (
              <Button
                type="button"
                onClick={finish}
                className="gap-1.5 gradient-primary text-primary-foreground border-0"
              >
                Get Started <Check className="size-4" />
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
