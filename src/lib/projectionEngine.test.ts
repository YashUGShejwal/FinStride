import { describe, expect, it } from "vitest";
import {
  affordabilityMultiplier,
  calculateMilestoneETA,
  calculateRequiredNetWorth,
  generateProjectionSeries,
  getCompoundingCheckpoints,
  milestoneProgress,
  SCENARIO_CAGR,
  wealthMultiple,
} from "./projectionEngine";

describe("SCENARIO_CAGR", () => {
  it("matches the documented presets", () => {
    expect(SCENARIO_CAGR.conservative).toBe(9);
    expect(SCENARIO_CAGR.base).toBe(12);
    expect(SCENARIO_CAGR.aggressive).toBe(15);
  });
});

describe("generateProjectionSeries — known benchmark values", () => {
  // The textbook SIP benchmark: ₹10,000/month, no step-up, 12% p.a., 10 years.
  // Every mainstream Indian SIP calculator (Groww/ET Money/ClearTax/AMC sites)
  // puts this at ~₹23,23,391 — the annuity-due formula
  // PMT * [((1+r)^n - 1) / r] * (1+r) with r = 1%/month, n = 120 months.
  it("reproduces the standard 10k/month, 10yr, 12% SIP benchmark", () => {
    const series = generateProjectionSeries({
      currentNetWorth: 0,
      monthlyContribution: 10_000,
      stepUpPercent: 0,
      annualReturnPercent: 12,
      inflationPercent: 0,
      horizonYears: 10,
    });
    const final = series[series.length - 1];
    expect(final.monthIndex).toBe(120);
    expect(final.nominalValue).toBeCloseTo(2_323_391, 0);
  });

  it("matches the closed-form annuity-due formula for any flat (no step-up) SIP", () => {
    const monthly = 10;
    const r = 0.01; // 1%/month
    const n = 120;
    const closedForm = monthly * (((Math.pow(1 + r, n) - 1) / r) * (1 + r));

    const series = generateProjectionSeries({
      currentNetWorth: 0,
      monthlyContribution: monthly,
      stepUpPercent: 0,
      annualReturnPercent: 12,
      inflationPercent: 0,
      horizonYears: 10,
    });

    expect(series[series.length - 1].nominalValue).toBeCloseTo(closedForm, 6);
  });

  it("compounds a lump sum (zero contribution) as simple monthly compound interest", () => {
    const principal = 100_000;
    const series = generateProjectionSeries({
      currentNetWorth: principal,
      monthlyContribution: 0,
      stepUpPercent: 0,
      annualReturnPercent: 12,
      inflationPercent: 0,
      horizonYears: 1,
    });
    const expected = principal * Math.pow(1 + 0.12 / 12, 12);
    expect(series[series.length - 1].nominalValue).toBeCloseTo(expected, 6);
  });

  it("keeps every point's principal + gains equal to its nominal value", () => {
    const series = generateProjectionSeries({
      currentNetWorth: 500_000,
      monthlyContribution: 15_000,
      stepUpPercent: 10,
      annualReturnPercent: 12,
      inflationPercent: 6,
      horizonYears: 5,
    });
    for (const p of series) {
      expect(p.principal + p.gains).toBeCloseTo(p.nominalValue, 6);
    }
    // Principal accounting is independently verifiable: starting net worth
    // plus the sum of every step-up-adjusted monthly contribution.
    let expectedPrincipal = 500_000;
    for (let m = 1; m <= 60; m++) {
      const yearIndex = Math.floor((m - 1) / 12);
      expectedPrincipal += 15_000 * Math.pow(1.1, yearIndex);
    }
    expect(series[series.length - 1].principal).toBeCloseTo(expectedPrincipal, 6);
  });

  it("step-up contributions compound to a strictly higher nominal value than flat ones", () => {
    const base = {
      currentNetWorth: 0,
      monthlyContribution: 20_000,
      annualReturnPercent: 12,
      inflationPercent: 0,
      horizonYears: 15,
    };
    const flat = generateProjectionSeries({ ...base, stepUpPercent: 0 });
    const steppedUp = generateProjectionSeries({ ...base, stepUpPercent: 10 });
    const last = flat.length - 1;
    expect(steppedUp[last].nominalValue).toBeGreaterThan(flat[last].nominalValue);
  });

  it("computes real (inflation-adjusted) value via FV_real = FV_nominal / (1+i)^t", () => {
    const series = generateProjectionSeries({
      currentNetWorth: 1_000_000,
      monthlyContribution: 10_000,
      stepUpPercent: 5,
      annualReturnPercent: 12,
      inflationPercent: 6,
      horizonYears: 20,
    });
    const final = series[series.length - 1];
    const expectedReal = final.nominalValue / Math.pow(1.06, 20);
    expect(final.realValue).toBeCloseTo(expectedReal, 6);
    expect(final.realValue).toBeLessThan(final.nominalValue);
  });

  it("with zero inflation, real value equals nominal value at every point", () => {
    const series = generateProjectionSeries({
      currentNetWorth: 250_000,
      monthlyContribution: 5_000,
      stepUpPercent: 0,
      annualReturnPercent: 9,
      inflationPercent: 0,
      horizonYears: 3,
    });
    for (const p of series) expect(p.realValue).toBeCloseTo(p.nominalValue, 9);
  });
});

describe("wealthMultiple", () => {
  it("returns nominal/principal", () => {
    expect(wealthMultiple(300, 100)).toBeCloseTo(3, 9);
  });
  it("falls back to 1 when nothing has been invested yet", () => {
    expect(wealthMultiple(0, 0)).toBe(1);
  });
});

describe("milestoneProgress", () => {
  it("clamps to [0, 1]", () => {
    expect(milestoneProgress(-50, 100)).toBe(0);
    expect(milestoneProgress(50, 100)).toBeCloseTo(0.5, 9);
    expect(milestoneProgress(200, 100)).toBe(1);
  });
});

describe("calculateMilestoneETA", () => {
  it("reports already-achieved when current net worth already meets the target", () => {
    const result = calculateMilestoneETA(1_000_000, 1_500_000, 10_000, 10, 12);
    expect(result?.alreadyAchieved).toBe(true);
    expect(result?.totalMonths).toBe(0);
  });

  it("returns null for an unreachable target (0% return, 0 contribution)", () => {
    const result = calculateMilestoneETA(1_000_000, 0, 0, 0, 0);
    expect(result).toBeNull();
  });

  it("finds the exact boundary month: the series crosses the target at totalMonths, not before", () => {
    const inputs = {
      currentNetWorth: 200_000,
      monthlyContribution: 25_000,
      stepUpPercent: 10,
      annualReturnPercent: 12,
      inflationPercent: 0,
      horizonYears: 20,
    };
    const target = 5_000_000;
    const eta = calculateMilestoneETA(
      target,
      inputs.currentNetWorth,
      inputs.monthlyContribution,
      inputs.stepUpPercent,
      inputs.annualReturnPercent,
    );
    expect(eta).not.toBeNull();
    const series = generateProjectionSeries(inputs);
    const atEta = series[eta!.totalMonths];
    const beforeEta = series[eta!.totalMonths - 1];
    expect(atEta.nominalValue).toBeGreaterThanOrEqual(target);
    expect(beforeEta.nominalValue).toBeLessThan(target);
    expect(eta!.years * 12 + eta!.months).toBe(eta!.totalMonths);
  });

  it("a higher CAGR never takes longer to reach the same target", () => {
    const slow = calculateMilestoneETA(2_000_000, 100_000, 15_000, 5, 9);
    const fast = calculateMilestoneETA(2_000_000, 100_000, 15_000, 5, 15);
    expect(fast).not.toBeNull();
    expect(slow).not.toBeNull();
    expect(fast!.totalMonths).toBeLessThanOrEqual(slow!.totalMonths);
  });
});

describe("getCompoundingCheckpoints", () => {
  const baseInputs = {
    currentNetWorth: 300_000,
    monthlyContribution: 20_000,
    stepUpPercent: 10,
    annualReturnPercent: 12,
    inflationPercent: 6,
    horizonYears: 20,
  };

  it("lands exactly on Year 0, 5, 10, 15, 20 for a clean-multiple horizon", () => {
    const checkpoints = getCompoundingCheckpoints(baseInputs);
    expect(checkpoints.map((c) => c.monthIndex / 12)).toEqual([0, 5, 10, 15, 20]);
  });

  it("each checkpoint matches the full series at the same month exactly", () => {
    const checkpoints = getCompoundingCheckpoints(baseInputs);
    const series = generateProjectionSeries(baseInputs);
    for (const c of checkpoints) {
      expect(c.nominalValue).toBe(series[c.monthIndex].nominalValue);
    }
  });

  it("always includes the final horizon point, even off-interval", () => {
    const checkpoints = getCompoundingCheckpoints({ ...baseInputs, horizonYears: 22 });
    const months = checkpoints.map((c) => c.monthIndex);
    expect(months).toEqual([0, 60, 120, 180, 240, 264]); // 264 = 22 years, not a multiple of 5
  });

  it("respects a custom interval", () => {
    const checkpoints = getCompoundingCheckpoints(baseInputs, { intervalYears: 10 });
    expect(checkpoints.map((c) => c.monthIndex / 12)).toEqual([0, 10, 20]);
  });

  it("every checkpoint's principal+gains still reconciles to its nominal value", () => {
    const checkpoints = getCompoundingCheckpoints(baseInputs);
    for (const c of checkpoints) expect(c.principal + c.gains).toBeCloseTo(c.nominalValue, 6);
  });
});

describe("calculateMilestoneETA — inflation-aware (adjustForInflation)", () => {
  const start = new Date("2026-01-01T00:00:00.000Z");
  const base = { targetAmount: 2_000_000, currentNW: 100_000, monthlyContribution: 15_000, stepUpRate: 5, cagr: 12 };

  it("with inflationPercent omitted, behaves exactly like the original nominal-only solver", () => {
    const withOpts = calculateMilestoneETA(
      base.targetAmount, base.currentNW, base.monthlyContribution, base.stepUpRate, base.cagr,
      { startDate: start },
    );
    const withZeroInflation = calculateMilestoneETA(
      base.targetAmount, base.currentNW, base.monthlyContribution, base.stepUpRate, base.cagr,
      { startDate: start, inflationPercent: 0 },
    );
    expect(withZeroInflation).toEqual(withOpts);
  });

  it("solving against the real (inflation-adjusted) curve never finds an EARLIER month than the nominal curve", () => {
    const nominalEta = calculateMilestoneETA(
      base.targetAmount, base.currentNW, base.monthlyContribution, base.stepUpRate, base.cagr,
      { startDate: start },
    );
    const realEta = calculateMilestoneETA(
      base.targetAmount, base.currentNW, base.monthlyContribution, base.stepUpRate, base.cagr,
      { startDate: start, inflationPercent: 6 },
    );
    expect(nominalEta).not.toBeNull();
    expect(realEta).not.toBeNull();
    expect(realEta!.totalMonths).toBeGreaterThanOrEqual(nominalEta!.totalMonths);
  });

  it("the real-terms ETA month matches an independent real-value recomputation from generateProjectionSeries", () => {
    const inflationPercent = 6;
    const eta = calculateMilestoneETA(
      base.targetAmount, base.currentNW, base.monthlyContribution, base.stepUpRate, base.cagr,
      { startDate: start, inflationPercent },
    );
    expect(eta).not.toBeNull();
    const series = generateProjectionSeries(
      {
        currentNetWorth: base.currentNW,
        monthlyContribution: base.monthlyContribution,
        stepUpPercent: base.stepUpRate,
        annualReturnPercent: base.cagr,
        inflationPercent,
        horizonYears: 30,
      },
      { startDate: start },
    );
    const atEta = series[eta!.totalMonths];
    const beforeEta = series[eta!.totalMonths - 1];
    expect(atEta.realValue).toBeGreaterThanOrEqual(base.targetAmount);
    expect(beforeEta.realValue).toBeLessThan(base.targetAmount);
  });
});

describe("calculateRequiredNetWorth", () => {
  it("matches cost / (allocationPercent/100) for each affordability category's default", () => {
    expect(calculateRequiredNetWorth(300_000, 50)).toBeCloseTo(600_000, 6); // Need default
    expect(calculateRequiredNetWorth(300_000, 20)).toBeCloseTo(1_500_000, 6); // Major Want default
    expect(calculateRequiredNetWorth(300_000, 10)).toBeCloseTo(3_000_000, 6); // Minor Want default
  });

  it("is algebraically equivalent to cost * (100 / allocationPercent)", () => {
    expect(calculateRequiredNetWorth(50_000, 3)).toBeCloseTo(50_000 * (100 / 3), 6);
  });

  it("returns Infinity for a non-positive allocation percent rather than a misleading finite number", () => {
    expect(calculateRequiredNetWorth(100_000, 0)).toBe(Infinity);
    expect(calculateRequiredNetWorth(100_000, -5)).toBe(Infinity);
  });
});

describe("affordabilityMultiplier", () => {
  it("matches the documented multiplier bounds for every category's slider range", () => {
    expect(affordabilityMultiplier(50)).toBeCloseTo(2.0, 6); // Need max% (least conservative)
    expect(affordabilityMultiplier(20)).toBeCloseTo(5.0, 6); // Need min% == Major Want max%
    expect(affordabilityMultiplier(10)).toBeCloseTo(10.0, 6); // Major Want min% == Minor Want max%
    expect(affordabilityMultiplier(3)).toBeCloseTo(100 / 3, 6); // Minor Want min% (~33.3x)
  });

  it("cost * multiplier reconciles exactly with calculateRequiredNetWorth", () => {
    for (const pct of [3, 10, 20, 50]) {
      expect(70_000 * affordabilityMultiplier(pct)).toBeCloseTo(calculateRequiredNetWorth(70_000, pct), 6);
    }
  });
});
