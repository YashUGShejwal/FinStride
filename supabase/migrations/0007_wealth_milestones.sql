-- ============================================================================
-- FinStride — 0007_wealth_milestones.sql
-- ============================================================================
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
-- Cloud sync for the Wealth Hub (Track 4), previously local-only:
--
--   1. user_settings.projection_settings — a single jsonb blob holding the
--      ProjectionSettings object (monthlySip, stepUpPercent, expectedCagr,
--      inflationRate, horizonYears, scenario, adjustForInflation). Follows the
--      exact precedent of custom_account_modes/custom_broker_partitions
--      (0002_structured_account_partitions.sql): one user, one settings row,
--      schemaless jsonb so the app's TS type can evolve without a migration
--      for every new field. Keys inside the JSON stay camelCase, matching the
--      app's ProjectionSettings type verbatim — see src/lib/db/mappers.ts.
--
--   2. user_milestones — a genuine multi-row table (unlike the settings jsonb
--      blob) since a user has many milestones, each independently created,
--      edited, and deleted. Mirrors the swing_trades RLS/index/trigger shape.
--
-- EXTENSION BEYOND THE LITERAL SPEC — target_type, item_cost, allocation_percent
-- --------------------------------------------------------------------------
-- The originating spec lists user_milestones columns without a "type" column,
-- but separately specifies a milestone modal with a required "Target Type"
-- field. Without a column to hold it, that field would have nowhere to
-- persist. Adding target_type here is the same kind of deliberate, documented
-- extension as income_categories/expense_categories in 0001_initial_schema.sql
-- ("Extension beyond the original column spec... required so the feature can
-- sync"). item_cost/allocation_percent are the same story, added when the
-- affordability-multiplier engine (Track 4) needed somewhere to persist the
-- item price and the % of net worth it's capped at for the 3 non-net_worth
-- categories.
--
-- is_custom vs. target_type: is_custom is WHO created the row (false only for
-- the 6 seeded defaults — ₹25L..₹10Cr — pushed by the migration flow in
-- src/lib/db/migrate.ts on first login); target_type is WHAT KIND of goal it
-- is. The two are independent — a user-added milestone can be any target_type.
--
-- REVISION NOTE: this migration was revised in place (not superseded by a
-- corrective follow-up) to replace the target_type taxonomy (net_worth |
-- asset_goal | custom) with the affordability-multiplier one (net_worth |
-- need | major_want | minor_want) and add item_cost/allocation_percent, and
-- again to add is_financed/total_asset_cost/downpayment_amount (Down Payment
-- financing mode) — confirmed safe both times because this migration had not
-- yet been applied to any real Supabase project.
--
-- DOWN PAYMENT (DP) FINANCING MODE
-- ---------------------------------
-- For a financed purchase (e.g. a house bought with a home loan), the
-- affordability multiplier should evaluate against the actual out-of-pocket
-- cash — the down payment — not the full asset price, since that's the real
-- amount at risk. When is_financed is true, item_cost MIRRORS
-- downpayment_amount (enforced in src/lib/store.tsx's addMilestone/
-- updateMilestone, not just the UI); total_asset_cost is kept purely for
-- display context ("Asset: ₹25L · DP: ₹5L") and never enters the math.
--
-- RE-RUNNABILITY
-- --------------
-- ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS, re-runnable CHECK
-- constraint guards, DROP POLICY/TRIGGER IF EXISTS before each CREATE.
-- ============================================================================

-- ─── 1. user_settings.projection_settings ──────────────────────────────────
alter table public.user_settings
  add column if not exists projection_settings jsonb not null default
    '{"monthlySip":0,"stepUpPercent":10,"expectedCagr":12,"inflationRate":6,"horizonYears":15,"scenario":"base","adjustForInflation":false}'::jsonb;

comment on column public.user_settings.projection_settings is
  'ProjectionSettings JSON ({monthlySip,stepUpPercent,expectedCagr,inflationRate,horizonYears,scenario,adjustForInflation}) backing the Wealth Hub''s compounding engine (src/lib/projectionEngine.ts). Schemaless by design — see custom_account_modes for the precedent.';


-- ─── 2. user_milestones ─────────────────────────────────────────────────────
create table if not exists public.user_milestones (
  id                  uuid        primary key default gen_random_uuid(),
  user_id             uuid        not null references auth.users (id) on delete cascade,
  name                text        not null,
  target_amount       numeric     not null,
  is_custom           boolean     not null default true,
  -- Extension beyond the literal spec — see the migration doc comment above.
  target_type         text        not null default 'net_worth',
  -- Affordability-multiplier fields: NULL for target_type = 'net_worth',
  -- populated for need/major_want/minor_want.
  item_cost           numeric,
  allocation_percent  numeric,
  -- Down Payment (DP) financing mode — see the migration doc comment above.
  -- NULL/false unless the user opted a need/major_want/minor_want goal into
  -- financing.
  is_financed         boolean     not null default false,
  total_asset_cost    numeric,
  downpayment_amount  numeric,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint user_milestones_target_amount_check
    check (target_amount > 0),
  constraint user_milestones_target_type_check
    check (target_type in ('net_worth', 'need', 'major_want', 'minor_want')),
  constraint user_milestones_item_cost_check
    check (item_cost is null or item_cost > 0),
  constraint user_milestones_allocation_percent_check
    check (allocation_percent is null or (allocation_percent > 0 and allocation_percent <= 100)),
  constraint user_milestones_total_asset_cost_check
    check (total_asset_cost is null or total_asset_cost > 0),
  constraint user_milestones_downpayment_amount_check
    check (downpayment_amount is null or downpayment_amount > 0),
  -- A down payment can never exceed the asset it's a down payment ON. Only
  -- enforced when BOTH are present — is_financed=false leaves both NULL.
  constraint user_milestones_downpayment_le_asset_check
    check (
      total_asset_cost is null or downpayment_amount is null
      or downpayment_amount <= total_asset_cost
    )
);

comment on table public.user_milestones is
  'Wealth Hub milestone targets — one row per goal. The 6 defaults (₹25L..₹10Cr) are pushed with is_custom=false by the first-login migration (src/lib/db/migrate.ts); user-added goals (via MilestoneModal) are is_custom=true.';
comment on column public.user_milestones.is_custom is
  'false only for the 6 seeded net-worth defaults. Gates the Edit affordance in the UI — matching AccountMode/BrokerPartition''s "defaults can''t be edited in place" convention.';
comment on column public.user_milestones.target_type is
  'net_worth (direct target, e.g. ₹1Cr) | need, major_want, minor_want (affordability categories — target_amount is DERIVED from item_cost/allocation_percent, see calculateRequiredNetWorth in src/lib/projectionEngine.ts). Extension beyond the literal spec — see migration doc comment.';
comment on column public.user_milestones.item_cost is
  'NULL for target_type = net_worth. The actual purchase price for need/major_want/minor_want — target_amount = item_cost / (allocation_percent/100).';
comment on column public.user_milestones.allocation_percent is
  'NULL for target_type = net_worth. The % of net worth the category is capped at for need/major_want/minor_want (e.g. 20 for a Major Want) — the reciprocal (100/allocation_percent) is the "buffer" multiplier shown in the UI.';
comment on column public.user_milestones.is_financed is
  'Down Payment financing mode (need/major_want/minor_want only). When true, item_cost mirrors downpayment_amount — the safety multiplier evaluates against the actual out-of-pocket cash, not the full asset price.';
comment on column public.user_milestones.total_asset_cost is
  'NULL unless is_financed. The full asset price (e.g. a house''s price) — display context only ("Asset: ₹25L"), never itself used in the target_amount math.';
comment on column public.user_milestones.downpayment_amount is
  'NULL unless is_financed. The actual out-of-pocket cash; item_cost mirrors this value exactly (enforced in src/lib/store.tsx, not just the UI).';

create index if not exists user_milestones_user_id_target_amount_idx
  on public.user_milestones (user_id, target_amount);

alter table public.user_milestones enable row level security;

drop policy if exists user_milestones_select_own on public.user_milestones;
create policy user_milestones_select_own
  on public.user_milestones
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists user_milestones_insert_own on public.user_milestones;
create policy user_milestones_insert_own
  on public.user_milestones
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists user_milestones_update_own on public.user_milestones;
create policy user_milestones_update_own
  on public.user_milestones
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists user_milestones_delete_own on public.user_milestones;
create policy user_milestones_delete_own
  on public.user_milestones
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

drop trigger if exists user_milestones_set_updated_at on public.user_milestones;
create trigger user_milestones_set_updated_at
  before update on public.user_milestones
  for each row
  execute function public.set_updated_at();

grant select, insert, update, delete on public.user_milestones to authenticated;
grant all on public.user_milestones to service_role;

-- ============================================================================
-- End of 0007_wealth_milestones.sql
-- ============================================================================
