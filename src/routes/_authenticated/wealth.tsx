import { createFileRoute } from "@tanstack/react-router";
import { Rocket } from "lucide-react";
import { SCENARIO_CAGR, type Scenario } from "@/lib/projectionEngine";
import { useStore } from "@/lib/store";
import { inr } from "@/lib/format";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { Sensitive } from "@/components/Sensitive";
import { MilestoneTracker } from "@/components/MilestoneTracker";
import { NetWorthProjectionChart } from "@/components/NetWorthProjectionChart";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/wealth")({ component: WealthPage });

const SCENARIOS: readonly { key: Scenario; label: string }[] = [
  { key: "conservative", label: `Conservative ${SCENARIO_CAGR.conservative}%` },
  { key: "base", label: `Base ${SCENARIO_CAGR.base}%` },
  { key: "aggressive", label: `Aggressive ${SCENARIO_CAGR.aggressive}%` },
];

function WealthPage() {
  const { currentNetWorth, projectionSettings, updateProjectionSettings } = useStore();
  const { monthlySip, stepUpPercent, expectedCagr, inflationRate, horizonYears, scenario, adjustForInflation } =
    projectionSettings;

  return (
    <div className="space-y-6">
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Wealth Hub</p>
          <h1 className="text-3xl md:text-4xl font-display font-semibold tracking-tight mt-1">
            Your <span className="text-gradient">net worth</span>, compounded forward
          </h1>
          <p className="text-sm text-muted-foreground mt-2">
            Current net worth{" "}
            <Sensitive>
              <span className="tnum font-medium text-foreground">
                <AnimatedNumber value={currentNetWorth} format={inr} />
              </span>
            </Sensitive>{" "}
            — projected {horizonYears} years out.
          </p>
        </div>
        <Rocket className="size-8 text-primary/60 hidden md:block" />
      </header>

      {/* Scenario presets + quick parameter sliders */}
      <section className="rounded-2xl border border-white/[0.08] bg-white/[0.015] p-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Return Scenario</p>
          <div className="inline-flex items-center gap-1 rounded-lg border border-glass-border p-1">
            {SCENARIOS.map((s) => {
              const active = scenario === s.key && expectedCagr === SCENARIO_CAGR[s.key];
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => updateProjectionSettings({ scenario: s.key, expectedCagr: SCENARIO_CAGR[s.key] })}
                  aria-pressed={active}
                  className={`px-3.5 py-1.5 rounded-md text-sm transition-colors ${
                    active
                      ? "bg-white/[0.08] text-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-5">
          <ParamSlider
            label="Monthly SIP"
            value={monthlySip}
            display={inr(monthlySip)}
            min={0}
            max={300_000}
            step={1000}
            onChange={(v) => updateProjectionSettings({ monthlySip: v })}
            hint="Auto-filled from your Groww MF SIP baseline — adjust anytime."
            sensitive
          />
          <ParamSlider
            label="Annual Step-Up"
            value={stepUpPercent}
            display={`${stepUpPercent}%`}
            min={0}
            max={25}
            step={1}
            onChange={(v) => updateProjectionSettings({ stepUpPercent: v })}
            hint="How much your SIP grows every 12 months."
          />
          <ParamSlider
            label="Expected Return (CAGR)"
            value={expectedCagr}
            display={`${expectedCagr}%`}
            min={1}
            max={25}
            step={0.5}
            onChange={(v) => updateProjectionSettings({ expectedCagr: v })}
            hint="Nominal annual return, compounded monthly."
          />
          <ParamSlider
            label="Inflation Rate"
            value={inflationRate}
            display={`${inflationRate}%`}
            min={0}
            max={12}
            step={0.5}
            onChange={(v) => updateProjectionSettings({ inflationRate: v })}
            hint="Drives the real (purchasing-power) curve."
          />
          <ParamSlider
            label="Time Horizon"
            value={horizonYears}
            display={`${horizonYears} yrs`}
            min={1}
            max={30}
            step={1}
            onChange={(v) => updateProjectionSettings({ horizonYears: v })}
            hint="How far out the trajectory projects."
          />
          <div className="flex items-center justify-between rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
            <div>
              <Label htmlFor="adjust-inflation" className="text-sm">
                Headline in real terms
              </Label>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Show inflation-adjusted value as the primary figure.
              </p>
            </div>
            <Switch
              id="adjust-inflation"
              checked={adjustForInflation}
              onCheckedChange={(v) => updateProjectionSettings({ adjustForInflation: v })}
            />
          </div>
        </div>
      </section>

      <MilestoneTracker />
      <NetWorthProjectionChart />
    </div>
  );
}

function ParamSlider({
  label,
  value,
  display,
  min,
  max,
  step,
  onChange,
  hint,
  sensitive,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  hint?: string;
  sensitive?: boolean;
}) {
  const valueEl = <span className="text-sm font-semibold tnum">{display}</span>;
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <Label className="text-sm text-muted-foreground">{label}</Label>
        {sensitive ? <Sensitive>{valueEl}</Sensitive> : valueEl}
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={([v]) => onChange(v)}
      />
      {hint && <p className="text-[11px] text-muted-foreground mt-1.5">{hint}</p>}
    </div>
  );
}
