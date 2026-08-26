-- ============================================================================
-- FinStride — 0008_wealth_tour_flag.sql
-- ============================================================================
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
-- Adds user_settings.has_completed_tour (Track 5) — a single boolean flag
-- recording whether the user has finished (or explicitly skipped) the
-- AppTourModal walkthrough. Same shape as enable_fno_tracking
-- (0005_trade_close_data_and_fno_tracking.sql): a plain not-null boolean
-- column, default false, synced through the same user_settings row as every
-- other cross-device preference — see src/lib/db/mappers.ts's SettingsBundle.
--
-- WHY A NEW FILE INSTEAD OF REVISING 0007 AGAIN
-- -----------------------------------------------
-- 0007_wealth_milestones.sql has already been revised in place three times
-- this project, and its exact applied state on the live database is no
-- longer certain after the user's own manual DROP+CREATE pass. This flag is
-- unrelated to milestones/projection settings, so it gets its own small,
-- independently re-runnable migration rather than another revision of an
-- already-uncertain file.
--
-- Safe to re-run: ADD COLUMN IF NOT EXISTS.
-- ============================================================================

-- ─── user_settings.has_completed_tour ───────────────────────────────────────
alter table public.user_settings
  add column if not exists has_completed_tour boolean not null default false;

comment on column public.user_settings.has_completed_tour is
  'Whether the user has completed or skipped the AppTourModal walkthrough (Track 5). Local-only equivalent: none — this flag is cloud-synced from the start, unlike onboarding_completed which stays local-only.';
