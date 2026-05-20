import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

// Local persistence layer. Methods mirror what a Supabase-backed repo would
// expose so we can drop in SDK calls (.from().insert/select/delete) later.

export type BrokerPartition = "Zerodha_Vault" | "Dhan_Swing" | "INDmoney_US" | "Liquid_Cash";

export type InvestmentApp = {
  id: BrokerPartition;
  label: string;
  description: string;
  scopes: ("cashflow" | "swing")[];
};

/** Active investment apps — deprecated brokers (Groww, Kotak Neo, etc.) removed. */
export const INVESTMENT_APPS: readonly InvestmentApp[] = [
  {
    id: "Zerodha_Vault",
    label: "Zerodha Vault",
    description: "Long-hold equity vault (delivery)",
    scopes: ["cashflow", "swing"],
  },
  {
    id: "Dhan_Swing",
    label: "Dhan Swing",
    description: "Active swing book — equity only",
    scopes: ["swing", "cashflow"],
  },
  {
    id: "INDmoney_US",
    label: "INDmoney US",
    description: "US equities partition",
    scopes: ["cashflow"],
  },
  {
    id: "Liquid_Cash",
    label: "Liquid Cash",
    description: "Bank runway & liquid reserves",
    scopes: ["cashflow"],
  },
] as const;

export const BROKER_PARTITION_IDS = INVESTMENT_APPS.map((a) => a.id);

export function partitionLabel(id: BrokerPartition): string {
  return INVESTMENT_APPS.find((a) => a.id === id)?.label ?? id;
}

export function appsForScope(scope: "cashflow" | "swing"): InvestmentApp[] {
  return INVESTMENT_APPS.filter((a) => a.scopes.includes(scope));
}

function normalizePartition(raw: unknown): BrokerPartition {
  if (typeof raw === "string" && BROKER_PARTITION_IDS.includes(raw as BrokerPartition)) {
    return raw as BrokerPartition;
  }
  return "Liquid_Cash";
}

function normalizeTransaction(raw: Record<string, unknown>): Transaction {
  return {
    id: String(raw.id),
    date: String(raw.date),
    type: raw.type as TxType,
    category: raw.category as TxCategory,
    partition: normalizePartition(raw.partition ?? raw.account),
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
    partition: normalizePartition(raw.partition ?? "Dhan_Swing"),
  };
}

export type TxType = "income" | "expense";
export type TxCategory = "Salary" | "Fixed Runrate" | "Scooter EMI" | "Freelance" | "Other";

export type Transaction = {
  id: string;
  date: string; // ISO
  type: TxType;
  category: TxCategory;
  partition: BrokerPartition;
  amount: number;
  tags: string[];
  notes?: string;
};

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
};

type StoreCtx = {
  transactions: Transaction[];
  trades: Trade[];
  addTransaction: (t: Omit<Transaction, "id">) => void;
  deleteTransaction: (id: string) => void;
  addTrade: (t: Omit<Trade, "id">) => void;
  deleteTrade: (id: string) => void;
};

const Ctx = createContext<StoreCtx | null>(null);
const TX_KEY = "finstride.transactions";
const TR_KEY = "finstride.trades";

const seedTx: Transaction[] = [
  { id: crypto.randomUUID(), date: new Date(Date.now() - 86400000 * 2).toISOString(), type: "income", category: "Salary", partition: "Liquid_Cash", amount: 76000, tags: ["monthly"], notes: "May salary" },
  { id: crypto.randomUUID(), date: new Date(Date.now() - 86400000 * 5).toISOString(), type: "expense", category: "Fixed Runrate", partition: "Liquid_Cash", amount: 39000, tags: ["essentials"] },
  { id: crypto.randomUUID(), date: new Date(Date.now() - 86400000 * 7).toISOString(), type: "expense", category: "Scooter EMI", partition: "Liquid_Cash", amount: 9000, tags: ["emi"] },
];

export function StoreProvider({ children }: { children: ReactNode }) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);

  useEffect(() => {
    try {
      const tx = localStorage.getItem(TX_KEY);
      setTransactions(
        tx ? (JSON.parse(tx) as Record<string, unknown>[]).map(normalizeTransaction) : seedTx,
      );
      const tr = localStorage.getItem(TR_KEY);
      setTrades(tr ? (JSON.parse(tr) as Record<string, unknown>[]).map(normalizeTrade) : []);
    } catch {
      setTransactions(seedTx);
    }
  }, []);

  useEffect(() => {
    if (transactions.length) localStorage.setItem(TX_KEY, JSON.stringify(transactions));
  }, [transactions]);
  useEffect(() => {
    localStorage.setItem(TR_KEY, JSON.stringify(trades));
  }, [trades]);

  const value: StoreCtx = {
    transactions,
    trades,
    addTransaction: (t) => setTransactions((s) => [{ ...t, id: crypto.randomUUID() }, ...s]),
    deleteTransaction: (id) => setTransactions((s) => s.filter((x) => x.id !== id)),
    addTrade: (t) => setTrades((s) => [{ ...t, id: crypto.randomUUID() }, ...s]),
    deleteTrade: (id) => setTrades((s) => s.filter((x) => x.id !== id)),
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useStore = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStore within StoreProvider");
  return v;
};

// Business constants — Personal Cashflow Blueprint
export const BLUEPRINT = {
  salaryBaseline: 76000,
  fixedRunrate: 39000,
  scooterEmi: 9000,
  accountBalance: 300000, // arbitrary total account balance
  riskCapPct: 0.03, // 3% rule
};
