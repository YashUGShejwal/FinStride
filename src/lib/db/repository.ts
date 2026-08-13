/**
 * Data access for the Supabase-backed tables.
 *
 * Every function here is defensive: a network failure or an RLS rejection must
 * never take down the UI, because localStorage remains a complete local mirror
 * (see src/lib/store.tsx). Reads return null on failure so callers can fall back
 * to local data; writes resolve to a boolean success flag.
 */

import type { FinStrideClient } from "./client";
import type {
  AccountMode,
  BlueprintSettings,
  BrokerPartition,
  GrindLogEntry,
  GrindMetricKey,
  GrindState,
  HustleEntry,
  MonthlyPending,
  PortfolioSnapshot,
  Trade,
  Transaction,
} from "@/lib/store";
import {
  grindLogToRow,
  hustleToRow,
  pendingToRow,
  rowToGrindLog,
  rowToHustle,
  rowToPending,
  rowToSettings,
  rowToSnapshot,
  rowToTrade,
  rowToTransaction,
  settingsToRow,
  snapshotToRow,
  tradeToRow,
  transactionToRow,
  type SettingsBundle,
} from "./mappers";

/** Everything the store needs for one authenticated user. */
export type RemoteBundle = {
  transactions: Transaction[];
  trades: Trade[];
  portfolioSnapshots: PortfolioSnapshot[];
  grind: GrindState;
  settings: SettingsBundle | null;
  pending: MonthlyPending | null;
};

function logFailure(op: string, error: unknown): void {
  console.error(`[finstride/db] ${op} failed:`, error);
}

/** True when the bundle holds no user-authored rows at all. */
export function isBundleEmpty(b: RemoteBundle): boolean {
  const grindCount =
    b.grind.metrics.systemDesign.length +
    b.grind.metrics.leetcode.length +
    b.grind.metrics.linkedinOutreach.length +
    b.grind.hustle.length;
  return (
    b.transactions.length === 0 &&
    b.trades.length === 0 &&
    b.portfolioSnapshots.length === 0 &&
    grindCount === 0
  );
}

// ─── Reads ─────────────────────────────────────────────────────────────────
/**
 * Load every table for one user in parallel. Returns null if ANY table read
 * fails — including a resolved-but-failed PostgREST response, not just a
 * thrown/rejected request.
 *
 * This must NOT degrade a failed read to an empty list. postgrest-js resolves
 * with `{ data: null, error }` on a non-2xx response or even a network
 * failure (it does not reject by default), so a `data ?? []` fallback would
 * make "the request failed" indistinguishable from "the table is genuinely
 * empty" — and the caller (src/lib/store.tsx) treats an empty remote bundle as
 * authoritative, replacing and then persisting local state with it. A single
 * transient error would silently blank the user's entire ledger.
 */
export async function fetchAllUserData(
  client: FinStrideClient,
  userId: string,
  yearMonth: string,
): Promise<RemoteBundle | null> {
  try {
    const [txRes, trRes, snapRes, grindRes, hustleRes, settingsRes, pendingRes] = await Promise.all(
      [
        client
          .from("cashflow_ledger")
          .select("*")
          .eq("user_id", userId)
          .order("date", { ascending: false }),
        client
          .from("swing_trades")
          .select("*")
          .eq("user_id", userId)
          .order("entry_date", { ascending: false }),
        client
          .from("portfolio_snapshots")
          .select("*")
          .eq("user_id", userId)
          .order("snapshot_date", { ascending: false }),
        client
          .from("grind_logs")
          .select("*")
          .eq("user_id", userId)
          .order("logged_at", { ascending: false }),
        client
          .from("hustle_entries")
          .select("*")
          .eq("user_id", userId)
          .order("date", { ascending: false }),
        client.from("user_settings").select("*").eq("user_id", userId).maybeSingle(),
        client
          .from("pending_obligations")
          .select("*")
          .eq("user_id", userId)
          .eq("year_month", yearMonth)
          .maybeSingle(),
      ],
    );

    const failed = [
      ["cashflow_ledger", txRes.error],
      ["swing_trades", trRes.error],
      ["portfolio_snapshots", snapRes.error],
      ["grind_logs", grindRes.error],
      ["hustle_entries", hustleRes.error],
      ["user_settings", settingsRes.error],
      ["pending_obligations", pendingRes.error],
    ].find(([, error]) => error);
    if (failed) {
      logFailure(`fetchAllUserData (${failed[0]})`, failed[1]);
      return null;
    }

    const metrics: GrindState["metrics"] = {
      systemDesign: [],
      leetcode: [],
      linkedinOutreach: [],
    };
    for (const row of grindRes.data ?? []) {
      const { metric, entry } = rowToGrindLog(row);
      metrics[metric].push(entry);
    }

    return {
      transactions: (txRes.data ?? []).map(rowToTransaction),
      trades: (trRes.data ?? []).map(rowToTrade),
      portfolioSnapshots: (snapRes.data ?? []).map(rowToSnapshot),
      grind: { metrics, hustle: (hustleRes.data ?? []).map(rowToHustle) },
      settings: settingsRes.data ? rowToSettings(settingsRes.data) : null,
      pending: pendingRes.data ? rowToPending(pendingRes.data) : null,
    };
  } catch (error) {
    logFailure("fetchAllUserData", error);
    return null;
  }
}

// ─── Writes: cashflow ──────────────────────────────────────────────────────
export async function upsertTransaction(
  client: FinStrideClient,
  userId: string,
  t: Transaction,
): Promise<boolean> {
  const { error } = await client.from("cashflow_ledger").upsert(transactionToRow(t, userId));
  if (error) logFailure("upsertTransaction", error);
  return !error;
}

export async function deleteTransactionRow(
  client: FinStrideClient,
  userId: string,
  id: string,
): Promise<boolean> {
  const { error } = await client
    .from("cashflow_ledger")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);
  if (error) logFailure("deleteTransaction", error);
  return !error;
}

// ─── Writes: trades ────────────────────────────────────────────────────────
export async function upsertTrade(
  client: FinStrideClient,
  userId: string,
  t: Trade,
): Promise<boolean> {
  const { error } = await client.from("swing_trades").upsert(tradeToRow(t, userId));
  if (error) logFailure("upsertTrade", error);
  return !error;
}

export async function deleteTradeRow(
  client: FinStrideClient,
  userId: string,
  id: string,
): Promise<boolean> {
  const { error } = await client.from("swing_trades").delete().eq("id", id).eq("user_id", userId);
  if (error) logFailure("deleteTrade", error);
  return !error;
}

// ─── Writes: snapshots ─────────────────────────────────────────────────────
export async function upsertSnapshots(
  client: FinStrideClient,
  userId: string,
  rows: PortfolioSnapshot[],
): Promise<boolean> {
  if (rows.length === 0) return true;
  // Conflict target matches the table's UNIQUE(user_id, snapshot_date, broker_partition):
  // re-recording the same partition at the same instant updates in place.
  const { error } = await client.from("portfolio_snapshots").upsert(
    rows.map((s) => snapshotToRow(s, userId)),
    {
      onConflict: "user_id,snapshot_date,broker_partition",
    },
  );
  if (error) logFailure("upsertSnapshots", error);
  return !error;
}

export async function deleteSnapshotRow(
  client: FinStrideClient,
  userId: string,
  id: string,
): Promise<boolean> {
  const { error } = await client
    .from("portfolio_snapshots")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);
  if (error) logFailure("deleteSnapshot", error);
  return !error;
}

// ─── Writes: grind + hustle ────────────────────────────────────────────────
export async function upsertGrindLog(
  client: FinStrideClient,
  userId: string,
  metric: GrindMetricKey,
  entry: GrindLogEntry,
): Promise<boolean> {
  const { error } = await client.from("grind_logs").upsert(grindLogToRow(entry, metric, userId));
  if (error) logFailure("upsertGrindLog", error);
  return !error;
}

export async function deleteGrindLogRow(
  client: FinStrideClient,
  userId: string,
  id: string,
): Promise<boolean> {
  const { error } = await client.from("grind_logs").delete().eq("id", id).eq("user_id", userId);
  if (error) logFailure("deleteGrindLog", error);
  return !error;
}

export async function upsertHustleEntry(
  client: FinStrideClient,
  userId: string,
  e: HustleEntry,
): Promise<boolean> {
  const { error } = await client.from("hustle_entries").upsert(hustleToRow(e, userId));
  if (error) logFailure("upsertHustleEntry", error);
  return !error;
}

export async function deleteHustleEntryRow(
  client: FinStrideClient,
  userId: string,
  id: string,
): Promise<boolean> {
  const { error } = await client.from("hustle_entries").delete().eq("id", id).eq("user_id", userId);
  if (error) logFailure("deleteHustleEntry", error);
  return !error;
}

// ─── Writes: settings + obligations ────────────────────────────────────────
export async function upsertSettings(
  client: FinStrideClient,
  userId: string,
  bundle: {
    blueprint: BlueprintSettings;
    showPersonalQuotes: boolean;
    customAccountModes: AccountMode[];
    customBrokerPartitions: BrokerPartition[];
    customIncomeCategories: string[];
    customExpenseCategories: string[];
  },
): Promise<boolean> {
  const { error } = await client
    .from("user_settings")
    .upsert(settingsToRow(bundle, userId), { onConflict: "user_id" });
  if (error) logFailure("upsertSettings", error);
  return !error;
}

export async function upsertPendingObligations(
  client: FinStrideClient,
  userId: string,
  yearMonth: string,
  pending: MonthlyPending,
): Promise<boolean> {
  const { error } = await client
    .from("pending_obligations")
    .upsert(pendingToRow(pending, yearMonth, userId), { onConflict: "user_id,year_month" });
  if (error) logFailure("upsertPendingObligations", error);
  return !error;
}
