/**
 * Demo Sandbox data seeder (Track 5) — a realistic, hand-curated snapshot
 * spanning all 5 hubs, used by AppTourModal's "Load Demo Sandbox" action and
 * StoreProvider's loadDemoData()/exitSandboxMode().
 *
 * Every id/date is generated FRESH on each call (ids are stable strings —
 * demo data is never persisted or re-hydrated across calls, so uniqueness
 * across sessions doesn't matter; dates are relative to `new Date()` so the
 * demo always looks current whenever it's loaded, never stuck in the past).
 *
 * Deliberately reuses the REAL default account modes / broker partitions
 * (Bank Account, Credit Card, UPI, Primary Broker, Long-Term Portfolio,
 * Mutual Funds, Cash) rather than inventing custom ones — those already
 * resolve to real labels everywhere in the UI, so the demo needs no extra
 * store slices (customAccountModes etc.) swapped in alongside it.
 *
 * NOTE: only `import type` from "@/lib/store" — store.tsx imports this
 * module's `getDemoSnapshot` at runtime, so a value import here would close
 * a require cycle (same reasoning as src/lib/db/mappers.ts's doc comment).
 */
import { calculateRequiredNetWorth } from "./projectionEngine";
import { pinToNoonUTC, todayLocalISO } from "./format";
import type {
  BlueprintSettings,
  Milestone,
  PortfolioSnapshot,
  ProjectionSettings,
  Trade,
  Transaction,
} from "./store";

export type DemoSnapshot = {
  transactions: Transaction[];
  trades: Trade[];
  portfolioSnapshots: PortfolioSnapshot[];
  blueprintSettings: BlueprintSettings;
  projectionSettings: ProjectionSettings;
  milestones: Milestone[];
  enableFnoTracking: boolean;
};

function daysAgoISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function demoTransactions(): Transaction[] {
  return [
    { id: "demo-tx-salary", date: daysAgoISO(4), type: "income", category: "Salary", account: "Bank Account", amount: 180_000, tags: [] },
    { id: "demo-tx-freelance", date: daysAgoISO(2), type: "income", category: "Freelance", account: "Bank Account", amount: 15_000, tags: [] },
    { id: "demo-tx-rent", date: daysAgoISO(3), type: "expense", category: "Rent", account: "Bank Account", amount: 32_000, tags: [] },
    { id: "demo-tx-utilities", date: daysAgoISO(6), type: "expense", category: "Utilities", account: "Bank Account", amount: 3_800, tags: [] },
    { id: "demo-tx-groceries", date: daysAgoISO(7), type: "expense", category: "Groceries", account: "UPI", amount: 9_500, tags: [] },
    { id: "demo-tx-dining-1", date: daysAgoISO(9), type: "expense", category: "Dining", account: "Credit Card", amount: 6_200, tags: [] },
    { id: "demo-tx-dining-2", date: daysAgoISO(16), type: "expense", category: "Dining", account: "UPI", amount: 2_800, tags: [] },
    { id: "demo-tx-subscriptions", date: daysAgoISO(5), type: "expense", category: "Subscriptions", account: "Credit Card", amount: 1_499, tags: [] },
    { id: "demo-tx-fuel", date: daysAgoISO(11), type: "expense", category: "Fuel", account: "UPI", amount: 4_200, tags: [] },
    { id: "demo-tx-emi", date: daysAgoISO(6), type: "expense", category: "Loan/EMI", account: "Bank Account", amount: 9_000, tags: [] },
    {
      id: "demo-tx-sip",
      date: daysAgoISO(6),
      type: "expense",
      category: "Capital Transfer (Out)",
      account: "Bank Account",
      amount: 50_000,
      tags: [],
      notes: "Groww MF SIP",
    },
    {
      id: "demo-tx-shopping",
      date: daysAgoISO(13),
      type: "expense",
      category: "Other",
      account: "Credit Card",
      amount: 7_500,
      tags: [],
      notes: "Shopping",
    },
    {
      id: "demo-tx-entertainment",
      date: daysAgoISO(19),
      type: "expense",
      category: "Other",
      account: "UPI",
      amount: 3_000,
      tags: [],
      notes: "Movies & entertainment",
    },
  ];
}

function demoTrades(): Trade[] {
  return [
    // Equity swing — win
    {
      id: "demo-trade-reliance",
      ticker: "RELIANCE",
      entryDate: daysAgoISO(20),
      direction: "LONG",
      qty: 50,
      entryPrice: 2_450,
      targetPrice: 2_600,
      stopLoss: 2_380,
      source: "Self",
      partition: "Primary Broker",
      status: "closed",
      closeReason: "target",
      exitDate: daysAgoISO(12),
      exitPrice: 2_580,
      pnl: 6_500,
      assetClass: "equity",
      charges: 145,
      netPnl: 6_355,
      exitReason: "target",
    },
    // Equity swing — loss
    {
      id: "demo-trade-tatasteel",
      ticker: "TATASTEEL",
      entryDate: daysAgoISO(25),
      direction: "LONG",
      qty: 200,
      entryPrice: 142,
      targetPrice: 155,
      stopLoss: 135,
      source: "Self",
      partition: "Primary Broker",
      status: "closed",
      closeReason: "stoploss",
      exitDate: daysAgoISO(18),
      exitPrice: 135,
      pnl: -1_400,
      assetClass: "equity",
      charges: 78,
      netPnl: -1_478,
      exitReason: "stop_loss",
    },
    // F&O option — win
    {
      id: "demo-trade-nifty-ce",
      ticker: "NIFTY",
      entryDate: daysAgoISO(15),
      direction: "LONG",
      qty: 50,
      entryPrice: 120,
      targetPrice: 200,
      stopLoss: 90,
      source: "Self",
      partition: "Primary Broker",
      status: "closed",
      closeReason: "target",
      exitDate: daysAgoISO(8),
      exitPrice: 180,
      pnl: 3_000,
      assetClass: "fno",
      expiry: "28-Aug-2026",
      strike: 24_500,
      lotSize: 50,
      optionType: "CE",
      charges: 210,
      netPnl: 2_790,
      exitReason: "target",
    },
    // F&O future — loss
    {
      id: "demo-trade-banknifty-fut",
      ticker: "BANKNIFTY",
      entryDate: daysAgoISO(10),
      direction: "LONG",
      qty: 15,
      entryPrice: 48_200,
      targetPrice: 49_000,
      stopLoss: 47_800,
      source: "Self",
      partition: "Primary Broker",
      status: "closed",
      closeReason: "stoploss",
      exitDate: daysAgoISO(4),
      exitPrice: 47_900,
      pnl: -4_500,
      assetClass: "fno",
      expiry: "28-Aug-2026",
      lotSize: 15,
      optionType: "FUT",
      charges: 245,
      netPnl: -4_745,
      exitReason: "stop_loss",
    },
  ];
}

function demoPortfolioSnapshots(): PortfolioSnapshot[] {
  const snapshotDate = pinToNoonUTC(todayLocalISO());
  return [
    { id: "demo-snap-long-term", snapshotDate, brokerPartition: "Long-Term Portfolio", currentValue: 1_400_000, notes: "Zerodha equity + Gold SGBs" },
    { id: "demo-snap-mf", snapshotDate, brokerPartition: "Mutual Funds", currentValue: 950_000, notes: "Groww mutual funds" },
    { id: "demo-snap-cash", snapshotDate, brokerPartition: "Cash", currentValue: 500_000, notes: "Fixed deposits + liquid reserve" },
  ];
}

const DEMO_BLUEPRINT: BlueprintSettings = {
  defaultSalary: 180_000,
  fixedRunrate: 35_800, // Rent 32,000 + Utilities 3,800
  scooterEmi: 9_000,
  defaultRiskCapPct: 0.03,
  growwMfSip: 50_000,
  riskCapPartition: "Primary Broker",
};

const DEMO_PROJECTION_SETTINGS: ProjectionSettings = {
  monthlySip: 50_000,
  stepUpPercent: 10,
  expectedCagr: 12,
  inflationRate: 6,
  horizonYears: 15,
  scenario: "base",
  adjustForInflation: false,
};

function demoMilestones(): Milestone[] {
  const evAllocationPercent = 20; // Major Want default
  const evDownpayment = 500_000;
  const gamingCost = 300_000;
  const gamingAllocationPercent = 20; // -> 5.0x buffer, matching the task's "5x buffer" spec

  return [
    {
      id: "demo-milestone-net-worth",
      name: "₹1 Cr Net Worth",
      targetAmount: 10_000_000,
      targetType: "net_worth",
      isFinanced: false,
      isCustom: true,
    },
    {
      id: "demo-milestone-ev-car",
      name: "EV Car",
      targetType: "major_want",
      itemCost: evDownpayment, // mirrors downpaymentAmount — see Milestone.itemCost doc comment
      allocationPercent: evAllocationPercent,
      isFinanced: true,
      totalAssetCost: 2_500_000,
      downpaymentAmount: evDownpayment,
      targetAmount: calculateRequiredNetWorth(evDownpayment, evAllocationPercent),
      isCustom: true,
    },
    {
      id: "demo-milestone-gaming-pc",
      name: "Gaming PC",
      targetType: "major_want",
      itemCost: gamingCost,
      allocationPercent: gamingAllocationPercent,
      isFinanced: false,
      targetAmount: calculateRequiredNetWorth(gamingCost, gamingAllocationPercent),
      isCustom: true,
    },
  ];
}

/** The full mock bundle AppTourModal's "Load Demo Sandbox" injects into the store. */
export function getDemoSnapshot(): DemoSnapshot {
  return {
    transactions: demoTransactions(),
    trades: demoTrades(),
    portfolioSnapshots: demoPortfolioSnapshots(),
    blueprintSettings: DEMO_BLUEPRINT,
    projectionSettings: DEMO_PROJECTION_SETTINGS,
    milestones: demoMilestones(),
    enableFnoTracking: true,
  };
}

/** True when the given store's data is the demo sandbox bundle, not the user's own. */
export function isSandboxActive(store: { isSandboxMode: boolean }): boolean {
  return store.isSandboxMode;
}
