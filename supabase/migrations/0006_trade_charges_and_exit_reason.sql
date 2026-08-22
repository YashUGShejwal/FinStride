-- ============================================================================
-- FinStride — 0006_trade_charges_and_exit_reason.sql
-- ============================================================================
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
-- Three additive columns on swing_trades supporting the tradebook 4-pass
-- reconciliation engine (src/components/TradeImportModal.tsx):
--
--   1. charges — brokerage + STT + stamp duty + GST + other statutory fees for
--      this trade, extracted from the tradebook CSV (see CHARGE columns in
--      src/lib/parsers/tradebookParser.ts). Populated on BOTH legs of a trade
--      independently (the entry fill's charges when the position is opened,
--      the exit fill's charges added in when it closes) — see netPnl below.
--      NULL (not 0) when the source never had charge data at all, so a
--      genuinely-zero-charges fill stays distinguishable from "unknown" if
--      that distinction ever matters later.
--
--   2. net_pnl — realized P&L after charges: (exit_price - entry_price) * qty
--      - charges. `pnl` (added in 0005) stays the GROSS figure with no
--      charges deducted; net_pnl is the new, more accurate "what did I
--      actually keep" number surfaced in the Performance Ribbon and the
--      closed-position cards. Both are stored (not one derived from the
--      other at render time) because charges can arrive from either the
--      entry leg, the exit leg, or both, depending on which pass closed the
--      trade — recomputing correctly at every call site would just
--      duplicate this same charges-summing logic.
--
--   3. exit_reason — a coarser, ALWAYS-populated-on-close companion to the
--      existing close_reason (0001): close_reason is the user's own pick in
--      the manual close panel (target/stoploss/other) and stays exactly as
--      it was. exit_reason is auto-computed at close time for EVERY close,
--      manual or imported — see classifyExitReason in src/lib/store.tsx —
--      by comparing the real exit price against the trade's planned
--      target/stop for an import-driven close, or mapping directly from
--      close_reason for a manual one. It exists because closed-position
--      cards need one consistent field to key a "🎯 Target Hit / 🛑 Stop Hit
--      / ⚡ Sync Exit / ✍️ Manual Close" badge off regardless of which flow
--      produced the close, and close_reason alone can't do that (a
--      tradebook-driven close has never had a user pick one of the three
--      close_reason buttons).
--
-- RE-RUNNABILITY
-- --------------
-- ADD COLUMN IF NOT EXISTS / re-runnable CHECK constraint guards throughout.
-- ============================================================================

alter table public.swing_trades
  add column if not exists charges     numeric,
  add column if not exists net_pnl     numeric,
  add column if not exists exit_reason text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'swing_trades_exit_reason_check'
  ) then
    alter table public.swing_trades
      add constraint swing_trades_exit_reason_check
        check (exit_reason is null or exit_reason in ('target', 'stop_loss', 'manual', 'tradebook_sync'));
  end if;
end $$;

comment on column public.swing_trades.charges is
  'Brokerage + STT + stamp duty + GST + other statutory fees for this trade''s fill(s), summed from the tradebook CSV''s charge columns (see tradebookParser.ts). NULL when the source never carried charge data — distinct from a genuine 0.';
comment on column public.swing_trades.net_pnl is
  'Realized P&L after charges: (exit_price - entry_price) * qty - charges. Stored rather than derived from pnl+charges at render time because charges can accumulate from the entry leg, the exit leg, or both depending on which reconciliation pass closed the trade. NULL until the trade closes with recorded exit + charge data.';
comment on column public.swing_trades.exit_reason is
  '''target'' | ''stop_loss'' | ''manual'' | ''tradebook_sync'' — auto-computed at close time for every close (see classifyExitReason in src/lib/store.tsx), unlike close_reason which is the user''s own manual-panel pick. Powers the closed-position card''s outcome badge uniformly across manual and imported closes.';

-- ============================================================================
-- End of 0006_trade_charges_and_exit_reason.sql
-- ============================================================================
