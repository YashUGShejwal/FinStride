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
  AccountMode,
  AccountType,
  BlueprintSettings,
  BrokerPartition,
  CustomCategories,
  GrindLogEntry,
  GrindMetricKey,
  HustleCategory,
  HustleEntry,
  Milestone,
  MilestoneTargetType,
  MonthlyPending,
  PartitionCategory,
  PartitionPurpose,
  PortfolioSnapshot,
  ProjectionSettings,
  Scenario,
  Trade,
  Transaction,
} from "@/lib/store";
import type {
  DbAccountModeJson,
  DbBrokerPartitionJson,
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
  DbProjectionSettingsJson,
  DbSwingTradeInsert,
  DbSwingTradeRow,
  DbUserMilestoneInsert,
  DbUserMilestoneRow,
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
    exit_price: t.exitPrice ?? null,
    pnl: t.pnl ?? null,
    close_execution_id: t.closeExecutionId ?? null,
    asset_class: t.assetClass ?? "equity",
    expiry: t.expiry ?? null,
    strike: t.strike ?? null,
    lot_size: t.lotSize ?? null,
    option_type: t.optionType ?? null,
    charges: t.charges ?? null,
    net_pnl: t.netPnl ?? null,
    exit_reason: t.exitReason ?? null,
  };
}

export function rowToTrade(r: DbSwingTradeRow): Trade {
  return {
    id: r.id,
    ticker: r.ticker,
    entryDate: fromDbDate(r.entry_date),
    direction: r.direction === "SHORT" ? "SHORT" : "LONG",
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
    exitPrice: r.exit_price !== null && r.exit_price !== undefined ? Number(r.exit_price) : undefined,
    pnl: r.pnl !== null && r.pnl !== undefined ? Number(r.pnl) : undefined,
    closeExecutionId: r.close_execution_id ?? undefined,
    assetClass: r.asset_class === "fno" ? "fno" : undefined,
    expiry: r.expiry ?? undefined,
    strike: r.strike !== null && r.strike !== undefined ? Number(r.strike) : undefined,
    lotSize: r.lot_size !== null && r.lot_size !== undefined ? Number(r.lot_size) : undefined,
    optionType:
      r.option_type === "CE" || r.option_type === "PE" || r.option_type === "FUT"
        ? r.option_type
        : undefined,
    charges: r.charges !== null && r.charges !== undefined ? Number(r.charges) : undefined,
    netPnl: r.net_pnl !== null && r.net_pnl !== undefined ? Number(r.net_pnl) : undefined,
    exitReason:
      r.exit_reason === "target" ||
      r.exit_reason === "stop_loss" ||
      r.exit_reason === "manual" ||
      r.exit_reason === "tradebook_sync"
        ? r.exit_reason
        : undefined,
  };
}

// ─── Snapshots <-> portfolio_snapshots ─────────────────────────────────────
// snapshot_date is TIMESTAMPTZ, so the INSTANT round-trips with no truncation —
// but PostgREST serializes it as e.g. "2026-08-10T12:00:00+00:00", not the
// "2026-08-10T12:00:00.000Z" the app writes and does string equality/ordering
// on throughout analytics.tsx (exact-date x-axis lookups, dedupe via Set,
// carry-forward comparisons). Without normalizing on read, a snapshot fetched
// from the cloud and a snapshot just added locally for the SAME instant compare
// as different strings — same day, two x-axis points, phantom duplicate rows.
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

/** Canonicalize any ISO-ish timestamp string to the exact format the app writes. */
function normalizeInstant(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString();
}

export function rowToSnapshot(r: DbPortfolioSnapshotRow): PortfolioSnapshot {
  return {
    id: r.id,
    snapshotDate: normalizeInstant(r.snapshot_date),
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
    // Same PostgREST-vs-JS timestamptz string mismatch as portfolio_snapshots
    // (see normalizeInstant above) — nothing compares loggedAt today, but
    // normalizing keeps the app model's timestamp format uniform regardless
    // of source.
    entry: { id: r.id, loggedAt: normalizeInstant(r.logged_at), label: r.label, meta: r.meta ?? undefined },
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
  customAccountModes: AccountMode[];
  customBrokerPartitions: BrokerPartition[];
  customIncomeCategories: string[];
  customExpenseCategories: string[];
  hiddenDefaultCategories: CustomCategories;
  hiddenDefaultAccountIds: string[];
  hiddenDefaultPartitionIds: string[];
  enableFnoTracking: boolean;
  projectionSettings: ProjectionSettings;
};

const ACCOUNT_TYPES: readonly string[] = ["bank", "credit_card", "upi", "cash", "wallet"];
const PARTITION_CATEGORIES: readonly string[] = [
  "equity_swing",
  "long_term_etf",
  "mutual_funds",
  "crypto",
  "liquid",
];
const PARTITION_PURPOSES: readonly string[] = [
  "long_term",
  "swing",
  "international",
  "crypto",
  "liquid",
  "custom",
];

/** Mirrors PURPOSE_BY_CATEGORY in src/lib/store.tsx — duplicated to keep this module import-cycle-free. */
const PURPOSE_FALLBACK: Record<string, PartitionPurpose> = {
  equity_swing: "swing",
  long_term_etf: "long_term",
  mutual_funds: "long_term",
  crypto: "crypto",
  liquid: "liquid",
};

function accountModeToJson(a: AccountMode): DbAccountModeJson {
  return {
    id: a.id,
    name: a.name,
    type: a.type,
    linkedBankId: a.linkedBankId ?? null,
    channelLabel: a.channelLabel ?? null,
  };
}

function jsonToAccountMode(raw: unknown): AccountMode | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id : "";
  if (!id.trim()) return null;
  const type = ACCOUNT_TYPES.includes(r.type as string) ? (r.type as AccountType) : "bank";
  // `defaultChannel` is the pre-relational column name — read it as a fallback
  // so rows written before this model keep their channel.
  const channelRaw = r.channelLabel ?? r.defaultChannel;
  const linked = typeof r.linkedBankId === "string" ? r.linkedBankId.trim() : "";
  return {
    id,
    name: typeof r.name === "string" && r.name.trim() ? r.name : id,
    type,
    linkedBankId: linked || undefined,
    channelLabel:
      typeof channelRaw === "string" && channelRaw.trim() ? channelRaw.trim() : undefined,
  };
}

function brokerPartitionToJson(p: BrokerPartition): DbBrokerPartitionJson {
  return {
    id: p.id,
    name: p.name,
    purpose: p.purpose,
    category: p.category,
    brokerApp: p.brokerApp ?? null,
    description: p.description ?? null,
  };
}

function jsonToBrokerPartition(raw: unknown): BrokerPartition | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id : "";
  if (!id.trim()) return null;
  const category = PARTITION_CATEGORIES.includes(r.category as string)
    ? (r.category as PartitionCategory)
    : "equity_swing";
  return {
    id,
    name: typeof r.name === "string" && r.name.trim() ? r.name : id,
    // Rows written before `purpose` existed get one inferred from category
    // rather than all collapsing into a single bucket.
    purpose: PARTITION_PURPOSES.includes(r.purpose as string)
      ? (r.purpose as PartitionPurpose)
      : (PURPOSE_FALLBACK[category] ?? "custom"),
    category,
    brokerApp: typeof r.brokerApp === "string" && r.brokerApp.trim() ? r.brokerApp : undefined,
    description: typeof r.description === "string" ? r.description : undefined,
  };
}

/**
 * Kept in sync with DEFAULT_PROJECTION_SETTINGS in src/lib/store.tsx — see the
 * import-cycle note at the top of this file for why this can't just import
 * that constant directly.
 */
const PROJECTION_FALLBACK: ProjectionSettings = {
  monthlySip: 0,
  stepUpPercent: 10,
  expectedCagr: 12,
  inflationRate: 6,
  horizonYears: 15,
  scenario: "base",
  adjustForInflation: false,
};

function projectionSettingsToJson(p: ProjectionSettings): DbProjectionSettingsJson {
  return {
    monthlySip: p.monthlySip,
    stepUpPercent: p.stepUpPercent,
    expectedCagr: p.expectedCagr,
    inflationRate: p.inflationRate,
    horizonYears: p.horizonYears,
    scenario: p.scenario,
    adjustForInflation: p.adjustForInflation,
  };
}

function jsonToProjectionSettings(raw: unknown): ProjectionSettings {
  if (!raw || typeof raw !== "object") return PROJECTION_FALLBACK;
  const r = raw as Record<string, unknown>;
  const scenario: Scenario =
    r.scenario === "conservative" || r.scenario === "base" || r.scenario === "aggressive"
      ? r.scenario
      : PROJECTION_FALLBACK.scenario;
  return {
    monthlySip: typeof r.monthlySip === "number" ? r.monthlySip : PROJECTION_FALLBACK.monthlySip,
    stepUpPercent:
      typeof r.stepUpPercent === "number" ? r.stepUpPercent : PROJECTION_FALLBACK.stepUpPercent,
    expectedCagr:
      typeof r.expectedCagr === "number" ? r.expectedCagr : PROJECTION_FALLBACK.expectedCagr,
    inflationRate:
      typeof r.inflationRate === "number" ? r.inflationRate : PROJECTION_FALLBACK.inflationRate,
    horizonYears:
      typeof r.horizonYears === "number" ? r.horizonYears : PROJECTION_FALLBACK.horizonYears,
    scenario,
    adjustForInflation:
      typeof r.adjustForInflation === "boolean"
        ? r.adjustForInflation
        : PROJECTION_FALLBACK.adjustForInflation,
  };
}

export function settingsToRow(b: SettingsBundle, userId: string): DbUserSettingsUpsert {
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
    custom_account_modes: b.customAccountModes.map(accountModeToJson),
    custom_broker_partitions: b.customBrokerPartitions.map(brokerPartitionToJson),
    income_categories: b.customIncomeCategories,
    expense_categories: b.customExpenseCategories,
    hidden_default_income_categories: b.hiddenDefaultCategories.income,
    hidden_default_expense_categories: b.hiddenDefaultCategories.expense,
    hidden_default_account_ids: b.hiddenDefaultAccountIds,
    hidden_default_partition_ids: b.hiddenDefaultPartitionIds,
    enable_fno_tracking: b.enableFnoTracking,
    projection_settings: projectionSettingsToJson(b.projectionSettings),
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
  defaultSalary: 0,
  fixedRunrate: 0,
  scooterEmi: 0,
  growwMfSip: 0,
  defaultRiskCapPct: 0.03,
  riskCapPartition: "Primary Broker",
} as const;

export function rowToSettings(r: DbUserSettings): SettingsBundle {
  const num = (v: unknown, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  const list = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];

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
    customAccountModes: Array.isArray(r.custom_account_modes)
      ? r.custom_account_modes.map(jsonToAccountMode).filter((a): a is AccountMode => a !== null)
      : [],
    customBrokerPartitions: Array.isArray(r.custom_broker_partitions)
      ? r.custom_broker_partitions
          .map(jsonToBrokerPartition)
          .filter((p): p is BrokerPartition => p !== null)
      : [],
    customIncomeCategories: list(r.income_categories),
    customExpenseCategories: list(r.expense_categories),
    hiddenDefaultCategories: {
      income: list(r.hidden_default_income_categories),
      expense: list(r.hidden_default_expense_categories),
    } satisfies CustomCategories,
    hiddenDefaultAccountIds: list(r.hidden_default_account_ids),
    hiddenDefaultPartitionIds: list(r.hidden_default_partition_ids),
    enableFnoTracking: r.enable_fno_tracking === true,
    projectionSettings: jsonToProjectionSettings(r.projection_settings),
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

// ─── Milestones <-> user_milestones ─────────────────────────────────────────
function milestoneTargetType(raw: unknown): MilestoneTargetType {
  return raw === "net_worth" || raw === "asset_goal" || raw === "custom" ? raw : "custom";
}

export function milestoneToRow(m: Milestone, userId: string): DbUserMilestoneInsert {
  return {
    id: m.id,
    user_id: userId,
    name: m.name,
    target_amount: m.targetAmount,
    is_custom: m.isCustom,
    target_type: m.targetType,
  };
}

export function rowToMilestone(r: DbUserMilestoneRow): Milestone {
  return {
    id: r.id,
    name: r.name,
    targetAmount: Number(r.target_amount),
    targetType: milestoneTargetType(r.target_type),
    isCustom: r.is_custom === true,
  };
}
