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
  /** Names of DEFAULT_INCOME_CATEGORIES/DEFAULT_EXPENSE_CATEGORIES the user has deleted — see src/lib/store.tsx's hiddenDefaultCategories doc comment. */
  hidden_default_income_categories: string[];
  hidden_default_expense_categories: string[];
  /** Ids of DEFAULT_ACCOUNT_MODES the user has deleted. */
  hidden_default_account_ids: string[];
  /** Ids of DEFAULT_BROKER_PARTITIONS the user has deleted. */
  hidden_default_partition_ids: string[];
  /** Opt-in (default false) gating F&O rows in the tradebook importer and the Swing Desk's "F&O Desk" view. */
  enable_fno_tracking: boolean;
  /** ProjectionSettings JSON — see supabase/migrations/0007_wealth_milestones.sql. */
  projection_settings: DbProjectionSettingsJson;
  /** Whether the user has completed (or skipped) the AppTourModal walkthrough — see supabase/migrations/0008_wealth_tour_flag.sql. */
  has_completed_tour: boolean;
  updated_at: string;
};

/**
 * JSON shape stored in the projection_settings jsonb column — mirrors
 * ProjectionSettings in src/lib/store.tsx verbatim (camelCase keys, same as
 * DbAccountModeJson mirrors AccountMode).
 */
export type DbProjectionSettingsJson = {
  monthlySip: number;
  stepUpPercent: number;
  expectedCagr: number;
  inflationRate: number;
  horizonYears: number;
  scenario: string;
  adjustForInflation: boolean;
};

/**
 * JSON shape stored in the custom_account_modes jsonb column — mirrors AccountMode.
 * `linkedBankId` is a soft reference to another AccountMode.id in the same
 * array (the funding bank for a credit card / UPI handle), not a DB foreign
 * key: the whole list lives in one jsonb value, so there is no row to point at.
 */
export type DbAccountModeJson = {
  id: string;
  name: string;
  type: string;
  linkedBankId?: string | null;
  channelLabel?: string | null;
};

/** JSON shape stored in the custom_broker_partitions jsonb column — mirrors BrokerPartition. */
export type DbBrokerPartitionJson = {
  id: string;
  name: string;
  purpose: string;
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
  /** Set only when a tradebook SELL row auto-closed this trade — see supabase/migrations/0005. */
  exit_price: number | null;
  pnl: number | null;
  close_execution_id: string | null;
  /** 'equity' (default) or 'fno' — see supabase/migrations/0005. */
  asset_class: string;
  expiry: string | null;
  strike: number | null;
  lot_size: number | null;
  option_type: string | null;
  /** Brokerage/STT/stamp duty/GST etc. for this trade's fill(s) — see supabase/migrations/0006. NULL when the source never carried charge data. */
  charges: number | null;
  /** (exit_price - entry_price) * qty - charges — see supabase/migrations/0006. */
  net_pnl: number | null;
  /** 'target' | 'stop_loss' | 'manual' | 'tradebook_sync' — see supabase/migrations/0006. */
  exit_reason: string | null;
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

// ─── user_milestones ────────────────────────────────────────────────────────
/** Mirrors: user_milestones — see supabase/migrations/0007_wealth_milestones.sql. */
export type DbUserMilestoneRow = {
  id: string;
  user_id: string;
  name: string;
  target_amount: number;
  is_custom: boolean;
  /** 'net_worth' | 'need' | 'major_want' | 'minor_want' — see the migration's target_type comment. */
  target_type: string;
  /** NULL for net_worth; the item/purchase price for the 3 affordability types. */
  item_cost: number | null;
  /** NULL for net_worth; the % of net worth the affordability category is capped at. */
  allocation_percent: number | null;
  /** Down-payment financing mode. When true, item_cost mirrors downpayment_amount. */
  is_financed: boolean;
  /** NULL unless is_financed — the full asset price, kept for display only. */
  total_asset_cost: number | null;
  /** NULL unless is_financed — the actual out-of-pocket cash; item_cost mirrors this. */
  downpayment_amount: number | null;
  created_at: string;
  updated_at: string;
};

export type DbUserMilestoneInsert = Omit<DbUserMilestoneRow, "created_at" | "updated_at">;

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
      user_milestones: {
        Row: DbUserMilestoneRow;
        Insert: DbUserMilestoneInsert;
        Update: Partial<DbUserMilestoneInsert>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
