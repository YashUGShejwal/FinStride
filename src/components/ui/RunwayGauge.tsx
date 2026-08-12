import { useEffect, useId } from "react";
import { motion, useReducedMotion, useSpring, useTransform } from "framer-motion";
import { inr } from "@/lib/format";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { Sensitive } from "@/components/Sensitive";

const R = 44;
const CIRCUMFERENCE = 2 * Math.PI * R;

/**
 * Circular gauge for monthly runway consumption: how much of the salary
 * baseline the fixed obligations (runrate + EMI) eat. The arc's dash-offset
 * is driven by a framer-motion spring, so it sweeps in on hydration and
 * re-springs whenever the blueprint numbers change.
 */
export function RunwayGauge({
  consumed,
  total,
}: {
  /** Fixed monthly obligations (runrate + EMI). */
  consumed: number;
  /** Monthly salary baseline. */
  total: number;
}) {
  const gid = `gauge-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const reducedMotion = useReducedMotion();

  // A zero baseline with real obligations is the WORST state, not a healthy
  // empty one: fill the arc and warn. (Fresh installs ship all-zero
  // blueprints, so consumed>0 with total=0 is a reachable configuration.)
  const pct = total > 0 ? Math.min(consumed / total, 1) : consumed > 0 ? 1 : 0;
  const overCommitted = consumed > total;
  const noBaseline = total === 0 && consumed > 0;

  // Starts at 0 (empty arc) on the server and first client paint, springs to
  // the real fraction after mount — same hydration-safe pattern as AnimatedNumber.
  const spring = useSpring(0, { stiffness: 70, damping: 20 });
  const dashOffset = useTransform(spring, (v) => CIRCUMFERENCE * (1 - v));

  useEffect(() => {
    if (reducedMotion) spring.jump(pct);
    else spring.set(pct);
  }, [spring, pct, reducedMotion]);

  return (
    <div className="flex flex-col items-center">
      <div className="relative size-40">
        <svg viewBox="0 0 100 100" className="size-full -rotate-90">
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
              {overCommitted ? (
                <>
                  <stop offset="0" stopColor="#fb7185" />
                  <stop offset="1" stopColor="#f43f5e" />
                </>
              ) : (
                <>
                  <stop offset="0" stopColor="#34d399" />
                  <stop offset="1" stopColor="#22d3ee" />
                </>
              )}
            </linearGradient>
          </defs>
          <circle
            cx="50"
            cy="50"
            r={R}
            fill="none"
            stroke="oklch(1 0 0 / 0.06)"
            strokeWidth="7"
          />
          <motion.circle
            cx="50"
            cy="50"
            r={R}
            fill="none"
            stroke={`url(#${gid})`}
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            style={{ strokeDashoffset: dashOffset }}
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <div className="text-center">
            <p className="text-2xl font-semibold tnum">
              <Sensitive>
                <AnimatedNumber value={pct * 100} format={(n) => `${Math.round(n)}%`} />
              </Sensitive>
            </p>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">
              consumed
            </p>
          </div>
        </div>
      </div>
      <p className="text-xs text-muted-foreground mt-2 text-center">
        <Sensitive>
          <span className="tnum">{inr(consumed)}</span>
        </Sensitive>{" "}
        of{" "}
        <Sensitive>
          <span className="tnum">{inr(total)}</span>
        </Sensitive>{" "}
        baseline
        {overCommitted && (
          <span className="block text-[oklch(0.75_0.18_25)] mt-0.5 font-medium">
            {noBaseline
              ? "No salary baseline set — add it in Settings"
              : "Obligations exceed salary baseline"}
          </span>
        )}
      </p>
    </div>
  );
}
