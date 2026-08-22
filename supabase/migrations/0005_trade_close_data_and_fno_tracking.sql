-- ============================================================================
-- FinStride — 0005_trade_close_data_and_fno_tracking.sql
-- ============================================================================
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
-- Two additive, independently-optional feature extensions to swing_trades,
-- plus one new user_settings preference:
--
--   1. SELL-order auto-close support (Track: tradebook SELL auto-closing).
--      Closing a trade via the existing manual flow (src/lib/store.tsx
--      closeTrade) has never collected an exit price — only closeReason/
--      closeNotes/exitDate=now. Auto-closing from a tradebook SELL row DOES
--      have a real exit price and can compute realized P&L, so three nullable
--      columns are added to carry that when it's known:
--        exit_price, pnl, close_execution_id (a dedup fingerprint — the
--        source SELL row's trade_id/order_id if the broker export has one,
--        else a synthetic date+symbol+qty+price key — checked before
--        applying a close so re-importing an overlapping tradebook can never
--        re-apply, or misapply, the same execution twice).
--      All three stay NULL for manually-closed trades — nothing here changes
--      that existing flow.
--
--   2. Optional F&O tracking (Track: F&O Desk). asset_class defaults to
--      'equity' for every existing and future equity swing trade — the
--      column is additive and changes no existing row's meaning. F&O trades
--      (only ever created via tradebook import when the user has opted in,
--      never via manual entry) carry a few derivatives-specific descriptive
--      columns; equity rows leave them NULL.
--
--   3. user_settings.enable_fno_tracking — the opt-in preference gating both
--      the tradebook importer's F&O handling and the Swing Desk's "F&O Desk"
--      view. Defaults false: a fresh/existing account sees no behavior change
--      until the user explicitly turns this on in Settings.
--
-- NOTE ON lot_size: NSE F&O lot sizes change periodically (SEBI revises them
-- most financial years) and this app has no reliable, current lookup table to
-- auto-populate this from a tradingsymbol — inventing one risks silently
-- showing a WRONG lot size, which is worse than showing none. The column
-- exists for forward compatibility (a future manual-edit affordance) but
-- nothing currently writes it; the F&O Desk UI shows "—" until something does.
--
-- Similarly, `expiry` is a best-effort HUMAN STRING decoded from the
-- tradingsymbol (see decodeFnoSymbol in src/lib/blueprintRules.ts), not a
-- real date column — NSE weekly-contract symbols encode the day with a
-- single character and no year-calendar lookup, so an exact settlement date
-- can't always be recovered from the symbol alone.
--
-- RE-RUNNABILITY
-- --------------
-- ADD COLUMN IF NOT EXISTS / re-runnable CHECK constraint guards throughout.
-- ============================================================================

alter table public.swing_trades
  add column if not exists exit_price          numeric,
  add column if not exists pnl                 numeric,
  add column if not exists close_execution_id  text,
  add column if not exists asset_class         text    not null default 'equity',
  add column if not exists expiry              text,
  add column if not exists strike              numeric,
  add column if not exists lot_size            numeric,
  add column if not exists option_type         text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'swing_trades_asset_class_check'
  ) then
    alter table public.swing_trades
      add constraint swing_trades_asset_class_check check (asset_class in ('equity', 'fno'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'swing_trades_option_type_check'
  ) then
    alter table public.swing_trades
      add constraint swing_trades_option_type_check
        check (option_type is null or option_type in ('CE', 'PE', 'FUT'));
  end if;
end $$;

comment on column public.swing_trades.exit_price is
  'Realized exit price — set only when a tradebook SELL row auto-closes this trade (src/components/TradeImportModal.tsx). NULL for manually-closed trades, which collect no exit price today.';
comment on column public.swing_trades.pnl is
  '(exit_price - entry_price) * matched quantity, in rupees, stamped at close time. Stored rather than purely derived because the matched quantity can differ from qty on a partial-fill mismatch.';
comment on column public.swing_trades.close_execution_id is
  'Dedup fingerprint of the SELL execution that closed this trade: the source row''s trade_id/order_id when the broker export has one, else a synthetic dateISO|symbol|qty|price key. Checked on every future import so an overlapping/re-uploaded tradebook can never re-apply (or misapply) the same close twice.';
comment on column public.swing_trades.asset_class is
  '''equity'' (default — delivery swing, the only kind manual entry creates) or ''fno'' (derivatives, created only via tradebook import while user_settings.enable_fno_tracking is on).';
comment on column public.swing_trades.expiry is
  'F&O only. Best-effort HUMAN STRING decoded from the tradingsymbol (see decodeFnoSymbol in src/lib/blueprintRules.ts) — not a real date, since weekly-contract symbols do not encode a fully recoverable settlement date without an NSE expiry-calendar lookup.';
comment on column public.swing_trades.strike is
  'F&O only. Option strike price; NULL for futures (option_type = ''FUT'').';
comment on column public.swing_trades.lot_size is
  'F&O only. NOT auto-populated — NSE lot sizes change periodically and this app has no current lookup table, so guessing one risks showing a confidently wrong number. Reserved for a future manual-edit affordance; the F&O Desk shows "—" until something writes it.';
comment on column public.swing_trades.option_type is
  'F&O only. CE (call) | PE (put) | FUT (future).';

alter table public.user_settings
  add column if not exists enable_fno_tracking boolean not null default false;

comment on column public.user_settings.enable_fno_tracking is
  'Opt-in (default off) for F&O contract tracking: gates whether the tradebook importer treats an F&O row as importable (vs. skipping it, the default) and whether the Swing Desk shows the "F&O Desk" segmented view alongside "Equity Swing".';

-- ============================================================================
-- End of 0005_trade_close_data_and_fno_tracking.sql
-- ============================================================================
