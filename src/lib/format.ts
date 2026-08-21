export const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n || 0);

export const inrCompact = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n || 0);

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

/**
 * Today's date in the browser's local timezone, as "YYYY-MM-DD".
 * `new Date().toISOString().slice(0, 10)` returns the UTC calendar date instead —
 * near midnight that's off by one day for any user outside UTC (e.g. IST, US zones).
 */
export const todayLocalISO = (): string => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

/**
 * "YYYY-MM-DD" -> a fixed noon-UTC instant for that calendar day. Portfolio
 * snapshots dedupe/upsert on (snapshotDate, brokerPartition) — pinning every
 * date-only entry to the SAME time-of-day means two snapshots for "the same
 * day" (one added manually, one imported) always land on the identical
 * instant and correctly overwrite each other instead of becoming near-duplicate
 * rows a few hours apart. Shared by every snapshot-creating UI (Analytics'
 * AddSnapshotDialog, the eCAS importer) for exactly that reason.
 */
export const pinToNoonUTC = (dateOnly: string): string => `${dateOnly}T12:00:00.000Z`;
