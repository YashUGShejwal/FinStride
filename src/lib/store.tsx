import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { isRunningStandalone, type BeforeInstallPromptEvent } from "@/lib/platform";
import {
  deleteGrindLogRow,
  deleteHustleEntryRow,
  deleteSnapshotRow,
  deleteTradeRow,
  deleteTransactionRow,
  fetchAllUserData,
  getSupabaseBrowserClient,
  hasMigrated,
  isBundleEmpty,
  isSupabaseConfigured,
  markMigrated,
  migrateLocalDataToSupabase,
  upsertGrindLog as dbUpsertGrindLog,
  upsertHustleEntry as dbUpsertHustleEntry,
  upsertPendingObligations,
  upsertSettings as dbUpsertSettings,
  upsertSnapshots as dbUpsertSnapshots,
  upsertTrade as dbUpsertTrade,
  upsertTransaction as dbUpsertTransaction,
  type FinStrideClient,
} from "@/lib/db";

// ─── Payment modes (Cashflow ledger) ───────────────────────────────────────
// Extensible: DEFAULT_PAYMENT_MODES are always available; users can add more
// via Settings. Existing transactions keep working regardless of what's
// configured later — the type is a plain string, not a closed union.
export type PaymentMode = string;
export const DEFAULT_PAYMENT_MODES: readonly string[] = ["Bank Account", "Cash", "Credit Card"];

// ─── Investment broker partitions (Swing logger, Cashflow, Profile) ────────
// Extensible: DEFAULT_INVESTMENT_APPS are always available; users can add more
// via Settings. Both BrokerPartition and PortfolioPartitionKey are plain
// strings — arbitrary values are safe to store on existing trade/snapshot rows.
export type BrokerPartition = string;
export type PortfolioPartitionKey = string;

export type InvestmentApp = {
  id: BrokerPartition;
  label: string;
  description: string;
  scopes: ("cashflow" | "swing")[];
};

export const DEFAULT_INVESTMENT_APPS: readonly InvestmentApp[] = [
  {
    id: "Long-Term Portfolio",
    label: "Long-Term Portfolio",
    description: "Long-hold equity vault (delivery)",
    scopes: ["cashflow", "swing"],
  },
  {
    id: "Primary Broker",
    label: "Primary Broker",
    description: "Active swing book — equity only",
    scopes: ["cashflow", "swing"],
  },
  {
    id: "International Broker",
    label: "International Broker",
    description: "International equities partition",
    scopes: ["cashflow", "swing"],
  },
  {
    id: "Crypto Wallet",
    label: "Crypto Wallet",
    description: "Crypto holdings",
    scopes: ["cashflow", "swing"],
  },
  {
    id: "Mutual Funds",
    label: "Mutual Funds",
    description: "Mutual fund SIPs",
    scopes: ["cashflow", "swing"],
  },
  {
    id: "Cash",
    label: "Cash",
    description: "Physical cash & liquid reserves",
    scopes: ["cashflow", "swing"],
  },
] as const;

export function appsForScope(apps: InvestmentApp[], scope: "cashflow" | "swing"): InvestmentApp[] {
  return apps.filter((a) => a.scopes.includes(scope));
}

// ─── Portfolio snapshots ───────────────────────────────────────────────────
export const DEFAULT_PORTFOLIO_PARTITIONS: readonly {
  key: PortfolioPartitionKey;
  label: string;
  description: string;
}[] = [
  { key: "Long-Term Portfolio", label: "Long-Term Portfolio", description: "Long-term ETFs & bonds" },
  { key: "Primary Broker", label: "Primary Broker", description: "Active equity swings" },
  { key: "International Broker", label: "International Broker", description: "International fractional stocks" },
  { key: "Cash", label: "Liquid Cash", description: "Emergency bank balance" },
] as const;

/** A user-added broker/investment partition beyond the built-in defaults. */
export type CustomPartition = { id: string; label: string; description: string };

/**
 * One per-partition row — mirrors portfolio_snapshots DB schema exactly.
 */
export type PortfolioSnapshot = {
  id: string;
  snapshotDate: string;
  brokerPartition: PortfolioPartitionKey;
  currentValue: number;
  notes?: string;
};

function normalizeSnapshot(raw: Record<string, unknown>): PortfolioSnapshot | PortfolioSnapshot[] {
  if (raw.brokerPartition !== undefined) {
    const partition = raw.brokerPartition;
    return {
      id: String(raw.id),
      snapshotDate: String(raw.snapshotDate ?? raw.recordedAt ?? new Date().toISOString()),
      brokerPartition: typeof partition === "string" && partition.trim() ? partition : "Cash",
      currentValue: Number(raw.currentValue) || 0,
      notes: raw.notes ? String(raw.notes) : undefined,
    };
  }
  // Legacy grouped shape migration — only the 4 original partitions ever used this shape.
  const legacyValues = (raw.values ?? {}) as Record<string, unknown>;
  const date = String(raw.recordedAt ?? new Date().toISOString());
  const rows: PortfolioSnapshot[] = [];
  for (const p of DEFAULT_PORTFOLIO_PARTITIONS) {
    const v = legacyValues[p.key];
    if (typeof v === "number" && !isNaN(v)) {
      rows.push({
        id: crypto.randomUUID(),
        snapshotDate: date,
        brokerPartition: p.key,
        currentValue: v,
        notes: raw.notes ? String(raw.notes) : undefined,
      });
    }
  }
  return rows;
}

// ─── Dynamic Blueprint Settings ────────────────────────────────────────────
export type BlueprintSettings = {
  defaultSalary: number;
  fixedRunrate: number;
  scooterEmi: number;
  defaultRiskCapPct: number; // 0–1, e.g. 0.03
  growwMfSip: number;
  /** Which partition's latest snapshot backs the swing-trade risk cap. */
  riskCapPartition: PortfolioPartitionKey;
};

// A fresh install must show ₹0 everywhere until the user configures their own
// numbers — these fallbacks are the initial state / "reset to defaults" value,
// never a stand-in for real financial data. riskCapPct stays 3% since it's a
// risk-management RULE, not a personal financial figure the way the ₹ amounts are.
export const DEFAULT_BLUEPRINT: BlueprintSettings = {
  defaultSalary: 0,
  fixedRunrate: 0,
  scooterEmi: 0,
  defaultRiskCapPct: 0.03,
  growwMfSip: 0,
  riskCapPartition: "Primary Broker",
};

const BLUEPRINT_KEY = "finstride.blueprint.settings";

function normalizeBlueprint(raw: unknown): BlueprintSettings {
  if (!raw || typeof raw !== "object") return DEFAULT_BLUEPRINT;
  const r = raw as Record<string, unknown>;
  // typeof === "number" (not `Number(x) || fallback`) so an intentionally-saved
  // 0 (e.g. "EMI paid off") isn't silently reverted to the hardcoded default —
  // 0 is falsy in JS, so `||` would otherwise always prefer the fallback.
  return {
    defaultSalary:
      typeof r.defaultSalary === "number" ? r.defaultSalary : DEFAULT_BLUEPRINT.defaultSalary,
    fixedRunrate:
      typeof r.fixedRunrate === "number" ? r.fixedRunrate : DEFAULT_BLUEPRINT.fixedRunrate,
    scooterEmi: typeof r.scooterEmi === "number" ? r.scooterEmi : DEFAULT_BLUEPRINT.scooterEmi,
    defaultRiskCapPct:
      typeof r.defaultRiskCapPct === "number"
        ? r.defaultRiskCapPct
        : DEFAULT_BLUEPRINT.defaultRiskCapPct,
    growwMfSip: typeof r.growwMfSip === "number" ? r.growwMfSip : DEFAULT_BLUEPRINT.growwMfSip,
    riskCapPartition:
      typeof r.riskCapPartition === "string" && r.riskCapPartition.trim()
        ? r.riskCapPartition
        : DEFAULT_BLUEPRINT.riskCapPartition,
  };
}

// ─── Dynamic Categories ────────────────────────────────────────────────────
export const DEFAULT_INCOME_CATEGORIES: readonly string[] = [
  "Salary",
  "Freelance",
  "Capital Transfer (In)",
  "Other",
];
export const DEFAULT_EXPENSE_CATEGORIES: readonly string[] = [
  "Fixed Runrate",
  "Loan/EMI",
  "Capital Transfer (Out)",
  "Other",
];

export type CustomCategories = { income: string[]; expense: string[] };
const CATEGORIES_KEY = "finstride.categories.custom";
const DEFAULT_CUSTOM_CATEGORIES: CustomCategories = { income: [], expense: [] };

function normalizeCustomCategories(raw: unknown): CustomCategories {
  if (!raw || typeof raw !== "object") return DEFAULT_CUSTOM_CATEGORIES;
  const r = raw as Record<string, unknown>;
  return {
    income: Array.isArray(r.income)
      ? (r.income as string[]).filter((s) => typeof s === "string")
      : [],
    expense: Array.isArray(r.expense)
      ? (r.expense as string[]).filter((s) => typeof s === "string")
      : [],
  };
}

// ─── Dynamic payment modes ─────────────────────────────────────────────────
const CUSTOM_PAYMENT_MODES_KEY = "finstride.paymentmodes.custom";

function normalizeCustomPaymentModes(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === "string") : [];
}

// ─── Dynamic broker/investment partitions ──────────────────────────────────
const CUSTOM_PARTITIONS_KEY = "finstride.partitions.custom";

function normalizeCustomPartitions(raw: unknown): CustomPartition[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r) => ({
      id: String(r.id ?? ""),
      label: r.label ? String(r.label) : String(r.id ?? ""),
      description: r.description ? String(r.description) : "",
    }))
    .filter((p) => p.id.trim() !== "");
}

// ─── Quote preferences ──────────────────────────────────────────────────────
// Whether the app-owner's personal reflection quotes are shown alongside the
// general pool — driven by an explicit user setting rather than a hardcoded
// owner-email check, and defaults off so a fresh install never shows someone
// else's personal notes without opting in.
const SHOW_PERSONAL_QUOTES_KEY = "finstride.quotes.showPersonal";

// ─── Connectivity & installability ─────────────────────────────────────────
// Neither has a localStorage key: both are live browser/OS facts (network
// state, install state) that must always reflect the CURRENT device/session,
// never a persisted value from a previous one.

// ─── Stealth privacy mode ───────────────────────────────────────────────────
// Blurs sensitive figures (net worth, balances, trade sizes, returns) across
// the app. A pure UI preference: persisted immediately, never synced to the
// cloud, and deliberately NOT part of ALL_LOCAL_KEYS so "Delete All Data"
// doesn't quietly switch privacy off.
const STEALTH_KEY = "finstride.ui.stealth";

// ─── Monthly obligations checklist ────────────────────────────────────────
export type ObligationKey = "fixedRunrate" | "scooterEmi" | "growwMfSip" | "ccSettled";
export type MonthlyPending = Partial<Record<ObligationKey, boolean>>;

const PENDING_KEY = "finstride.pending";

function loadAllPending(): Record<string, MonthlyPending> {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    return raw ? (JSON.parse(raw) as Record<string, MonthlyPending>) : {};
  } catch {
    return {};
  }
}

export function currentMonthKey(): string {
  return new Date().toISOString().slice(0, 7);
}

// ─── Legacy data normalizers ───────────────────────────────────────────────
// Maps both the old underscore-formatted names AND the earlier (specific
// broker-branded) canonical names to the current generic defaults, so any
// trade/snapshot recorded before this pass still resolves to a real default
// partition instead of surviving as an orphaned literal string.
const LEGACY_PARTITION_MAP: Record<string, string> = {
  Zerodha_Vault: "Long-Term Portfolio",
  Dhan_Swing: "Primary Broker",
  INDmoney_US: "International Broker",
  Liquid_Cash: "Cash",
  "Zerodha Vault": "Long-Term Portfolio",
  "Dhan Swing": "Primary Broker",
  "INDmoney US": "International Broker",
  "CoinDCX Crypto": "Crypto Wallet",
  "Groww MF": "Mutual Funds",
};

// Any non-empty string is a valid partition (built-in default or user custom) —
// only a missing/empty value falls back to a default. This must stay permissive
// (not restricted to an enumerated list) so custom partitions round-trip through
// localStorage correctly instead of being silently reset on reload.
function normalizePartition(raw: unknown): string {
  if (typeof raw === "string" && raw.trim()) {
    return LEGACY_PARTITION_MAP[raw] ?? raw;
  }
  return "Primary Broker";
}

// Same reasoning as normalizePartition — any non-empty string is valid.
function normalizePaymentMode(raw: unknown): string {
  return typeof raw === "string" && raw.trim() ? raw : "Bank Account";
}

// ─── Data types ────────────────────────────────────────────────────────────
export type TxType = "income" | "expense";
/**
 * User-extensible string. Default values live in DEFAULT_INCOME_CATEGORIES /
 * DEFAULT_EXPENSE_CATEGORIES. Custom additions are persisted separately.
 */
export type TxCategory = string;

/**
 * Mirrors cashflow_ledger DB columns (camelCase).
 * tags is a local UI-only field with no DB column.
 */
export type Transaction = {
  id: string;
  date: string;
  type: TxType;
  category: TxCategory;
  account: PaymentMode;
  amount: number;
  tags: string[];
  notes?: string;
};

// Accepts new schema (account), previous interim (paymentMode), and legacy (partition)
function normalizeTransaction(raw: Record<string, unknown>): Transaction {
  return {
    id: String(raw.id),
    date: String(raw.date),
    type: raw.type === "income" ? "income" : "expense",
    category: raw.category ? String(raw.category) : "Other",
    account: normalizePaymentMode(raw.account ?? raw.paymentMode ?? raw.partition),
    amount: Number(raw.amount),
    tags: Array.isArray(raw.tags) ? (raw.tags as string[]) : [],
    notes: raw.notes ? String(raw.notes) : undefined,
  };
}

export type TradeStatus = "open" | "closed";
export type CloseReason = "target" | "stoploss" | "other";

/**
 * Mirrors swing_trades DB columns (camelCase).
 * direction, partition, closeReason, closeNotes are local-only extensions.
 */
export type Trade = {
  id: string;
  ticker: string;
  entryDate: string;
  direction: "LONG";
  qty: number;
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  source: "TheDoji" | "Self";
  partition: BrokerPartition;
  notes?: string;
  status: TradeStatus;
  closeReason?: CloseReason;
  closeNotes?: string;
  exitDate?: string;
};

function normalizeTrade(raw: Record<string, unknown>): Trade {
  return {
    id: String(raw.id),
    ticker: String(raw.ticker),
    entryDate: String(raw.entryDate),
    direction: "LONG",
    qty: Number(raw.qty ?? raw.quantity ?? 0),
    entryPrice: Number(raw.entryPrice),
    targetPrice: Number(raw.targetPrice),
    stopLoss: Number(raw.stopLoss),
    source: raw.source === "Self" ? "Self" : "TheDoji",
    partition: normalizePartition(raw.partition ?? "Primary Broker"),
    notes: raw.notes ? String(raw.notes) : undefined,
    status: raw.status === "closed" ? "closed" : "open",
    closeReason: (raw.closeReason as CloseReason | undefined) ?? undefined,
    closeNotes: raw.closeNotes ? String(raw.closeNotes) : undefined,
    exitDate: raw.exitDate ? String(raw.exitDate) : raw.closedAt ? String(raw.closedAt) : undefined,
  };
}

// ─── Grind Deck ───────────────────────────────────────────────────────────
export type GrindMetricKey = "systemDesign" | "leetcode" | "linkedinOutreach";

export const GRIND_METRIC_META: Record<
  GrindMetricKey,
  {
    label: string;
    inputLabel: string;
    metaLabel?: string;
    placeholder: string;
    metaPlaceholder?: string;
  }
> = {
  systemDesign: {
    label: "System Design",
    inputLabel: "Topic",
    metaLabel: "Domain",
    placeholder: "e.g. URL Shortener, Rate Limiter, Kafka Design…",
    metaPlaceholder: "e.g. Distributed Systems, Caching…",
  },
  leetcode: {
    label: "LeetCode",
    inputLabel: "Problem",
    metaLabel: "Difficulty",
    placeholder: "e.g. 146 LRU Cache, 23 Merge K Lists…",
    metaPlaceholder: "Easy / Medium / Hard",
  },
  linkedinOutreach: {
    label: "LinkedIn Outreaches",
    inputLabel: "Name @ Company",
    metaLabel: "Title",
    placeholder: "e.g. Priya Sharma @ Google…",
    metaPlaceholder: "e.g. Engineering Manager, VP Engineering…",
  },
};

export type GrindLogEntry = {
  id: string;
  loggedAt: string;
  label: string;
  meta?: string;
};

export type GrindMetrics = Record<GrindMetricKey, GrindLogEntry[]>;

export type HustleCategory = "Freelance" | "Consulting" | "Media Production";
export const HUSTLE_CATEGORIES: readonly HustleCategory[] = [
  "Freelance",
  "Consulting",
  "Media Production",
];

export type HustleEntry = {
  id: string;
  date: string;
  category: HustleCategory;
  description: string;
  amount: number;
};

export type GrindState = {
  metrics: GrindMetrics;
  hustle: HustleEntry[];
};

const EMPTY_GRIND: GrindState = {
  metrics: { systemDesign: [], leetcode: [], linkedinOutreach: [] },
  hustle: [],
};

const GRIND_KEY = "finstride.grind.metrics";

function normalizeGrindLogEntry(raw: Record<string, unknown>): GrindLogEntry {
  return {
    id: String(raw.id),
    loggedAt: String(raw.loggedAt),
    label: String(raw.label ?? ""),
    meta: raw.meta ? String(raw.meta) : undefined,
  };
}

function normalizeHustleEntry(raw: Record<string, unknown>): HustleEntry {
  return {
    id: String(raw.id),
    date: String(raw.date),
    category: HUSTLE_CATEGORIES.includes(raw.category as HustleCategory)
      ? (raw.category as HustleCategory)
      : "Freelance",
    description: String(raw.description ?? ""),
    amount: Number(raw.amount) || 0,
  };
}

function normalizeGrindState(raw: unknown): GrindState {
  if (!raw || typeof raw !== "object") return EMPTY_GRIND;
  const r = raw as Record<string, unknown>;
  const rawM = (r.metrics ?? {}) as Record<string, unknown>;
  const metricKey = (k: string): GrindLogEntry[] =>
    Array.isArray(rawM[k])
      ? (rawM[k] as Record<string, unknown>[]).map(normalizeGrindLogEntry)
      : [];
  return {
    metrics: {
      systemDesign: metricKey("systemDesign"),
      leetcode: metricKey("leetcode"),
      linkedinOutreach: metricKey("linkedinOutreach"),
    },
    hustle: Array.isArray(r.hustle)
      ? (r.hustle as Record<string, unknown>[]).map(normalizeHustleEntry)
      : [],
  };
}

// ─── Store context ─────────────────────────────────────────────────────────
type StoreCtx = {
  transactions: Transaction[];
  trades: Trade[];
  creditCardDues: number;
  pendingChecklist: MonthlyPending;
  portfolioSnapshots: PortfolioSnapshot[];
  latestSnapshotValues: Partial<Record<PortfolioPartitionKey, number>>;
  /** Latest snapshot value for blueprintSettings.riskCapPartition; 0 if none recorded yet. */
  riskCapCapital: number;
  // Blueprint — user-editable
  blueprintSettings: BlueprintSettings;
  updateBlueprintSettings: (patch: Partial<BlueprintSettings>) => void;
  // Dynamic categories
  incomeCategories: string[];
  expenseCategories: string[];
  addCategory: (type: "income" | "expense", name: string) => void;
  deleteCustomCategory: (type: "income" | "expense", name: string) => void;
  // Dynamic payment modes
  paymentModes: string[];
  addPaymentMode: (name: string) => void;
  deleteCustomPaymentMode: (name: string) => void;
  // Dynamic broker/investment partitions
  investmentApps: InvestmentApp[];
  portfolioPartitions: { key: PortfolioPartitionKey; label: string; description: string }[];
  addBrokerPartition: (id: string, description?: string) => void;
  /** Returns false (and does not delete) if the id is a default, or if trades/snapshots still reference it. */
  deleteCustomBrokerPartition: (id: string) => boolean;
  partitionLabel: (id: string) => string;
  // Quote preferences
  showPersonalQuotes: boolean;
  setShowPersonalQuotes: (v: boolean) => void;
  // Stealth privacy mode
  isStealthMode: boolean;
  toggleStealthMode: () => void;
  // Connectivity
  isOffline: boolean;
  // PWA installability — captured once here so it's caught regardless of
  // which route is mounted when the browser fires the prompt.
  canInstallApp: boolean;
  isAppInstalled: boolean;
  /** Resolves true if the user accepted the native install prompt. False if none was captured, or they dismissed it. */
  installApp: () => Promise<boolean>;
  // Transactions
  addTransaction: (t: Omit<Transaction, "id">) => void;
  deleteTransaction: (id: string) => void;
  // Trades
  addTrade: (t: Omit<Trade, "id" | "status">) => void;
  closeTrade: (id: string, closeReason: CloseReason, closeNotes?: string) => void;
  deleteTrade: (id: string) => void;
  // Obligations
  toggleObligation: (key: ObligationKey) => void;
  // Portfolio snapshots
  addPortfolioSnapshots: (
    entries: Array<{ brokerPartition: PortfolioPartitionKey; currentValue: number }>,
    notes?: string,
    snapshotDate?: string,
  ) => void;
  deletePortfolioSnapshot: (id: string) => void;
  // Grind Deck
  grind: GrindState;
  addGrindLog: (metric: GrindMetricKey, label: string, meta?: string) => void;
  deleteGrindLog: (metric: GrindMetricKey, id: string) => void;
  addHustleEntry: (entry: Omit<HustleEntry, "id">) => void;
  deleteHustleEntry: (id: string) => void;
  // Local data management
  /** Downloads everything below as a single .json file. Returns false if the browser blocked it. */
  exportData: () => boolean;
  /** Replaces current state with a previously-exported backup. Any field missing from the file is left untouched. */
  importData: (json: string) => { success: boolean; error?: string };
  /** Wipes every finstride.* localStorage key and resets all in-memory state to empty/default. */
  resetAllData: () => void;
};

/** Shape of a file produced by exportData() / accepted by importData(). */
export type FinStrideBackup = {
  version: 1;
  exportedAt: string;
  transactions: Transaction[];
  trades: Trade[];
  portfolioSnapshots: PortfolioSnapshot[];
  grind: GrindState;
  /** Full multi-month history, not just the current month. */
  pendingByMonth: Record<string, MonthlyPending>;
  blueprintSettings: BlueprintSettings;
  customPaymentModes: string[];
  customPartitions: CustomPartition[];
  customCategories: CustomCategories;
  showPersonalQuotes: boolean;
};

const Ctx = createContext<StoreCtx | null>(null);
const TX_KEY = "finstride.transactions";
const TR_KEY = "finstride.trades";
const SNAP_KEY = "finstride.portfolio.snapshots";

/**
 * Which identity the localStorage cache belongs to: a Supabase user id, or
 * "local" for data created before/without authentication.
 *
 * This only matters when Supabase is configured. In pure-localStorage mode the
 * mock auth mints a brand-new random id on every sign-in, so owner-scoping
 * there would wipe the user's data on every login — hence the isSupabaseConfigured()
 * guard everywhere this is used.
 */
const CACHE_OWNER_KEY = "finstride.cache.owner";
const LOCAL_OWNER = "local";

/** See the trackedWrite()/getPendingWriteCount() doc comment below for what this guards. */
const PENDING_WRITES_KEY = "finstride.pendingWrites";

const ALL_LOCAL_KEYS = [
  TX_KEY,
  TR_KEY,
  SNAP_KEY,
  GRIND_KEY,
  BLUEPRINT_KEY,
  CATEGORIES_KEY,
  CUSTOM_PAYMENT_MODES_KEY,
  CUSTOM_PARTITIONS_KEY,
  SHOW_PERSONAL_QUOTES_KEY,
  PENDING_KEY,
  PENDING_WRITES_KEY,
];

/** Full local snapshot — also the payload shape the first-login migration pushes up. */
type LocalState = {
  transactions: Transaction[];
  trades: Trade[];
  portfolioSnapshots: PortfolioSnapshot[];
  grind: GrindState;
  blueprint: BlueprintSettings;
  showPersonalQuotes: boolean;
  customPaymentModes: string[];
  customPartitions: CustomPartition[];
  customIncomeCategories: string[];
  customExpenseCategories: string[];
  pending: MonthlyPending;
};

const EMPTY_LOCAL_STATE: LocalState = {
  transactions: [],
  trades: [],
  portfolioSnapshots: [],
  grind: EMPTY_GRIND,
  blueprint: DEFAULT_BLUEPRINT,
  showPersonalQuotes: false,
  customPaymentModes: [],
  customPartitions: [],
  customIncomeCategories: [],
  customExpenseCategories: [],
  pending: {},
};

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

/** Read and normalize everything the app persists locally. Never throws. */
function readLocalState(): LocalState {
  try {
    const rawSnaps = readJson<Record<string, unknown>[]>(SNAP_KEY, []);
    const snapshots: PortfolioSnapshot[] = [];
    for (const raw of rawSnaps) {
      const result = normalizeSnapshot(raw);
      if (Array.isArray(result)) snapshots.push(...result);
      else snapshots.push(result);
    }
    const cats = normalizeCustomCategories(readJson<unknown>(CATEGORIES_KEY, null));
    let showPersonal = false;
    try {
      showPersonal = localStorage.getItem(SHOW_PERSONAL_QUOTES_KEY) === "true";
    } catch {
      showPersonal = false;
    }
    return {
      transactions: readJson<Record<string, unknown>[]>(TX_KEY, []).map(normalizeTransaction),
      trades: readJson<Record<string, unknown>[]>(TR_KEY, []).map(normalizeTrade),
      portfolioSnapshots: snapshots,
      grind: normalizeGrindState(readJson<unknown>(GRIND_KEY, null)),
      blueprint: normalizeBlueprint(readJson<unknown>(BLUEPRINT_KEY, null)),
      showPersonalQuotes: showPersonal,
      customPaymentModes: normalizeCustomPaymentModes(
        readJson<unknown>(CUSTOM_PAYMENT_MODES_KEY, null),
      ),
      customPartitions: normalizeCustomPartitions(readJson<unknown>(CUSTOM_PARTITIONS_KEY, null)),
      customIncomeCategories: cats.income,
      customExpenseCategories: cats.expense,
      pending: loadAllPending()[currentMonthKey()] ?? {},
    };
  } catch {
    return EMPTY_LOCAL_STATE;
  }
}

function localStateHasData(s: LocalState): boolean {
  return (
    s.transactions.length > 0 ||
    s.trades.length > 0 ||
    s.portfolioSnapshots.length > 0 ||
    s.grind.hustle.length > 0 ||
    s.grind.metrics.systemDesign.length > 0 ||
    s.grind.metrics.leetcode.length > 0 ||
    s.grind.metrics.linkedinOutreach.length > 0
  );
}

function clearLocalCache(): void {
  try {
    for (const k of ALL_LOCAL_KEYS) localStorage.removeItem(k);
  } catch {
    // Nothing actionable — the in-memory state is authoritative for this session.
  }
}

function readCacheOwner(): string {
  try {
    return localStorage.getItem(CACHE_OWNER_KEY) ?? LOCAL_OWNER;
  } catch {
    return LOCAL_OWNER;
  }
}

function writeCacheOwner(owner: string): void {
  try {
    localStorage.setItem(CACHE_OWNER_KEY, owner);
  } catch {
    // Ignore — owner scoping degrades to "treat as local", which is safe.
  }
}

/**
 * Count of remote writes fired but not yet confirmed successful, persisted so
 * it survives a reload/offline period (unlike a plain in-memory ref).
 *
 * This is a deliberately minimal safety net, not a durable retry queue: it
 * does not know WHAT failed or replay it, only THAT something might still be
 * unsynced. Its one job is to block the load effect's "cloud wins" wholesale
 * state replacement while the count is nonzero — without it, a write that
 * failed (offline, expired token, RLS rejection — repository.ts logs these to
 * the console and nothing else) would be permanently and silently erased the
 * next time a load succeeds and overwrites local state with the cloud's
 * (never-received-that-write) version.
 */
function getPendingWriteCount(): number {
  try {
    return Number(localStorage.getItem(PENDING_WRITES_KEY)) || 0;
  } catch {
    return 0;
  }
}

function adjustPendingWriteCount(delta: number): void {
  try {
    const next = Math.max(0, getPendingWriteCount() + delta);
    if (next === 0) localStorage.removeItem(PENDING_WRITES_KEY);
    else localStorage.setItem(PENDING_WRITES_KEY, String(next));
  } catch {
    // Ignore — worst case the safety net can't engage this session.
  }
}

/**
 * Fire a remote write, tracking it in the pending-write count for the
 * duration. On failure the count is deliberately left incremented (see
 * PENDING_WRITES_KEY) rather than decremented, so a failed write keeps
 * blocking "cloud wins" until the user is back online and something succeeds.
 */
function trackedWrite(promise: Promise<boolean>): void {
  adjustPendingWriteCount(1);
  void promise.then((ok) => {
    if (ok) adjustPendingWriteCount(-1);
  });
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id ?? null;
  const cloudEnabled = isSupabaseConfigured();

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [pendingChecklist, setPendingChecklist] = useState<MonthlyPending>({});
  const [portfolioSnapshots, setPortfolioSnapshots] = useState<PortfolioSnapshot[]>([]);
  const [grind, setGrind] = useState<GrindState>(EMPTY_GRIND);
  const [blueprintSettings, setBlueprintSettings] = useState<BlueprintSettings>(DEFAULT_BLUEPRINT);
  const [customCategories, setCustomCategories] =
    useState<CustomCategories>(DEFAULT_CUSTOM_CATEGORIES);
  const [customPaymentModes, setCustomPaymentModes] = useState<string[]>([]);
  const [customPartitions, setCustomPartitions] = useState<CustomPartition[]>([]);
  const [showPersonalQuotes, setShowPersonalQuotesState] = useState(false);
  // Always starts false and reads localStorage after mount: SSR has no
  // localStorage, so initializing from it lazily would make the server and
  // first client render disagree on the blur classes (hydration mismatch).
  const [isStealthMode, setIsStealthMode] = useState(false);

  useEffect(() => {
    try {
      setIsStealthMode(localStorage.getItem(STEALTH_KEY) === "true");
    } catch {
      // Ignore — stealth simply stays off this session.
    }
  }, []);

  // Starts false (assume online) and corrects on mount: navigator.onLine
  // doesn't exist during SSR, and "online" is the overwhelmingly common case
  // for a fresh load anyway, so there's nothing jarring to correct visually.
  const [isOffline, setIsOffline] = useState(false);
  useEffect(() => {
    setIsOffline(!navigator.onLine);
    const onOnline = () => setIsOffline(false);
    const onOffline = () => setIsOffline(true);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  const [installPromptEvent, setInstallPromptEvent] = useState<BeforeInstallPromptEvent | null>(
    null,
  );
  const [isAppInstalled, setIsAppInstalled] = useState(false);
  useEffect(() => {
    setIsAppInstalled(isRunningStandalone());
    const onBeforeInstallPrompt = (e: Event) => {
      // Suppress the browser's own mini-infobar — the app decides when/where
      // to offer installation (the banner, and Settings' install button).
      e.preventDefault();
      setInstallPromptEvent(e as BeforeInstallPromptEvent);
    };
    const onAppInstalled = () => {
      setIsAppInstalled(true);
      setInstallPromptEvent(null);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  const owner = userId ?? LOCAL_OWNER;

  /**
   * Which identity's load has fully completed — null until then, and re-armed
   * (via `owner` changing) on every sign-in/sign-out.
   *
   * This is owner-scoped rather than a bare boolean because StoreProvider
   * stays mounted across sign-in: on the commit where `userId` flips, a bare
   * "have we ever hydrated" flag would still read true from the PREVIOUS
   * identity's completed load, letting the settings/pending remote-sync
   * effects below fire — with state that is either the previous user's, or
   * this device's pre-login local defaults — against the NEWLY authenticated
   * account, before that account's own data has even been fetched. Comparing
   * against the current `owner` makes those effects correctly see "not yet
   * hydrated for THIS identity" during that transition.
   */
  const [hydratedOwner, setHydratedOwner] = useState<string | null>(null);
  const hydrated = hydratedOwner === owner;

  /** Latest state, readable from mutation closures without re-subscribing effects. */
  const stateRef = useRef({ trades, grind });
  stateRef.current = { trades, grind };

  /**
   * Set by every mutator; cleared at the start of each load. Guards the
   * "cloud wins" replacement below from silently discarding an edit the user
   * made during the load's network round-trip — that fetch's snapshot
   * necessarily predates any such edit, so applying it afterward would erase
   * the edit from state and then, once `hydrated` flips, from localStorage too.
   */
  const localWriteDuringLoadRef = useRef(false);
  const markLocalWrite = () => {
    localWriteDuringLoadRef.current = true;
  };

  /** Live sync target, or null when running local-only (offline/unauthenticated/unconfigured). */
  const getSync = (): { client: FinStrideClient; userId: string } | null => {
    if (!cloudEnabled || !userId) return null;
    const client = getSupabaseBrowserClient();
    return client ? { client, userId } : null;
  };

  // ── Load / sync ──────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    localWriteDuringLoadRef.current = false;

    void (async () => {
      const identity = userId ?? LOCAL_OWNER;
      const priorOwner = cloudEnabled ? readCacheOwner() : LOCAL_OWNER;

      // Cross-tenant guard: if this browser's cache belongs to a different
      // Supabase user, drop it rather than rendering — or worse, uploading —
      // one person's finances under another's account.
      if (cloudEnabled && priorOwner !== LOCAL_OWNER && priorOwner !== identity) {
        clearLocalCache();
      }

      // Local first: instant paint, and the only source when offline.
      const local = readLocalState();
      if (cancelled) return;
      setTransactions(local.transactions);
      setTrades(local.trades);
      setPortfolioSnapshots(local.portfolioSnapshots);
      setGrind(local.grind);
      setBlueprintSettings(local.blueprint);
      setShowPersonalQuotesState(local.showPersonalQuotes);
      setCustomPaymentModes(local.customPaymentModes);
      setCustomPartitions(local.customPartitions);
      setCustomCategories({
        income: local.customIncomeCategories,
        expense: local.customExpenseCategories,
      });
      setPendingChecklist(local.pending);

      // Auth is still resolving — the initial getSession() restore, or an
      // active OAuth code exchange on /auth/callback. `userId` here could be
      // a stale localStorage-mirrored value (AuthProvider paints from it
      // optimistically before its own check resolves) or about to change
      // again the moment the exchange finishes. Fetching remote data against
      // either is exactly the race that produced 401s: the request goes out
      // before the client's in-memory session is the authoritative one. Do
      // nothing remote yet — re-run (authLoading is a dependency below) once
      // auth settles, with whatever userId turns out to be the authoritative
      // one. The local snapshot already applied above still paints instantly,
      // so this adds no visible delay for the common (already-signed-in) case.
      if (authLoading) return;

      const client = cloudEnabled && userId ? getSupabaseBrowserClient() : null;
      if (!client || !userId) {
        // Local-only session (offline / unauthenticated / Supabase not
        // configured) — safe to stamp ownership unconditionally, nothing
        // remote is at risk of being mis-attributed.
        if (cloudEnabled) writeCacheOwner(identity);
        if (!cancelled) setHydratedOwner(identity);
        return;
      }

      const remote = await fetchAllUserData(client, userId, currentMonthKey());
      if (cancelled) return;

      if (!remote) {
        // Read failed (network, RLS, expired token, Supabase outage).
        // Deliberately do NOT stamp the cache owner or touch the migration
        // flag here — both must only ever be set once we've gotten a real
        // answer from the cloud, or a single transient failure permanently
        // poisons the "empty cloud vs. real local data" migration gate and
        // the cross-tenant clear on every subsequent load. Keep running on
        // the local snapshot already applied above for this session.
        toast.error("Couldn't reach the cloud — showing your last saved data.");
        if (!cancelled) setHydratedOwner(identity);
        return;
      }

      const firstLoginWithLocalData =
        isBundleEmpty(remote) &&
        localStateHasData(local) &&
        priorOwner === LOCAL_OWNER &&
        !hasMigrated(userId);

      if (firstLoginWithLocalData) {
        // Pre-auth data on this device, empty cloud account: push it up and
        // keep the state we already applied (it is exactly what was sent).
        const result = await migrateLocalDataToSupabase(client, userId, local, currentMonthKey());
        if (cancelled) return;
        if (result.failures === 0) {
          markMigrated(userId);
          writeCacheOwner(identity);
        } else {
          // Partial failure: leave both the migration flag and the cache
          // owner unset. priorOwner stays LOCAL_OWNER, so the NEXT load
          // re-opens this exact branch and retries — instead of falling
          // through to "cloud wins" and deleting the rows that never made it
          // for merely being absent remotely.
          toast.error(
            `${result.failures} item(s) didn't sync to the cloud yet — will retry next time you're online.`,
          );
        }
      } else if (localWriteDuringLoadRef.current) {
        // An edit landed locally while this fetch was in flight — trust it
        // over this now-stale snapshot instead of silently discarding it.
        // The read itself succeeded, so ownership bookkeeping is still accurate.
        writeCacheOwner(identity);
      } else if (getPendingWriteCount() > 0) {
        // A write from THIS or an earlier (possibly offline) session never
        // confirmed success. Applying "cloud wins" now would silently delete
        // exactly those rows, since the cloud never received them — keep
        // local authoritative until a write actually succeeds and clears
        // the count, rather than trusting a read that's known to be incomplete.
        toast.error("Some earlier changes haven't synced yet — keeping your local copy for now.");
        writeCacheOwner(identity);
      } else {
        // Cloud is the source of truth for an authenticated user.
        setTransactions(remote.transactions);
        setTrades(remote.trades);
        setPortfolioSnapshots(remote.portfolioSnapshots);
        setGrind(remote.grind);
        if (remote.settings) {
          setBlueprintSettings(remote.settings.blueprint);
          setShowPersonalQuotesState(remote.settings.showPersonalQuotes);
          setCustomPaymentModes(remote.settings.customPaymentModes);
          setCustomPartitions(remote.settings.customPartitions);
          setCustomCategories({
            income: remote.settings.customIncomeCategories,
            expense: remote.settings.customExpenseCategories,
          });
        }
        setPendingChecklist(remote.pending ?? {});
        writeCacheOwner(identity);
      }

      if (!cancelled) setHydratedOwner(identity);
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, cloudEnabled, authLoading]);

  // ── Persist effects (localStorage = offline cache + local-only store) ────
  // All gated on `hydrated` so they never write pre-load empty state over real data.
  useEffect(() => {
    if (hydrated) localStorage.setItem(TX_KEY, JSON.stringify(transactions));
  }, [hydrated, transactions]);

  useEffect(() => {
    if (hydrated) localStorage.setItem(TR_KEY, JSON.stringify(trades));
  }, [hydrated, trades]);

  useEffect(() => {
    if (!hydrated) return;
    const allPending = loadAllPending();
    allPending[currentMonthKey()] = pendingChecklist;
    localStorage.setItem(PENDING_KEY, JSON.stringify(allPending));
  }, [hydrated, pendingChecklist]);

  useEffect(() => {
    if (hydrated) localStorage.setItem(SNAP_KEY, JSON.stringify(portfolioSnapshots));
  }, [hydrated, portfolioSnapshots]);

  useEffect(() => {
    if (hydrated) localStorage.setItem(GRIND_KEY, JSON.stringify(grind));
  }, [hydrated, grind]);

  useEffect(() => {
    if (hydrated) localStorage.setItem(BLUEPRINT_KEY, JSON.stringify(blueprintSettings));
  }, [hydrated, blueprintSettings]);

  useEffect(() => {
    if (hydrated) localStorage.setItem(CATEGORIES_KEY, JSON.stringify(customCategories));
  }, [hydrated, customCategories]);

  useEffect(() => {
    if (hydrated)
      localStorage.setItem(CUSTOM_PAYMENT_MODES_KEY, JSON.stringify(customPaymentModes));
  }, [hydrated, customPaymentModes]);

  useEffect(() => {
    if (hydrated) localStorage.setItem(CUSTOM_PARTITIONS_KEY, JSON.stringify(customPartitions));
  }, [hydrated, customPartitions]);

  useEffect(() => {
    if (hydrated) localStorage.setItem(SHOW_PERSONAL_QUOTES_KEY, String(showPersonalQuotes));
  }, [hydrated, showPersonalQuotes]);

  // ── Remote sync for the single-row tables ────────────────────────────────
  // Settings live in one row, so the whole bundle is upserted whenever any
  // part changes — simpler and cheaper than threading a write through each
  // individual settings mutation.
  useEffect(() => {
    if (!hydrated) return;
    const sync = getSync();
    if (!sync) return;
    trackedWrite(
      dbUpsertSettings(sync.client, sync.userId, {
        blueprint: blueprintSettings,
        showPersonalQuotes,
        customPaymentModes,
        customPartitions,
        customIncomeCategories: customCategories.income,
        customExpenseCategories: customCategories.expense,
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    hydrated,
    userId,
    cloudEnabled,
    blueprintSettings,
    showPersonalQuotes,
    customPaymentModes,
    customPartitions,
    customCategories,
  ]);

  useEffect(() => {
    if (!hydrated) return;
    const sync = getSync();
    if (!sync) return;
    trackedWrite(upsertPendingObligations(sync.client, sync.userId, currentMonthKey(), pendingChecklist));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, userId, cloudEnabled, pendingChecklist]);

  // ── Derived values ───────────────────────────────────────────────────────
  const creditCardDues = transactions
    .filter((t) => t.type === "expense" && t.account === "Credit Card")
    .reduce((sum, t) => sum + t.amount, 0);

  // Latest value per partition, derived straight from recorded snapshots — works
  // for any partition (default or custom), not just an enumerated list.
  const latestSnapshotValues = (() => {
    // portfolioSnapshots is newest-inserted-first (addPortfolioSnapshots prepends),
    // so on an exact snapshotDate tie (e.g. re-entering today's value to correct a
    // mistake) the FIRST occurrence encountered here is the most recent edit —
    // strict `>` preserves that instead of letting a later (older) tie overwrite it.
    const latest = new Map<string, PortfolioSnapshot>();
    for (const s of portfolioSnapshots) {
      const existing = latest.get(s.brokerPartition);
      if (!existing || s.snapshotDate > existing.snapshotDate) {
        latest.set(s.brokerPartition, s);
      }
    }
    const result: Partial<Record<PortfolioPartitionKey, number>> = {};
    for (const [key, snap] of latest) result[key] = snap.currentValue;
    return result;
  })();

  const riskCapCapital = latestSnapshotValues[blueprintSettings.riskCapPartition] ?? 0;

  const incomeCategories = [...DEFAULT_INCOME_CATEGORIES, ...customCategories.income];
  const expenseCategories = [...DEFAULT_EXPENSE_CATEGORIES, ...customCategories.expense];

  const paymentModes = [...DEFAULT_PAYMENT_MODES, ...customPaymentModes];

  const investmentApps: InvestmentApp[] = [
    ...DEFAULT_INVESTMENT_APPS,
    ...customPartitions.map((p) => ({
      id: p.id,
      label: p.label,
      description: p.description,
      scopes: ["cashflow", "swing"] as ("cashflow" | "swing")[],
    })),
  ];

  const portfolioPartitions = [
    ...DEFAULT_PORTFOLIO_PARTITIONS,
    ...customPartitions.map((p) => ({ key: p.id, label: p.label, description: p.description })),
  ];

  const partitionLabel = (id: string): string =>
    investmentApps.find((a) => a.id === id)?.label ?? id;

  const toggleObligation = (key: ObligationKey) => {
    markLocalWrite();
    setPendingChecklist((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // ── Context value ────────────────────────────────────────────────────────
  const value: StoreCtx = {
    transactions,
    trades,
    creditCardDues,
    pendingChecklist,
    portfolioSnapshots,
    latestSnapshotValues,
    riskCapCapital,
    blueprintSettings,
    updateBlueprintSettings: (patch) => {
      markLocalWrite();
      setBlueprintSettings((prev) => ({ ...prev, ...patch }));
    },
    incomeCategories,
    expenseCategories,
    addCategory: (type, name) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const defaults = type === "income" ? DEFAULT_INCOME_CATEGORIES : DEFAULT_EXPENSE_CATEGORIES;
      if (defaults.includes(trimmed)) return; // already a default
      markLocalWrite();
      setCustomCategories((prev) => {
        if (prev[type].includes(trimmed)) return prev;
        return { ...prev, [type]: [...prev[type], trimmed] };
      });
    },
    deleteCustomCategory: (type, name) => {
      const defaults = type === "income" ? DEFAULT_INCOME_CATEGORIES : DEFAULT_EXPENSE_CATEGORIES;
      if (defaults.includes(name)) return; // cannot delete defaults
      markLocalWrite();
      setCustomCategories((prev) => ({
        ...prev,
        [type]: prev[type].filter((c) => c !== name),
      }));
    },
    paymentModes,
    addPaymentMode: (name) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      if (DEFAULT_PAYMENT_MODES.includes(trimmed)) return; // already a default
      markLocalWrite();
      setCustomPaymentModes((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
    },
    deleteCustomPaymentMode: (name) => {
      if (DEFAULT_PAYMENT_MODES.includes(name)) return; // cannot delete defaults
      markLocalWrite();
      setCustomPaymentModes((prev) => prev.filter((m) => m !== name));
    },
    investmentApps,
    portfolioPartitions,
    addBrokerPartition: (id, description) => {
      const trimmed = id.trim();
      if (!trimmed) return;
      if (DEFAULT_INVESTMENT_APPS.some((a) => a.id === trimmed)) return; // already a default
      markLocalWrite();
      setCustomPartitions((prev) =>
        prev.some((p) => p.id === trimmed)
          ? prev
          : [...prev, { id: trimmed, label: trimmed, description: description?.trim() ?? "" }],
      );
    },
    deleteCustomBrokerPartition: (id) => {
      if (DEFAULT_INVESTMENT_APPS.some((a) => a.id === id)) return false; // cannot delete defaults
      // Block deletion while trades/snapshots still reference this partition —
      // every partition-scoped view (Analytics charts, Snapshot history) reads
      // from portfolioPartitions, so deleting it out from under existing data
      // would orphan that data: still summed into totals, but invisible everywhere else.
      const hasReferences =
        portfolioSnapshots.some((s) => s.brokerPartition === id) ||
        trades.some((t) => t.partition === id);
      if (hasReferences) return false;
      markLocalWrite();
      setCustomPartitions((prev) => prev.filter((p) => p.id !== id));
      return true;
    },
    partitionLabel,
    showPersonalQuotes,
    setShowPersonalQuotes: (v) => {
      markLocalWrite();
      setShowPersonalQuotesState(v);
    },
    isStealthMode,
    toggleStealthMode: () => {
      setIsStealthMode((prev) => {
        const next = !prev;
        try {
          localStorage.setItem(STEALTH_KEY, String(next));
        } catch {
          // Ignore — the in-memory toggle still applies for this session.
        }
        return next;
      });
    },
    isOffline,
    canInstallApp: installPromptEvent !== null,
    isAppInstalled,
    installApp: async () => {
      if (!installPromptEvent) return false;
      await installPromptEvent.prompt();
      const choice = await installPromptEvent.userChoice;
      setInstallPromptEvent(null);
      if (choice.outcome === "accepted") setIsAppInstalled(true);
      return choice.outcome === "accepted";
    },
    // Each mutation updates local state first (instant, and the offline record
    // of truth), then fires the matching remote write. Remote failures are
    // logged by the repository layer and never surface as UI exceptions —
    // localStorage still holds the row either way.
    addTransaction: (t) => {
      markLocalWrite();
      const row: Transaction = { ...t, id: crypto.randomUUID() };
      setTransactions((s) => [row, ...s]);
      const sync = getSync();
      if (sync) trackedWrite(dbUpsertTransaction(sync.client, sync.userId, row));
    },
    deleteTransaction: (id) => {
      markLocalWrite();
      setTransactions((s) => s.filter((x) => x.id !== id));
      const sync = getSync();
      if (sync) trackedWrite(deleteTransactionRow(sync.client, sync.userId, id));
    },
    addTrade: (t) => {
      markLocalWrite();
      const row: Trade = { ...t, id: crypto.randomUUID(), status: "open" };
      setTrades((s) => [row, ...s]);
      const sync = getSync();
      if (sync) trackedWrite(dbUpsertTrade(sync.client, sync.userId, row));
    },
    closeTrade: (id, closeReason, closeNotes) => {
      markLocalWrite();
      // Compute the exit stamp once so local state and the remote row agree.
      const exitDate = new Date().toISOString();
      const patch = (t: Trade): Trade => ({
        ...t,
        status: "closed",
        closeReason,
        closeNotes: closeNotes || undefined,
        exitDate,
      });
      setTrades((s) => s.map((t) => (t.id === id ? patch(t) : t)));
      const existing = stateRef.current.trades.find((t) => t.id === id);
      const sync = getSync();
      if (sync && existing) trackedWrite(dbUpsertTrade(sync.client, sync.userId, patch(existing)));
    },
    deleteTrade: (id) => {
      markLocalWrite();
      setTrades((s) => s.filter((x) => x.id !== id));
      const sync = getSync();
      if (sync) trackedWrite(deleteTradeRow(sync.client, sync.userId, id));
    },
    toggleObligation,
    addPortfolioSnapshots: (entries, notes, snapshotDate) => {
      markLocalWrite();
      const date = snapshotDate ?? new Date().toISOString();
      // Match the remote's ON CONFLICT (user_id, snapshot_date, broker_partition)
      // DO UPDATE: replace an existing row for the same (date, partition) in
      // place (same id) instead of always prepending a new one. Without this,
      // re-recording a partition for a day that already has an entry (e.g.
      // correcting a typo via the Analytics dialog, which pins the date to a
      // fixed instant per calendar day) created two local rows that collapsed
      // into the remote's one — a phantom duplicate that also made "delete the
      // row you can see" remove the wrong id relative to what the cloud held.
      let resolvedRows: PortfolioSnapshot[] = [];
      setPortfolioSnapshots((s) => {
        const byKey = new Map(s.map((row) => [`${row.snapshotDate}|${row.brokerPartition}`, row]));
        const touchedKeys = new Set(entries.map((e) => `${date}|${e.brokerPartition}`));
        const untouched = s.filter((row) => !touchedKeys.has(`${row.snapshotDate}|${row.brokerPartition}`));
        resolvedRows = entries.map((e) => {
          const existing = byKey.get(`${date}|${e.brokerPartition}`);
          return {
            id: existing?.id ?? crypto.randomUUID(),
            snapshotDate: date,
            brokerPartition: e.brokerPartition,
            currentValue: e.currentValue,
            notes,
          };
        });
        return [...resolvedRows, ...untouched];
      });
      const sync = getSync();
      if (sync) trackedWrite(dbUpsertSnapshots(sync.client, sync.userId, resolvedRows));
    },
    deletePortfolioSnapshot: (id) => {
      markLocalWrite();
      setPortfolioSnapshots((s) => s.filter((x) => x.id !== id));
      const sync = getSync();
      if (sync) trackedWrite(deleteSnapshotRow(sync.client, sync.userId, id));
    },
    grind,
    addGrindLog: (metric, label, meta) => {
      markLocalWrite();
      const entry: GrindLogEntry = {
        id: crypto.randomUUID(),
        loggedAt: new Date().toISOString(),
        label,
        meta,
      };
      setGrind((s) => ({
        ...s,
        metrics: { ...s.metrics, [metric]: [entry, ...s.metrics[metric]] },
      }));
      const sync = getSync();
      if (sync) trackedWrite(dbUpsertGrindLog(sync.client, sync.userId, metric, entry));
    },
    deleteGrindLog: (metric, id) => {
      markLocalWrite();
      setGrind((s) => ({
        ...s,
        metrics: {
          ...s.metrics,
          [metric]: s.metrics[metric].filter((e) => e.id !== id),
        },
      }));
      const sync = getSync();
      if (sync) trackedWrite(deleteGrindLogRow(sync.client, sync.userId, id));
    },
    addHustleEntry: (entry) => {
      markLocalWrite();
      const row: HustleEntry = { ...entry, id: crypto.randomUUID() };
      setGrind((s) => ({ ...s, hustle: [row, ...s.hustle] }));
      const sync = getSync();
      if (sync) trackedWrite(dbUpsertHustleEntry(sync.client, sync.userId, row));
    },
    deleteHustleEntry: (id) => {
      markLocalWrite();
      setGrind((s) => ({ ...s, hustle: s.hustle.filter((e) => e.id !== id) }));
      const sync = getSync();
      if (sync) trackedWrite(deleteHustleEntryRow(sync.client, sync.userId, id));
    },
    exportData: () => {
      try {
        const backup: FinStrideBackup = {
          version: 1,
          exportedAt: new Date().toISOString(),
          transactions,
          trades,
          portfolioSnapshots,
          grind,
          pendingByMonth: loadAllPending(),
          blueprintSettings,
          customPaymentModes,
          customPartitions,
          customCategories,
          showPersonalQuotes,
        };
        const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `finstride-backup-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return true;
      } catch {
        return false;
      }
    },
    importData: (json) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(json);
      } catch {
        return { success: false, error: "That file isn't valid JSON." };
      }
      if (!parsed || typeof parsed !== "object") {
        return { success: false, error: "That file doesn't look like a FinStride backup." };
      }
      const b = parsed as Record<string, unknown>;

      // Every field is optional and independently defaulted to the CURRENT
      // value (not a blank default) when absent or malformed, so importing an
      // older or hand-edited partial backup can't silently wipe data the file
      // simply didn't mention. Reuses the exact normalizers the initial
      // localStorage/remote load already trusts for untrusted raw JSON.
      const importedTransactions = Array.isArray(b.transactions)
        ? (b.transactions as Record<string, unknown>[]).map(normalizeTransaction)
        : transactions;
      const importedTrades = Array.isArray(b.trades)
        ? (b.trades as Record<string, unknown>[]).map(normalizeTrade)
        : trades;
      let importedSnapshots = portfolioSnapshots;
      if (Array.isArray(b.portfolioSnapshots)) {
        const rows: PortfolioSnapshot[] = [];
        for (const raw of b.portfolioSnapshots as Record<string, unknown>[]) {
          const result = normalizeSnapshot(raw);
          if (Array.isArray(result)) rows.push(...result);
          else rows.push(result);
        }
        importedSnapshots = rows;
      }
      const importedGrind = b.grind !== undefined ? normalizeGrindState(b.grind) : grind;
      const importedBlueprint =
        b.blueprintSettings !== undefined ? normalizeBlueprint(b.blueprintSettings) : blueprintSettings;
      const importedCats =
        b.customCategories !== undefined
          ? normalizeCustomCategories(b.customCategories)
          : customCategories;
      const importedPaymentModes =
        b.customPaymentModes !== undefined
          ? normalizeCustomPaymentModes(b.customPaymentModes)
          : customPaymentModes;
      const importedPartitions =
        b.customPartitions !== undefined
          ? normalizeCustomPartitions(b.customPartitions)
          : customPartitions;
      const importedShowPersonal =
        typeof b.showPersonalQuotes === "boolean" ? b.showPersonalQuotes : showPersonalQuotes;

      markLocalWrite();
      setTransactions(importedTransactions);
      setTrades(importedTrades);
      setPortfolioSnapshots(importedSnapshots);
      setGrind(importedGrind);
      setBlueprintSettings(importedBlueprint);
      setCustomCategories(importedCats);
      setCustomPaymentModes(importedPaymentModes);
      setCustomPartitions(importedPartitions);
      setShowPersonalQuotesState(importedShowPersonal);

      if (b.pendingByMonth && typeof b.pendingByMonth === "object") {
        const monthMap = b.pendingByMonth as Record<string, MonthlyPending>;
        try {
          localStorage.setItem(PENDING_KEY, JSON.stringify(monthMap));
        } catch {
          // Non-fatal — the current month's slice below still applies in memory.
        }
        setPendingChecklist(monthMap[currentMonthKey()] ?? {});
      }

      // Mirror the import to the cloud too, if this account is synced.
      const sync = getSync();
      if (sync) {
        for (const t of importedTransactions) trackedWrite(dbUpsertTransaction(sync.client, sync.userId, t));
        for (const t of importedTrades) trackedWrite(dbUpsertTrade(sync.client, sync.userId, t));
        if (importedSnapshots.length) {
          trackedWrite(dbUpsertSnapshots(sync.client, sync.userId, importedSnapshots));
        }
        trackedWrite(
          dbUpsertSettings(sync.client, sync.userId, {
            blueprint: importedBlueprint,
            showPersonalQuotes: importedShowPersonal,
            customPaymentModes: importedPaymentModes,
            customPartitions: importedPartitions,
            customIncomeCategories: importedCats.income,
            customExpenseCategories: importedCats.expense,
          }),
        );
      }

      return { success: true };
    },
    resetAllData: () => {
      markLocalWrite();
      for (const key of ALL_LOCAL_KEYS) {
        try {
          localStorage.removeItem(key);
        } catch {
          // Nothing actionable — in-memory state below is reset regardless.
        }
      }
      setTransactions([]);
      setTrades([]);
      setPortfolioSnapshots([]);
      setGrind(EMPTY_GRIND);
      setBlueprintSettings(DEFAULT_BLUEPRINT);
      setShowPersonalQuotesState(false);
      setCustomPaymentModes([]);
      setCustomPartitions([]);
      setCustomCategories(DEFAULT_CUSTOM_CATEGORIES);
      setPendingChecklist({});
      // Deliberately does NOT touch remote Supabase rows or sign the user out —
      // this clears the LOCAL cache only. For a cloud-synced account, the next
      // full reload's "cloud wins" load would otherwise just re-populate
      // everything from the account's still-intact remote data; the caller
      // should navigate client-side (not a hard reload) immediately after this
      // so the in-memory reset actually sticks for the current session.
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useStore = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStore must be used within StoreProvider");
  return v;
};
