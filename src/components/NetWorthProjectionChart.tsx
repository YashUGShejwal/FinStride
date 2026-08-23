import { useMemo } from "react";
import {
  CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { format } from "date-fns";
import { LineChart as LineChartIcon } from "lucide-react";
import { generateProjectionSeries, wealthMultiple, type ProjectionPoint } from "@/lib/projectionEngine";
import { useStore } from "@/lib/store";
import { inr, inrCompact } from "@/lib/format";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { Sensitive } from "@/components/Sensitive";

/** How many year-gridlines to show on the X-axis before thinning them out. */
function tickStepYears(horizonYears: number): number {
  if (horizonYears > 20) return 5;
  if (horizonYears > 10) return 2;
  return 1;
}

export function NetWorthProjectionChart() {
  const { projectionSettings, currentNetWorth, milestones, isStealthMode } = useStore();
  const { monthlySip, stepUpPercent, expectedCagr, inflationRate, horizonYears, adjustForInflation } =
    projectionSettings;

  const series = useMemo<ProjectionPoint[]>(
    () =>
      generateProjectionSeries({
        currentNetWorth,
        monthlyContribution: monthlySip,
        stepUpPercent,
        annualReturnPercent: expectedCagr,
        inflationPercent: inflationRate,
        horizonYears,
      }),
    [currentNetWorth, monthlySip, stepUpPercent, expectedCagr, inflationRate, horizonYears],
  );

  const final = series[series.length - 1];
  const headlineValue = adjustForInflation ? final.realValue : final.nominalValue;

  const yDomainMax = useMemo(() => {
    const max = Math.max(...series.map((p) => p.nominalValue), 1);
    return Math.ceil((max * 1.1) / 100_000) * 100_000;
  }, [series]);

  const ticks = useMemo(() => {
    const step = tickStepYears(horizonYears) * 12;
    return series.filter((p) => p.monthIndex % step === 0).map((p) => p.monthIndex);
  }, [series, horizonYears]);

  const visibleMilestones = useMemo(
    () => milestones.filter((m) => m.targetAmount > currentNetWorth && m.targetAmount <= yDomainMax),
    [milestones, currentNetWorth, yDomainMax],
  );

  return (
    <section className="rounded-2xl border border-white/[0.08] bg-white/[0.015] p-5">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <LineChartIcon className="size-4 text-muted-foreground" />
          <h2 className="font-display font-semibold tracking-tight">Wealth Trajectory</h2>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-[oklch(0.72_0.18_155)]" /> Nominal
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full border border-dashed border-[oklch(0.72_0.14_195)]" />
            Real (inflation-adjusted)
          </span>
        </div>
      </div>

      {/* Horizon summary — the same 4 figures the hover tooltip shows, pinned to the final projected month.
          Cards 1-2 invert which figure is "primary" based on adjustForInflation (the "Headline in real
          terms" toggle) — the emphasized card always reflects what the user asked to see first. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 my-4">
        <SummaryStat
          label={adjustForInflation ? "Real (Today's Purchasing Power)" : `Nominal · Year ${horizonYears}`}
          value={headlineValue}
          primary
        />
        <SummaryStat
          label={adjustForInflation ? "Nominal Portfolio Value" : "Real (Today's ₹)"}
          value={adjustForInflation ? final.nominalValue : final.realValue}
        />
        <SummaryStat label="Principal Invested" value={final.principal} />
        <SummaryStat label="Compounded Gain" value={final.gains} tone="oklch(0.72 0.18 155)" />
      </div>
      <p className="text-[11px] text-muted-foreground mb-4">
        Your money multiplies{" "}
        <Sensitive>
          <span className="tnum font-medium text-foreground">
            {wealthMultiple(headlineValue, final.principal).toFixed(1)}×
          </span>
        </Sensitive>{" "}
        over {horizonYears} years ({adjustForInflation ? "real" : "nominal"} terms).
      </p>

      <div className="h-[320px] -ml-2">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={series} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="oklch(0.5 0 0 / 0.12)" vertical={false} />
            <XAxis
              dataKey="monthIndex"
              type="number"
              domain={[0, series.length - 1]}
              ticks={ticks}
              tickFormatter={(m: number) => format(series[m]?.date ?? new Date(), "yyyy")}
              tick={{ fontSize: 11, fill: "oklch(0.65 0 0)" }}
              axisLine={{ stroke: "oklch(1 0 0 / 0.1)" }}
              tickLine={false}
            />
            <YAxis
              domain={[0, yDomainMax]}
              tickFormatter={(v: number) => (isStealthMode ? "₹•••" : inrCompact(v))}
              tick={{ fontSize: 11, fill: "oklch(0.65 0 0)" }}
              axisLine={false}
              tickLine={false}
              width={56}
            />
            <Tooltip
              content={<ProjectionTooltip isStealthMode={isStealthMode} />}
              cursor={{ stroke: "oklch(1 0 0 / 0.18)", strokeDasharray: "3 3" }}
            />
            {visibleMilestones.map((m) => (
              <ReferenceLine
                key={m.id}
                y={m.targetAmount}
                stroke="oklch(0.78 0.16 75 / 0.45)"
                strokeDasharray="4 4"
                label={{
                  value: m.name,
                  position: "insideTopRight",
                  fill: "oklch(0.78 0.16 75)",
                  fontSize: 10,
                }}
              />
            ))}
            <Line
              type="monotone"
              dataKey="nominalValue"
              stroke="oklch(0.72 0.18 155)"
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="realValue"
              stroke="oklch(0.72 0.14 195)"
              strokeWidth={2}
              strokeDasharray="5 5"
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function SummaryStat({
  label,
  value,
  tone,
  primary,
}: {
  label: string;
  value: number;
  tone?: string;
  /** The headline card driven by the "Headline in real terms" toggle — bigger, bolder, glowing emerald. */
  primary?: boolean;
}) {
  return (
    <div
      className={
        primary
          ? "rounded-xl border border-primary/30 bg-primary/[0.06] p-3 shadow-[0_0_24px_-10px_oklch(0.78_0.15_165_/_0.5)]"
          : "rounded-xl border border-white/[0.08] bg-white/[0.02] p-3"
      }
    >
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p
        className={primary ? "text-2xl font-bold font-display tnum mt-1" : "text-base font-semibold tnum mt-0.5"}
        style={{ color: primary ? "oklch(0.78 0.2 155)" : tone }}
      >
        <Sensitive>
          <AnimatedNumber value={value} format={inr} />
        </Sensitive>
      </p>
    </div>
  );
}

function ProjectionTooltip({
  active,
  payload,
  isStealthMode,
}: {
  active?: boolean;
  payload?: Array<{ payload: ProjectionPoint }>;
  isStealthMode: boolean;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const mask = (n: number) => (isStealthMode ? "₹•••" : inr(n));
  return (
    <div className="rounded-xl border border-white/15 bg-[#060913]/95 backdrop-blur-2xl p-3 shadow-xl min-w-[190px]">
      <p className="text-[10px] text-white/50 font-medium tracking-wide mb-1.5">
        {format(p.date, "MMMM yyyy")} · Year {(p.monthIndex / 12).toFixed(1)}
      </p>
      <div className="space-y-1 text-xs">
        <Row label="Nominal Value" value={mask(p.nominalValue)} color="oklch(0.72 0.18 155)" />
        <Row label="Real Value" value={mask(p.realValue)} color="oklch(0.72 0.14 195)" />
        <Row label="Principal Invested" value={mask(p.principal)} />
        <Row label="Compounded Gain" value={mask(p.gains)} />
      </div>
    </div>
  );
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <p className="flex items-center justify-between gap-4">
      <span className="text-white/60">{label}</span>
      <span className="tnum font-semibold" style={color ? { color } : undefined}>
        {value}
      </span>
    </p>
  );
}
