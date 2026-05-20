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

export type PortfolioSnapshot = {
  id: string;
  recordedAt: string; // ISO
  values: Partial<Record<PortfolioPartitionKey, number>>;
  notes?: string;
};

function normalizeSnapshot(raw: Record<string, unknown>): PortfolioSnapshot {
  const rawValues = (raw.values ?? {}) as Record<string, unknown>;
  const values: Partial<Record<PortfolioPartitionKey, number>> = {};
  for (const p of PORTFOLIO_PARTITIONS) {
    const v = rawValues[p.key];
    if (typeof v === "number" && !isNaN(v)) values[p.key] = v;
  }
  return {
    id: String(raw.id),
    recordedAt: String(raw.recordedAt),
    values,
    notes: raw.notes ? String(raw.notes) : undefined,
  };
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

// Accepts both new schema (paymentMode) and legacy schemas (partition / account string)
function normalizeTransaction(raw: Record<string, unknown>): Transaction {
  return {
    id: String(raw.id),
    date: String(raw.date),
    type: raw.type as TxType,
    category: raw.category as TxCategory,
    paymentMode: normalizePaymentMode(raw.paymentMode ?? raw.partition ?? raw.account),
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
    quantity: Number(raw.quantity),
    entryPrice: Number(raw.entryPrice),
    targetPrice: Number(raw.targetPrice),
    stopLoss: Number(raw.stopLoss),
    source: raw.source === "Self" ? "Self" : "TheDoji",
    partition: normalizePartition(raw.partition ?? "Dhan Swing"),
    notes: raw.notes ? String(raw.notes) : undefined,
    status: raw.status === "closed" ? "closed" : "open",
    closeReason: (raw.closeReason as CloseReason | undefined) ?? undefined,
    closeNotes: raw.closeNotes ? String(raw.closeNotes) : undefined,
    closedAt: raw.closedAt ? String(raw.closedAt) : undefined,
  };
}

// ─── Data types ────────────────────────────────────────────────────────────
export type TxType = "income" | "expense";
export type TxCategory = "Salary" | "Fixed Runrate" | "Scooter EMI" | "Freelance" | "Other";

export type Transaction = {
  id: string;
  date: string; // ISO
  type: TxType;
  category: TxCategory;
  paymentMode: PaymentMode;
  amount: number;
  tags: string[];
  notes?: string;
};

export type TradeStatus = "open" | "closed";
export type CloseReason = "target" | "stoploss" | "other";

export type Trade = {
  id: string;
  ticker: string;
  entryDate: string;
  direction: "LONG";
  quantity: number;
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  source: "TheDoji" | "Self";
  partition: BrokerPartition;
  notes?: string;        // optional rationale set at entry
  status: TradeStatus;
  closeReason?: CloseReason;
  closeNotes?: string;   // optional notes set when closing
  closedAt?: string;     // ISO date of close
};

// ─── Store context ─────────────────────────────────────────────────────────
type StoreCtx = {
  transactions: Transaction[];
  trades: Trade[];
  creditCardDues: number;
  pendingChecklist: MonthlyPending;
  // Portfolio snapshot state
  portfolioSnapshots: PortfolioSnapshot[];
  latestSnapshot: PortfolioSnapshot | null;
  /** Latest recorded Dhan Swing capital; falls back to BLUEPRINT.accountBalance if no snapshot. */
  dhanSwingCapital: number;
  addTransaction: (t: Omit<Transaction, "id">) => void;
  deleteTransaction: (id: string) => void;
  addTrade: (t: Omit<Trade, "id" | "status">) => void;
  closeTrade: (id: string, closeReason: CloseReason, closeNotes?: string) => void;
  deleteTrade: (id: string) => void;
  toggleObligation: (key: ObligationKey) => void;
  addPortfolioSnapshot: (
    values: Partial<Record<PortfolioPartitionKey, number>>,
    notes?: string,
  ) => void;
  deletePortfolioSnapshot: (id: string) => void;
};

const Ctx = createContext<StoreCtx | null>(null);
const TX_KEY = "finstride.transactions";
const TR_KEY = "finstride.trades";
const SNAP_KEY = "finstride.portfolio.snapshots";

const seedTx: Transaction[] = [
  { id: crypto.randomUUID(), date: new Date(Date.now() - 86400000 * 2).toISOString(), type: "income",  category: "Salary",        paymentMode: "Bank Account", amount: 76000, tags: ["monthly"],    notes: "May salary" },
  { id: crypto.randomUUID(), date: new Date(Date.now() - 86400000 * 5).toISOString(), type: "expense", category: "Fixed Runrate", paymentMode: "Bank Account", amount: 39000, tags: ["essentials"] },
  { id: crypto.randomUUID(), date: new Date(Date.now() - 86400000 * 7).toISOString(), type: "expense", category: "Scooter EMI",   paymentMode: "Bank Account", amount: 9000,  tags: ["emi"] },
];

export function StoreProvider({ children }: { children: ReactNode }) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [pendingChecklist, setPendingChecklist] = useState<MonthlyPending>({});
  const [portfolioSnapshots, setPortfolioSnapshots] = useState<PortfolioSnapshot[]>([]);

  useEffect(() => {
    try {
      const tx = localStorage.getItem(TX_KEY);
      setTransactions(
        tx ? (JSON.parse(tx) as Record<string, unknown>[]).map(normalizeTransaction) : seedTx,
      );
      const tr = localStorage.getItem(TR_KEY);
      setTrades(tr ? (JSON.parse(tr) as Record<string, unknown>[]).map(normalizeTrade) : []);
      const sn = localStorage.getItem(SNAP_KEY);
      setPortfolioSnapshots(
        sn ? (JSON.parse(sn) as Record<string, unknown>[]).map(normalizeSnapshot) : [],
      );
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

  const creditCardDues = transactions
    .filter((t) => t.type === "expense" && t.paymentMode === "Credit Card")
    .reduce((sum, t) => sum + t.amount, 0);

  // Latest snapshot = most recent by recordedAt
  const latestSnapshot = portfolioSnapshots.length
    ? portfolioSnapshots.reduce((a, b) => (a.recordedAt >= b.recordedAt ? a : b))
    : null;

  // Dhan Swing capital from latest snapshot; fall back to Blueprint default
  const dhanSwingCapital =
    latestSnapshot?.values["Dhan Swing"] ?? BLUEPRINT.accountBalance;

  const toggleObligation = (key: ObligationKey) =>
    setPendingChecklist((prev) => ({ ...prev, [key]: !prev[key] }));

  const value: StoreCtx = {
    transactions,
    trades,
    creditCardDues,
    pendingChecklist,
    portfolioSnapshots,
    latestSnapshot,
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
                closedAt: new Date().toISOString(),
              }
            : t,
        ),
      ),
    deleteTrade: (id) => setTrades((s) => s.filter((x) => x.id !== id)),
    toggleObligation,
    addPortfolioSnapshot: (values, notes) =>
      setPortfolioSnapshots((s) => [
        { id: crypto.randomUUID(), recordedAt: new Date().toISOString(), values, notes },
        ...s,
      ]),
    deletePortfolioSnapshot: (id) =>
      setPortfolioSnapshots((s) => s.filter((x) => x.id !== id)),
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
