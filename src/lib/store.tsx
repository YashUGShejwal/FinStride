import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

// ─── Payment mode (used in Cashflow ledger only) ───────────────────────────
export type PaymentMode = "Bank Account" | "Cash" | "Credit Card";
export const PAYMENT_MODES: readonly PaymentMode[] = ["Bank Account", "Cash", "Credit Card"];

// ─── Investment broker partitions (used in Swing logger & Profile) ─────────
export type BrokerPartition =
  | "Zerodha Vault"
  | "Dhan Swing"
  | "INDmoney US"
  | "CoinDCX Crypto"
  | "Groww MF"
  | "Cash";

export type InvestmentApp = {
  id: BrokerPartition;
  label: string;
  description: string;
  scopes: ("cashflow" | "swing")[];
};

export const INVESTMENT_APPS: readonly InvestmentApp[] = [
  { id: "Zerodha Vault",  label: "Zerodha Vault",  description: "Long-hold equity vault (delivery)",  scopes: ["cashflow", "swing"] },
  { id: "Dhan Swing",     label: "Dhan Swing",     description: "Active swing book — equity only",    scopes: ["cashflow", "swing"] },
  { id: "INDmoney US",    label: "INDmoney US",    description: "US equities partition",               scopes: ["cashflow", "swing"] },
  { id: "CoinDCX Crypto", label: "CoinDCX Crypto", description: "Crypto holdings",                    scopes: ["cashflow", "swing"] },
  { id: "Groww MF",       label: "Groww MF",       description: "Mutual Fund SIPs via Groww",          scopes: ["cashflow", "swing"] },
  { id: "Cash",           label: "Cash",           description: "Physical cash & liquid reserves",     scopes: ["cashflow", "swing"] },
] as const;

export const BROKER_PARTITION_IDS = INVESTMENT_APPS.map((a) => a.id);

export function partitionLabel(id: BrokerPartition): string {
  return INVESTMENT_APPS.find((a) => a.id === id)?.label ?? id;
}

export function appsForScope(scope: "cashflow" | "swing"): InvestmentApp[] {
  return INVESTMENT_APPS.filter((a) => a.scopes.includes(scope));
}

// ─── Portfolio snapshots ───────────────────────────────────────────────────
// The four partitions we track with manual point-in-time capital snapshots.
export type PortfolioPartitionKey = "Zerodha Vault" | "Dhan Swing" | "INDmoney US" | "Cash";

export const PORTFOLIO_PARTITIONS: readonly {
  key: PortfolioPartitionKey;
  label: string;
  description: string;
}[] = [
  { key: "Zerodha Vault", label: "Zerodha Vault", description: "Long-term ETFs & SGBs" },
  { key: "Dhan Swing",    label: "Dhan Swing",    description: "Active equity swings" },
  { key: "INDmoney US",  label: "INDmoney US",   description: "US fractional stocks" },
  { key: "Cash",          label: "Liquid Cash",   description: "Emergency bank balance" },
] as const;

/**
 * One per-partition row — mirrors portfolio_snapshots DB schema exactly.
 * Local camelCase fields map 1-to-1: snapshotDate↔snapshot_date,
 * brokerPartition↔broker_partition, currentValue↔current_value.
 */
export type PortfolioSnapshot = {
  id: string;
  snapshotDate: string;                    // ISO — DB: snapshot_date
  brokerPartition: PortfolioPartitionKey;  // DB: broker_partition
  currentValue: number;                    // DB: current_value
  notes?: string;                          // local-only; not in DB schema
};

const PORTFOLIO_PARTITION_KEYS = PORTFOLIO_PARTITIONS.map((p) => p.key) as PortfolioPartitionKey[];

function normalizeSnapshot(raw: Record<string, unknown>): PortfolioSnapshot | PortfolioSnapshot[] {
  if (raw.brokerPartition !== undefined) {
    // New per-row shape
    const partition = raw.brokerPartition as string;
    return {
      id: String(raw.id),
      snapshotDate: String(raw.snapshotDate ?? raw.recordedAt ?? new Date().toISOString()),
      brokerPartition: PORTFOLIO_PARTITION_KEYS.includes(partition as PortfolioPartitionKey)
        ? (partition as PortfolioPartitionKey)
        : "Cash",
      currentValue: Number(raw.currentValue) || 0,
      notes: raw.notes ? String(raw.notes) : undefined,
    };
  }
  // Legacy grouped shape: { id, recordedAt, values: { "Dhan Swing": 200000, … } }
  // Expand into one row per partition so stored data migrates cleanly.
  const legacyValues = (raw.values ?? {}) as Record<string, unknown>;
  const date = String(raw.recordedAt ?? new Date().toISOString());
  const rows: PortfolioSnapshot[] = [];
  for (const key of PORTFOLIO_PARTITION_KEYS) {
    const v = legacyValues[key];
    if (typeof v === "number" && !isNaN(v)) {
      rows.push({
        id: crypto.randomUUID(),
        snapshotDate: date,
        brokerPartition: key,
        currentValue: v,
        notes: raw.notes ? String(raw.notes) : undefined,
      });
    }
  }
  return rows;
}

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
  return new Date().toISOString().slice(0, 7); // "YYYY-MM"
}

// ─── Legacy data normalizers ───────────────────────────────────────────────
const LEGACY_PARTITION_MAP: Record<string, BrokerPartition> = {
  Zerodha_Vault: "Zerodha Vault",
  Dhan_Swing:    "Dhan Swing",
  INDmoney_US:   "INDmoney US",
  Liquid_Cash:   "Cash",
};

function normalizePartition(raw: unknown): BrokerPartition {
  if (typeof raw === "string") {
    if (BROKER_PARTITION_IDS.includes(raw as BrokerPartition)) return raw as BrokerPartition;
    if (LEGACY_PARTITION_MAP[raw]) return LEGACY_PARTITION_MAP[raw];
  }
  return "Dhan Swing";
}

function normalizePaymentMode(raw: unknown): PaymentMode {
  if (raw === "Bank Account" || raw === "Cash" || raw === "Credit Card") return raw;
  return "Bank Account";
}

// Accepts new schema (account), previous interim (paymentMode), and legacy (partition)
function normalizeTransaction(raw: Record<string, unknown>): Transaction {
  return {
    id: String(raw.id),
    date: String(raw.date),
    type: raw.type as TxType,
    category: raw.category as TxCategory,
    account: normalizePaymentMode(raw.account ?? raw.paymentMode ?? raw.partition),
    amount: Number(raw.amount),
    tags: Array.isArray(raw.tags) ? (raw.tags as string[]) : [],
    notes: raw.notes ? String(raw.notes) : undefined,
  };
}

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

// ─── Data types ────────────────────────────────────────────────────────────
export type TxType = "income" | "expense";
export type TxCategory = "Salary" | "Fixed Runrate" | "Scooter EMI" | "Freelance" | "Other";

/**
 * Mirrors cashflow_ledger DB columns (camelCase).
 * account↔cashflow_ledger.account, date↔date, type↔type, etc.
 * tags is a local UI-only field with no DB column.
 */
export type Transaction = {
  id: string;
  date: string;           // DB: date
  type: TxType;           // DB: type
  category: TxCategory;   // DB: category
  account: PaymentMode;   // DB: account ("Bank Account" | "Cash" | "Credit Card")
  amount: number;         // DB: amount
  tags: string[];         // local UI only — not in DB schema
  notes?: string;         // DB: notes
};

export type TradeStatus = "open" | "closed";
export type CloseReason = "target" | "stoploss" | "other";

/**
 * Mirrors swing_trades DB columns (camelCase).
 * qty↔qty, entryDate↔entry_date, exitDate↔exit_date, etc.
 * direction, partition, closeReason, closeNotes are local-only extensions.
 */
export type Trade = {
  id: string;
  ticker: string;          // DB: ticker
  entryDate: string;       // DB: entry_date (ISO)
  direction: "LONG";       // local only
  qty: number;             // DB: qty
  entryPrice: number;      // DB: entry_price
  targetPrice: number;     // DB: target_price
  stopLoss: number;        // DB: stop_loss
  source: "TheDoji" | "Self"; // DB: source
  partition: BrokerPartition; // local only — broker account used
  notes?: string;          // local only — entry rationale
  status: TradeStatus;     // DB: status
  closeReason?: CloseReason;  // local only
  closeNotes?: string;     // local only
  exitDate?: string;       // DB: exit_date (ISO)
};

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
  loggedAt: string; // ISO
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
  date: string; // ISO
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
  // Portfolio snapshot state — per-row, aligned with portfolio_snapshots schema
  portfolioSnapshots: PortfolioSnapshot[];
  /** Latest current_value per broker_partition; built from the most-recent row per partition. */
  latestSnapshotValues: Partial<Record<PortfolioPartitionKey, number>>;
  /** Latest recorded Dhan Swing capital; falls back to BLUEPRINT.accountBalance if no snapshot. */
  dhanSwingCapital: number;
  addTransaction: (t: Omit<Transaction, "id">) => void;
  deleteTransaction: (id: string) => void;
  addTrade: (t: Omit<Trade, "id" | "status">) => void;
  closeTrade: (id: string, closeReason: CloseReason, closeNotes?: string) => void;
  deleteTrade: (id: string) => void;
  toggleObligation: (key: ObligationKey) => void;
  /**
   * Add one or more snapshot rows in a single "session" (all share the same timestamp).
   * Each entry becomes a separate row — mirrors portfolio_snapshots.
   */
  addPortfolioSnapshots: (
    entries: Array<{ brokerPartition: PortfolioPartitionKey; currentValue: number }>,
    notes?: string,
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
// GRIND_KEY defined above near GrindState types

const seedTx: Transaction[] = [
  { id: crypto.randomUUID(), date: new Date(Date.now() - 86400000 * 2).toISOString(), type: "income",  category: "Salary",        account: "Bank Account", amount: 76000, tags: ["monthly"],    notes: "May salary" },
  { id: crypto.randomUUID(), date: new Date(Date.now() - 86400000 * 5).toISOString(), type: "expense", category: "Fixed Runrate", account: "Bank Account", amount: 39000, tags: ["essentials"] },
  { id: crypto.randomUUID(), date: new Date(Date.now() - 86400000 * 7).toISOString(), type: "expense", category: "Scooter EMI",   account: "Bank Account", amount: 9000,  tags: ["emi"] },
];

export function StoreProvider({ children }: { children: ReactNode }) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [pendingChecklist, setPendingChecklist] = useState<MonthlyPending>({});
  const [portfolioSnapshots, setPortfolioSnapshots] = useState<PortfolioSnapshot[]>([]);
  const [grind, setGrind] = useState<GrindState>(EMPTY_GRIND);

  useEffect(() => {
    try {
      const tx = localStorage.getItem(TX_KEY);
      setTransactions(
        tx ? (JSON.parse(tx) as Record<string, unknown>[]).map(normalizeTransaction) : seedTx,
      );
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
    } catch {
      setTransactions(seedTx);
    }
    const allPending = loadAllPending();
    setPendingChecklist(allPending[currentMonthKey()] ?? {});
  }, []);

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

  const creditCardDues = transactions
    .filter((t) => t.type === "expense" && t.account === "Credit Card")
    .reduce((sum, t) => sum + t.amount, 0);

  // Latest value per partition: find the most-recent row for each key
  const latestSnapshotValues = PORTFOLIO_PARTITION_KEYS.reduce(
    (acc, key) => {
      const rows = portfolioSnapshots.filter((s) => s.brokerPartition === key);
      if (rows.length) {
        acc[key] = rows.reduce((a, b) => (a.snapshotDate >= b.snapshotDate ? a : b)).currentValue;
      }
      return acc;
    },
    {} as Partial<Record<PortfolioPartitionKey, number>>,
  );

  // Dhan Swing capital from latest snapshot; fall back to Blueprint default
  const dhanSwingCapital = latestSnapshotValues["Dhan Swing"] ?? BLUEPRINT.accountBalance;

  const toggleObligation = (key: ObligationKey) =>
    setPendingChecklist((prev) => ({ ...prev, [key]: !prev[key] }));

  const value: StoreCtx = {
    transactions,
    trades,
    creditCardDues,
    pendingChecklist,
    portfolioSnapshots,
    latestSnapshotValues,
    dhanSwingCapital,
    addTransaction: (t) => setTransactions((s) => [{ ...t, id: crypto.randomUUID() }, ...s]),
    deleteTransaction: (id) => setTransactions((s) => s.filter((x) => x.id !== id)),
    addTrade: (t) =>
      setTrades((s) => [{ ...t, id: crypto.randomUUID(), status: "open" }, ...s]),
    closeTrade: (id, closeReason, closeNotes) =>
      setTrades((s) =>
        s.map((t) =>
          t.id === id
            ? {
                ...t,
                status: "closed",
                closeReason,
                closeNotes: closeNotes || undefined,
                exitDate: new Date().toISOString(),
              }
            : t,
        ),
      ),
    deleteTrade: (id) => setTrades((s) => s.filter((x) => x.id !== id)),
    toggleObligation,
    addPortfolioSnapshots: (entries, notes) => {
      const snapshotDate = new Date().toISOString();
      const rows: PortfolioSnapshot[] = entries.map((e) => ({
        id: crypto.randomUUID(),
        snapshotDate,
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
  if (!v) throw new Error("useStore within StoreProvider");
  return v;
};

// ─── Business constants — Personal Cashflow Blueprint ─────────────────────
export const BLUEPRINT = {
  salaryBaseline: 76000,
  fixedRunrate: 39000,
  scooterEmi: 9000,
  growwMfSip: 5000,      // monthly SIP commitment
  accountBalance: 300000, // total account balance for risk cap
  riskCapPct: 0.03,       // 3% per-trade rule
};
