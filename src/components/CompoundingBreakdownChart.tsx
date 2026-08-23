import { useMemo } from "react";
import { BarChart3 } from "lucide-react";
import { getCompoundingCheckpoints, wealthMultiple, type ProjectionPoint } from "@/lib/projectionEngine";
import { useStore } from "@/lib/store";
import { inr, inrCompact } from "@/lib/format";
import { Sensitive } from "@/components/Sensitive";

const BAR_MAX_PX = 220;

/**
 * Principal-vs-Compounding stacked bar breakdown, sampled every 5 years (see
 * getCompoundingCheckpoints). Plain HTML/CSS bars rather than a Recharts
 * <Bar> — the spec calls for literal Tailwind color classes per segment
 * (bg-cyan-950/bg-emerald-500), which only apply to real DOM elements, not
 * SVG `fill`. That also makes stealth-mode masking trivial: every figure here
 * is normal HTML text, so <Sensitive>'s CSS blur just works — unlike
 * NetWorthProjectionChart's Recharts axis ticks, which need manual "₹•••"
 * substitution because Recharts renders them as raw SVG text.
 */
export function CompoundingBreakdownChart() {
  const { projectionSettings, currentNetWorth } = useStore();
  const { monthlySip, stepUpPercent, expectedCagr, inflationRate, horizonYears } = projectionSettings;

  const checkpoints = useMemo(
    () =>
      getCompoundingCheckpoints({
        currentNetWorth,
        monthlyContribution: monthlySip,
        stepUpPercent,
        annualReturnPercent: expectedCagr,
        inflationPercent: inflationRate,
        horizonYears,
      }),
    [currentNetWorth, monthlySip, stepUpPercent, expectedCagr, inflationRate, horizonYears],
  );

  const maxNominal = Math.max(...checkpoints.map((c) => c.nominalValue), 1);

  return (
    <section className="rounded-2xl border border-white/[0.08] bg-white/[0.015] p-5">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <BarChart3 className="size-4 text-muted-foreground" />
          <h2 className="font-display font-semibold tracking-tight">5-Year Compounding Split</h2>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-sm bg-cyan-950 border border-cyan-500/30" /> Principal Invested
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-sm bg-emerald-500" /> Compounded Gains
          </span>
        </div>
      </div>

      <div className="flex items-end justify-between gap-2 md:gap-6 overflow-x-auto pb-1">
        {checkpoints.map((c) => (
          <CheckpointBar key={c.monthIndex} point={c} maxNominal={maxNominal} />
        ))}
      </div>
    </section>
  );
}

function CheckpointBar({ point, maxNominal }: { point: ProjectionPoint; maxNominal: number }) {
  const barHeight = (point.nominalValue / maxNominal) * BAR_MAX_PX;
  const gainsFraction = point.nominalValue > 0 ? Math.max(point.gains / point.nominalValue, 0) : 0;
  const gainsHeight = barHeight * gainsFraction;
  const principalHeight = Math.max(barHeight - gainsHeight, point.principal > 0 ? 3 : 0);
  const multiplier = wealthMultiple(point.nominalValue, point.principal);
  const years = Math.round(point.monthIndex / 12);

  return (
    <div className="flex-1 min-w-[64px] flex flex-col items-center group relative">
      <div className="mb-2 text-center">
        <Sensitive>
          <p className="tnum text-xs md:text-sm font-bold whitespace-nowrap">{inrCompact(point.nominalValue)}</p>
        </Sensitive>
        <span className="inline-block mt-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold tnum text-emerald-400">
          {multiplier.toFixed(1)}x
        </span>
      </div>

      <div
        className="relative w-full max-w-[56px] flex flex-col justify-end cursor-default"
        style={{ height: BAR_MAX_PX }}
      >
        {gainsHeight > 0 && (
          <div
            className="w-full bg-emerald-500/80 shadow-[0_0_12px_rgba(16,185,129,0.35)] rounded-t-md transition-[height] duration-500"
            style={{ height: gainsHeight }}
          />
        )}
        <div
          className="w-full bg-cyan-950/70 border border-cyan-500/30 rounded-b-md transition-[height] duration-500"
          style={{ height: principalHeight }}
        />

        {/* Hover breakdown — exact ₹ split + percentage contribution. */}
        <div className="pointer-events-none absolute bottom-full mb-3 left-1/2 -translate-x-1/2 hidden group-hover:flex flex-col gap-1.5 min-w-[170px] rounded-xl border border-white/15 bg-[#060913]/95 backdrop-blur-2xl p-3 z-20 shadow-xl">
          <p className="text-[10px] text-white/50 font-medium tracking-wide">Year {years}</p>
          <Sensitive>
            <p className="text-xs flex items-center justify-between gap-3">
              <span className="text-cyan-400">Principal</span>
              <span className="tnum font-semibold">{inr(point.principal)}</span>
            </p>
          </Sensitive>
          <Sensitive>
            <p className="text-xs flex items-center justify-between gap-3">
              <span className="text-emerald-400">Gains</span>
              <span className="tnum font-semibold">{inr(point.gains)}</span>
            </p>
          </Sensitive>
          <p className="text-[10px] text-white/50 pt-1.5 mt-0.5 border-t border-white/10 flex justify-between gap-3">
            <span>{Math.round((1 - gainsFraction) * 100)}% principal</span>
            <span>{Math.round(gainsFraction * 100)}% compounding</span>
          </p>
        </div>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">Year {years}</p>
    </div>
  );
}
