-- ============================================================================
-- FinStride — 0002_structured_account_partitions.sql
-- ============================================================================
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
-- Replaces the flat-string custom lists on user_settings with structured JSON
-- lists, matching the app's move from plain-string payment modes / broker
-- partitions to the AccountMode / BrokerPartition object shapes
-- (see src/lib/store.tsx):
--
--   AccountMode        = { id, name, type, defaultChannel? }
--   BrokerPartition    = { id, name, category, brokerApp?, description? }
--
-- A text[] column can only ever hold plain strings, so the three columns that
-- used to carry "user's custom additions" as flat names are dropped and
-- replaced with two jsonb columns that carry the full structured objects.
--
-- This project has never been deployed to production (see the deployment
-- notes from the Cloudflare Workers setup step) and no live user data exists
-- against 0001's schema, so this migration drops and replaces the columns
-- directly rather than carrying a compatibility shim for rows that don't exist.
--
-- income_categories / expense_categories are UNCHANGED — categories stay
-- plain strings (no id/name split was requested for them) and continue to
-- round-trip through those two existing text[] columns.
--
-- ALSO FIXES a latent stale-default bug found while touching this table:
-- salary_baseline/fixed_runrate/scooter_emi/groww_mf_sip/risk_cap_partition
-- still carried 0001's original hardcoded personal figures (76000/39000/9000/
-- 5000/'Dhan Swing') as column DEFAULTs. handle_new_user() inserts a brand-new
-- user's settings row with only user_id set, so every new signup's row was
-- silently created holding those old personal numbers — directly undoing the
-- "zero out hardcoded defaults" pass earlier in this app's history the moment
-- StoreProvider's first remote load applied that row's blueprint. Column
-- DEFAULTs are reset here to match DEFAULT_BLUEPRINT in src/lib/store.tsx.
--
-- RE-RUNNABILITY
-- --------------
-- DROP COLUMN IF EXISTS / ADD COLUMN IF NOT EXISTS make this safely re-runnable.
-- ============================================================================

alter table public.user_settings
  drop column if exists payment_modes,
  drop column if exists investment_apps,
  drop column if exists portfolio_partitions;

alter table public.user_settings
  alter column salary_baseline    set default 0,
  alter column fixed_runrate      set default 0,
  alter column scooter_emi        set default 0,
  alter column groww_mf_sip       set default 0,
  alter column risk_cap_partition set default 'Primary Broker';

-- Column DEFAULTs only apply to future INSERTs — existing rows (if any exist
-- in a dev/staging project) keep whatever value they already have, which is
-- correct: this backfills the DEFAULT for new signups, not existing accounts'
-- real (possibly intentionally-set) settings.

alter table public.user_settings
  add column if not exists custom_account_modes    jsonb not null default '[]'::jsonb,
  add column if not exists custom_broker_partitions jsonb not null default '[]'::jsonb;

-- risk_cap_partition stays a plain text id-reference (matches BrokerPartition.id),
-- same as before — no change needed to that column.

comment on column public.user_settings.custom_account_modes is
  'User CUSTOM account modes only, as AccountMode[] JSON ({id,name,type,defaultChannel?}). Built-in DEFAULT_ACCOUNT_MODES live in app code and are not stored here.';
comment on column public.user_settings.custom_broker_partitions is
  'User CUSTOM broker partitions only, as BrokerPartition[] JSON ({id,name,category,brokerApp?,description?}). Built-in DEFAULT_BROKER_PARTITIONS live in app code and are not stored here. Replaces the old investment_apps/portfolio_partitions pair — the app now derives both the trade-partition selector and the snapshot-partition selector from this single list.';

comment on column public.user_settings.risk_cap_partition is
  'BrokerPartition.id whose latest snapshot backs the per-trade risk cap (0.03 = 3%), matching DEFAULT_BLUEPRINT.riskCapPartition.';

-- Hidden-defaults tombstone lists. A DEFAULT_* entry (category, account mode,
-- or broker partition) lives in app code, not a row here — there's nothing to
-- DELETE from the database when a user removes one. Instead its id/name is
-- recorded here, and the app subtracts these ids/names back out of the
-- DEFAULT_* constant before merging in the custom-additions columns above.
-- Without this, "delete a default" has no durable effect at all: reloading
-- (or syncing to another device) would just re-show it, since nothing in the
-- database says it was ever removed.
alter table public.user_settings
  add column if not exists hidden_default_income_categories  text[] not null default '{}'::text[],
  add column if not exists hidden_default_expense_categories text[] not null default '{}'::text[],
  add column if not exists hidden_default_account_ids        text[] not null default '{}'::text[],
  add column if not exists hidden_default_partition_ids      text[] not null default '{}'::text[];

comment on column public.user_settings.hidden_default_income_categories is
  'Names from DEFAULT_INCOME_CATEGORIES the user has deleted. Subtracted from DEFAULT_INCOME_CATEGORIES before merging in income_categories (the custom additions) — see the tombstone-list note above.';
comment on column public.user_settings.hidden_default_expense_categories is
  'Names from DEFAULT_EXPENSE_CATEGORIES the user has deleted. Same mechanism as hidden_default_income_categories.';
comment on column public.user_settings.hidden_default_account_ids is
  'Ids from DEFAULT_ACCOUNT_MODES the user has deleted. Subtracted from DEFAULT_ACCOUNT_MODES before merging in custom_account_modes — see the tombstone-list note above.';
comment on column public.user_settings.hidden_default_partition_ids is
  'Ids from DEFAULT_BROKER_PARTITIONS the user has deleted. Subtracted from DEFAULT_BROKER_PARTITIONS before merging in custom_broker_partitions — see the tombstone-list note above.';

-- ============================================================================
-- End of 0002_structured_account_partitions.sql
-- ============================================================================
