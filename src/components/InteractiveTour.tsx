import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * Every step follows Problem → Insight → Action: `title` + `problem` form the
 * card's dilemma headline, `insight` is the financial rule behind that hub, and
 * `action` is one concrete thing to do with the highlighted element.
 */
type TourStep = {
  id: string;
  route: string;
  /** Hub badge next to the step counter, e.g. "Step 4 of 5 • Wealth Hub". */
  hub: string;
  title: string;
  problem: string;
  insight: string;
  action: string;
};

const TOUR_STEPS: TourStep[] = [
  {
    id: "networth-hero",
    route: "/dashboard",
    hub: "Dashboard",
    title: "The Big Picture: Consolidated Net Position",
    problem: "What is my true financial net position across all institutions?",
    insight:
      "Consolidates liquid cash, stocks, mutual funds, and fixed deposits across all your brokers and bank accounts, minus obligations.",
    action: "Check your Liquid Cash runway to see how many months of expenses your reserves cover.",
  },
  {
    id: "cashflow-summary",
    route: "/cashflow",
    hub: "Cash Flow",
    title: "Guilt-Free Spending: The 50/30/20 Engine",
    problem: "How much can I spend this month without feeling anxious?",
    insight:
      "When fixed needs and SIP investments are funded upfront, your remaining wants allocation is safe to spend with zero guilt.",
    action: "Review your Monthly Inflow vs. Fixed Obligations split.",
  },
  {
    id: "pnl-heatmap",
    route: "/swing",
    hub: "Swing Desk",
    title: "Execution Discipline: True Net P&L",
    problem: "Am I actually profitable after broker charges and taxes?",
    insight:
      "Trades are tracked via 4-pass FIFO with STT, exchange turnover fees, SEBI charges, and GST accounted for.",
    action: "Glance at your 26-week calendar to spot consistency streaks.",
  },
  {
    id: "wealth-controls",
    route: "/wealth",
    hub: "Wealth Hub",
    title: "The Inflation Reality Check: Real vs. Nominal",
    problem: "Will my ₹1 Crore corpus in 15 years actually buy what I expect?",
    insight:
      "At 6% inflation, purchasing power halves every 12 years. 12% CAGR beats inflation, but ₹5 Cr nominal is ~₹2.2 Cr in today's purchasing power.",
    action: "Toggle the 'Headline in real terms' switch to see the purchasing power curve.",
  },
  {
    id: "add-milestone-btn",
    route: "/wealth",
    hub: "Wealth Hub",
    title: "Smart Upgrades & Loans: The Safety Multiplier",
    problem: "Can I safely afford a ₹5L car down payment or a ₹2L tech upgrade?",
    insight:
      "The affordability multiplier protects your compounding curve by requiring a 2× to 10× net worth buffer before liquidating cash.",
    action: "Click '+ Add Milestone' to configure a financed Down Payment or Major Want goal.",
  },
];

const SPOTLIGHT_PAD = 10;
// ring-2 + ring-offset-4, drawn outside the padded cutout (see SpotlightMask).
const SPOTLIGHT_RING = 6;
// Clears the glow ring with 8px to spare — flush against it looked cramped.
const TOOLTIP_GAP = SPOTLIGHT_PAD + SPOTLIGHT_RING + 8;
const TOOLTIP_W = 400;
// Alignment guess only — the card measures its own rendered height (see
// TooltipCard) because its copy varies a lot per step and per screen width.
const TOOLTIP_H_ESTIMATE = 390;
const VIEWPORT_MARGIN = 12;
// Sticky app header (56) + sandbox banner (40) + a little air: anything
// scrolled up beneath this is hidden behind the app's own chrome.
const SCROLL_TOP_INSET = 112;
// The fixed bottom tab bar (shown below the `md` breakpoint) hides whatever
// page content is scrolled beneath it.
const MOBILE_TAB_BAR_H = 64;
const MOBILE_BREAKPOINT = 768;
const MAX_LOCATE_ATTEMPTS = 40; // ~4s at 100ms/attempt — covers a route change + data load
const SANDBOX_SETTLE_ATTEMPTS = 5; // ~0.5s max wait for the sandbox banner's reflow before aligning

type LocatePhase = "searching" | "found" | "not-found";
type Box = { top: number; left: number; width: number; height: number };

function overlapArea(a: Box, b: Box): number {
  const w = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
  const h = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Where the card goes relative to the highlighted rect. Tries bottom → top →
 * right → left and takes the first side where the card clears the highlight
 * entirely. When no side does (a tall target on a short viewport, or any
 * phone — the card is ~400px tall) it settles for the side that covers the
 * least of the highlight instead. Every candidate is clamped inside the
 * viewport, so the card and its Next button can never be pushed off-screen.
 */
function getTooltipPosition(
  rect: DOMRect,
  cardW: number,
  cardH: number,
  vw: number,
  vh: number,
): { top: number; left: number } {
  // Upper bound can't go below the lower bound on a viewport smaller than the
  // card — without the inner Math.max a tiny screen clamps to a negative
  // range and the card flies off-screen instead of just filling it.
  const clampLeft = (l: number) =>
    Math.min(Math.max(l, VIEWPORT_MARGIN), Math.max(VIEWPORT_MARGIN, vw - cardW - VIEWPORT_MARGIN));
  const clampTop = (t: number) =>
    Math.min(Math.max(t, VIEWPORT_MARGIN), Math.max(VIEWPORT_MARGIN, vh - cardH - VIEWPORT_MARGIN));
  const centeredLeft = rect.left + rect.width / 2 - cardW / 2;
  const centeredTop = rect.top + rect.height / 2 - cardH / 2;

  // Preference order: bottom, top, right, left.
  const candidates = [
    { top: clampTop(rect.bottom + TOOLTIP_GAP), left: clampLeft(centeredLeft) },
    { top: clampTop(rect.top - TOOLTIP_GAP - cardH), left: clampLeft(centeredLeft) },
    { top: clampTop(centeredTop), left: clampLeft(rect.right + TOOLTIP_GAP) },
    { top: clampTop(centeredTop), left: clampLeft(rect.left - TOOLTIP_GAP - cardW) },
  ];
  // What the card has to stay clear of: the cutout plus its visible glow.
  const glow = SPOTLIGHT_PAD + SPOTLIGHT_RING;
  const highlight: Box = {
    top: rect.top - glow,
    left: rect.left - glow,
    width: rect.width + glow * 2,
    height: rect.height + glow * 2,
  };

  let best = candidates[0];
  let bestOverlap = Infinity;
  for (const c of candidates) {
    const overlap = overlapArea({ ...c, width: cardW, height: cardH }, highlight);
    // Must beat the leader by a real margin, so a dead heat (e.g. a target
    // centered in the viewport) keeps the earlier, preferred side rather than
    // flipping on float noise.
    if (overlap < bestOverlap - 1) {
      best = c;
      bestOverlap = overlap;
    }
    if (overlap === 0) break;
  }
  return best;
}

/**
 * Brings the target into view with room left for the card. Plain
 * `block: "center"` was enough for the old ~240px card; the current one is
 * ~400px, so on a 768px-tall screen a centered target leaves neither side big
 * enough and the card lands on top of the highlight. Instead, park the
 * target + card pair where it fits:
 *   1. card below the target (preferred) — the target has to clear the sticky
 *      header/banner, so it's centered in what's left underneath them;
 *   2. card above the target — the card can sit over the dimmed header, so the
 *      target goes flush toward the bottom and the pair gets ~100px more room;
 *   3. neither fits — hug the top, so the card docks at the bottom of the
 *      screen and covers as little of the target as this screen allows
 *      (centering it would put the card straight across the middle of it).
 * A shortfall up to one gap only makes the card graze the glow ring, never
 * the target itself, so that much is tolerated. Each arrangement also has to
 * be reachable: a target near the top of its page can't be scrolled *down*
 * the screen to make room above it.
 */
function scrollTargetIntoView(el: Element) {
  const rect = el.getBoundingClientRect();
  const vh = window.innerHeight;
  const pair = rect.height + SPOTLIGHT_PAD + TOOLTIP_GAP + TOOLTIP_H_ESTIMATE;
  const maxScroll = document.documentElement.scrollHeight - vh;
  const reachable = (top: number) => {
    const delta = rect.top - top;
    return delta >= -window.scrollY && delta <= maxScroll - window.scrollY;
  };
  const scrollTopTo = (top: number) => window.scrollBy({ top: rect.top - top, behavior: "smooth" });

  const roomBelow = vh - SCROLL_TOP_INSET - VIEWPORT_MARGIN;
  const belowTop = SCROLL_TOP_INSET + Math.max(0, roomBelow - pair) / 2;
  if (pair <= roomBelow + TOOLTIP_GAP && reachable(belowTop)) {
    scrollTopTo(belowTop);
    return;
  }

  const bottomChrome = window.innerWidth < MOBILE_BREAKPOINT ? MOBILE_TAB_BAR_H : 0;
  const roomAbove = vh - bottomChrome - VIEWPORT_MARGIN * 2;
  const aboveTop = vh - bottomChrome - VIEWPORT_MARGIN - SPOTLIGHT_PAD - rect.height;
  if (pair <= roomAbove + TOOLTIP_GAP && reachable(aboveTop)) {
    scrollTopTo(aboveTop);
    return;
  }

  scrollTopTo(SCROLL_TOP_INSET);
}

function useViewportSize() {
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return size;
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
  const { setHasCompletedTour, loadDemoData, isSandboxMode } = useStore();
  const nav = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [stepIndex, setStepIndex] = useState(0);
  const [phase, setPhase] = useState<LocatePhase>("searching");
  const [rect, setRect] = useState<DOMRect | null>(null);

  // Read by the locate poll below without making it a dependency — flipping
  // it must not restart a locate that's already under way.
  const sandboxActiveRef = useRef(isSandboxMode);
  sandboxActiveRef.current = isSandboxMode;

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
      // The sandbox banner reflows the whole page by 40px when it mounts, and
      // the target can already exist before it does — scrolling then would
      // align to a position that's stale a frame later. Give it a few polls
      // to land, then go ahead regardless so a sandbox that never activates
      // can't stall the tour.
      const layoutSettled =
        sandboxActiveRef.current || attemptsLeft <= MAX_LOCATE_ATTEMPTS - SANDBOX_SETTLE_ATTEMPTS;
      if (el && layoutSettled) {
        scrollTargetIntoView(el);
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
          // Keyed by step: consecutive steps on the same route batch their
          // searching→found updates into one render, so without this the card
          // would never remount and carry the previous step's measured height.
          key={step.id}
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
  const vp = useViewportSize();
  const cardRef = useRef<HTMLDivElement>(null);
  const [measuredH, setMeasuredH] = useState(TOOLTIP_H_ESTIMATE);

  // The card is a fixed width but its height follows the step's copy (and how
  // it wraps on a narrow phone), so placement runs off the real rendered
  // height. Layout effect, so the corrected position lands before first paint;
  // the observer catches later reflows (font swap, viewport resize). The
  // parent keys this component by step, so each step measures from scratch.
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const measure = () => setMeasuredH(el.offsetHeight);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cardW = Math.min(TOOLTIP_W, vp.w - VIEWPORT_MARGIN * 2);
  // Roomy enough for all three controls to share one row (~340px of content).
  const wide = cardW >= 380;
  // Taller than the screen (landscape phone) → the card scrolls internally
  // rather than pushing Previous/Next out of reach.
  const maxH = vp.h - VIEWPORT_MARGIN * 2;
  const style = useMemo<React.CSSProperties>(() => {
    const base: React.CSSProperties = { width: cardW, maxHeight: maxH };
    if (!rect) return base;
    return { ...base, ...getTooltipPosition(rect, cardW, Math.min(measuredH, maxH), vp.w, vp.h) };
  }, [rect, cardW, maxH, measuredH, vp.w, vp.h]);

  return (
    <div
      ref={cardRef}
      className={cn(
        "fixed z-[101] pointer-events-auto overflow-y-auto overscroll-contain rounded-2xl border border-white/15 bg-[#0a0f1d]/95 backdrop-blur-xl shadow-2xl p-4 sm:p-5",
        !rect && "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2",
      )}
      style={style}
    >
      {/* Step pill + hub badge */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold leading-none text-primary">
          Step {index + 1} of {TOUR_STEPS.length}{" "}
          <span aria-hidden="true" className="text-primary/50">
            •
          </span>{" "}
          <span className="text-white/85">{step.hub}</span>
        </span>
        <button
          onClick={onFinish}
          aria-label="Exit tour"
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Dilemma headline: the topic, then the question the user is really asking */}
      <h3 className="font-bold text-white leading-snug">
        <span className="block font-display tracking-tight text-[17px] text-balance">
          {step.title}
        </span>
        {/* Body face, not the display face: at 14px the display face's tight word spacing makes a full question hard to scan */}
        <span className="block mt-1.5 text-sm font-semibold text-white/90 text-balance">
          {step.problem}
        </span>
      </h3>

      {/* Insight: the financial principle behind this hub */}
      <div className="mt-3.5 bg-white/[0.04] rounded-lg p-2.5 border border-white/5">
        <p className="text-[10px] uppercase font-bold tracking-wider text-emerald-400">
          <span aria-hidden="true">💡</span> THE RULE OF THUMB
        </p>
        <p className="mt-1 text-[13px] leading-[1.5] text-white/80">{step.insight}</p>
      </div>

      {/* Micro-action: one concrete thing to do with the highlighted element */}
      <div className="mt-3 border-l-2 border-cyan-400/50 pl-2.5">
        <p className="text-[10px] uppercase font-bold tracking-wider text-cyan-400">
          <span aria-hidden="true">👉</span> TRY THIS
        </p>
        <p className="mt-1 text-[13px] leading-[1.5] text-white/90">{step.action}</p>
      </div>

      {/* Wide card: Previous · End Tour · Next on one row. Narrow (phone): End
          Tour drops to its own full-width row under the other two. `order`
          only reshuffles that narrow case, so tab order stays Previous → End →
          Next on desktop, where keyboard use actually happens. */}
      <div className="flex flex-wrap items-center justify-between gap-x-2 mt-4">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onPrev}
          disabled={index === 0}
          className="order-1 gap-1 text-muted-foreground"
        >
          <ChevronLeft className="size-3.5" /> Previous
        </Button>
        {/* Early exit — the sandbox stays loaded either way (finish never clears
            it), so the same label is accurate on every step. The last step's
            primary button already says it, so no second copy there. */}
        {!isLast && (
          <button
            type="button"
            onClick={onFinish}
            className={cn(
              "py-1.5 text-center text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline",
              wide ? "order-2" : "order-3 mt-1 w-full",
            )}
          >
            End Tour &amp; Keep Sandbox
          </button>
        )}
        {isLast ? (
          <Button
            type="button"
            size="sm"
            onClick={onFinish}
            className="order-3 ml-auto gradient-primary text-primary-foreground border-0"
          >
            End Tour &amp; Keep Sandbox
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            onClick={onNext}
            className={cn(
              "gap-1 gradient-primary text-primary-foreground border-0",
              wide ? "order-3" : "order-2 ml-auto",
            )}
          >
            Next Hub <ChevronRight className="size-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}
