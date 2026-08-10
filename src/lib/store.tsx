import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

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
  { id: "Zerodha Vault",  label: "Zerodha Vault",  description: "Long-hold equity vault (delivery)",  scopes: ["cashflow", "swing"] },
  { id: "Dhan Swing",     label: "Dhan Swing",     description: "Active swing book — equity only",    scopes: ["cashflow", "swing"] },
  { id: "INDmoney US",    label: "INDmoney US",    description: "US equities partition",               scopes: ["cashflow", "swing"] },
  { id: "CoinDCX Crypto", label: "CoinDCX Crypto", description: "Crypto holdings",                    scopes: ["cashflow", "swing"] },
  { id: "Groww MF",       label: "Groww MF",       description: "Mutual Fund SIPs via Groww",          scopes: ["cashflow", "swing"] },
  { id: "Cash",           label: "Cash",           description: "Physical cash & liquid reserves",     scopes: ["cashflow", "swing"] },
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
  { key: "Zerodha Vault", label: "Zerodha Vault", description: "Long-term ETFs & SGBs" },
  { key: "Dhan Swing",    label: "Dhan Swing",    description: "Active equity swings" },
  { key: "INDmoney US",  label: "INDmoney US",   description: "US fractional stocks" },
  { key: "Cash",          label: "Liquid Cash",   description: "Emergency bank balance" },
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

export const DEFAULT_BLUEPRINT: BlueprintSettings = {
  defaultSalary: 76000,
  fixedRunrate: 39000,
  scooterEmi: 9000,
  defaultRiskCapPct: 0.03,
  growwMfSip: 5000,
  riskCapPartition: "Dhan Swing",
};

const BLUEPRINT_KEY = "finstride.blueprint.settings";

function normalizeBlueprint(raw: unknown): BlueprintSettings {
  if (!raw || typeof raw !== "object") return DEFAULT_BLUEPRINT;
  const r = raw as Record<string, unknown>;
  // typeof === "number" (not `Number(x) || fallback`) so an intentionally-saved
  // 0 (e.g. "EMI paid off") isn't silently reverted to the hardcoded default —
  // 0 is falsy in JS, so `||` would otherwise always prefer the fallback.
  return {
    defaultSalary:    typeof r.defaultSalary    === "number" ? r.defaultSalary    : DEFAULT_BLUEPRINT.defaultSalary,
    fixedRunrate:     typeof r.fixedRunrate      === "number" ? r.fixedRunrate      : DEFAULT_BLUEPRINT.fixedRunrate,
    scooterEmi:       typeof r.scooterEmi        === "number" ? r.scooterEmi        : DEFAULT_BLUEPRINT.scooterEmi,
    defaultRiskCapPct: typeof r.defaultRiskCapPct === "number" ? r.defaultRiskCapPct : DEFAULT_BLUEPRINT.defaultRiskCapPct,
    growwMfSip:       typeof r.growwMfSip        === "number" ? r.growwMfSip        : DEFAULT_BLUEPRINT.growwMfSip,
    riskCapPartition: typeof r.riskCapPartition === "string" && r.riskCapPartition.trim()
      ? r.riskCapPartition
      : DEFAULT_BLUEPRINT.riskCapPartition,
  };
}

// ─── Dynamic Categories ────────────────────────────────────────────────────
export const DEFAULT_INCOME_CATEGORIES: readonly string[] = [
  "Salary", "Freelance", "Capital Transfer (In)", "Other",
];
export const DEFAULT_EXPENSE_CATEGORIES: readonly string[] = [
  "Fixed Runrate", "Scooter EMI", "Capital Transfer (Out)", "Other",
];

type CustomCategories = { income: string[]; expense: string[] };
const CATEGORIES_KEY = "finstride.categories.custom";
const DEFAULT_CUSTOM_CATEGORIES: CustomCategories = { income: [], expense: [] };

function normalizeCustomCategories(raw: unknown): CustomCategories {
  if (!raw || typeof raw !== "object") return DEFAULT_CUSTOM_CATEGORIES;
  const r = raw as Record<string, unknown>;
  return {
    income:  Array.isArray(r.income)  ? (r.income  as string[]).filter((s) => typeof s === "string") : [],
    expense: Array.isArray(r.expense) ? (r.expense as string[]).filter((s) => typeof s === "string") : [],
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
const LEGACY_PARTITION_MAP: Record<string, string> = {
  Zerodha_Vault: "Zerodha Vault",
  Dhan_Swing:    "Dhan Swing",
  INDmoney_US:   "INDmoney US",
  Liquid_Cash:   "Cash",
};

// Any non-empty string is a valid partition (built-in default or user custom) —
// only a missing/empty value falls back to a default. This must stay permissive
// (not restricted to an enumerated list) so custom partitions round-trip through
// localStorage correctly instead of being silently reset on reload.
function normalizePartition(raw: unknown): string {
  if (typeof raw === "string" && raw.trim()) {
    return LEGACY_PARTITION_MAP[raw] ?? raw;
  }
  return "Dhan Swing";
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
    partition: normalizePartition(raw.partition ?? "Dhan Swing"),
    notes: raw.notes ? String(raw.notes) : undefined,
    status: raw.status === "closed" ? "closed" : "open",
    closeReason: (raw.closeReason as CloseReason | undefined) ?? undefined,
    closeNotes: raw.closeNotes ? String(raw.closeNotes) : undefined,
    exitDate: raw.exitDate ? String(raw.exitDate) : (raw.closedAt ? String(raw.closedAt) : undefined),
  };
}

// ─── Grind Deck ───────────────────────────────────────────────────────────
export type GrindMetricKey = "systemDesign" | "leetcode" | "linkedinOutreach";

export const GRIND_METRIC_META: Record<
  GrindMetricKey,
  { label: string; inputLabel: string; metaLabel?: string; placeholder: string; metaPlaceholder?: string }
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
};

const Ctx = createContext<StoreCtx | null>(null);
const TX_KEY   = "finstride.transactions";
const TR_KEY   = "finstride.trades";
const SNAP_KEY = "finstride.portfolio.snapshots";

export function StoreProvider({ children }: { children: ReactNode }) {
  const [transactions, setTransactions]       = useState<Transaction[]>([]);
  const [trades, setTrades]                   = useState<Trade[]>([]);
  const [pendingChecklist, setPendingChecklist] = useState<MonthlyPending>({});
  const [portfolioSnapshots, setPortfolioSnapshots] = useState<PortfolioSnapshot[]>([]);
  const [grind, setGrind]                     = useState<GrindState>(EMPTY_GRIND);
  const [blueprintSettings, setBlueprintSettings] = useState<BlueprintSettings>(DEFAULT_BLUEPRINT);
  const [customCategories, setCustomCategories] = useState<CustomCategories>(DEFAULT_CUSTOM_CATEGORIES);
  const [customPaymentModes, setCustomPaymentModes] = useState<string[]>([]);
  const [customPartitions, setCustomPartitions] = useState<CustomPartition[]>([]);
  const [showPersonalQuotes, setShowPersonalQuotesState] = useState(false);

  // ── Initial load ────────────────────────────────────────────────────────
  useEffect(() => {
    try {
      const tx = localStorage.getItem(TX_KEY);
      setTransactions(tx ? (JSON.parse(tx) as Record<string, unknown>[]).map(normalizeTransaction) : []);
      const tr = localStorage.getItem(TR_KEY);
      setTrades(tr ? (JSON.parse(tr) as Record<string, unknown>[]).map(normalizeTrade) : []);
      const sn = localStorage.getItem(SNAP_KEY);
      if (sn) {
        const rawSnaps = JSON.parse(sn) as Record<string, unknown>[];
        const rows: PortfolioSnapshot[] = [];
        for (const raw of rawSnaps) {
          const result = normalizeSnapshot(raw);
          if (Array.isArray(result)) rows.push(...result);
          else rows.push(result);
        }
        setPortfolioSnapshots(rows);
      }
      const gr = localStorage.getItem(GRIND_KEY);
      setGrind(gr ? normalizeGrindState(JSON.parse(gr)) : EMPTY_GRIND);
      const bp = localStorage.getItem(BLUEPRINT_KEY);
      if (bp) setBlueprintSettings(normalizeBlueprint(JSON.parse(bp)));
      const cc = localStorage.getItem(CATEGORIES_KEY);
      if (cc) setCustomCategories(normalizeCustomCategories(JSON.parse(cc)));
      const cpm = localStorage.getItem(CUSTOM_PAYMENT_MODES_KEY);
      if (cpm) setCustomPaymentModes(normalizeCustomPaymentModes(JSON.parse(cpm)));
      const cp = localStorage.getItem(CUSTOM_PARTITIONS_KEY);
      if (cp) setCustomPartitions(normalizeCustomPartitions(JSON.parse(cp)));
      const spq = localStorage.getItem(SHOW_PERSONAL_QUOTES_KEY);
      if (spq !== null) setShowPersonalQuotesState(spq === "true");
    } catch {
      setTransactions([]);
    }
    const allPending = loadAllPending();
    setPendingChecklist(allPending[currentMonthKey()] ?? {});
  }, []);

  // ── Persist effects ──────────────────────────────────────────────────────
  useEffect(() => {
    if (transactions.length) localStorage.setItem(TX_KEY, JSON.stringify(transactions));
  }, [transactions]);

  useEffect(() => {
    localStorage.setItem(TR_KEY, JSON.stringify(trades));
  }, [trades]);

  useEffect(() => {
    const allPending = loadAllPending();
    allPending[currentMonthKey()] = pendingChecklist;
    localStorage.setItem(PENDING_KEY, JSON.stringify(allPending));
  }, [pendingChecklist]);

  useEffect(() => {
    localStorage.setItem(SNAP_KEY, JSON.stringify(portfolioSnapshots));
  }, [portfolioSnapshots]);

  useEffect(() => {
    localStorage.setItem(GRIND_KEY, JSON.stringify(grind));
  }, [grind]);

  useEffect(() => {
    localStorage.setItem(BLUEPRINT_KEY, JSON.stringify(blueprintSettings));
  }, [blueprintSettings]);

  useEffect(() => {
    localStorage.setItem(CATEGORIES_KEY, JSON.stringify(customCategories));
  }, [customCategories]);

  useEffect(() => {
    localStorage.setItem(CUSTOM_PAYMENT_MODES_KEY, JSON.stringify(customPaymentModes));
  }, [customPaymentModes]);

  useEffect(() => {
    localStorage.setItem(CUSTOM_PARTITIONS_KEY, JSON.stringify(customPartitions));
  }, [customPartitions]);

  useEffect(() => {
    localStorage.setItem(SHOW_PERSONAL_QUOTES_KEY, String(showPersonalQuotes));
  }, [showPersonalQuotes]);

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

  const incomeCategories  = [...DEFAULT_INCOME_CATEGORIES,  ...customCategories.income];
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

  const toggleObligation = (key: ObligationKey) =>
    setPendingChecklist((prev) => ({ ...prev, [key]: !prev[key] }));

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
    updateBlueprintSettings: (patch) =>
      setBlueprintSettings((prev) => ({ ...prev, ...patch })),
    incomeCategories,
    expenseCategories,
    addCategory: (type, name) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const defaults = type === "income" ? DEFAULT_INCOME_CATEGORIES : DEFAULT_EXPENSE_CATEGORIES;
      if (defaults.includes(trimmed)) return; // already a default
      setCustomCategories((prev) => {
        if (prev[type].includes(trimmed)) return prev;
        return { ...prev, [type]: [...prev[type], trimmed] };
      });
    },
    deleteCustomCategory: (type, name) => {
      const defaults = type === "income" ? DEFAULT_INCOME_CATEGORIES : DEFAULT_EXPENSE_CATEGORIES;
      if (defaults.includes(name)) return; // cannot delete defaults
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
      setCustomPaymentModes((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
    },
    deleteCustomPaymentMode: (name) => {
      if (DEFAULT_PAYMENT_MODES.includes(name)) return; // cannot delete defaults
      setCustomPaymentModes((prev) => prev.filter((m) => m !== name));
    },
    investmentApps,
    portfolioPartitions,
    addBrokerPartition: (id, description) => {
      const trimmed = id.trim();
      if (!trimmed) return;
      if (DEFAULT_INVESTMENT_APPS.some((a) => a.id === trimmed)) return; // already a default
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
      setCustomPartitions((prev) => prev.filter((p) => p.id !== id));
      return true;
    },
    partitionLabel,
    showPersonalQuotes,
    setShowPersonalQuotes: (v) => setShowPersonalQuotesState(v),
    addTransaction: (t) => setTransactions((s) => [{ ...t, id: crypto.randomUUID() }, ...s]),
    deleteTransaction: (id) => setTransactions((s) => s.filter((x) => x.id !== id)),
    addTrade: (t) =>
      setTrades((s) => [{ ...t, id: crypto.randomUUID(), status: "open" }, ...s]),
    closeTrade: (id, closeReason, closeNotes) =>
      setTrades((s) =>
        s.map((t) =>
          t.id === id
            ? { ...t, status: "closed", closeReason, closeNotes: closeNotes || undefined, exitDate: new Date().toISOString() }
            : t,
        ),
      ),
    deleteTrade: (id) => setTrades((s) => s.filter((x) => x.id !== id)),
    toggleObligation,
    addPortfolioSnapshots: (entries, notes, snapshotDate) => {
      const date = snapshotDate ?? new Date().toISOString();
      const rows: PortfolioSnapshot[] = entries.map((e) => ({
        id: crypto.randomUUID(),
        snapshotDate: date,
        brokerPartition: e.brokerPartition,
        currentValue: e.currentValue,
        notes,
      }));
      setPortfolioSnapshots((s) => [...rows, ...s]);
    },
    deletePortfolioSnapshot: (id) =>
      setPortfolioSnapshots((s) => s.filter((x) => x.id !== id)),
    grind,
    addGrindLog: (metric, label, meta) =>
      setGrind((s) => ({
        ...s,
        metrics: {
          ...s.metrics,
          [metric]: [
            { id: crypto.randomUUID(), loggedAt: new Date().toISOString(), label, meta },
            ...s.metrics[metric],
          ],
        },
      })),
    deleteGrindLog: (metric, id) =>
      setGrind((s) => ({
        ...s,
        metrics: {
          ...s.metrics,
          [metric]: s.metrics[metric].filter((e) => e.id !== id),
        },
      })),
    addHustleEntry: (entry) =>
      setGrind((s) => ({
        ...s,
        hustle: [{ ...entry, id: crypto.randomUUID() }, ...s.hustle],
      })),
    deleteHustleEntry: (id) =>
      setGrind((s) => ({ ...s, hustle: s.hustle.filter((e) => e.id !== id) })),
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useStore = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStore must be used within StoreProvider");
  return v;
};
