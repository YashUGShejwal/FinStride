/**
 * Net worth compounding & milestone-ETA math. Pure functions only — no store,
 * no React, no formatting. Every ₹ amount in/out is a plain number (rupees);
 * every rate in/out is a plain percent (12 means 12%, not 0.12).
 *
 * Compounding convention: `annualReturnPercent` is treated as a NOMINAL
 * annual rate compounded monthly (monthlyRate = r/100/12), and each month's
 * contribution is added BEFORE that month's growth is applied (annuity-due).
 * This is deliberate, not an approximation — it's the exact convention used
 * by standard Indian SIP calculators (Groww/ET Money/ClearTax/AMC sites), so
 * a flat (0% step-up) projection here reproduces their numbers exactly: e.g.
 * ₹10,000/month for 10 years at 12% p.a. compounds to ₹23,23,391 — see
 * projectionEngine.test.ts. One consequence worth knowing: because growth
 * compounds monthly, the realized EFFECTIVE annual return is slightly above
 * the input percentage (12% nominal ≈ 12.68% effective annually).
 */

export type Scenario = "conservative" | "base" | "aggressive";

/** Preset CAGR (%) per scenario — the 3 buttons on the Wealth page. */
export const SCENARIO_CAGR: Record<Scenario, number> = {
  conservative: 9,
  base: 12,
  aggressive: 15,
};

export type ProjectionInputs = {
  /** Current net worth / starting principal, ₹. */
  currentNetWorth: number;
  /** Monthly contribution in year 1, before step-up, ₹. */
  monthlyContribution: number;
  /** Annual contribution step-up rate (%), applied once every 12 months. */
  stepUpPercent: number;
  /** Expected annual return (%), nominal, compounded monthly. */
  annualReturnPercent: number;
  /** Annual inflation rate (%), compounded yearly against elapsed time. */
  inflationPercent: number;
  /** Projection horizon, in years. */
  horizonYears: number;
};

export type ProjectionPoint = {
  /** Whole months elapsed since the projection start (0 = today). */
  monthIndex: number;
  /** Calendar date for this point. */
  date: Date;
  /** Nominal portfolio value. */
  nominalValue: number;
  /** Inflation-adjusted value, in today's purchasing power. */
  realValue: number;
  /** Cumulative principal invested to date (starting net worth + contributions so far). */
  principal: number;
  /** Cumulative capital gains to date (nominalValue - principal). */
  gains: number;
};

export type MilestoneETAResult = {
  /** Total whole months from the start date until the target is first reached. */
  totalMonths: number;
  /** Whole-years component of totalMonths. */
  years: number;
  /** Remaining whole-months component (0-11). */
  months: number;
  /** Calendar date the target is first reached. */
  targetDate: Date;
  /** True if the target is already met at month 0 (totalMonths is meaningless — always 0). */
  alreadyAchieved: boolean;
};

/** A solver cap so an unreachable target (e.g. 0% return, 0 contribution) terminates instead of looping forever. */
const MAX_SOLVER_YEARS = 100;

const monthlyRateFromAnnualPercent = (annualPercent: number): number => annualPercent / 100 / 12;

/**
 * Contribution due in 1-based month `monthNumber`, given a base monthly
 * amount that steps up by `stepUpPercent` every 12 months: months 1-12 use
 * the base amount, 13-24 use base*(1+s), 25-36 use base*(1+s)^2, and so on.
 */
function contributionForMonth(
  baseMonthly: number,
  stepUpPercent: number,
  monthNumber: number,
): number {
  const yearIndex = Math.floor((monthNumber - 1) / 12);
  return baseMonthly * Math.pow(1 + stepUpPercent / 100, yearIndex);
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

/**
 * Inflation-adjusted value of `nominal` after `elapsedYears`. Guards the
 * degenerate inflationPercent <= -100 case (which would divide by zero or
 * flip sign) by falling back to the nominal value rather than emitting
 * Infinity/NaN into a chart — inputs come from a UI slider a user could in
 * principle drag to that extreme.
 */
function toRealValue(nominal: number, inflationPercent: number, elapsedYears: number): number {
  const base = 1 + inflationPercent / 100;
  if (base <= 0 || elapsedYears === 0) return nominal;
  return nominal / Math.pow(base, elapsedYears);
}

/**
 * Full month-by-month compound projection from today out to `horizonYears`.
 * Point 0 is "today" (no growth/contribution applied yet); point N is N
 * months out. See the module doc comment for the compounding convention.
 */
export function generateProjectionSeries(
  inputs: ProjectionInputs,
  opts?: { startDate?: Date },
): ProjectionPoint[] {
  const {
    currentNetWorth,
    monthlyContribution,
    stepUpPercent,
    annualReturnPercent,
    inflationPercent,
    horizonYears,
  } = inputs;
  const start = opts?.startDate ?? new Date();
  const totalMonths = Math.max(0, Math.round(horizonYears * 12));
  const monthlyRate = monthlyRateFromAnnualPercent(annualReturnPercent);

  const points: ProjectionPoint[] = [
    {
      monthIndex: 0,
      date: start,
      nominalValue: currentNetWorth,
      realValue: currentNetWorth,
      principal: currentNetWorth,
      gains: 0,
    },
  ];

  let balance = currentNetWorth;
  let principal = currentNetWorth;
  for (let m = 1; m <= totalMonths; m++) {
    const contribution = contributionForMonth(monthlyContribution, stepUpPercent, m);
    balance = (balance + contribution) * (1 + monthlyRate);
    principal += contribution;

    points.push({
      monthIndex: m,
      date: addMonths(start, m),
      nominalValue: balance,
      realValue: toRealValue(balance, inflationPercent, m / 12),
      principal,
      gains: balance - principal,
    });
  }

  return points;
}

/**
 * Samples generateProjectionSeries at fixed year intervals (Year 0, 5, 10, ...)
 * for the Principal-vs-Compounding stacked-bar breakdown. Always includes the
 * final horizon point even when horizonYears isn't a clean multiple of
 * intervalYears (e.g. a 22-year horizon with the default 5-year interval
 * yields checkpoints at 0, 5, 10, 15, 20, 22 — never silently dropping the
 * last few years' growth from the chart).
 */
export function getCompoundingCheckpoints(
  inputs: ProjectionInputs,
  opts?: { startDate?: Date; intervalYears?: number },
): ProjectionPoint[] {
  const intervalYears = opts?.intervalYears ?? 5;
  const series = generateProjectionSeries(inputs, opts);
  const stepMonths = Math.max(1, Math.round(intervalYears * 12));

  const checkpoints: ProjectionPoint[] = [];
  for (let m = 0; m < series.length; m += stepMonths) checkpoints.push(series[m]);

  const last = series[series.length - 1];
  if (checkpoints[checkpoints.length - 1]?.monthIndex !== last.monthIndex) {
    checkpoints.push(last);
  }
  return checkpoints;
}

/**
 * How many times the original money has multiplied: nominalValue / principal.
 * Returns 1 for a zero/negative principal (nothing invested yet to multiply).
 */
export function wealthMultiple(nominalValue: number, principal: number): number {
  return principal > 0 ? nominalValue / principal : 1;
}

/** Fraction of `targetAmount` reached so far, clamped to [0, 1]. */
export function milestoneProgress(currentNetWorth: number, targetAmount: number): number {
  if (targetAmount <= 0) return 1;
  return Math.min(Math.max(currentNetWorth / targetAmount, 0), 1);
}

/**
 * Solves for the exact month a target net worth is first hit, under the same
 * step-up monthly-compounding model as generateProjectionSeries. Inflation is
 * deliberately not a parameter here — a "₹1 Crore" milestone means a nominal
 * ₹1,00,00,000, matching how milestones are colloquially understood and kept
 * consistent regardless of the chart's inflation-adjustment toggle.
 *
 * Returns null if the target isn't reached within MAX_SOLVER_YEARS (e.g. a
 * 0% return with 0 contribution and a target above the current net worth).
 */
export function calculateMilestoneETA(
  targetAmount: number,
  currentNW: number,
  monthlyContribution: number,
  stepUpRate: number,
  cagr: number,
  opts?: { startDate?: Date },
): MilestoneETAResult | null {
  const start = opts?.startDate ?? new Date();

  if (currentNW >= targetAmount) {
    return { totalMonths: 0, years: 0, months: 0, targetDate: start, alreadyAchieved: true };
  }

  const monthlyRate = monthlyRateFromAnnualPercent(cagr);
  const maxMonths = MAX_SOLVER_YEARS * 12;
  let balance = currentNW;

  for (let m = 1; m <= maxMonths; m++) {
    const contribution = contributionForMonth(monthlyContribution, stepUpRate, m);
    balance = (balance + contribution) * (1 + monthlyRate);
    if (balance >= targetAmount) {
      return {
        totalMonths: m,
        years: Math.floor(m / 12),
        months: m % 12,
        targetDate: addMonths(start, m),
        alreadyAchieved: false,
      };
    }
  }
  return null;
}
