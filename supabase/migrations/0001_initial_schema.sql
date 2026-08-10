-- ============================================================================
-- FinStride — 0001_initial_schema.sql
-- ============================================================================
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
-- Creates the complete initial Postgres schema backing FinStride's migration
-- from a localStorage-only app to a multi-tenant Supabase Postgres database:
--
--   1. profiles              — one row per auth user (display identity)
--   2. user_settings         — one row per auth user (the "blueprint" config)
--   3. cashflow_ledger       — income/expense transactions
--   4. swing_trades          — the active/closed swing-trading book
--   5. portfolio_snapshots   — point-in-time broker partition valuations
--   6. grind_logs            — interview-prep reps (system design / LC / outreach)
--   7. hustle_entries        — side-hustle revenue ledger
--   8. pending_obligations   — per-month checklist of recurring obligations
--
-- Plus: Row Level Security on all 8 tables, per-user composite indexes, an
-- auth.users signup trigger that provisions profiles + user_settings, and a
-- shared updated_at maintenance trigger.
--
-- MULTI-TENANCY MODEL
-- -------------------
-- Every table is owned by exactly one Supabase auth user. Tenancy is enforced
-- in the database — not in application code — via Row Level Security:
--
--   * Every table carries a `user_id uuid NOT NULL REFERENCES auth.users(id)
--     ON DELETE CASCADE` (the `profiles` table uses `id` for this role, since
--     its primary key IS the auth user id).
--   * RLS is ENABLED on all 8 tables with explicit, separate policies for
--     SELECT / INSERT / UPDATE / DELETE, all scoped `TO authenticated`.
--   * Read paths use `USING`; write paths additionally use `WITH CHECK`, so a
--     user can neither insert a row owned by someone else nor "move" one of
--     their own rows to another user_id.
--   * Policies compare against `(SELECT auth.uid())` rather than bare
--     `auth.uid()`. Wrapping the call in a scalar subselect lets the planner
--     treat it as a one-time InitPlan evaluated ONCE per statement instead of
--     re-invoking the function for every candidate row. This is the documented
--     Supabase RLS performance practice and matters a lot on the ledger tables.
--   * Deleting an auth user cascades away every row they own.
--
-- Because auth.uid() is NULL for the `anon` role, unauthenticated requests match
-- no policy and therefore see no rows — no extra "deny" policy is required.
--
-- SCHEMA SOURCE OF TRUTH
-- ----------------------
-- Column names, types and nullability mirror src/lib/db/types.ts exactly (which
-- in turn documents itself as mirroring this file). Any divergence found while
-- writing this migration resolves in favour of types.ts; none were found.
--
-- RE-RUNNABILITY
-- --------------
-- Written to be safely re-runnable: CREATE ... IF NOT EXISTS for tables and
-- indexes, DROP POLICY IF EXISTS before each CREATE POLICY, CREATE OR REPLACE
-- for functions, and DROP TRIGGER IF EXISTS before each CREATE TRIGGER.
-- Note that IF NOT EXISTS on a table does NOT reconcile drift in an existing
-- table — later schema changes belong in later numbered migrations.
--
-- NOTE ON OPTIONAL SUPABASE
-- -------------------------
-- FinStride treats Supabase as OPTIONAL (see src/lib/db/client.ts). When the
-- VITE_SUPABASE_* env vars are absent the app never talks to this database at
-- all and runs entirely on localStorage. Nothing in this migration is required
-- for the app to boot; it only defines the shape of the remote store when one
-- is configured.
-- ============================================================================

-- gen_random_uuid() is provided by pg_catalog on PostgreSQL 13+ (which every
-- current Supabase project runs), so no pgcrypto extension is required here.


-- ============================================================================
-- SECTION 1 — SHARED TRIGGER FUNCTION
-- ============================================================================

-- Keeps `updated_at` honest on every UPDATE, regardless of what the client
-- sends. SECURITY INVOKER (the default) is correct: this function needs no
-- privileges beyond the caller's own. search_path is still pinned to the empty
-- string so the function body can never be hijacked by a caller-controlled
-- search_path; `now()` resolves from pg_catalog, which is always implicitly
-- present and cannot be shadowed.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'BEFORE UPDATE trigger: forces updated_at to the server clock so clients cannot backdate it.';


-- ============================================================================
-- SECTION 2 — TABLES
-- ============================================================================

-- ─── 2.1  profiles ─────────────────────────────────────────────────────────
-- One row per auth user. The primary key IS auth.users.id, so this table has no
-- separate user_id column — `id` is the tenancy column used by its RLS policies.
create table if not exists public.profiles (
  id          uuid        primary key references auth.users (id) on delete cascade,
  full_name   text,
  email       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.profiles is
  'Public-facing identity for an auth user. Row is provisioned automatically by handle_new_user() on signup.';
comment on column public.profiles.id is
  'Primary key AND foreign key to auth.users(id). This is the tenancy column for RLS on this table (there is no user_id here).';
comment on column public.profiles.email is
  'Denormalised copy of auth.users.email for display. Not authoritative — auth.users remains the source of truth.';


-- ─── 2.2  user_settings ────────────────────────────────────────────────────
-- Exactly one row per user: user_id is simultaneously the PRIMARY KEY and the
-- FOREIGN KEY to auth.users, which makes "one row per user" a structural
-- guarantee rather than something application code has to remember.
create table if not exists public.user_settings (
  user_id               uuid        primary key references auth.users (id) on delete cascade,

  -- Blueprint numbers. Defaults mirror DEFAULT_BLUEPRINT in src/lib/store.tsx
  -- so a brand-new remote account starts identical to a brand-new local one.
  salary_baseline       numeric     not null default 76000,
  fixed_runrate         numeric     not null default 39000,
  scooter_emi           numeric     not null default 9000,
  groww_mf_sip          numeric     not null default 5000,
  account_balance       numeric     not null default 0,
  risk_cap_pct          numeric     not null default 0.03,   -- fraction, not percent: 0.03 = 3%
  risk_cap_partition    text        not null default 'Dhan Swing',
  show_personal_quotes  boolean     not null default false,

  -- User CUSTOM additions only — see the column comments below.
  payment_modes         text[]      not null default '{}'::text[],
  investment_apps       text[]      not null default '{}'::text[],
  portfolio_partitions  text[]      not null default '{}'::text[],
  income_categories     text[]      not null default '{}'::text[],
  expense_categories    text[]      not null default '{}'::text[],

  updated_at            timestamptz not null default now()
);

comment on table public.user_settings is
  'One row per user (user_id is both PK and FK to auth.users). Mirrors the app "blueprint" settings plus the user''s custom list additions.';

comment on column public.user_settings.risk_cap_pct is
  'Per-trade risk cap as a fraction of the risk_cap_partition''s latest snapshot value (0.03 = 3%), matching DEFAULT_BLUEPRINT.defaultRiskCapPct.';

-- IMPORTANT — semantics of the five text[] columns.
--
-- payment_modes / investment_apps / portfolio_partitions store ONLY the user's
-- CUSTOM additions. The built-in defaults (DEFAULT_PAYMENT_MODES,
-- DEFAULT_INVESTMENT_APPS, DEFAULT_PORTFOLIO_PARTITIONS in src/lib/store.tsx)
-- deliberately live in application code and are NOT persisted here: the app
-- always renders `defaults ∪ custom`. Keeping defaults out of the database means
-- shipping a new built-in immediately reaches every existing user, and renaming
-- one never requires a data migration. An empty array is therefore the correct
-- and expected value for a user who has added nothing of their own.
--
-- income_categories / expense_categories are an EXTENSION BEYOND THE ORIGINAL
-- COLUMN SPEC. They were added because the app already ships a custom-category
-- feature (CATEGORIES_KEY / normalizeCustomCategories in src/lib/store.tsx), and
-- without these two columns that feature could not sync to the remote store —
-- a user's custom categories would silently vanish on another device. They
-- follow the same custom-additions-only rule as the three columns above.
comment on column public.user_settings.payment_modes is
  'User CUSTOM payment modes only. Built-in DEFAULT_PAYMENT_MODES live in app code and are not stored here.';
comment on column public.user_settings.investment_apps is
  'User CUSTOM investment apps only. Written from the app''s single customPartitions list (the app derives this view and portfolio_partitions from one source). Built-in DEFAULT_INVESTMENT_APPS live in app code and are not stored here.';
comment on column public.user_settings.portfolio_partitions is
  'User CUSTOM broker/portfolio partitions only. Written from the same customPartitions list as investment_apps. Built-in DEFAULT_PORTFOLIO_PARTITIONS live in app code and are not stored here.';
comment on column public.user_settings.income_categories is
  'Extension beyond the original column spec: user CUSTOM income categories only. Required so the existing custom-category feature can sync. Built-in defaults live in app code.';
comment on column public.user_settings.expense_categories is
  'Extension beyond the original column spec: user CUSTOM expense categories only. Required so the existing custom-category feature can sync. Built-in defaults live in app code.';


-- ─── 2.3  cashflow_ledger ──────────────────────────────────────────────────
-- The income/expense transaction ledger. `date` is DATE (day granularity, no
-- time-of-day) to match DbCashflowRow.date ("YYYY-MM-DD") — using timestamptz
-- here would drag timezone conversion into month-bucketing arithmetic.
create table if not exists public.cashflow_ledger (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users (id) on delete cascade,
  date        date        not null,
  type        text        not null,
  category    text        not null,
  account     text        not null,
  amount      numeric     not null,
  tags        text[]      not null default '{}'::text[],
  notes       text,
  created_at  timestamptz not null default now(),

  -- Mirrors the `"income" | "expense"` union on DbCashflowRow.type.
  constraint cashflow_ledger_type_check
    check (type in ('income', 'expense'))
);

comment on table public.cashflow_ledger is
  'Income/expense transactions. One row per transaction, owned by user_id.';
comment on column public.cashflow_ledger.date is
  'DATE (day granularity, no time-of-day) — matches DbCashflowRow.date "YYYY-MM-DD".';
comment on column public.cashflow_ledger.amount is
  'Always a positive magnitude; direction is carried by `type`, not by the sign.';


-- ─── 2.4  swing_trades ─────────────────────────────────────────────────────
-- NOTE ON THE `partition` COLUMN NAME:
-- `PARTITION` is a *non-reserved* keyword in PostgreSQL (it appears in window
-- function syntax as `PARTITION BY` and in `PARTITION OF`), which means it is
-- perfectly legal as a bare column name and Postgres will parse it correctly.
-- We nonetheless double-quote it as "partition" at every single site — DDL,
-- constraints, indexes, and any query — for two reasons: (1) it removes all
-- ambiguity for a human reader who might otherwise pause on it, and (2) it is
-- future-proof, since a keyword's reserved status can change between major
-- PostgreSQL versions and quoting is the only form guaranteed to keep working.
-- The column name itself is retained (rather than renamed to broker_partition)
-- because DbSwingTradeRow.partition in src/lib/db/types.ts is authoritative.
create table if not exists public.swing_trades (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null references auth.users (id) on delete cascade,
  ticker        text        not null,
  entry_date    date        not null,
  exit_date     date,
  direction     text        not null default 'LONG',
  qty           integer     not null,
  entry_price   numeric     not null,
  target_price  numeric     not null,
  stop_loss     numeric     not null,
  source        text        not null,
  "partition"   text        not null,
  notes         text,
  status        text        not null default 'open',
  close_reason  text,
  close_notes   text,
  created_at    timestamptz not null default now(),

  -- Mirrors the `"open" | "closed"` union on DbSwingTradeRow.status.
  constraint swing_trades_status_check
    check (status in ('open', 'closed')),

  -- close_reason is nullable (an open trade has none); when present it must be
  -- one of the three recognised reasons.
  constraint swing_trades_close_reason_check
    check (close_reason is null or close_reason in ('target', 'stoploss', 'other'))
);

comment on table public.swing_trades is
  'Swing-trading book: one row per position, open or closed.';
comment on column public.swing_trades."partition" is
  'Broker/portfolio partition this trade belongs to. PARTITION is a non-reserved Postgres keyword so this is legal unquoted, but it is double-quoted everywhere for clarity and version-proofing.';
comment on column public.swing_trades.close_reason is
  'NULL while status = ''open''. Once closed: target | stoploss | other.';


-- ─── 2.5  portfolio_snapshots ──────────────────────────────────────────────
-- snapshot_date is TIMESTAMPTZ (a full instant, not a day) per
-- DbPortfolioSnapshotRow.snapshot_date, because more than one valuation can be
-- recorded within a single day.
create table if not exists public.portfolio_snapshots (
  id                uuid        primary key default gen_random_uuid(),
  user_id           uuid        not null references auth.users (id) on delete cascade,
  snapshot_date     timestamptz not null,
  broker_partition  text        not null,
  current_value     numeric     not null,
  notes             text,
  created_at        timestamptz not null default now(),

  -- Re-recording the same partition at the same instant is an in-place update
  -- (upsert target), never a duplicate row. This unique constraint also backs
  -- ON CONFLICT (user_id, snapshot_date, broker_partition) DO UPDATE.
  constraint portfolio_snapshots_user_date_partition_key
    unique (user_id, snapshot_date, broker_partition)
);

comment on table public.portfolio_snapshots is
  'Point-in-time valuations per broker partition. UNIQUE(user_id, snapshot_date, broker_partition) makes re-recording an upsert rather than a duplicate.';
comment on column public.portfolio_snapshots.snapshot_date is
  'TIMESTAMPTZ (full instant, not a day) — multiple snapshots per calendar day are supported.';


-- ─── 2.6  grind_logs ───────────────────────────────────────────────────────
create table if not exists public.grind_logs (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users (id) on delete cascade,
  metric      text        not null,
  label       text        not null,
  meta        text,
  logged_at   timestamptz not null default now(),
  created_at  timestamptz not null default now(),

  -- DbGrindLogRow.metric is typed `string` in TypeScript but documented there as
  -- the three-value set below; the CHECK is what actually enforces it.
  constraint grind_logs_metric_check
    check (metric in ('systemDesign', 'leetcode', 'linkedinOutreach'))
);

comment on table public.grind_logs is
  'Interview-prep reps. One row per logged entry.';
comment on column public.grind_logs.metric is
  'systemDesign | leetcode | linkedinOutreach. Enforced by CHECK; typed as plain string in src/lib/db/types.ts.';
comment on column public.grind_logs.logged_at is
  'When the rep happened (user-settable). Distinct from created_at, which is when the row was written.';


-- ─── 2.7  hustle_entries ───────────────────────────────────────────────────
create table if not exists public.hustle_entries (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users (id) on delete cascade,
  date         date        not null,
  category     text        not null,
  description  text        not null,
  amount       numeric     not null,
  created_at   timestamptz not null default now()
);

comment on table public.hustle_entries is
  'Side-hustle revenue ledger. One row per earning event.';


-- ─── 2.8  pending_obligations ──────────────────────────────────────────────
-- One row per (user, month). The composite primary key is the natural upsert
-- key: toggling a checkbox is an ON CONFLICT (user_id, year_month) DO UPDATE.
create table if not exists public.pending_obligations (
  user_id        uuid        not null references auth.users (id) on delete cascade,
  year_month     text        not null,
  fixed_runrate  boolean     not null default false,
  scooter_emi    boolean     not null default false,
  groww_mf_sip   boolean     not null default false,
  cc_settled     boolean     not null default false,
  updated_at     timestamptz not null default now(),

  constraint pending_obligations_pkey
    primary key (user_id, year_month),

  -- Stored as text (not date) because the app's month key is literally "YYYY-MM"
  -- (currentMonthKey()). The regex pins both the shape and a valid month number,
  -- so '2026-13' and '2026-1' are both rejected.
  constraint pending_obligations_year_month_format_check
    check (year_month ~ '^\d{4}-(0[1-9]|1[0-2])$')
);

comment on table public.pending_obligations is
  'Per-month checklist of recurring obligations. One row per (user_id, year_month).';
comment on column public.pending_obligations.year_month is
  'Month key in "YYYY-MM" form, matching the app''s currentMonthKey(). Format and month range are enforced by CHECK.';


-- ============================================================================
-- SECTION 3 — INDEXES
-- ============================================================================
--
-- profiles / user_settings need no extra index: their primary key IS the
-- tenancy column, so every per-user lookup is already a PK probe. Likewise
-- pending_obligations, whose PK leads with user_id.
--
-- For the remaining tables the access pattern is always "all of MY rows, newest
-- first", so each index leads with user_id (making it an exact-match prefix that
-- the RLS predicate also benefits from) and follows with the time column DESC to
-- match the app's read order — letting Postgres satisfy ORDER BY straight from
-- the index with no sort step.

-- Required: cashflow reads are per-user, newest transaction first.
create index if not exists cashflow_ledger_user_id_date_idx
  on public.cashflow_ledger (user_id, date desc);

-- Supports the month-bucketed income/expense splits on the dashboard.
create index if not exists cashflow_ledger_user_id_type_date_idx
  on public.cashflow_ledger (user_id, type, date desc);

-- Required: latest snapshot per partition drives the swing risk cap.
create index if not exists portfolio_snapshots_user_id_snapshot_date_idx
  on public.portfolio_snapshots (user_id, snapshot_date desc);

-- "Latest value for THIS partition" — the exact lookup the risk-cap calc makes.
create index if not exists portfolio_snapshots_user_id_partition_date_idx
  on public.portfolio_snapshots (user_id, broker_partition, snapshot_date desc);

-- Swing book listing: most recent entries first.
create index if not exists swing_trades_user_id_entry_date_idx
  on public.swing_trades (user_id, entry_date desc);

-- Partial index for the open-positions view, which is read on nearly every
-- page load. Restricting to status = 'open' keeps it small and hot even as the
-- closed-trade history grows without bound.
create index if not exists swing_trades_user_id_open_idx
  on public.swing_trades (user_id, entry_date desc)
  where status = 'open';

-- Grind streak/heatmap queries scan a user's reps in reverse chronological order.
create index if not exists grind_logs_user_id_logged_at_idx
  on public.grind_logs (user_id, logged_at desc);

-- Per-metric streak calculations.
create index if not exists grind_logs_user_id_metric_logged_at_idx
  on public.grind_logs (user_id, metric, logged_at desc);

-- Hustle ledger listing: newest first.
create index if not exists hustle_entries_user_id_date_idx
  on public.hustle_entries (user_id, date desc);


-- ============================================================================
-- SECTION 4 — ROW LEVEL SECURITY
-- ============================================================================
--
-- RLS is enabled on all 8 tables. Every table gets four explicit policies, one
-- per operation, rather than a single FOR ALL policy — separate policies make
-- the read path and the write path independently auditable, and they are what
-- allows INSERT/UPDATE to carry a WITH CHECK clause that pins the owner column.
--
-- Every policy is scoped `TO authenticated` so it is not even considered for the
-- anon role, and every predicate uses the `(SELECT auth.uid())` scalar-subselect
-- form so the current user id is resolved once per statement (as an InitPlan)
-- instead of once per row.

alter table public.profiles             enable row level security;
alter table public.user_settings        enable row level security;
alter table public.cashflow_ledger      enable row level security;
alter table public.swing_trades         enable row level security;
alter table public.portfolio_snapshots  enable row level security;
alter table public.grind_logs           enable row level security;
alter table public.hustle_entries       enable row level security;
alter table public.pending_obligations  enable row level security;


-- ─── 4.1  profiles ─────────────────────────────────────────────────────────
-- Tenancy column here is `id` (the PK), NOT user_id — this table has no user_id
-- column, because its primary key already IS the auth user id.
--
-- The INSERT policy exists for completeness/self-healing only: in normal operation
-- handle_new_user() (Section 6) has already created the row by the time the client
-- can authenticate. The DELETE policy likewise rarely fires — deleting the auth
-- user cascades the profile away without any client DELETE.
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
  on public.profiles
  for select
  to authenticated
  using ((select auth.uid()) = id);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own
  on public.profiles
  for insert
  to authenticated
  with check ((select auth.uid()) = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);   -- blocks re-pointing the row at another user

drop policy if exists profiles_delete_own on public.profiles;
create policy profiles_delete_own
  on public.profiles
  for delete
  to authenticated
  using ((select auth.uid()) = id);


-- ─── 4.2  user_settings ────────────────────────────────────────────────────
drop policy if exists user_settings_select_own on public.user_settings;
create policy user_settings_select_own
  on public.user_settings
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists user_settings_insert_own on public.user_settings;
create policy user_settings_insert_own
  on public.user_settings
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists user_settings_update_own on public.user_settings;
create policy user_settings_update_own
  on public.user_settings
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists user_settings_delete_own on public.user_settings;
create policy user_settings_delete_own
  on public.user_settings
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);


-- ─── 4.3  cashflow_ledger ──────────────────────────────────────────────────
drop policy if exists cashflow_ledger_select_own on public.cashflow_ledger;
create policy cashflow_ledger_select_own
  on public.cashflow_ledger
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists cashflow_ledger_insert_own on public.cashflow_ledger;
create policy cashflow_ledger_insert_own
  on public.cashflow_ledger
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists cashflow_ledger_update_own on public.cashflow_ledger;
create policy cashflow_ledger_update_own
  on public.cashflow_ledger
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists cashflow_ledger_delete_own on public.cashflow_ledger;
create policy cashflow_ledger_delete_own
  on public.cashflow_ledger
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);


-- ─── 4.4  swing_trades ─────────────────────────────────────────────────────
drop policy if exists swing_trades_select_own on public.swing_trades;
create policy swing_trades_select_own
  on public.swing_trades
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists swing_trades_insert_own on public.swing_trades;
create policy swing_trades_insert_own
  on public.swing_trades
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists swing_trades_update_own on public.swing_trades;
create policy swing_trades_update_own
  on public.swing_trades
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists swing_trades_delete_own on public.swing_trades;
create policy swing_trades_delete_own
  on public.swing_trades
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);


-- ─── 4.5  portfolio_snapshots ──────────────────────────────────────────────
drop policy if exists portfolio_snapshots_select_own on public.portfolio_snapshots;
create policy portfolio_snapshots_select_own
  on public.portfolio_snapshots
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists portfolio_snapshots_insert_own on public.portfolio_snapshots;
create policy portfolio_snapshots_insert_own
  on public.portfolio_snapshots
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists portfolio_snapshots_update_own on public.portfolio_snapshots;
create policy portfolio_snapshots_update_own
  on public.portfolio_snapshots
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists portfolio_snapshots_delete_own on public.portfolio_snapshots;
create policy portfolio_snapshots_delete_own
  on public.portfolio_snapshots
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);


-- ─── 4.6  grind_logs ───────────────────────────────────────────────────────
drop policy if exists grind_logs_select_own on public.grind_logs;
create policy grind_logs_select_own
  on public.grind_logs
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists grind_logs_insert_own on public.grind_logs;
create policy grind_logs_insert_own
  on public.grind_logs
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists grind_logs_update_own on public.grind_logs;
create policy grind_logs_update_own
  on public.grind_logs
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists grind_logs_delete_own on public.grind_logs;
create policy grind_logs_delete_own
  on public.grind_logs
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);


-- ─── 4.7  hustle_entries ───────────────────────────────────────────────────
drop policy if exists hustle_entries_select_own on public.hustle_entries;
create policy hustle_entries_select_own
  on public.hustle_entries
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists hustle_entries_insert_own on public.hustle_entries;
create policy hustle_entries_insert_own
  on public.hustle_entries
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists hustle_entries_update_own on public.hustle_entries;
create policy hustle_entries_update_own
  on public.hustle_entries
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists hustle_entries_delete_own on public.hustle_entries;
create policy hustle_entries_delete_own
  on public.hustle_entries
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);


-- ─── 4.8  pending_obligations ──────────────────────────────────────────────
drop policy if exists pending_obligations_select_own on public.pending_obligations;
create policy pending_obligations_select_own
  on public.pending_obligations
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists pending_obligations_insert_own on public.pending_obligations;
create policy pending_obligations_insert_own
  on public.pending_obligations
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists pending_obligations_update_own on public.pending_obligations;
create policy pending_obligations_update_own
  on public.pending_obligations
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists pending_obligations_delete_own on public.pending_obligations;
create policy pending_obligations_delete_own
  on public.pending_obligations
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);


-- ============================================================================
-- SECTION 5 — updated_at TRIGGERS
-- ============================================================================
-- Only the three tables that carry an updated_at column. The append-mostly
-- ledger tables track created_at only and need no trigger.

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();

drop trigger if exists user_settings_set_updated_at on public.user_settings;
create trigger user_settings_set_updated_at
  before update on public.user_settings
  for each row
  execute function public.set_updated_at();

drop trigger if exists pending_obligations_set_updated_at on public.pending_obligations;
create trigger pending_obligations_set_updated_at
  before update on public.pending_obligations
  for each row
  execute function public.set_updated_at();


-- ============================================================================
-- SECTION 6 — NEW USER PROVISIONING
-- ============================================================================
--
-- Fires once per signup and gives the new user the two singleton rows the app
-- expects to exist: a profile and a settings row. Doing this in a trigger rather
-- than in client code means the rows exist before the client's first query, and
-- they exist regardless of which auth provider or admin path created the user.
--
-- SECURITY DEFINER is required: the inserting session is the auth machinery, not
-- the new user, so `auth.uid()` is not yet the new id and the RLS policies in
-- Section 4 would reject both inserts. Running as the function owner bypasses
-- RLS for exactly these two provisioning writes.
--
-- HARDENING: `SET search_path = ''` is mandatory for any SECURITY DEFINER
-- function in Supabase. Without it, a caller could prepend a schema they control
-- to search_path and have this elevated function resolve `profiles` to their own
-- malicious table. With an empty search_path nothing resolves implicitly, so
-- every object below is written fully qualified (public.profiles,
-- public.user_settings); built-ins like coalesce() still resolve because
-- pg_catalog is always implicitly searched and cannot be shadowed.
--
-- IDEMPOTENT: both inserts use ON CONFLICT DO NOTHING, so a re-run, a replayed
-- signup, or a row that was somehow pre-created is a no-op rather than an error
-- that would abort the auth.users INSERT and fail the signup.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Identity row. full_name comes from whatever the signup form / OAuth provider
  -- put in user metadata; providers disagree on the key, so check both common
  -- spellings before giving up and leaving it NULL for the user to fill in.
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name'
    ),
    new.email
  )
  on conflict (id) do nothing;

  -- Settings row: insert user_id only and let the column DEFAULTs in Section 2.2
  -- supply the blueprint values, so the defaults are defined in exactly one place.
  insert into public.user_settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

comment on function public.handle_new_user() is
  'AFTER INSERT ON auth.users: provisions the new user''s profiles and user_settings rows. SECURITY DEFINER with an empty search_path; idempotent via ON CONFLICT DO NOTHING.';

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();


-- ============================================================================
-- SECTION 7 — GRANTS
-- ============================================================================
-- Supabase's default privileges already grant the API roles access to new tables
-- in `public`, but stating it explicitly makes this migration self-contained and
-- correct even if those defaults are ever tightened.
--
-- These grants are table-level only and are NOT the security boundary — RLS is.
-- A GRANT lets the role reach the table; the policies in Section 4 decide which
-- rows it sees. `anon` is deliberately not granted anything: nothing in this
-- schema is public, and every policy is scoped TO authenticated anyway.

grant select, insert, update, delete on
  public.profiles,
  public.user_settings,
  public.cashflow_ledger,
  public.swing_trades,
  public.portfolio_snapshots,
  public.grind_logs,
  public.hustle_entries,
  public.pending_obligations
to authenticated;

-- service_role bypasses RLS entirely; the grant is what makes server-side admin
-- tooling (backfills, exports, the localStorage → Postgres import) able to work.
grant all on
  public.profiles,
  public.user_settings,
  public.cashflow_ledger,
  public.swing_trades,
  public.portfolio_snapshots,
  public.grind_logs,
  public.hustle_entries,
  public.pending_obligations
to service_role;

-- ============================================================================
-- End of 0001_initial_schema.sql
-- ============================================================================
