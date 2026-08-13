/**
 * Exact column-level TypeScript types mirroring the Supabase PostgreSQL schema
 * defined in supabase/migrations/0001_initial_schema.sql.
 *
 * All field names use snake_case to match DB column names 1-to-1. These are the
 * canonical "row shapes"; the camelCase app models in src/lib/store.tsx are
 * converted to/from these by src/lib/db/mappers.ts.
 */

// ─── profiles ──────────────────────────────────────────────────────────────
/** Mirrors: profiles (id uuid pk refs auth.users, full_name, email, created_at) */
export type DbProfile = {
  id: string;
  full_name: string | null;
  email: string | null;
  created_at: string;
  updated_at: string;
};

export type DbProfileInsert = {
  id: string;
  full_name?: string | null;
  email?: string | null;
};

// ─── user_settings ─────────────────────────────────────────────────────────
/**
 * Mirrors: user_settings — one row per user (user_id is both PK and FK).
 *
 * `custom_account_modes` / `custom_broker_partitions` are jsonb columns holding
 * the app's structured AccountMode[] / BrokerPartition[] custom-additions lists
 * (see src/lib/store.tsx) — replacing the old flat-string payment_modes/
 * investment_apps/portfolio_partitions columns from 0001, which could only ever
 * carry plain names. `income_categories` / `expense_categories` are an addition
 * beyond the original column spec — without them the existing custom-category
 * feature could not sync.
 */
export type DbUserSettings = {
  user_id: string;
  salary_baseline: number;
  fixed_runrate: number;
  scooter_emi: number;
  groww_mf_sip: number;
  account_balance: number;
  risk_cap_pct: number;
  risk_cap_partition: string;
  show_personal_quotes: boolean;
  custom_account_modes: DbAccountModeJson[];
  custom_broker_partitions: DbBrokerPartitionJson[];
  income_categories: string[];
  expense_categories: string[];
  updated_at: string;
};

/** JSON shape stored in the custom_account_modes jsonb column — mirrors AccountMode. */
export type DbAccountModeJson = {
  id: string;
  name: string;
  type: string;
  defaultChannel?: string | null;
};

/** JSON shape stored in the custom_broker_partitions jsonb column — mirrors BrokerPartition. */
export type DbBrokerPartitionJson = {
  id: string;
  name: string;
  category: string;
  brokerApp?: string | null;
  description?: string | null;
};

export type DbUserSettingsUpsert = Omit<DbUserSettings, "updated_at">;

// ─── cashflow_ledger ───────────────────────────────────────────────────────
/** Mirrors: cashflow_ledger. `date` is a DATE column (day granularity, no time). */
export type DbCashflowRow = {
  id: string;
  user_id: string;
  date: string; // YYYY-MM-DD
  type: "income" | "expense";
  category: string;
  account: string;
  amount: number;
  tags: string[];
  notes: string | null;
  created_at: string;
};

export type DbCashflowInsert = Omit<DbCashflowRow, "created_at">;

// ─── swing_trades ──────────────────────────────────────────────────────────
/** Mirrors: swing_trades. entry_date/exit_date are DATE columns. */
export type DbSwingTradeRow = {
  id: string;
  user_id: string;
  ticker: string;
  entry_date: string; // YYYY-MM-DD
  exit_date: string | null; // YYYY-MM-DD
  direction: string;
  qty: number;
  entry_price: number;
  target_price: number;
  stop_loss: number;
  source: string;
  partition: string;
  notes: string | null;
  status: "open" | "closed";
  close_reason: string | null;
  close_notes: string | null;
  created_at: string;
};

export type DbSwingTradeInsert = Omit<DbSwingTradeRow, "created_at">;

// ─── portfolio_snapshots ───────────────────────────────────────────────────
/**
 * Mirrors: portfolio_snapshots. snapshot_date is TIMESTAMPTZ (full instant).
 * UNIQUE(user_id, snapshot_date, broker_partition) — re-recording the same
 * partition at the same instant updates in place rather than duplicating.
 */
export type DbPortfolioSnapshotRow = {
  id: string;
  user_id: string;
  snapshot_date: string; // ISO timestamptz
  broker_partition: string;
  current_value: number;
  notes: string | null;
  created_at: string;
};

export type DbPortfolioSnapshotInsert = Omit<DbPortfolioSnapshotRow, "created_at">;

// ─── grind_logs ────────────────────────────────────────────────────────────
/** Mirrors: grind_logs — interview-prep reps, one row per logged entry. */
export type DbGrindLogRow = {
  id: string;
  user_id: string;
  metric: string; // "systemDesign" | "leetcode" | "linkedinOutreach"
  label: string;
  meta: string | null;
  logged_at: string; // ISO timestamptz
  created_at: string;
};

export type DbGrindLogInsert = Omit<DbGrindLogRow, "created_at">;

// ─── hustle_entries ────────────────────────────────────────────────────────
/** Mirrors: hustle_entries — side-hustle revenue ledger. */
export type DbHustleEntryRow = {
  id: string;
  user_id: string;
  date: string; // YYYY-MM-DD
  category: string;
  description: string;
  amount: number;
  created_at: string;
};

export type DbHustleEntryInsert = Omit<DbHustleEntryRow, "created_at">;

// ─── pending_obligations ───────────────────────────────────────────────────
/**
 * Mirrors: pending_obligations — one row per (user_id, year_month).
 * year_month is "YYYY-MM"; matches the app's currentMonthKey().
 */
export type DbPendingObligationRow = {
  user_id: string;
  year_month: string; // YYYY-MM
  fixed_runrate: boolean;
  scooter_emi: boolean;
  groww_mf_sip: boolean;
  cc_settled: boolean;
  updated_at: string;
};

export type DbPendingObligationUpsert = Omit<DbPendingObligationRow, "updated_at">;

// ─── Database (supabase-js generic) ────────────────────────────────────────
/**
 * Shape consumed by createClient<Database>() so `.from("table")` is typed.
 * Only the fields this app actually uses are modelled.
 *
 * `Relationships: []` is REQUIRED on every table: postgrest-js's GenericTable
 * constraint includes it, and omitting it makes the whole schema fail to
 * satisfy GenericSchema — which silently degrades every insert/upsert argument
 * to `never` rather than producing a useful error at the Database type itself.
 * The arrays are empty because this app never uses embedded-resource selects.
 */
export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: DbProfile;
        Insert: DbProfileInsert;
        Update: Partial<DbProfileInsert>;
        Relationships: [];
      };
      user_settings: {
        Row: DbUserSettings;
        Insert: DbUserSettingsUpsert;
        Update: Partial<DbUserSettingsUpsert>;
        Relationships: [];
      };
      cashflow_ledger: {
        Row: DbCashflowRow;
        Insert: DbCashflowInsert;
        Update: Partial<DbCashflowInsert>;
        Relationships: [];
      };
      swing_trades: {
        Row: DbSwingTradeRow;
        Insert: DbSwingTradeInsert;
        Update: Partial<DbSwingTradeInsert>;
        Relationships: [];
      };
      portfolio_snapshots: {
        Row: DbPortfolioSnapshotRow;
        Insert: DbPortfolioSnapshotInsert;
        Update: Partial<DbPortfolioSnapshotInsert>;
        Relationships: [];
      };
      grind_logs: {
        Row: DbGrindLogRow;
        Insert: DbGrindLogInsert;
        Update: Partial<DbGrindLogInsert>;
        Relationships: [];
      };
      hustle_entries: {
        Row: DbHustleEntryRow;
        Insert: DbHustleEntryInsert;
        Update: Partial<DbHustleEntryInsert>;
        Relationships: [];
      };
      pending_obligations: {
        Row: DbPendingObligationRow;
        Insert: DbPendingObligationUpsert;
        Update: Partial<DbPendingObligationUpsert>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
