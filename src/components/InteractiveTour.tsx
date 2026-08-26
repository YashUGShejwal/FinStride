import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type TourStep = {
  id: string;
  route: string;
  headline: string;
  description: string;
};

const TOUR_STEPS: TourStep[] = [
  {
    id: "networth-hero",
    route: "/dashboard",
    headline: "Your Financial Snapshot",
    description: "Salary baseline, operational runway, and active commitments — everything else in FinStride rolls up from here.",
  },
  {
    id: "cashflow-summary",
    route: "/cashflow",
    headline: "Cash Flow, Totaled",
    description: "Running income, expenses, and net flow — every logged transaction rolls up here in real time.",
  },
  {
    id: "pnl-heatmap",
    route: "/swing",
    headline: "Trading Activity Heatmap",
    description: "A 26-week calendar of realized P&L, day by day — spot hot streaks and cold spells at a glance.",
  },
  {
    id: "wealth-controls",
    route: "/wealth",
    headline: "Model Your Compounding",
    description: "Switch return scenarios, tune your SIP and step-up, and toggle inflation-adjusted figures — the trajectory curve below reacts live.",
  },
  {
    id: "add-milestone-btn",
    route: "/wealth",
    headline: "Set a Real Goal",
    description: "From a ₹1 Cr net worth to a car down payment — add a milestone and FinStride tells you when you'll get there, guilt-free.",
  },
];

const SPOTLIGHT_PAD = 10;
const TOOLTIP_GAP = 16;
const TOOLTIP_W = 340;
const TOOLTIP_H_ESTIMATE = 240;
const MAX_LOCATE_ATTEMPTS = 40; // ~4s at 100ms/attempt — covers a route change + data load

type Placement = "top" | "bottom" | "left" | "right";
type LocatePhase = "searching" | "found" | "not-found";

function getPlacement(rect: DOMRect): Placement {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const spaceBottom = vh - rect.bottom;
  const spaceTop = rect.top;
  const spaceRight = vw - rect.right;
  const spaceLeft = rect.left;
  if (spaceBottom >= TOOLTIP_H_ESTIMATE + TOOLTIP_GAP) return "bottom";
  if (spaceTop >= TOOLTIP_H_ESTIMATE + TOOLTIP_GAP) return "top";
  if (spaceRight >= TOOLTIP_W + TOOLTIP_GAP) return "right";
  if (spaceLeft >= TOOLTIP_W + TOOLTIP_GAP) return "left";
  // Nothing has enough room (small viewport) — fall back to whichever
  // vertical side has more of it; the width clamp below keeps it on-screen.
  return spaceBottom >= spaceTop ? "bottom" : "top";
}

function getTooltipStyle(rect: DOMRect, placement: Placement): React.CSSProperties {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // Upper bound can't go below the lower bound on a viewport narrower than
  // the tooltip itself — without this a very small screen clamps to a
  // negative range and the card flies off-screen instead of just filling it.
  const clampLeft = (l: number) => Math.min(Math.max(l, 12), Math.max(12, vw - TOOLTIP_W - 12));
  const clampTop = (t: number) => Math.min(Math.max(t, 12), Math.max(12, vh - TOOLTIP_H_ESTIMATE - 12));

  switch (placement) {
    case "bottom":
      return { top: rect.bottom + TOOLTIP_GAP, left: clampLeft(rect.left + rect.width / 2 - TOOLTIP_W / 2) };
    case "top":
      return { bottom: vh - rect.top + TOOLTIP_GAP, left: clampLeft(rect.left + rect.width / 2 - TOOLTIP_W / 2) };
    case "right":
      return { left: rect.right + TOOLTIP_GAP, top: clampTop(rect.top + rect.height / 2 - TOOLTIP_H_ESTIMATE / 2) };
    case "left":
      return { right: vw - rect.left + TOOLTIP_GAP, top: clampTop(rect.top + rect.height / 2 - TOOLTIP_H_ESTIMATE / 2) };
  }
}

/**
 * In-situ spotlight tour — replaces the old static AppTourModal. Highlights
 * real `data-tour="<id>"` elements across routes instead of describing them
 * in a self-contained dialog.
 *
 * Spotlight is 4 solid backdrop bands (top/bottom/left/right of the target
 * rect) rather than an SVG/clip-path mask: simpler to reason about, and the
 * "hole" between them is a real gap in the DOM — nothing needs a manual
 * pointer-events carve-out for the highlighted element to stay clickable.
 * The thin glow/ring overlay drawn in that gap IS pointer-events-none so it
 * doesn't reintroduce the block it's visually sitting inside of.
 */
export function InteractiveTour({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { setHasCompletedTour, loadDemoData } = useStore();
  const nav = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [stepIndex, setStepIndex] = useState(0);
  const [phase, setPhase] = useState<LocatePhase>("searching");
  const [rect, setRect] = useState<DOMRect | null>(null);

  const step = TOUR_STEPS[stepIndex];
  const isLast = stepIndex === TOUR_STEPS.length - 1;

  // Fresh account, first real content, zero setup required — the tour is
  // useless pointed at an empty dashboard, so activating sandbox mode is
  // part of opening the tour, not a separate step. No-ops if already active.
  useEffect(() => {
    if (open) loadDemoData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (open) setStepIndex(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (path !== step.route) void nav({ to: step.route });
  }, [open, step.route, path, nav]);

  // Locate the current step's target: poll until it mounts (a route change
  // or the demo data landing can both delay this by a render or two), then
  // scroll it into view exactly once. Gives up after MAX_LOCATE_ATTEMPTS
  // rather than leaving the tour permanently stuck on a target that never
  // appears (e.g. an unusually small viewport hiding the element).
  useEffect(() => {
    if (!open || path !== step.route) {
      setPhase("searching");
      setRect(null);
      return;
    }

    let cancelled = false;
    let timeoutId: number;
    setPhase("searching");
    setRect(null);

    const tryFind = (attemptsLeft: number) => {
      if (cancelled) return;
      const el = document.querySelector(`[data-tour="${step.id}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        setRect(el.getBoundingClientRect());
        setPhase("found");
        return;
      }
      if (attemptsLeft <= 0) {
        setPhase("not-found");
        return;
      }
      timeoutId = window.setTimeout(() => tryFind(attemptsLeft - 1), 100);
    };
    tryFind(MAX_LOCATE_ATTEMPTS);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [open, stepIndex, path, step.id, step.route]);

  // Keep the cutout glued to the target continuously — scroll/resize alone
  // miss the layout shift the sandbox banner's own mount causes (it's a
  // content reflow, not a scroll or resize event), which left an early
  // version of this pinned to a stale pre-banner rect ~40px off. Deliberately
  // setInterval, not requestAnimationFrame: rAF is throttled to zero in a
  // backgrounded/non-composited tab, which would silently freeze tracking
  // there — setInterval keeps firing (browsers only throttle its rate, never
  // pause it outright), and nothing here needs 60fps smoothness since the
  // box snaps rather than transitions. The equality check still avoids a
  // re-render on ticks where nothing actually moved.
  useEffect(() => {
    if (!open || phase !== "found") return;
    const id = window.setInterval(() => {
      const el = document.querySelector(`[data-tour="${step.id}"]`);
      if (!el) return;
      const r = el.getBoundingClientRect();
      setRect((prev) =>
        prev && prev.top === r.top && prev.left === r.left && prev.width === r.width && prev.height === r.height
          ? prev
          : r,
      );
    }, 100);
    return () => window.clearInterval(id);
  }, [open, phase, step.id]);

  const finish = useCallback(() => {
    setHasCompletedTour(true);
    onOpenChange(false);
  }, [setHasCompletedTour, onOpenChange]);

  const goNext = useCallback(() => {
    setStepIndex((i) => (i >= TOUR_STEPS.length - 1 ? i : i + 1));
  }, []);

  const goPrev = useCallback(() => {
    setStepIndex((i) => Math.max(0, i - 1));
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") {
        e.preventDefault();
        if (isLast) finish();
        else goNext();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "Escape") {
        e.preventDefault();
        finish();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, isLast, goNext, goPrev, finish]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] pointer-events-none"
      role="dialog"
      aria-modal="true"
      aria-label="Product tour"
      data-state="open"
    >
      {phase === "found" && rect ? (
        <SpotlightMask rect={rect} />
      ) : (
        <div className="fixed inset-0 bg-black/[0.78] pointer-events-auto transition-opacity duration-200" />
      )}
      {phase !== "searching" && (
        <TooltipCard
          rect={phase === "found" ? rect : null}
          step={step}
          index={stepIndex}
          isLast={isLast}
          onNext={goNext}
          onPrev={goPrev}
          onFinish={finish}
        />
      )}
    </div>
  );
}

function SpotlightMask({ rect }: { rect: DOMRect }) {
  const top = Math.max(0, rect.top - SPOTLIGHT_PAD);
  const left = Math.max(0, rect.left - SPOTLIGHT_PAD);
  const right = rect.right + SPOTLIGHT_PAD;
  const bottom = rect.bottom + SPOTLIGHT_PAD;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // No CSS transition on top/left/width/height here: these are recomputed
  // every animation frame (see the rAF tracking effect above) to stay glued
  // to a target that can still be settling — a sandbox banner mounting, a
  // scrollIntoView still animating. A transition on the same properties a
  // rAF loop is also driving fights itself: the box is always easing toward
  // a value that's already stale, so it never actually lands on the target
  // (an earlier version of this measured ~40-50px of permanent lag). Snap
  // instantly instead — always pixel-accurate beats a smoother chase.
  const band = "fixed bg-black/[0.78] pointer-events-auto";

  return (
    <>
      <div className={band} style={{ top: 0, left: 0, width: vw, height: top }} />
      <div className={band} style={{ top: bottom, left: 0, width: vw, height: Math.max(0, vh - bottom) }} />
      <div className={band} style={{ top, left: 0, width: left, height: Math.max(0, bottom - top) }} />
      <div className={band} style={{ top, left: right, width: Math.max(0, vw - right), height: Math.max(0, bottom - top) }} />
      <div
        className="fixed rounded-2xl ring-2 ring-emerald-400 ring-offset-4 ring-offset-black/80 pointer-events-none animate-pulse"
        style={{ top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }}
      />
    </>
  );
}

function TooltipCard({
  rect,
  step,
  index,
  isLast,
  onNext,
  onPrev,
  onFinish,
}: {
  rect: DOMRect | null;
  step: TourStep;
  index: number;
  isLast: boolean;
  onNext: () => void;
  onPrev: () => void;
  onFinish: () => void;
}) {
  const placement = useMemo(() => (rect ? getPlacement(rect) : "bottom"), [rect]);
  const style = useMemo<React.CSSProperties>(
    () => (rect ? { width: TOOLTIP_W, ...getTooltipStyle(rect, placement) } : { width: TOOLTIP_W }),
    [rect, placement],
  );

  return (
    <div
      className={cn(
        "fixed z-[101] pointer-events-auto rounded-2xl border border-white/15 bg-[#0a0f1d]/95 backdrop-blur-xl shadow-2xl p-5",
        !rect && "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2",
      )}
      style={style}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] uppercase tracking-wider font-semibold text-primary">
          Step {index + 1} of {TOUR_STEPS.length}
        </span>
        <button onClick={onFinish} aria-label="Exit tour" className="text-muted-foreground hover:text-foreground">
          <X className="size-4" />
        </button>
      </div>
      <h3 className="font-display font-semibold tracking-tight text-lg text-white">{step.headline}</h3>
      <p className="text-sm text-white/70 mt-1.5">{step.description}</p>
      <div className="flex items-center justify-between gap-2 mt-5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onPrev}
          disabled={index === 0}
          className="gap-1 text-muted-foreground"
        >
          <ChevronLeft className="size-3.5" /> Previous
        </Button>
        <div className="flex items-center gap-3">
          {!isLast && (
            <button
              type="button"
              onClick={onFinish}
              className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
            >
              End tour
            </button>
          )}
          {isLast ? (
            <Button
              type="button"
              size="sm"
              onClick={onFinish}
              className="gradient-primary text-primary-foreground border-0"
            >
              End Tour &amp; Keep Sandbox
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              onClick={onNext}
              className="gap-1 gradient-primary text-primary-foreground border-0"
            >
              Next Hub <ChevronRight className="size-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
