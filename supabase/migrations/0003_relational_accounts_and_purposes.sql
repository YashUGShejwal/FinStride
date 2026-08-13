-- ============================================================================
-- FinStride — 0003_relational_accounts_and_purposes.sql
-- ============================================================================
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
-- Documentation-only. The two jsonb columns added in 0002 are schemaless, so
-- the app-side shape change they now carry needs no DDL — but leaving their
-- COMMENTs describing the OLD shape would make the database actively misleading
-- to the next person who inspects it. This migration re-states them.
--
-- What changed in the app (see src/lib/store.tsx):
--
--   AccountMode, now relational:
--     { id, name, type, linkedBankId?, channelLabel? }
--     * `type` gained 'upi' -> 'bank' | 'credit_card' | 'upi' | 'cash' | 'wallet'
--     * `defaultChannel` (a closed 4-value union) became `channelLabel`, a free
--       string, so a user's own channel wording isn't rejected.
--     * `linkedBankId` is NEW: the id of the bank AccountMode that funds a
--       credit card or UPI handle. It is a SOFT reference to another element of
--       the SAME jsonb array — not a foreign key, because the entire list lives
--       inside one jsonb value and there is no row to reference. The app clears
--       dangling links on delete and degrades gracefully if one survives.
--
--   BrokerPartition, now purpose-first:
--     { id, name, purpose, category, brokerApp?, description? }
--     * `purpose` is NEW: 'long_term' | 'swing' | 'international' | 'crypto' |
--       'custom' — WHY the money is there. Several partitions may share one
--       purpose ("Long-Term (Zerodha)" + "Long-Term (Groww)"), which is what
--       lets the UI group them as one strategy across brokers.
--     * `category` is unchanged and still means WHAT the instrument is; it
--       drives allocation analytics and stays independently editable.
--
-- Rows written before this change are migrated on READ, in the app layer
-- (src/lib/db/mappers.ts): a missing `channelLabel` falls back to the legacy
-- `defaultChannel`, and a missing `purpose` is inferred from `category`. No
-- backfill UPDATE is run here, so this migration cannot corrupt existing data.
--
-- RE-RUNNABILITY
-- --------------
-- COMMENT ON is idempotent by nature — it replaces, never appends.
-- ============================================================================

comment on column public.user_settings.custom_account_modes is
  'User CUSTOM account modes only, as AccountMode[] JSON ({id,name,type,linkedBankId?,channelLabel?}). type is bank|credit_card|upi|cash|wallet. linkedBankId is a SOFT reference to another element''s id in this same array (the bank funding a card/UPI handle) — not an FK, since the whole list is one jsonb value. Built-in DEFAULT_ACCOUNT_MODES live in app code and are not stored here.';

comment on column public.user_settings.custom_broker_partitions is
  'User CUSTOM broker partitions only, as BrokerPartition[] JSON ({id,name,purpose,category,brokerApp?,description?}). purpose (long_term|swing|international|crypto|custom) is WHY the money is there and may repeat across partitions; category (equity_swing|long_term_etf|mutual_funds|crypto|liquid) is WHAT the instrument is and drives allocation analytics. Built-in DEFAULT_BROKER_PARTITIONS live in app code and are not stored here.';

-- ============================================================================
-- End of 0003_relational_accounts_and_purposes.sql
-- ============================================================================
