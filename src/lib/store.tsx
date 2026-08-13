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

// ─── Account modes (Cashflow ledger) ────────────────────────────────────────
// Extensible: DEFAULT_ACCOUNT_MODES are always available, and — like every
// other list in this file — fully editable and deletable, not just
// supplementable. Existing transactions keep working regardless of what's
// configured later: Transaction.account stores a PaymentMode (a plain id
// string referencing AccountMode.id), so renaming/removing an AccountMode
// never breaks a historical row — it just falls back to rendering the raw id
// if nothing in the current list matches it anymore.
export type AccountType = "bank" | "credit_card" | "cash" | "wallet";
export type PaymentChannel = "UPI" | "Card" | "NetBanking" | "Cash";

export type AccountMode = {
  id: string;
  name: string;
  type: AccountType;
  defaultChannel?: PaymentChannel;
};

/** Id reference into AccountMode[] — what Transaction.account actually stores. */
export type PaymentMode = string;

export const DEFAULT_ACCOUNT_MODES: readonly AccountMode[] = [
  { id: "Bank Account", name: "Bank Account", type: "bank", defaultChannel: "NetBanking" },
  { id: "Credit Card", name: "Credit Card", type: "credit_card", defaultChannel: "Card" },
  { id: "UPI", name: "UPI", type: "wallet", defaultChannel: "UPI" },
  { id: "Cash", name: "Cash", type: "cash", defaultChannel: "Cash" },
] as const;

/** "HDFC Bank (NetBanking)", or just the name if there's no channel to show. */
export function formatAccountLabel(a: AccountMode): string {
  return a.defaultChannel ? `${a.name} (${a.defaultChannel})` : a.name;
}

// ─── Broker/investment partitions (Swing logger, Cashflow, Analytics) ──────
// Extensible and fully editable/deletable, same as account modes above. One
// canonical list backs both the swing-trade partition selector AND the
// portfolio-snapshot partition selector — previously these were two separate
// lists (investmentApps / portfolioPartitions) that could silently drift out
// of sync (a partition addable to trades but not snapshots, or vice versa);
// merging them removes that class of bug entirely.
export type PartitionCategory = "equity_swing" | "long_term_etf" | "mutual_funds" | "crypto" | "liquid";

export type BrokerPartition = {
  id: string;
  name: string;
  brokerApp?: string;
  category: PartitionCategory;
  description?: string;
};

/** Id reference into BrokerPartition[] — what Trade.partition and PortfolioSnapshot.brokerPartition store. */
export type PartitionId = string;

export const DEFAULT_BROKER_PARTITIONS: readonly BrokerPartition[] = [
  {
    id: "Long-Term Portfolio",
    name: "Long-Term Portfolio",
    category: "long_term_etf",
    description: "Long-hold equity vault (delivery)",
  },
  {
    id: "Primary Broker",
    name: "Primary Broker",
    category: "equity_swing",
    description: "Active swing book — equity only",
  },
  {
    id: "International Broker",
    name: "International Broker",
    category: "equity_swing",
    description: "International equities partition",
  },
  {
    id: "Crypto Wallet",
    name: "Crypto Wallet",
    category: "crypto",
    description: "Crypto holdings",
  },
  {
    id: "Mutual Funds",
    name: "Mutual Funds",
    category: "mutual_funds",
    description: "Mutual fund SIPs",
  },
  {
    id: "Cash",
    name: "Cash",
    category: "liquid",
    description: "Physical cash & liquid reserves",
  },
] as const;

// ─── Portfolio snapshots ───────────────────────────────────────────────────
/**
 * One per-partition row — mirrors portfolio_snapshots DB schema exactly.
 */
export type PortfolioSnapshot = {
  id: string;
  snapshotDate: string;
  brokerPartition: PartitionId;
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
  // Legacy grouped shape migration — only the original 4 legacy partitions ever used this shape.
  const legacyValues = (raw.values ?? {}) as Record<string, unknown>;
  const date = String(raw.recordedAt ?? new Date().toISOString());
  const rows: PortfolioSnapshot[] = [];
  for (const p of DEFAULT_BROKER_PARTITIONS) {
    const v = legacyValues[p.id];
    if (typeof v === "number" && !isNaN(v)) {
      rows.push({
        id: crypto.randomUUID(),
        snapshotDate: date,
        brokerPartition: p.id,
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
  riskCapPartition: PartitionId;
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
  "Groceries",
  "Dining",
  "Subscriptions",
  "Fuel",
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

/**
 * Which DEFAULT categories the user has deleted — a tombstone list, not the
 * customs list. income/expenseCategories below always splice
 * DEFAULT_INCOME_CATEGORIES/DEFAULT_EXPENSE_CATEGORIES back in, so a default
 * can only ever be made to disappear by being named here; there is no other
 * mechanism that removes a member of those readonly arrays from what's shown.
 * Same shape as CustomCategories (reused rather than duplicated), but a
 * distinct semantic meaning — see addCategory/deleteCategory.
 */
const HIDDEN_CATEGORIES_KEY = "finstride.categories.hiddenDefaults";
const EMPTY_HIDDEN_CATEGORIES: CustomCategories = { income: [], expense: [] };

// ─── Dynamic account modes ──────────────────────────────────────────────────
const CUSTOM_ACCOUNT_MODES_KEY = "finstride.accountmodes.custom";
const ACCOUNT_TYPES: readonly AccountType[] = ["bank", "credit_card", "cash", "wallet"];
const PAYMENT_CHANNELS: readonly PaymentChannel[] = ["UPI", "Card", "NetBanking", "Cash"];

function normalizeCustomAccountModes(raw: unknown): AccountMode[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r) => {
      const id = String(r.id ?? "");
      return {
        id,
        name: r.name ? String(r.name) : id,
        type: (ACCOUNT_TYPES as readonly string[]).includes(r.type as string)
          ? (r.type as AccountType)
          : "bank",
        defaultChannel: (PAYMENT_CHANNELS as readonly string[]).includes(r.defaultChannel as string)
          ? (r.defaultChannel as PaymentChannel)
          : undefined,
      };
    })
    .filter((a) => a.id.trim() !== "");
}

/** Generic string-array validator, shared by every hidden-defaults tombstone list below. */
function normalizeStringArray(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === "string") : [];
}

/**
 * Which DEFAULT_ACCOUNT_MODES ids the user has deleted — see the doc comment
 * on HIDDEN_CATEGORIES_KEY above for why this tombstone-list approach exists.
 */
const HIDDEN_ACCOUNT_IDS_KEY = "finstride.accountmodes.hiddenDefaults";

// ─── Dynamic broker/investment partitions ──────────────────────────────────
const CUSTOM_BROKER_PARTITIONS_KEY = "finstride.partitions.custom";
const PARTITION_CATEGORIES: readonly PartitionCategory[] = [
  "equity_swing",
  "long_term_etf",
  "mutual_funds",
  "crypto",
  "liquid",
];

function normalizeCustomBrokerPartitions(raw: unknown): BrokerPartition[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r) => {
      const id = String(r.id ?? "");
      return {
        id,
        name: r.name ? String(r.name) : id,
        category: (PARTITION_CATEGORIES as readonly string[]).includes(r.category as string)
          ? (r.category as PartitionCategory)
          : "equity_swing",
        brokerApp: r.brokerApp ? String(r.brokerApp) : undefined,
        description: r.description ? String(r.description) : undefined,
      };
    })
    .filter((p) => p.id.trim() !== "");
}

/** Which DEFAULT_BROKER_PARTITIONS ids the user has deleted — see HIDDEN_CATEGORIES_KEY above. */
const HIDDEN_PARTITION_IDS_KEY = "finstride.partitions.hiddenDefaults";

// ─── Quote preferences ──────────────────────────────────────────────────────
// Whether the app-owner's personal reflection quotes are shown alongside the
// general pool — driven by an explicit user setting rather than a hardcoded
// owner-email check, and defaults off so a fresh install never shows someone
// else's personal notes without opting in.
const SHOW_PERSONAL_QUOTES_KEY = "finstride.quotes.showPersonal";

// ─── Owner passcode gate ────────────────────────────────────────────────────
// A lightweight, DEVICE-local speed bump — not real security. This value ships
// inside the JS bundle like any other `import.meta.env.VITE_*` constant, so
// anyone who opens devtools can read it; it only prevents a casual toggle,
// never a determined inspection of the code. Device-local and excluded from
// "Delete All Data" for the same reason isStealthMode is: it's a standing
// device-trust flag, not user financial data, so wiping the ledger shouldn't
// force re-entering the PIN.
const OWNER_REFLECTIONS_PIN = String(import.meta.env.VITE_OWNER_PIN ?? "hagemaru9966");
const OWNER_UNLOCKED_KEY = "finstride.owner.unlocked";

/**
 * Direct (non-React-state) localStorage read for isOwnerUnlocked, used inside
 * the load effect below to gate showPersonalQuotes. The load effect's deps
 * are [userId, cloudEnabled, authLoading] — NOT isOwnerUnlocked — so a plain
 * closure read of the React state would go stale after the mount-time effect
 * that hydrates isOwnerUnlocked runs (same render batch, but the load effect's
 * closure is already captured with the pre-hydration `false`). Reading straight
 * from localStorage here sidesteps that instead of adding isOwnerUnlocked to
 * the load effect's deps, which would re-run the entire fetch on every unlock.
 */
function readOwnerUnlocked(): boolean {
  try {
    return localStorage.getItem(OWNER_UNLOCKED_KEY) === "true";
  } catch {
    return false;
  }
}

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

// ─── Custom monthly obligations ────────────────────────────────────────────
// User-added obligations beyond the 4 built-in ones above (e.g. "Netflix",
// "Car Loan EMI"). Local-only for now: user_settings/pending_obligations are
// fixed-column schemas (see supabase/migrations/0001_initial_schema.sql) with
// no jsonb column for an arbitrary list, so there's nowhere to sync this to
// without a schema migration. Kept fully functional device-locally rather
// than blocked on that — same tradeoff this file already makes for
// isStealthMode, just for a different reason (schema gap vs. deliberate scope).
export type CustomObligation = { id: string; label: string; amount: number };
const CUSTOM_OBLIGATIONS_KEY = "finstride.obligations.custom";
const CUSTOM_OBLIGATIONS_PENDING_KEY = "finstride.obligations.custom.pending";

function normalizeCustomObligations(raw: unknown): CustomObligation[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r) => ({
      id: String(r.id ?? ""),
      label: r.label ? String(r.label) : String(r.id ?? ""),
      amount: Number(r.amount) || 0,
    }))
    .filter((o) => o.id.trim() !== "");
}

function loadAllCustomObligationsPending(): Record<string, Record<string, boolean>> {
  try {
    const raw = localStorage.getItem(CUSTOM_OBLIGATIONS_PENDING_KEY);
    return raw ? (JSON.parse(raw) as Record<string, Record<string, boolean>>) : {};
  } catch {
    return {};
  }
}

// ─── First-time onboarding ──────────────────────────────────────────────────
// Device-local: a returning user's real cloud data (once loaded) already
// makes isFirstTimeUser false on its own, so this flag only needs to cover
// the "picked defaults and skipped" case on THIS device — see isFirstTimeUser.
const ONBOARDING_KEY = "finstride.onboarding.completed";

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
  partition: PartitionId;
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
  latestSnapshotValues: Partial<Record<PartitionId, number>>;
  /** Latest snapshot value for blueprintSettings.riskCapPartition; 0 if none recorded yet. */
  riskCapCapital: number;
  // Blueprint — user-editable
  blueprintSettings: BlueprintSettings;
  updateBlueprintSettings: (patch: Partial<BlueprintSettings>) => void;
  // Dynamic categories — fully editable/deletable, defaults included
  incomeCategories: string[];
  expenseCategories: string[];
  addCategory: (type: "income" | "expense", name: string) => void;
  deleteCategory: (type: "income" | "expense", name: string) => void;
  /** Rename a CUSTOM category (defaults have no custom-list entry to rename — delete + add instead). Returns false if oldName isn't a custom entry, or newName collides with an existing one. */
  renameCategory: (type: "income" | "expense", oldName: string, newName: string) => boolean;
  // Dynamic account modes (payment modes / bank accounts / cards) — fully editable/deletable
  accountModes: AccountMode[];
  addAccountMode: (name: string, type: AccountType, defaultChannel?: PaymentChannel) => void;
  /** Returns false (and does not delete) if still referenced by existing transactions. */
  deleteAccountMode: (id: string) => boolean;
  /** Returns false if id isn't a CUSTOM account mode (defaults can't be edited in place). */
  updateAccountMode: (id: string, patch: Partial<Omit<AccountMode, "id">>) => boolean;
  accountLabel: (id: string) => string;
  // Dynamic broker/investment partitions — fully editable/deletable
  brokerPartitions: BrokerPartition[];
  addBrokerPartition: (name: string, category: PartitionCategory, brokerApp?: string, description?: string) => void;
  /** Returns false (and does not delete) if the id is still referenced by trades/snapshots. */
  deleteBrokerPartition: (id: string) => boolean;
  /** Returns false if id isn't a CUSTOM partition (defaults can't be edited in place). */
  updateBrokerPartition: (id: string, patch: Partial<Omit<BrokerPartition, "id">>) => boolean;
  partitionLabel: (id: string) => string;
  // Quote preferences
  showPersonalQuotes: boolean;
  setShowPersonalQuotes: (v: boolean) => void;
  // Owner passcode gate (see OWNER_REFLECTIONS_PIN doc comment — not real security)
  isOwnerUnlocked: boolean;
  /** Checks pin against the owner passcode; on match sets isOwnerUnlocked and returns true. */
  unlockOwnerReflections: (pin: string) => boolean;
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
  // Custom monthly obligations (local-only — see comment above CustomObligation)
  customObligations: CustomObligation[];
  addObligation: (label: string, amount: number) => void;
  deleteObligation: (id: string) => void;
  customObligationsPending: Record<string, boolean>;
  toggleCustomObligation: (id: string) => void;
  // Portfolio snapshots
  addPortfolioSnapshots: (
    entries: Array<{ brokerPartition: PartitionId; currentValue: number }>,
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
  // Onboarding
  /** True once the initial load for the current identity has fully settled — arrays below are trustworthy only after this. */
  hydrated: boolean;
  /** All financial data AND all customizations are empty — the genuine first-run state, not just "currently empty view". */
  isFirstTimeUser: boolean;
  onboardingCompleted: boolean;
  completeOnboarding: () => void;
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
  customAccountModes: AccountMode[];
  customBrokerPartitions: BrokerPartition[];
  customCategories: CustomCategories;
  hiddenDefaultCategories: CustomCategories;
  hiddenDefaultAccountIds: string[];
  hiddenDefaultPartitionIds: string[];
  showPersonalQuotes: boolean;
  customObligations: CustomObligation[];
  /** Full multi-month history, not just the current month. */
  customObligationsPendingByMonth: Record<string, Record<string, boolean>>;
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
  HIDDEN_CATEGORIES_KEY,
  CUSTOM_ACCOUNT_MODES_KEY,
  HIDDEN_ACCOUNT_IDS_KEY,
  CUSTOM_BROKER_PARTITIONS_KEY,
  HIDDEN_PARTITION_IDS_KEY,
  SHOW_PERSONAL_QUOTES_KEY,
  PENDING_KEY,
  PENDING_WRITES_KEY,
  CUSTOM_OBLIGATIONS_KEY,
  CUSTOM_OBLIGATIONS_PENDING_KEY,
  // Not a UI-only preference like isStealthMode: after a full data wipe,
  // re-showing onboarding matches the "fresh start" intent of that action.
  ONBOARDING_KEY,
];

/** Full local snapshot — also the payload shape the first-login migration pushes up. */
type LocalState = {
  transactions: Transaction[];
  trades: Trade[];
  portfolioSnapshots: PortfolioSnapshot[];
  grind: GrindState;
  blueprint: BlueprintSettings;
  showPersonalQuotes: boolean;
  customAccountModes: AccountMode[];
  customBrokerPartitions: BrokerPartition[];
  customIncomeCategories: string[];
  customExpenseCategories: string[];
  hiddenDefaultCategories: CustomCategories;
  hiddenDefaultAccountIds: string[];
  hiddenDefaultPartitionIds: string[];
  pending: MonthlyPending;
  customObligations: CustomObligation[];
  customObligationsPending: Record<string, boolean>;
};

const EMPTY_LOCAL_STATE: LocalState = {
  transactions: [],
  trades: [],
  portfolioSnapshots: [],
  grind: EMPTY_GRIND,
  blueprint: DEFAULT_BLUEPRINT,
  showPersonalQuotes: false,
  customAccountModes: [],
  customBrokerPartitions: [],
  customIncomeCategories: [],
  customExpenseCategories: [],
  hiddenDefaultCategories: EMPTY_HIDDEN_CATEGORIES,
  hiddenDefaultAccountIds: [],
  hiddenDefaultPartitionIds: [],
  pending: {},
  customObligations: [],
  customObligationsPending: {},
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
    const hiddenCats = normalizeCustomCategories(readJson<unknown>(HIDDEN_CATEGORIES_KEY, null));
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
      // Clamped by the owner-unlock gate, not just the raw persisted toggle —
      // see readOwnerUnlocked()'s doc comment for why this can never be
      // silently true on a device that hasn't itself passed the PIN check.
      showPersonalQuotes: showPersonal && readOwnerUnlocked(),
      customAccountModes: normalizeCustomAccountModes(
        readJson<unknown>(CUSTOM_ACCOUNT_MODES_KEY, null),
      ),
      customBrokerPartitions: normalizeCustomBrokerPartitions(
        readJson<unknown>(CUSTOM_BROKER_PARTITIONS_KEY, null),
      ),
      customIncomeCategories: cats.income,
      customExpenseCategories: cats.expense,
      hiddenDefaultCategories: hiddenCats,
      hiddenDefaultAccountIds: normalizeStringArray(readJson<unknown>(HIDDEN_ACCOUNT_IDS_KEY, null)),
      hiddenDefaultPartitionIds: normalizeStringArray(
        readJson<unknown>(HIDDEN_PARTITION_IDS_KEY, null),
      ),
      pending: loadAllPending()[currentMonthKey()] ?? {},
      customObligations: normalizeCustomObligations(readJson<unknown>(CUSTOM_OBLIGATIONS_KEY, null)),
      customObligationsPending: loadAllCustomObligationsPending()[currentMonthKey()] ?? {},
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
    s.grind.metrics.linkedinOutreach.length > 0 ||
    s.customObligations.length > 0
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
  const [customAccountModes, setCustomAccountModes] = useState<AccountMode[]>([]);
  const [customBrokerPartitions, setCustomBrokerPartitions] = useState<BrokerPartition[]>([]);
  const [hiddenDefaultCategories, setHiddenDefaultCategories] =
    useState<CustomCategories>(EMPTY_HIDDEN_CATEGORIES);
  const [hiddenDefaultAccountIds, setHiddenDefaultAccountIds] = useState<string[]>([]);
  const [hiddenDefaultPartitionIds, setHiddenDefaultPartitionIds] = useState<string[]>([]);
  const [customObligations, setCustomObligations] = useState<CustomObligation[]>([]);
  const [customObligationsPending, setCustomObligationsPending] = useState<Record<string, boolean>>(
    {},
  );
  const [showPersonalQuotes, setShowPersonalQuotesState] = useState(false);
  // Always starts false and reads localStorage after mount: SSR has no
  // localStorage, so initializing from it lazily would make the server and
  // first client render disagree on the blur classes (hydration mismatch).
  const [isStealthMode, setIsStealthMode] = useState(false);
  // Same SSR-hydration-mismatch reasoning as isStealthMode.
  const [isOwnerUnlocked, setIsOwnerUnlockedState] = useState(false);

  useEffect(() => {
    try {
      setIsStealthMode(localStorage.getItem(STEALTH_KEY) === "true");
    } catch {
      // Ignore — stealth simply stays off this session.
    }
    setIsOwnerUnlockedState(readOwnerUnlocked());
  }, []);

  // Onboarding flag. UNLIKE isStealthMode, this IS owner-scoped: read once
  // more inside the load effect below (right after clearLocalCache(), never
  // on a bare mount-only effect) so signing out of one identity and into
  // another on the same tab doesn't leave the PREVIOUS identity's flag
  // stuck true — StoreProvider never remounts across sign-in/out, so a
  // mount-only read would otherwise go stale for the rest of the tab's life.
  const [onboardingCompleted, setOnboardingCompleted] = useState(false);

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

      // Re-sync onboardingCompleted for THIS identity now, after any clear
      // above has run — must happen here, not in a bare mount-only effect,
      // or a previous identity's completed-onboarding flag (still true in
      // React state) would silently suppress the wizard for a genuinely
      // new identity signing into this same tab.
      try {
        setOnboardingCompleted(localStorage.getItem(ONBOARDING_KEY) === "true");
      } catch {
        setOnboardingCompleted(false);
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
      setCustomAccountModes(local.customAccountModes);
      setCustomBrokerPartitions(local.customBrokerPartitions);
      setCustomCategories({
        income: local.customIncomeCategories,
        expense: local.customExpenseCategories,
      });
      setHiddenDefaultCategories(local.hiddenDefaultCategories);
      setHiddenDefaultAccountIds(local.hiddenDefaultAccountIds);
      setHiddenDefaultPartitionIds(local.hiddenDefaultPartitionIds);
      setPendingChecklist(local.pending);
      setCustomObligations(local.customObligations);
      setCustomObligationsPending(local.customObligationsPending);

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

      const fetchResult = await fetchAllUserData(client, userId, currentMonthKey());
      if (cancelled) return;

      if (!fetchResult.bundle) {
        // Read failed (network, RLS, expired token, Supabase outage).
        // Deliberately do NOT stamp the cache owner or touch the migration
        // flag here — both must only ever be set once we've gotten a real
        // answer from the cloud, or a single transient failure permanently
        // poisons the "empty cloud vs. real local data" migration gate and
        // the cross-tenant clear on every subsequent load. Keep running on
        // the local snapshot already applied above for this session.
        //
        // authError (fetchAllUserData already attempted a silent
        // refreshSession() and it didn't help) means this is an expected
        // background condition — a session that quietly expired, or hasn't
        // been established yet on this tab — not a surprising connectivity
        // failure, so it's deliberately silent rather than alarming the user
        // with a toast over something that just means "sign in again".
        if (!fetchResult.authError) {
          toast.error("Couldn't reach the cloud — showing your last saved data.");
        }
        if (!cancelled) setHydratedOwner(identity);
        return;
      }
      const remote = fetchResult.bundle;

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
          // Clamped by the owner-unlock gate — see readOwnerUnlocked()'s doc
          // comment. Without this, unlocking + toggling on one device would
          // silently turn personal quotes on for every other device/session
          // that syncs this account, with no PIN check on the receiving side.
          setShowPersonalQuotesState(remote.settings.showPersonalQuotes && readOwnerUnlocked());
          setCustomAccountModes(remote.settings.customAccountModes);
          setCustomBrokerPartitions(remote.settings.customBrokerPartitions);
          setCustomCategories({
            income: remote.settings.customIncomeCategories,
            expense: remote.settings.customExpenseCategories,
          });
          setHiddenDefaultCategories(remote.settings.hiddenDefaultCategories);
          setHiddenDefaultAccountIds(remote.settings.hiddenDefaultAccountIds);
          setHiddenDefaultPartitionIds(remote.settings.hiddenDefaultPartitionIds);
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
      localStorage.setItem(CUSTOM_ACCOUNT_MODES_KEY, JSON.stringify(customAccountModes));
  }, [hydrated, customAccountModes]);

  useEffect(() => {
    if (hydrated)
      localStorage.setItem(CUSTOM_BROKER_PARTITIONS_KEY, JSON.stringify(customBrokerPartitions));
  }, [hydrated, customBrokerPartitions]);

  useEffect(() => {
    if (hydrated) localStorage.setItem(HIDDEN_CATEGORIES_KEY, JSON.stringify(hiddenDefaultCategories));
  }, [hydrated, hiddenDefaultCategories]);

  useEffect(() => {
    if (hydrated) localStorage.setItem(HIDDEN_ACCOUNT_IDS_KEY, JSON.stringify(hiddenDefaultAccountIds));
  }, [hydrated, hiddenDefaultAccountIds]);

  useEffect(() => {
    if (hydrated)
      localStorage.setItem(HIDDEN_PARTITION_IDS_KEY, JSON.stringify(hiddenDefaultPartitionIds));
  }, [hydrated, hiddenDefaultPartitionIds]);

  useEffect(() => {
    if (hydrated) localStorage.setItem(SHOW_PERSONAL_QUOTES_KEY, String(showPersonalQuotes));
  }, [hydrated, showPersonalQuotes]);

  useEffect(() => {
    if (hydrated) localStorage.setItem(CUSTOM_OBLIGATIONS_KEY, JSON.stringify(customObligations));
  }, [hydrated, customObligations]);

  useEffect(() => {
    if (!hydrated) return;
    const all = loadAllCustomObligationsPending();
    all[currentMonthKey()] = customObligationsPending;
    localStorage.setItem(CUSTOM_OBLIGATIONS_PENDING_KEY, JSON.stringify(all));
  }, [hydrated, customObligationsPending]);

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
        customAccountModes,
        customBrokerPartitions,
        customIncomeCategories: customCategories.income,
        customExpenseCategories: customCategories.expense,
        hiddenDefaultCategories,
        hiddenDefaultAccountIds,
        hiddenDefaultPartitionIds,
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    hydrated,
    userId,
    cloudEnabled,
    blueprintSettings,
    showPersonalQuotes,
    customAccountModes,
    customBrokerPartitions,
    customCategories,
    hiddenDefaultCategories,
    hiddenDefaultAccountIds,
    hiddenDefaultPartitionIds,
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
    const result: Partial<Record<PartitionId, number>> = {};
    for (const [key, snap] of latest) result[key] = snap.currentValue;
    return result;
  })();

  const riskCapCapital = latestSnapshotValues[blueprintSettings.riskCapPartition] ?? 0;

  // Every merged list below EXCLUDES defaults the user has deleted (tracked in
  // the hiddenDefault* tombstone lists) — without that filter, a "deleted"
  // default just gets spliced right back in by DEFAULT_*, which is exactly the
  // bug this exclusion exists to prevent (see addCategory/deleteCategory etc.).
  const incomeCategories = [
    ...DEFAULT_INCOME_CATEGORIES.filter((c) => !hiddenDefaultCategories.income.includes(c)),
    ...customCategories.income,
  ];
  const expenseCategories = [
    ...DEFAULT_EXPENSE_CATEGORIES.filter((c) => !hiddenDefaultCategories.expense.includes(c)),
    ...customCategories.expense,
  ];

  const accountModes: AccountMode[] = [
    ...DEFAULT_ACCOUNT_MODES.filter((a) => !hiddenDefaultAccountIds.includes(a.id)),
    ...customAccountModes,
  ];
  const brokerPartitions: BrokerPartition[] = [
    ...DEFAULT_BROKER_PARTITIONS.filter((p) => !hiddenDefaultPartitionIds.includes(p.id)),
    ...customBrokerPartitions,
  ];

  const partitionLabel = (id: string): string =>
    brokerPartitions.find((p) => p.id === id)?.name ?? id;

  const accountLabel = (id: string): string => {
    const a = accountModes.find((m) => m.id === id);
    return a ? formatAccountLabel(a) : id;
  };

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
      // Re-adding a name that matches a previously-deleted default restores
      // (un-hides) that default rather than creating a redundant custom entry
      // with the same identity.
      const restoredDefault = defaults.find((c) => c.toLowerCase() === trimmed.toLowerCase());
      if (restoredDefault && hiddenDefaultCategories[type].includes(restoredDefault)) {
        markLocalWrite();
        setHiddenDefaultCategories((prev) => ({
          ...prev,
          [type]: prev[type].filter((c) => c !== restoredDefault),
        }));
        return;
      }
      const all = type === "income" ? incomeCategories : expenseCategories;
      if (all.some((c) => c.toLowerCase() === trimmed.toLowerCase())) return; // already on the (visible) list
      markLocalWrite();
      setCustomCategories((prev) => ({ ...prev, [type]: [...prev[type], trimmed] }));
    },
    deleteCategory: (type, name) => {
      // 100% deletable — including defaults. Categories are plain strings with
      // no structural FK, so deleting one that's still used by existing
      // transactions is harmless: those rows simply keep their old category
      // string and stop appearing in the add-transaction dropdown's options.
      //
      // A default isn't a member of customCategories (it lives in the
      // DEFAULT_INCOME_CATEGORIES/DEFAULT_EXPENSE_CATEGORIES constant instead),
      // so "deleting" one can't mean filtering it out of a list it was never
      // in — it has to be recorded in the hiddenDefaultCategories tombstone
      // list, which incomeCategories/expenseCategories subtract out above.
      markLocalWrite();
      const defaults = type === "income" ? DEFAULT_INCOME_CATEGORIES : DEFAULT_EXPENSE_CATEGORIES;
      if (defaults.includes(name)) {
        setHiddenDefaultCategories((prev) =>
          prev[type].includes(name) ? prev : { ...prev, [type]: [...prev[type], name] },
        );
      } else {
        setCustomCategories((prev) => ({
          ...prev,
          [type]: prev[type].filter((c) => c !== name),
        }));
      }
    },
    renameCategory: (type, oldName, newName) => {
      const trimmed = newName.trim();
      if (!trimmed) return false;
      const isCustom = customCategories[type].includes(oldName);
      if (!isCustom) return false; // defaults have no custom-list entry to rename in place
      const all = type === "income" ? incomeCategories : expenseCategories;
      if (all.some((c) => c.toLowerCase() === trimmed.toLowerCase() && c !== oldName)) return false;
      markLocalWrite();
      setCustomCategories((prev) => ({
        ...prev,
        [type]: prev[type].map((c) => (c === oldName ? trimmed : c)),
      }));
      return true;
    },
    accountModes,
    addAccountMode: (name, type, defaultChannel) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      // Re-adding a name that matches a previously-deleted default restores
      // (un-hides) the ORIGINAL default — by its canonical id/casing — rather
      // than creating a redundant custom entry with a near-duplicate identity.
      const restoredDefault = DEFAULT_ACCOUNT_MODES.find(
        (a) => a.id.toLowerCase() === trimmed.toLowerCase(),
      );
      if (restoredDefault && hiddenDefaultAccountIds.includes(restoredDefault.id)) {
        markLocalWrite();
        setHiddenDefaultAccountIds((prev) => prev.filter((id) => id !== restoredDefault.id));
        return;
      }
      // Case-insensitive so a differently-cased retype of an existing entry
      // ("bank account" vs "Bank Account") is treated as the same account
      // instead of silently creating a near-duplicate.
      if (accountModes.some((a) => a.id.toLowerCase() === trimmed.toLowerCase())) return;
      markLocalWrite();
      setCustomAccountModes((prev) => [
        ...prev,
        { id: trimmed, name: trimmed, type, defaultChannel },
      ]);
    },
    deleteAccountMode: (id) => {
      // Block deletion while transactions still reference this account — every
      // account-scoped view (ledger table/cards, credit-card-dues total) reads
      // from accountModes, so deleting it out from under existing data would
      // orphan that data: still summed into totals, but unlabeled everywhere else.
      const hasReferences = transactions.some((t) => t.account === id);
      if (hasReferences) return false;
      markLocalWrite();
      // A default isn't a member of customAccountModes (it lives in
      // DEFAULT_ACCOUNT_MODES instead), so "deleting" one can't mean filtering
      // it out of a list it was never in — it has to be recorded in the
      // hiddenDefaultAccountIds tombstone list, which accountModes subtracts
      // out above. Custom entries are still removed outright, same as before.
      if (DEFAULT_ACCOUNT_MODES.some((a) => a.id === id)) {
        setHiddenDefaultAccountIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
      } else {
        setCustomAccountModes((prev) => prev.filter((a) => a.id !== id));
      }
      return true;
    },
    updateAccountMode: (id, patch) => {
      if (!customAccountModes.some((a) => a.id === id)) return false; // defaults can't be edited in place
      markLocalWrite();
      setCustomAccountModes((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
      return true;
    },
    accountLabel,
    brokerPartitions,
    addBrokerPartition: (name, category, brokerApp, description) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      // Re-adding a name that matches a previously-deleted default restores
      // (un-hides) the ORIGINAL default rather than creating a redundant
      // custom entry with a near-duplicate identity.
      const restoredDefault = DEFAULT_BROKER_PARTITIONS.find(
        (p) => p.id.toLowerCase() === trimmed.toLowerCase(),
      );
      if (restoredDefault && hiddenDefaultPartitionIds.includes(restoredDefault.id)) {
        markLocalWrite();
        setHiddenDefaultPartitionIds((prev) => prev.filter((id) => id !== restoredDefault.id));
        return;
      }
      // Case-insensitive so a differently-cased retype of an existing entry
      // is treated as the same partition instead of silently creating a
      // near-duplicate.
      if (brokerPartitions.some((p) => p.id.toLowerCase() === trimmed.toLowerCase())) return;
      markLocalWrite();
      setCustomBrokerPartitions((prev) => [
        ...prev,
        { id: trimmed, name: trimmed, category, brokerApp: brokerApp?.trim() || undefined, description: description?.trim() || undefined },
      ]);
    },
    deleteBrokerPartition: (id) => {
      // Block deletion while trades/snapshots still reference this partition —
      // every partition-scoped view (Analytics charts, Snapshot history) reads
      // from brokerPartitions, so deleting it out from under existing data
      // would orphan that data: still summed into totals, but invisible everywhere else.
      const hasReferences =
        portfolioSnapshots.some((s) => s.brokerPartition === id) ||
        trades.some((t) => t.partition === id);
      if (hasReferences) return false;
      markLocalWrite();
      // A default isn't a member of customBrokerPartitions (it lives in
      // DEFAULT_BROKER_PARTITIONS instead), so "deleting" one can't mean
      // filtering it out of a list it was never in — it has to be recorded in
      // the hiddenDefaultPartitionIds tombstone list, which brokerPartitions
      // subtracts out above. Custom entries are still removed outright.
      if (DEFAULT_BROKER_PARTITIONS.some((p) => p.id === id)) {
        setHiddenDefaultPartitionIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
      } else {
        setCustomBrokerPartitions((prev) => prev.filter((p) => p.id !== id));
      }
      return true;
    },
    updateBrokerPartition: (id, patch) => {
      if (!customBrokerPartitions.some((p) => p.id === id)) return false; // defaults can't be edited in place
      markLocalWrite();
      setCustomBrokerPartitions((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
      return true;
    },
    partitionLabel,
    showPersonalQuotes,
    setShowPersonalQuotes: (v) => {
      markLocalWrite();
      setShowPersonalQuotesState(v);
    },
    isOwnerUnlocked,
    unlockOwnerReflections: (pin) => {
      if (pin !== OWNER_REFLECTIONS_PIN) return false;
      setIsOwnerUnlockedState(true);
      try {
        localStorage.setItem(OWNER_UNLOCKED_KEY, "true");
      } catch {
        // Ignore — the in-memory unlock still applies for this session.
      }
      return true;
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
    customObligations,
    addObligation: (label, amount) => {
      const trimmed = label.trim();
      if (!trimmed) return;
      markLocalWrite();
      setCustomObligations((prev) =>
        prev.some((o) => o.label.toLowerCase() === trimmed.toLowerCase())
          ? prev
          : [...prev, { id: crypto.randomUUID(), label: trimmed, amount: amount > 0 ? amount : 0 }],
      );
    },
    deleteObligation: (id) => {
      markLocalWrite();
      setCustomObligations((prev) => prev.filter((o) => o.id !== id));
      setCustomObligationsPending((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    },
    customObligationsPending,
    toggleCustomObligation: (id) => {
      markLocalWrite();
      setCustomObligationsPending((prev) => ({ ...prev, [id]: !prev[id] }));
    },
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
          customAccountModes,
          customBrokerPartitions,
          customCategories,
          hiddenDefaultCategories,
          hiddenDefaultAccountIds,
          hiddenDefaultPartitionIds,
          showPersonalQuotes,
          customObligations,
          customObligationsPendingByMonth: loadAllCustomObligationsPending(),
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
      const importedAccountModes =
        b.customAccountModes !== undefined
          ? normalizeCustomAccountModes(b.customAccountModes)
          : customAccountModes;
      const importedBrokerPartitions =
        b.customBrokerPartitions !== undefined
          ? normalizeCustomBrokerPartitions(b.customBrokerPartitions)
          : customBrokerPartitions;
      const importedHiddenCategories =
        b.hiddenDefaultCategories !== undefined
          ? normalizeCustomCategories(b.hiddenDefaultCategories)
          : hiddenDefaultCategories;
      const importedHiddenAccountIds =
        b.hiddenDefaultAccountIds !== undefined
          ? normalizeStringArray(b.hiddenDefaultAccountIds)
          : hiddenDefaultAccountIds;
      const importedHiddenPartitionIds =
        b.hiddenDefaultPartitionIds !== undefined
          ? normalizeStringArray(b.hiddenDefaultPartitionIds)
          : hiddenDefaultPartitionIds;
      // Clamped by the owner-unlock gate (React state is safe to read directly
      // here — unlike the load effect, importData is a plain callback, not a
      // mount-time effect closure, so there's no stale-value risk). Otherwise
      // a hand-edited or shared backup file could flip personal quotes on
      // without ever passing the PIN check on this device.
      const importedShowPersonal =
        (typeof b.showPersonalQuotes === "boolean" ? b.showPersonalQuotes : showPersonalQuotes) &&
        isOwnerUnlocked;
      const importedObligations =
        b.customObligations !== undefined
          ? normalizeCustomObligations(b.customObligations)
          : customObligations;

      markLocalWrite();
      setTransactions(importedTransactions);
      setTrades(importedTrades);
      setPortfolioSnapshots(importedSnapshots);
      setGrind(importedGrind);
      setBlueprintSettings(importedBlueprint);
      setCustomCategories(importedCats);
      setCustomAccountModes(importedAccountModes);
      setCustomBrokerPartitions(importedBrokerPartitions);
      setHiddenDefaultCategories(importedHiddenCategories);
      setHiddenDefaultAccountIds(importedHiddenAccountIds);
      setHiddenDefaultPartitionIds(importedHiddenPartitionIds);
      setShowPersonalQuotesState(importedShowPersonal);
      setCustomObligations(importedObligations);

      if (b.pendingByMonth && typeof b.pendingByMonth === "object") {
        const monthMap = b.pendingByMonth as Record<string, MonthlyPending>;
        try {
          localStorage.setItem(PENDING_KEY, JSON.stringify(monthMap));
        } catch {
          // Non-fatal — the current month's slice below still applies in memory.
        }
        setPendingChecklist(monthMap[currentMonthKey()] ?? {});
      }

      if (b.customObligationsPendingByMonth && typeof b.customObligationsPendingByMonth === "object") {
        const monthMap = b.customObligationsPendingByMonth as Record<string, Record<string, boolean>>;
        try {
          localStorage.setItem(CUSTOM_OBLIGATIONS_PENDING_KEY, JSON.stringify(monthMap));
        } catch {
          // Non-fatal — the current month's slice below still applies in memory.
        }
        setCustomObligationsPending(monthMap[currentMonthKey()] ?? {});
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
            customAccountModes: importedAccountModes,
            customBrokerPartitions: importedBrokerPartitions,
            customIncomeCategories: importedCats.income,
            customExpenseCategories: importedCats.expense,
            hiddenDefaultCategories: importedHiddenCategories,
            hiddenDefaultAccountIds: importedHiddenAccountIds,
            hiddenDefaultPartitionIds: importedHiddenPartitionIds,
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
      setCustomAccountModes([]);
      setCustomBrokerPartitions([]);
      setCustomCategories(DEFAULT_CUSTOM_CATEGORIES);
      setHiddenDefaultCategories(EMPTY_HIDDEN_CATEGORIES);
      setHiddenDefaultAccountIds([]);
      setHiddenDefaultPartitionIds([]);
      setPendingChecklist({});
      setCustomObligations([]);
      setCustomObligationsPending({});
      setOnboardingCompleted(false);
      // Deliberately does NOT touch remote Supabase rows or sign the user out —
      // this clears the LOCAL cache only. For a cloud-synced account, the next
      // full reload's "cloud wins" load would otherwise just re-populate
      // everything from the account's still-intact remote data; the caller
      // should navigate client-side (not a hard reload) immediately after this
      // so the in-memory reset actually sticks for the current session.
      // isStealthMode/isOwnerUnlocked are deliberately left untouched — both
      // are device-trust/UI preferences, not financial data, so a data wipe
      // shouldn't force switching privacy off or re-entering the owner PIN.
    },
    hydrated,
    isFirstTimeUser:
      transactions.length === 0 &&
      trades.length === 0 &&
      portfolioSnapshots.length === 0 &&
      customAccountModes.length === 0 &&
      customBrokerPartitions.length === 0 &&
      customCategories.income.length === 0 &&
      customCategories.expense.length === 0 &&
      hiddenDefaultCategories.income.length === 0 &&
      hiddenDefaultCategories.expense.length === 0 &&
      hiddenDefaultAccountIds.length === 0 &&
      hiddenDefaultPartitionIds.length === 0 &&
      customObligations.length === 0,
    onboardingCompleted,
    completeOnboarding: () => {
      setOnboardingCompleted(true);
      try {
        localStorage.setItem(ONBOARDING_KEY, "true");
      } catch {
        // Ignore — the in-memory flag still suppresses the wizard this session.
      }
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useStore = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStore must be used within StoreProvider");
  return v;
};
