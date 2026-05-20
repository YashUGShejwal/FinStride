/**
 * Exact column-level TypeScript types mirroring the future Supabase PostgreSQL schema.
 * All field names use snake_case to match DB column names 1-to-1.
 * These are the canonical "row shapes" — local store types align to these and camelCase them.
 */

// ─── profiles ─────────────────────────────────────────────────────────────
/** Mirrors: profiles (id uuid pk, updated_at timestamptz, full_name text) */
export interface DbProfile {
  id: string;
  updated_at: string | null;
  full_name: string | null;
}

// ─── cashflow_ledger ───────────────────────────────────────────────────────
/**
 * Mirrors: cashflow_ledger
 *   id uuid pk, user_id uuid fk→profiles, date date,
 *   type text check(income|expense), category text,
 *   account text, amount numeric, notes text
 */
export interface DbCashflowRow {
  id: string;
  user_id: string;
  date: string;           // ISO date string (YYYY-MM-DD)
  type: "income" | "expense";
  category: string;
  account: string;        // e.g. "Bank Account" | "Cash" | "Credit Card"
  amount: number;
  notes: string | null;
}

// ─── swing_trades ─────────────────────────────────────────────────────────
/**
 * Mirrors: swing_trades
 *   id uuid pk, user_id uuid fk→profiles, ticker text,
 *   entry_date date, exit_date date nullable,
 *   qty integer, entry_price numeric, stop_loss numeric, target_price numeric,
 *   status text check(open|closed), source text
 */
export interface DbSwingTradeRow {
  id: string;
  user_id: string;
  ticker: string;
  entry_date: string;     // ISO date string
  exit_date: string | null;
  qty: number;
  entry_price: number;
  stop_loss: number;
  target_price: number;
  status: "open" | "closed";
  source: string;         // e.g. "TheDoji" | "Self"
}

// ─── portfolio_snapshots ──────────────────────────────────────────────────
/**
 * Mirrors: portfolio_snapshots
 *   id uuid pk, user_id uuid fk→profiles,
 *   snapshot_date date, broker_partition text, current_value numeric
 *
 * One row per (snapshot_date, broker_partition) pair — normalized.
 */
export interface DbPortfolioSnapshotRow {
  id: string;
  user_id: string;
  snapshot_date: string;  // ISO date string
  broker_partition: string; // e.g. "Dhan Swing" | "Zerodha Vault" | …
  current_value: number;
}
