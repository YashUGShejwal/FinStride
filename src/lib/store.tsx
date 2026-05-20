import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

// Local persistence layer. Methods mirror what a Supabase-backed repo would
// expose so we can drop in SDK calls (.from().insert/select/delete) later.

export type TxType = "income" | "expense";
export type TxCategory = "Salary" | "Fixed Runrate" | "Scooter EMI" | "Freelance" | "Other";

export type Transaction = {
  id: string;
  date: string; // ISO
  type: TxType;
  category: TxCategory;
  account: string;
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
const TX_KEY = "swingdash.transactions";
const TR_KEY = "swingdash.trades";

const seedTx: Transaction[] = [
  { id: crypto.randomUUID(), date: new Date(Date.now() - 86400000 * 2).toISOString(), type: "income", category: "Salary", account: "HDFC", amount: 76000, tags: ["monthly"], notes: "May salary" },
  { id: crypto.randomUUID(), date: new Date(Date.now() - 86400000 * 5).toISOString(), type: "expense", category: "Fixed Runrate", account: "HDFC", amount: 39000, tags: ["essentials"] },
  { id: crypto.randomUUID(), date: new Date(Date.now() - 86400000 * 7).toISOString(), type: "expense", category: "Scooter EMI", account: "ICICI", amount: 9000, tags: ["emi"] },
];

export function StoreProvider({ children }: { children: ReactNode }) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);

  useEffect(() => {
    try {
      const tx = localStorage.getItem(TX_KEY);
      setTransactions(tx ? JSON.parse(tx) : seedTx);
      const tr = localStorage.getItem(TR_KEY);
      setTrades(tr ? JSON.parse(tr) : []);
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
