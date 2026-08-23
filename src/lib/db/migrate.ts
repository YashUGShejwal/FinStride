/**
 * One-time localStorage -> Supabase migration.
 *
 * Runs on first authenticated load for a given user, and only when the remote
 * account holds no user-authored rows yet. That guard is what makes it safe to
 * call on every login: an account that already has cloud data is never
 * overwritten by whatever happens to be cached in this browser.
 */

import type { FinStrideClient } from "./client";
import type {
  AccountMode,
  BlueprintSettings,
  BrokerPartition,
  CustomCategories,
  GrindState,
  Milestone,
  MonthlyPending,
  PortfolioSnapshot,
  ProjectionSettings,
  Trade,
  Transaction,
} from "@/lib/store";
import {
  upsertGrindLog,
  upsertHustleEntry,
  upsertMilestone,
  upsertPendingObligations,
  upsertSettings,
  upsertSnapshots,
  upsertTrade,
  upsertTransaction,
} from "./repository";

const MIGRATED_KEY_PREFIX = "finstride.migrated.";

/** Per-user flag so the push is attempted once per account, per browser. */
export function hasMigrated(userId: string): boolean {
  try {
    return localStorage.getItem(MIGRATED_KEY_PREFIX + userId) === "1";
  } catch {
    return false;
  }
}

export function markMigrated(userId: string): void {
  try {
    localStorage.setItem(MIGRATED_KEY_PREFIX + userId, "1");
  } catch {
    // Private mode / quota — worst case the migration is retried next login,
    // which is harmless because it is guarded on the remote being empty.
  }
}

export type LocalDataSnapshot = {
  transactions: Transaction[];
  trades: Trade[];
  portfolioSnapshots: PortfolioSnapshot[];
  grind: GrindState;
  blueprint: BlueprintSettings;
  showPersonalQuotes: boolean;
  enableFnoTracking: boolean;
  customAccountModes: AccountMode[];
  customBrokerPartitions: BrokerPartition[];
  customIncomeCategories: string[];
  customExpenseCategories: string[];
  hiddenDefaultCategories: CustomCategories;
  hiddenDefaultAccountIds: string[];
  hiddenDefaultPartitionIds: string[];
  pending: MonthlyPending;
  projectionSettings: ProjectionSettings;
  milestones: Milestone[];
};

export type MigrationResult = {
  migrated: boolean;
  rowsPushed: number;
  failures: number;
};

/**
 * Push locally-cached data into Supabase for a freshly-linked account.
 *
 * Settings are always synced (they are a single upsert and represent user
 * preference, not historical records); ledger rows are pushed as-is with their
 * existing client-generated UUIDs so ids stay stable across the migration.
 */
export async function migrateLocalDataToSupabase(
  client: FinStrideClient,
  userId: string,
  local: LocalDataSnapshot,
  yearMonth: string,
): Promise<MigrationResult> {
  let rowsPushed = 0;
  let failures = 0;

  const track = (ok: boolean) => {
    if (ok) rowsPushed += 1;
    else failures += 1;
  };

  // Settings + obligations first: cheap, and they define the partitions/modes
  // that the historical rows below refer to.
  track(
    await upsertSettings(client, userId, {
      blueprint: local.blueprint,
      showPersonalQuotes: local.showPersonalQuotes,
      enableFnoTracking: local.enableFnoTracking,
      customAccountModes: local.customAccountModes,
      customBrokerPartitions: local.customBrokerPartitions,
      customIncomeCategories: local.customIncomeCategories,
      customExpenseCategories: local.customExpenseCategories,
      hiddenDefaultCategories: local.hiddenDefaultCategories,
      hiddenDefaultAccountIds: local.hiddenDefaultAccountIds,
      hiddenDefaultPartitionIds: local.hiddenDefaultPartitionIds,
      projectionSettings: local.projectionSettings,
    }),
  );

  if (Object.keys(local.pending).length > 0) {
    track(await upsertPendingObligations(client, userId, yearMonth, local.pending));
  }

  // Historical rows. Snapshots go up as one batched upsert; the rest are
  // per-row so a single bad record can't abort the whole migration.
  for (const t of local.transactions) track(await upsertTransaction(client, userId, t));
  for (const t of local.trades) track(await upsertTrade(client, userId, t));
  for (const m of local.milestones) track(await upsertMilestone(client, userId, m));

  if (local.portfolioSnapshots.length > 0) {
    track(await upsertSnapshots(client, userId, local.portfolioSnapshots));
  }

  for (const metric of ["systemDesign", "leetcode", "linkedinOutreach"] as const) {
    for (const entry of local.grind.metrics[metric]) {
      track(await upsertGrindLog(client, userId, metric, entry));
    }
  }
  for (const e of local.grind.hustle) track(await upsertHustleEntry(client, userId, e));

  return { migrated: true, rowsPushed, failures };
}
