/**
 * Conversion between Postgres row shapes (snake_case, src/lib/db/types.ts) and
 * the camelCase app models used by src/lib/store.tsx.
 *
 * Date handling — the two directions must round-trip exactly:
 *   App models store full ISO strings. DATE columns store calendar days.
 *   The app builds day-valued dates as `new Date("YYYY-MM-DD").toISOString()`,
 *   which is UTC midnight, so slicing the UTC date back out is lossless for
 *   those values. fromDbDate() rebuilds the same UTC-midnight ISO string, so
 *   app -> DB -> app is stable.
 */

// NOTE: every import from "@/lib/store" here is `import type` on purpose.
// store.tsx imports this module's siblings at runtime, so a value import would
// close a require cycle (store -> db -> mappers -> store) and risk reading an
// uninitialised binding at module-eval time. Type imports are erased entirely.
import type {
  BlueprintSettings,
  CustomPartition,
  GrindLogEntry,
  GrindMetricKey,
  HustleCategory,
  HustleEntry,
  MonthlyPending,
  PortfolioSnapshot,
  Trade,
  Transaction,
} from "@/lib/store";
import type {
  DbCashflowInsert,
  DbCashflowRow,
  DbGrindLogInsert,
  DbGrindLogRow,
  DbHustleEntryInsert,
  DbHustleEntryRow,
  DbPendingObligationRow,
  DbPendingObligationUpsert,
  DbPortfolioSnapshotInsert,
  DbPortfolioSnapshotRow,
  DbSwingTradeInsert,
  DbSwingTradeRow,
  DbUserSettings,
  DbUserSettingsUpsert,
} from "./types";

// ─── Date helpers ──────────────────────────────────────────────────────────
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** ISO timestamp (or bare YYYY-MM-DD) -> DATE column value "YYYY-MM-DD". */
export function toDbDate(iso: string): string {
  if (DATE_ONLY_RE.test(iso)) return iso;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

/** DATE column value "YYYY-MM-DD" -> the UTC-midnight ISO string the app stores. */
export function fromDbDate(date: string): string {
  if (DATE_ONLY_RE.test(date)) return `${date}T00:00:00.000Z`;
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

// ─── Transactions <-> cashflow_ledger ──────────────────────────────────────
export function transactionToRow(t: Transaction, userId: string): DbCashflowInsert {
  return {
    id: t.id,
    user_id: userId,
    date: toDbDate(t.date),
    type: t.type,
    category: t.category,
    account: t.account,
    amount: t.amount,
    tags: t.tags ?? [],
    notes: t.notes ?? null,
  };
}

export function rowToTransaction(r: DbCashflowRow): Transaction {
  return {
    id: r.id,
    date: fromDbDate(r.date),
    type: r.type === "income" ? "income" : "expense",
    category: r.category,
    account: r.account,
    amount: Number(r.amount),
    tags: Array.isArray(r.tags) ? r.tags : [],
    notes: r.notes ?? undefined,
  };
}

// ─── Trades <-> swing_trades ───────────────────────────────────────────────
export function tradeToRow(t: Trade, userId: string): DbSwingTradeInsert {
  return {
    id: t.id,
    user_id: userId,
    ticker: t.ticker,
    entry_date: toDbDate(t.entryDate),
    exit_date: t.exitDate ? toDbDate(t.exitDate) : null,
    direction: t.direction,
    qty: t.qty,
    entry_price: t.entryPrice,
    target_price: t.targetPrice,
    stop_loss: t.stopLoss,
    source: t.source,
    partition: t.partition,
    notes: t.notes ?? null,
    status: t.status,
    close_reason: t.closeReason ?? null,
    close_notes: t.closeNotes ?? null,
  };
}

export function rowToTrade(r: DbSwingTradeRow): Trade {
  return {
    id: r.id,
    ticker: r.ticker,
    entryDate: fromDbDate(r.entry_date),
    direction: "LONG",
    qty: Number(r.qty),
    entryPrice: Number(r.entry_price),
    targetPrice: Number(r.target_price),
    stopLoss: Number(r.stop_loss),
    source: r.source === "Self" ? "Self" : "TheDoji",
    partition: r.partition,
    notes: r.notes ?? undefined,
    status: r.status === "closed" ? "closed" : "open",
    closeReason:
      r.close_reason === "target" || r.close_reason === "stoploss" || r.close_reason === "other"
        ? r.close_reason
        : undefined,
    closeNotes: r.close_notes ?? undefined,
    exitDate: r.exit_date ? fromDbDate(r.exit_date) : undefined,
  };
}

// ─── Snapshots <-> portfolio_snapshots ─────────────────────────────────────
// snapshot_date is TIMESTAMPTZ, so the full instant round-trips with no truncation.
export function snapshotToRow(s: PortfolioSnapshot, userId: string): DbPortfolioSnapshotInsert {
  return {
    id: s.id,
    user_id: userId,
    snapshot_date: s.snapshotDate,
    broker_partition: s.brokerPartition,
    current_value: s.currentValue,
    notes: s.notes ?? null,
  };
}

export function rowToSnapshot(r: DbPortfolioSnapshotRow): PortfolioSnapshot {
  return {
    id: r.id,
    snapshotDate: r.snapshot_date,
    brokerPartition: r.broker_partition,
    currentValue: Number(r.current_value),
    notes: r.notes ?? undefined,
  };
}

// ─── Grind logs <-> grind_logs ─────────────────────────────────────────────
export function grindLogToRow(
  e: GrindLogEntry,
  metric: GrindMetricKey,
  userId: string,
): DbGrindLogInsert {
  return {
    id: e.id,
    user_id: userId,
    metric,
    label: e.label,
    meta: e.meta ?? null,
    logged_at: e.loggedAt,
  };
}

export function rowToGrindLog(r: DbGrindLogRow): { metric: GrindMetricKey; entry: GrindLogEntry } {
  const metric: GrindMetricKey =
    r.metric === "leetcode" || r.metric === "linkedinOutreach" || r.metric === "systemDesign"
      ? r.metric
      : "systemDesign";
  return {
    metric,
    entry: { id: r.id, loggedAt: r.logged_at, label: r.label, meta: r.meta ?? undefined },
  };
}

// ─── Hustle <-> hustle_entries ─────────────────────────────────────────────
export function hustleToRow(e: HustleEntry, userId: string): DbHustleEntryInsert {
  return {
    id: e.id,
    user_id: userId,
    date: toDbDate(e.date),
    category: e.category,
    description: e.description,
    amount: e.amount,
  };
}

const HUSTLE_CATS: readonly string[] = ["Freelance", "Consulting", "Media Production"];

export function rowToHustle(r: DbHustleEntryRow): HustleEntry {
  return {
    id: r.id,
    date: fromDbDate(r.date),
    category: (HUSTLE_CATS.includes(r.category) ? r.category : "Freelance") as HustleCategory,
    description: r.description,
    amount: Number(r.amount),
  };
}

// ─── Settings <-> user_settings ────────────────────────────────────────────
/** Everything the app persists into the single user_settings row. */
export type SettingsBundle = {
  blueprint: BlueprintSettings;
  showPersonalQuotes: boolean;
  customPaymentModes: string[];
  customPartitions: CustomPartition[];
  customIncomeCategories: string[];
  customExpenseCategories: string[];
};

export function settingsToRow(b: SettingsBundle, userId: string): DbUserSettingsUpsert {
  // investment_apps and portfolio_partitions are both written from the app's
  // single customPartitions list — the app derives both views from one source.
  const partitionIds = b.customPartitions.map((p) => p.id);
  return {
    user_id: userId,
    salary_baseline: b.blueprint.defaultSalary,
    fixed_runrate: b.blueprint.fixedRunrate,
    scooter_emi: b.blueprint.scooterEmi,
    groww_mf_sip: b.blueprint.growwMfSip,
    // account_balance exists in the schema but the app no longer uses a static
    // balance (risk cap is snapshot-driven). Persisted as 0 for schema fidelity.
    account_balance: 0,
    risk_cap_pct: b.blueprint.defaultRiskCapPct,
    risk_cap_partition: b.blueprint.riskCapPartition,
    show_personal_quotes: b.showPersonalQuotes,
    payment_modes: b.customPaymentModes,
    investment_apps: partitionIds,
    portfolio_partitions: partitionIds,
    income_categories: b.customIncomeCategories,
    expense_categories: b.customExpenseCategories,
  };
}

/**
 * Fallbacks used only if a column somehow holds a non-numeric/blank value.
 * Every one of these columns is NOT NULL DEFAULT in the schema, so in practice
 * these never fire — they exist so this module needs no runtime import from
 * store.tsx (see the import-cycle note at the top of this file). They are kept
 * in sync with DEFAULT_BLUEPRINT in src/lib/store.tsx.
 */
const SETTINGS_FALLBACK = {
  defaultSalary: 76000,
  fixedRunrate: 39000,
  scooterEmi: 9000,
  growwMfSip: 5000,
  defaultRiskCapPct: 0.03,
  riskCapPartition: "Dhan Swing",
} as const;

export function rowToSettings(r: DbUserSettings): SettingsBundle {
  const num = (v: unknown, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  const list = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];

  // portfolio_partitions is the primary source; investment_apps mirrors it, so
  // fall back to it if an older row only populated one of the two columns.
  const partitionIds = list(r.portfolio_partitions).length
    ? list(r.portfolio_partitions)
    : list(r.investment_apps);

  return {
    blueprint: {
      defaultSalary: num(r.salary_baseline, SETTINGS_FALLBACK.defaultSalary),
      fixedRunrate: num(r.fixed_runrate, SETTINGS_FALLBACK.fixedRunrate),
      scooterEmi: num(r.scooter_emi, SETTINGS_FALLBACK.scooterEmi),
      growwMfSip: num(r.groww_mf_sip, SETTINGS_FALLBACK.growwMfSip),
      defaultRiskCapPct: num(r.risk_cap_pct, SETTINGS_FALLBACK.defaultRiskCapPct),
      riskCapPartition:
        typeof r.risk_cap_partition === "string" && r.risk_cap_partition.trim()
          ? r.risk_cap_partition
          : SETTINGS_FALLBACK.riskCapPartition,
    },
    showPersonalQuotes: r.show_personal_quotes === true,
    customPaymentModes: list(r.payment_modes),
    customPartitions: partitionIds.map((id) => ({ id, label: id, description: "" })),
    customIncomeCategories: list(r.income_categories),
    customExpenseCategories: list(r.expense_categories),
  };
}

// ─── Pending obligations <-> pending_obligations ───────────────────────────
export function pendingToRow(
  p: MonthlyPending,
  yearMonth: string,
  userId: string,
): DbPendingObligationUpsert {
  return {
    user_id: userId,
    year_month: yearMonth,
    fixed_runrate: p.fixedRunrate === true,
    scooter_emi: p.scooterEmi === true,
    groww_mf_sip: p.growwMfSip === true,
    cc_settled: p.ccSettled === true,
  };
}

export function rowToPending(r: DbPendingObligationRow): MonthlyPending {
  return {
    fixedRunrate: r.fixed_runrate === true,
    scooterEmi: r.scooter_emi === true,
    growwMfSip: r.groww_mf_sip === true,
    ccSettled: r.cc_settled === true,
  };
}
