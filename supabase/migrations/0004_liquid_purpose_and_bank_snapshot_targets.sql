-- ============================================================================
-- FinStride — 0004_liquid_purpose_and_bank_snapshot_targets.sql
-- ============================================================================
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
-- Documentation-only, exactly like 0003. Two app-side model changes landed
-- that need no DDL (jsonb is schemaless and broker_partition is plain text),
-- but leaving the affected COMMENTs describing the old semantics would make
-- the database actively misleading to the next person who inspects it.
--
-- What changed in the app (see src/lib/store.tsx):
--
--   BrokerPartition.purpose gained a member:
--     'long_term' | 'swing' | 'international' | 'crypto' | 'liquid' | 'custom'
--     * 'liquid' is NEW — cash buckets and reserves are now a first-class
--       purpose instead of being parked under 'custom'. The built-in "Cash"
--       default partition carries it, and rows whose purpose is missing infer
--       'liquid' from a 'liquid' category (previously they inferred 'custom').
--
--   portfolio_snapshots.broker_partition widened its id namespace:
--     * Snapshots can now be recorded against BANK/CASH ACCOUNT MODES as well
--       as broker partitions. The app merges both into one snapshot-target
--       list (getSnapshotTargets() in src/lib/store.tsx): every
--       BrokerPartition.id plus every AccountMode.id whose type is
--       bank | cash, with an id collision (the built-in "Cash" ships on both
--       sides) resolved in the partition's favour.
--     * The column stays plain text with no FK — both id namespaces live in
--       app code / the user_settings jsonb columns, so there is no row to
--       reference. The app blocks deleting an account or partition that
--       snapshots still name, and renders orphaned ids as "Legacy Partition".
--
-- No backfill UPDATE is run here: rows written before this change are
-- migrated on READ in the app layer (a missing `purpose` is inferred from
-- `category`), so this migration cannot corrupt existing data.
--
-- RE-RUNNABILITY
-- --------------
-- COMMENT ON is idempotent by nature — it replaces, never appends.
-- ============================================================================

comment on column public.user_settings.custom_broker_partitions is
  'User CUSTOM broker partitions only, as BrokerPartition[] JSON ({id,name,purpose,category,brokerApp?,description?}). purpose (long_term|swing|international|crypto|liquid|custom) is WHY the money is there and may repeat across partitions; category (equity_swing|long_term_etf|mutual_funds|crypto|liquid) is WHAT the instrument is and drives allocation analytics. Built-in DEFAULT_BROKER_PARTITIONS live in app code and are not stored here.';

comment on column public.portfolio_snapshots.broker_partition is
  'Snapshot target id: a BrokerPartition.id OR a bank/cash AccountMode.id — the app''s unified snapshot-target list (getSnapshotTargets in src/lib/store.tsx) draws from both. Plain text, no FK: both id namespaces live in app code / the user_settings jsonb columns, so there is no row to reference. Orphaned ids render as "Legacy Partition" in the app.';

-- ============================================================================
-- End of 0004_liquid_purpose_and_bank_snapshot_targets.sql
-- ============================================================================
