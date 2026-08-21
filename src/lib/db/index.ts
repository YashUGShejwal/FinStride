/**
 * Barrel for the Supabase data layer.
 *
 * Import from "@/lib/db" for the common surface; deep-import a module directly
 * when you only need one piece (keeps SSR bundles from pulling in the client).
 */

export {
  isSupabaseConfigured,
  getSupabaseBrowserClient,
  createSupabaseServerClient,
  type FinStrideClient,
  type ServerCookieAdapter,
} from "./client";

export type {
  Database,
  DbProfile,
  DbUserSettings,
  DbCashflowRow,
  DbSwingTradeRow,
  DbPortfolioSnapshotRow,
  DbGrindLogRow,
  DbHustleEntryRow,
  DbPendingObligationRow,
} from "./types";

export {
  fetchAllUserData,
  isBundleEmpty,
  upsertTransaction,
  upsertTransactions,
  deleteTransactionRow,
  upsertTrade,
  deleteTradeRow,
  upsertSnapshots,
  deleteSnapshotRow,
  deleteAllSnapshotRows,
  upsertGrindLog,
  deleteGrindLogRow,
  upsertHustleEntry,
  deleteHustleEntryRow,
  upsertSettings,
  upsertPendingObligations,
  type RemoteBundle,
  type FetchAllUserDataResult,
} from "./repository";

export {
  hasMigrated,
  markMigrated,
  migrateLocalDataToSupabase,
  type LocalDataSnapshot,
  type MigrationResult,
} from "./migrate";

export type { SettingsBundle } from "./mappers";
