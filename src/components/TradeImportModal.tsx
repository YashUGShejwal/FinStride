/**
 * Tradebook CSV import — staging & review modal for the Swing Desk.
 *
 * Three linear steps: drop (target partition + file) -> (map, only on
 * auto-detect failure) -> review (stage, edit target/stop, commit).
 *
 * FOUR-PASS RECONCILIATION ENGINE (stageRows below) — deterministic, in this
 * order, each pass only ever seeing what the previous one left unclaimed:
 *
 *   Pass 1 — Intra-CSV round trips, LONG or SHORT. Within the uploaded file
 *     itself, two fills for the same ticker/contract are paired FIFO,
 *     chronologically (by exact execution timestamp when the export has
 *     one — see tradebookParser's applyExecutionTime — else by date, file
 *     order preserved for same-instant ties). Whichever fill comes FIRST
 *     decides the direction: BUY-then-SELL is a LONG round trip, SELL-then-
 *     BUY is a SHORT one (sold to open, bought to cover). Either way the
 *     pair imports ALREADY CLOSED — both entry and exit are known from the
 *     file — EXCEPT an opening SELL is only ever queued as a short-open
 *     candidate when there's no DB-open position for that ticker already;
 *     otherwise it's left for Pass 2, which is almost certainly what a sell
 *     with an existing open position actually means.
 *   Pass 2 — DB open-position matching. A SELL the file couldn't pair with
 *     its own BUY (or that Pass 1 deliberately left alone — see above) is
 *     matched against the OLDEST open trade for the same ticker in the
 *     target partition (FIFO again — there is no per-lot tracking engine,
 *     so this is the standard, defensible convention when more than one
 *     open lot could match) and staged as an auto-close.
 *   Pass 3 — Unpaired BUYs become new open LONG trades, target/stop
 *     suggested from the configured risk cap (same heuristic the manual
 *     entry form's risk meter uses). There is no equivalent "open a new
 *     standalone short" here — a short only ever exists as a fully-
 *     reconciled Pass 1 round trip.
 *   Pass 4 — Whatever SELL is left after passes 1-2 is an orphan: no CSV-
 *     side buy, no DB-side open position. Still shown (so the user sees
 *     everything the file contains) but flagged and never actionable.
 *
 * Every close (round-trip or auto-close) carries an execution fingerprint
 * (the source SELL row's trade/order id, or a synthetic date+symbol+qty+
 * price key) stamped onto the closed Trade's closeExecutionId — checked
 * against already-closed trades on every future import so a re-uploaded/
 * overlapping tradebook can never re-apply (or misapply) the same close
 * twice.
 *
 * P&L is reported NET of charges (brokerage/STT/stamp duty/GST/etc, summed
 * per fill by tradebookParser.ts) wherever the underlying trade has that
 * data — netPnl = (exitPrice - entryPrice) * qty - charges. The plain `pnl`
 * field is kept as the gross figure alongside it.
 *
 * F&O handling: FNO_REGEX-matched rows are skipped entirely (Blueprint Rule
 * 2) UNLESS the user has opted into enableFnoTracking, in which case they
 * flow through all four passes exactly like equity rows, tagged with a
 * best-effort decoded contract (see decodeFnoSymbol).
 *
 * The parser is a plain, isomorphic CSV reader (like csvStatementParser.ts) —
 * no dynamic import needed, unlike EcasImportDialog's pdf.js dependency.
 */

import { useMemo, useRef, useState } from "react";
import {
  CheckSquare, ExternalLink, FileSpreadsheet, Loader2, Search, Square, TriangleAlert, UploadCloud,
} from "lucide-react";
import { toast } from "sonner";
import { useStore, type BrokerPartition, type PartitionId, type Trade } from "@/lib/store";
import { FNO_REGEX, decodeFnoSymbol, type FnoContractInfo } from "@/lib/blueprintRules";
import {
  applyTradeMapping,
  parseTradebookCsv,
  type ParsedTradeRow,
  type TradeColumnMapping,
} from "@/lib/parsers/tradebookParser";
import { inr, fmtDate } from "@/lib/format";
import { Sensitive } from "@/components/Sensitive";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

// ─── Staging model ───────────────────────────────────────────────────────────
// A discriminated union rather than one flat shape with placeholder ""
// strings on irrelevant fields — a round-trip has no target/stop to edit, an
// unmatched sell has neither those nor P&L, and this keeps each variant only
// carrying the fields that are actually meaningful for it.
//
// StagedRoundTripRow does NOT extend ParsedTradeRow (unlike the other three)
// since it represents a MERGED pair of rows, not one — it declares its own
// symbol/rawSymbol rather than inheriting a single row's.
type StagedRoundTripRow = {
  kind: "round-trip";
  key: number;
  selected: boolean;
  symbol: string;
  rawSymbol: string;
  /**
   * "long" — the file's earlier fill was a BUY (opened), later a SELL
   * (closed). "short" — earlier fill was a SELL (sold to open), later a BUY
   * (bought to cover). entryPrice/entryDate always refer to whichever fill
   * OPENED the position, exitPrice/exitDate to whichever CLOSED it — the
   * rest of this row's math and rendering stays side-agnostic because of
   * that, with the sign flip between long/short folded into netPnl once,
   * here, at construction time.
   */
  side: "long" | "short";
  assetClass: "equity" | "fno";
  fno: FnoContractInfo | null;
  entryDate: string;
  exitDate: string;
  entryPrice: number;
  exitPrice: number;
  qty: number;
  charges: number;
  /** LONG: (exitPrice - entryPrice) * qty - charges. SHORT: (entryPrice - exitPrice) * qty - charges. */
  netPnl: number;
  /** netPnl / (entryPrice * qty). */
  roiPct: number;
  durationDays: number;
  /** True when the CSV's buy leg and sell leg had different quantities — a partial exit relative to the single lot this app tracks. */
  qtyMismatch: boolean;
  /** This exact SELL leg's fingerprint already matches a trade closed by a PAST import. */
  isDuplicate: boolean;
  closeExecutionId: string;
};

type StagedBuyRow = ParsedTradeRow & {
  kind: "buy";
  key: number;
  selected: boolean;
  isDuplicate: boolean;
  targetPrice: string;
  stopLoss: string;
  assetClass: "equity" | "fno";
  /** Decoded contract info — only set when assetClass is "fno" and the symbol was decodable. */
  fno: FnoContractInfo | null;
};

type StagedCloseRow = ParsedTradeRow & {
  kind: "close";
  key: number;
  /** Checked by default (see file doc comment) — unchecked automatically only when qtyMismatch flags something worth a second look. */
  selected: boolean;
  matchedTradeId: string;
  matchedTrade: Trade;
  /** Combined entry-leg + exit-leg charges (the open trade's own charges, if any, plus this SELL's). */
  charges: number;
  /** (price - matchedTrade.entryPrice) * min(quantity, matchedTrade.qty) — gross, no charges deducted. */
  pnl: number;
  /** pnl - charges. */
  netPnl: number;
  /** netPnl / (matchedTrade.entryPrice * min(quantity, matchedTrade.qty)). */
  roiPct: number;
  /** True when this SELL's quantity doesn't exactly match the open trade's — a partial exit or an oversell relative to the single lot this app tracks. */
  qtyMismatch: boolean;
};

type StagedUnmatchedSellRow = ParsedTradeRow & {
  kind: "unmatched-sell";
  key: number;
  /** This SELL's fingerprint already matches a trade closed by a PAST import — shown for transparency, never actionable. */
  alreadyClosed?: boolean;
};

type StagedTradeRow = StagedRoundTripRow | StagedBuyRow | StagedCloseRow | StagedUnmatchedSellRow;

type Step = "drop" | "map" | "review";

/** Quick portals to each broker's tradebook/order-history export page. */
const TRADEBOOK_HELPER_LINKS = [
  { label: "Zerodha Console Tradebook", url: "https://console.zerodha.com/reports/tradebook" },
  { label: "Groww Order History", url: "https://groww.in/user/orders" },
  { label: "Dhan Tradebook", url: "https://login.dhan.co/" },
];

function HelperLinkPill({ label, url }: { label: string; url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-full border border-glass-border bg-white/[0.03] text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
    >
      {label} <ExternalLink className="size-3" />
    </a>
  );
}

const EMERALD = "text-[oklch(0.78_0.16_155)]";
const ROSE = "text-[oklch(0.78_0.18_25)]";
const AMBER = "text-[oklch(0.82_0.13_80)]";
const SKY = "text-[oklch(0.75_0.14_230)]";
const CYAN = "text-[oklch(0.76_0.13_195)]";
// Trade counts are typically much smaller than bank-statement transaction
// counts, so this is a generous ceiling — but it must still hold regardless
// of size: see the render-cap pass at the end of stageRows below, which
// keeps "what's shown" and "what's committed" in sync even if a file
// somehow exceeds it.
const ROW_RENDER_CAP = 500;

/** Same-day + ticker + qty + price + partition — mirrors the CSV importer's dupKey shape. */
const dupKey = (dayISO: string, symbol: string, qty: number, price: number, partition: string) =>
  `${dayISO.slice(0, 10)}|${symbol}|${qty}|${price}|${partition}`;

/** Native trade/order id when the source CSV had one; else a synthetic date+symbol+qty+price key — stamped onto a closed Trade so a re-import can never re-apply the same close twice. */
const executionFingerprint = (r: ParsedTradeRow, partition: string): string =>
  r.executionId ? `id:${r.executionId}` : `synth:${dupKey(r.dateISO, r.symbol, r.quantity, r.price, partition)}`;

export function TradeImportModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { trades, addTrades, closeTrade, brokerPartitions, blueprintSettings, enableFnoTracking } = useStore();

  // Shared by the useState initializer AND resetAll — without a single
  // source of truth, resetAll drifting out of sync with the initializer is
  // exactly how a stale partition silently carries over into the next,
  // unrelated import (see resetAll's own comment below).
  const defaultPartition = () =>
    (brokerPartitions.find((p) => p.id === blueprintSettings.riskCapPartition) ?? brokerPartitions[0])?.id ?? "";

  const [step, setStep] = useState<Step>("drop");
  const [fileName, setFileName] = useState("");
  const [partition, setPartition] = useState<PartitionId>(defaultPartition);
  const [dragging, setDragging] = useState(false);
  const [staged, setStaged] = useState<StagedTradeRow[]>([]);
  const [skippedRows, setSkippedRows] = useState(0);
  const [fnoSkipped, setFnoSkipped] = useState(0);
  const [mapCtx, setMapCtx] = useState<{ headers: string[]; headerRowIndex: number; grid: string[][] } | null>(
    null,
  );
  const [mapSymbol, setMapSymbol] = useState("");
  const [mapDate, setMapDate] = useState("");
  const [mapSide, setMapSide] = useState("");
  const [mapQty, setMapQty] = useState("");
  const [mapPrice, setMapPrice] = useState("");
  const [q, setQ] = useState("");
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetAll = () => {
    setStep("drop");
    setFileName("");
    // Re-derive rather than leave whatever the user picked for the PREVIOUS
    // import — this modal is never unmounted between opens (only `open`
    // toggles), so without this an unrelated later import would silently
    // default to whatever partition was last selected instead of the user's
    // configured risk-cap partition.
    setPartition(defaultPartition());
    setDragging(false);
    setStaged([]);
    setSkippedRows(0);
    setFnoSkipped(0);
    setMapCtx(null);
    setMapSymbol("");
    setMapDate("");
    setMapSide("");
    setMapQty("");
    setMapPrice("");
    setQ("");
    setImporting(false);
  };

  // Default target/stop: the same 3% risk-cap convention the manual entry
  // form's risk meter already uses, applied here as a starting 1:2 R:R
  // placeholder — always visible and editable before commit, never silently
  // fabricated numbers the user doesn't see. Clamped below 100%: Settings
  // only rejects a risk cap ABOVE 100%, so a legally-saved 100% value would
  // otherwise make suggestStop() land on exactly 0 for every row, which
  // trips the commit-blocking validation with no on-screen explanation
  // (only a toast that a disabled button's own onClick never gets to fire).
  const riskPct = Math.min(blueprintSettings.defaultRiskCapPct, 0.9);
  const suggestTarget = (entryPrice: number) => (entryPrice * (1 + 2 * riskPct)).toFixed(2);
  const suggestStop = (entryPrice: number) => (entryPrice * (1 - riskPct)).toFixed(2);

  // ── Staging from parsed rows — the 4-pass engine ───────────────────────────
  const stageRows = (rows: ParsedTradeRow[], skipped: number) => {
    const fnoRows = enableFnoTracking ? [] : rows.filter((r) => FNO_REGEX.test(r.symbol));
    const workingRows = enableFnoTracking ? rows : rows.filter((r) => !FNO_REGEX.test(r.symbol));

    // Fingerprints of executions that already closed a trade in a PAST
    // import — checked by both Pass 1 and Pass 2 so a re-uploaded/
    // overlapping tradebook can never re-apply (or misapply) the same close
    // twice, regardless of which pass would otherwise claim it.
    const closedFingerprints = new Set(
      trades
        .filter((t) => t.status === "closed" && t.closeExecutionId)
        .map((t) => t.closeExecutionId as string),
    );

    // FIFO pool of DB-open trades per ticker, oldest first — built BEFORE
    // Pass 1 runs (not just before Pass 2) because Pass 1 needs to consult
    // its EXISTENCE, not just Pass 2 its contents: see the sell-queue guard
    // below for why. Consumption (`.shift()`) still only ever happens in
    // Pass 2 — Pass 1 only ever reads `.length`, never claims a lot from it.
    const openByTicker = new Map<string, Trade[]>();
    for (const t of trades) {
      if (t.status !== "open" || t.partition !== partition) continue;
      const list = openByTicker.get(t.ticker) ?? [];
      list.push(t);
      openByTicker.set(t.ticker, list);
    }
    for (const list of openByTicker.values()) {
      list.sort((a, b) => a.entryDate.localeCompare(b.entryDate));
    }

    // ── Pass 1: intra-CSV round-trip matching (LONG and SHORT) ─────────────
    // Grouped by symbol, then sorted CHRONOLOGICALLY within each group
    // (not left in file order) — some broker exports list newest-first, and
    // pairing off raw file order in that case would match a later fill to
    // an earlier one, producing a negative-duration "round trip" AND could
    // misclassify a long as a short (or vice versa) by getting which fill
    // came first backwards. dateISO carries real time-of-day precision when
    // the export has it (see tradebookParser's applyExecutionTime), so
    // same-day fills sort correctly too, not just same-day-arbitrarily.
    //
    // Two FIFO queues per symbol, not one: a BUY first tries to COVER the
    // oldest still-open SHORT (an earlier unclaimed SELL); only when there
    // isn't one does it become a new LONG-opening fill waiting for its own
    // sell. Symmetrically a SELL first tries to CLOSE the oldest open LONG;
    // only then does it become a new SHORT-opening fill waiting for a cover.
    // By construction at most one of the two queues is ever non-empty for a
    // given symbol at any point — this models a single running position that
    // flips between flat/long/short, never both directions at once.
    const bySymbol = new Map<string, ParsedTradeRow[]>();
    for (const r of workingRows) {
      const list = bySymbol.get(r.symbol) ?? [];
      list.push(r);
      bySymbol.set(r.symbol, list);
    }

    const buildRoundTrip = (
      entryLeg: ParsedTradeRow,
      exitLeg: ParsedTradeRow,
      side: "long" | "short",
      symbol: string,
    ): StagedRoundTripRow => {
      const matchedQty = Math.min(entryLeg.quantity, exitLeg.quantity);
      const qtyMismatch = entryLeg.quantity !== exitLeg.quantity;
      const charges = entryLeg.charges + exitLeg.charges;
      const grossDelta = side === "long" ? exitLeg.price - entryLeg.price : entryLeg.price - exitLeg.price;
      const netPnl = grossDelta * matchedQty - charges;
      const roiPct = entryLeg.price > 0 ? netPnl / (entryLeg.price * matchedQty) : 0;
      const durationDays = Math.max(
        0,
        Math.round((new Date(exitLeg.dateISO).getTime() - new Date(entryLeg.dateISO).getTime()) / 86400000),
      );
      const isFno = FNO_REGEX.test(symbol);
      const fp = executionFingerprint(exitLeg, partition);
      return {
        kind: "round-trip",
        key: exitLeg.sourceIndex,
        selected: !qtyMismatch && !closedFingerprints.has(fp),
        symbol,
        rawSymbol: exitLeg.rawSymbol,
        side,
        assetClass: isFno ? "fno" : "equity",
        fno: isFno ? decodeFnoSymbol(symbol) : null,
        entryDate: entryLeg.dateISO,
        exitDate: exitLeg.dateISO,
        entryPrice: entryLeg.price,
        exitPrice: exitLeg.price,
        qty: matchedQty,
        charges,
        netPnl,
        roiPct,
        durationDays,
        qtyMismatch,
        isDuplicate: closedFingerprints.has(fp),
        closeExecutionId: fp,
      };
    };

    const roundTripRows: StagedRoundTripRow[] = [];
    const consumed = new Set<number>();

    for (const [symbol, group] of bySymbol) {
      const chronological = [...group].sort((a, b) => a.dateISO.localeCompare(b.dateISO));
      const buyQueue: ParsedTradeRow[] = [];
      const sellQueue: ParsedTradeRow[] = [];
      for (const r of chronological) {
        if (r.side === "buy") {
          const shortEntryLeg = sellQueue.shift();
          if (shortEntryLeg) {
            roundTripRows.push(buildRoundTrip(shortEntryLeg, r, "short", symbol));
            consumed.add(shortEntryLeg.sourceIndex);
            consumed.add(r.sourceIndex);
            continue;
          }
          buyQueue.push(r); // no short to cover — opens/extends a potential LONG
          continue;
        }
        const longEntryLeg = buyQueue.shift();
        if (longEntryLeg) {
          roundTripRows.push(buildRoundTrip(longEntryLeg, r, "long", symbol));
          consumed.add(longEntryLeg.sourceIndex);
          consumed.add(r.sourceIndex);
          continue;
        }
        // No file-side buy to close. Only treat this as a SHORT-opening fill
        // when there is genuinely no DB-open position for this ticker —
        // otherwise a sell that closes an EXISTING (not-in-this-file) long,
        // followed later in the file by an unrelated fresh buy of the same
        // ticker, would get wrongly paired into a short round trip instead
        // of leaving the sell for Pass 2 to correctly close that DB position
        // and the later buy to correctly open its own new long in Pass 3.
        if (!openByTicker.get(r.symbol)?.length) {
          sellQueue.push(r);
        }
      }
    }

    const remainingRows = workingRows.filter((r) => !consumed.has(r.sourceIndex));

    // ── Pass 2 (DB open-position matching) / Pass 3 (unpaired buys) / Pass 4 (orphan sells) ──
    // Count-aware BUY duplicate matching against ALL existing trades (open
    // AND closed) in the target partition — mirrors the CSV importer's
    // approach: N existing trades flag at most N staged rows, so two
    // distinct same-day/same-price buys don't both get wrongly flagged off
    // one existing match. Deliberately not scoped to status==="open": a
    // trade that's since been closed keeps the exact same dedup key it had
    // while open, and most broker exports are date-range/since-inception
    // rather than incremental — excluding closed trades would make
    // re-uploading an overlapping tradebook silently re-create every
    // position the user already closed out.
    const buyDupCounts = new Map<string, number>();
    for (const t of trades) {
      if (t.partition !== partition) continue;
      const k = dupKey(t.entryDate, t.ticker, t.qty, t.entryPrice, t.partition);
      buyDupCounts.set(k, (buyDupCounts.get(k) ?? 0) + 1);
    }

    // openByTicker (FIFO pool of open trades per ticker) was already built
    // above, before Pass 1 — consumed here via `.shift()` as SELL rows below
    // claim a match, so two sells for the same ticker in one file each close
    // a DIFFERENT lot rather than double-matching the same one. Still just a
    // per-ticker queue, not a full lot-accounting engine: a SELL always
    // matches exactly one open trade (the oldest), never splits across
    // several — see qtyMismatch below for when that doesn't line up.
    const rest: StagedTradeRow[] = [];
    for (const r of remainingRows) {
      if (r.side === "sell") {
        const fp = executionFingerprint(r, partition);
        if (closedFingerprints.has(fp)) {
          rest.push({ ...r, kind: "unmatched-sell", key: r.sourceIndex, alreadyClosed: true });
          continue;
        }
        const pool = openByTicker.get(r.symbol);
        const candidate = pool && pool.length > 0 ? pool[0] : undefined;
        if (!candidate) {
          rest.push({ ...r, kind: "unmatched-sell", key: r.sourceIndex }); // Pass 4: orphan
          continue;
        }
        pool!.shift();
        const qtyMismatch = candidate.qty !== r.quantity;
        const matchedQty = Math.min(candidate.qty, r.quantity);
        const totalCharges = (candidate.charges ?? 0) + r.charges;
        const pnl = (r.price - candidate.entryPrice) * matchedQty;
        const netPnl = pnl - totalCharges;
        const roiPct = candidate.entryPrice > 0 ? netPnl / (candidate.entryPrice * matchedQty) : 0;
        rest.push({
          ...r,
          kind: "close",
          key: r.sourceIndex,
          selected: !qtyMismatch,
          matchedTradeId: candidate.id,
          matchedTrade: candidate,
          charges: totalCharges,
          pnl,
          netPnl,
          roiPct,
          qtyMismatch,
        });
        continue;
      }

      // Pass 3: remaining unpaired BUY rows become new open trades.
      const isFno = FNO_REGEX.test(r.symbol);
      let isDuplicate = false;
      const k = dupKey(r.dateISO, r.symbol, r.quantity, r.price, partition);
      const remainingCount = buyDupCounts.get(k) ?? 0;
      if (remainingCount > 0) {
        buyDupCounts.set(k, remainingCount - 1);
        isDuplicate = true;
      }
      rest.push({
        ...r,
        kind: "buy",
        key: r.sourceIndex,
        selected: !isDuplicate,
        isDuplicate,
        targetPrice: suggestTarget(r.price),
        stopLoss: suggestStop(r.price),
        assetClass: isFno ? "fno" : "equity",
        fno: isFno ? decodeFnoSymbol(r.symbol) : null,
      });
    }

    // Merge all four passes into one chronologically-coherent list (a
    // round-trip sorts at its SELL leg's position — the "closing" event is
    // the more salient anchor of a completed trade), then apply the render
    // cap LAST, across the unified order — computing it per-pass earlier
    // would have let a round-trip beyond the cap stay auto-selected just
    // because Pass 1 never rate-limited itself.
    const merged = [...roundTripRows, ...rest].sort((a, b) => a.key - b.key);
    const final = merged.map((r, idx) =>
      idx >= ROW_RENDER_CAP && "selected" in r ? ({ ...r, selected: false } as StagedTradeRow) : r,
    );

    setStaged(final);
    setSkippedRows(skipped);
    setFnoSkipped(fnoRows.length);
    setStep("review");
  };

  // ── File intake ────────────────────────────────────────────────────────────
  const handleFile = async (file: File | undefined | null) => {
    if (!file) return;
    if (!/\.(csv|txt)$/i.test(file.name) && !file.type.includes("csv") && !file.type.includes("text")) {
      toast.error("That doesn't look like a CSV file");
      return;
    }
    if (!partition) {
      toast.error("Pick a target partition first");
      return;
    }
    setFileName(file.name);
    let text: string;
    try {
      text = await file.text();
    } catch {
      toast.error("Couldn't read the file");
      return;
    }
    const result = parseTradebookCsv(text);
    if (result.status === "error") {
      toast.error(result.reason);
      return;
    }
    if (result.status === "needs-mapping") {
      setMapCtx({ headers: result.headers, headerRowIndex: result.headerRowIndex, grid: result.grid });
      setStep("map");
      return;
    }
    stageRows(result.rows, result.skippedRows);
  };

  const applyManualMapping = () => {
    if (!mapCtx) return;
    if (!mapSymbol || !mapDate || !mapSide || !mapQty || !mapPrice) {
      toast.error("Map every column first");
      return;
    }
    const mapping: TradeColumnMapping = {
      symbol: Number(mapSymbol),
      date: Number(mapDate),
      side: Number(mapSide),
      quantity: Number(mapQty),
      price: Number(mapPrice),
    };
    const { rows, skippedRows: skipped } = applyTradeMapping(mapCtx.grid, mapCtx.headerRowIndex, mapping);
    if (rows.length === 0) {
      toast.error("No parsable trades with that mapping — check the column choices");
      return;
    }
    stageRows(rows, skipped);
  };

  // ── Review derivations ─────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? staged.filter((r) => r.symbol.toLowerCase().includes(s)) : staged;
  }, [staged, q]);

  const roundTripRowsAll = staged.filter((r): r is StagedRoundTripRow => r.kind === "round-trip");
  const buyRows = staged.filter((r): r is StagedBuyRow => r.kind === "buy");
  const closeRows = staged.filter((r): r is StagedCloseRow => r.kind === "close");
  const unmatchedSellRows = staged.filter((r): r is StagedUnmatchedSellRow => r.kind === "unmatched-sell");
  const selectedRoundTrips = roundTripRowsAll.filter((r) => r.selected);
  const selectedBuys = buyRows.filter((r) => r.selected);
  const selectedCloses = closeRows.filter((r) => r.selected);
  const buyVolume =
    buyRows.reduce((s, r) => s + r.quantity * r.price, 0) +
    roundTripRowsAll.reduce((s, r) => s + r.qty * r.entryPrice, 0);
  const sellVolume =
    [...closeRows, ...unmatchedSellRows].reduce((s, r) => s + r.quantity * r.price, 0) +
    roundTripRowsAll.reduce((s, r) => s + r.qty * r.exitPrice, 0);
  const tickerCount = new Set(staged.map((r) => r.symbol)).size;
  const dupCount =
    buyRows.filter((r) => r.isDuplicate).length + roundTripRowsAll.filter((r) => r.isDuplicate).length;
  // Counts only STILL-unchecked mismatches (not the total) — once the user
  // manually re-checks one after reviewing it, it must drop out of this
  // count, or the banner would keep claiming rows are unreviewed forever.
  const qtyMismatchCount =
    closeRows.filter((r) => r.qtyMismatch && !r.selected).length +
    roundTripRowsAll.filter((r) => r.qtyMismatch && !r.selected).length;
  const estimatedNetPnl =
    selectedRoundTrips.reduce((s, r) => s + r.netPnl, 0) + selectedCloses.reduce((s, r) => s + r.netPnl, 0);

  // Loose patch type + one cast at the merge point — every call site below
  // controls exactly which fields it passes for a row it already knows the
  // kind of, so this sidesteps TS's awkward distribution of Partial<...>
  // over a discriminated union for zero real safety loss.
  const patchRow = (key: number, patch: Record<string, unknown>) =>
    setStaged((s) => s.map((r) => (r.key === key ? ({ ...r, ...patch } as StagedTradeRow) : r)));

  const toggleAllRoundTrips = () => {
    const target = !roundTripRowsAll.every((r) => r.selected);
    setStaged((s) => s.map((r) => (r.kind === "round-trip" ? { ...r, selected: target } : r)));
  };

  const toggleAllBuys = () => {
    const target = !buyRows.every((r) => r.selected);
    setStaged((s) => s.map((r) => (r.kind === "buy" ? { ...r, selected: target } : r)));
  };

  const toggleAllCloses = () => {
    const target = !closeRows.every((r) => r.selected);
    setStaged((s) => s.map((r) => (r.kind === "close" ? { ...r, selected: target } : r)));
  };

  const deselectDuplicates = () =>
    setStaged((s) =>
      s.map((r) =>
        (r.kind === "buy" && r.isDuplicate) || (r.kind === "round-trip" && r.isDuplicate)
          ? { ...r, selected: false }
          : r,
      ),
    );

  // ── Commit ─────────────────────────────────────────────────────────────────
  const invalidSelected = selectedBuys.some(
    (r) => !(Number(r.targetPrice) > 0) || !(Number(r.stopLoss) > 0),
  );

  const handleCommit = async () => {
    if (selectedRoundTrips.length === 0 && selectedBuys.length === 0 && selectedCloses.length === 0) {
      toast.error("Select at least one row to import");
      return;
    }
    if (invalidSelected) {
      toast.error("Every selected buy needs a target and stop loss greater than zero");
      return;
    }
    setImporting(true);
    await new Promise((r) => setTimeout(r, 60));

    if (selectedRoundTrips.length > 0) {
      // Created ALREADY CLOSED — status:"closed" plus the full exit shape —
      // via the same batch mutator as ordinary buys (addTrades now accepts
      // an optional per-entry status override for exactly this case).
      const entries = selectedRoundTrips.map((r) => ({
        ticker: r.symbol,
        entryDate: r.entryDate,
        direction: r.side === "short" ? ("SHORT" as const) : ("LONG" as const),
        qty: r.qty,
        entryPrice: r.entryPrice,
        // Structural filler, not a real plan: the position is already
        // closed by the time this exists, so target/stop can never be
        // tested again — the closed-card UI leads with entry/exit/P&L
        // instead of these. Kept only because Trade requires them. Flipped
        // for a short (target below entry, stop above) so they at least
        // read correctly if ever inspected — e.g. via the edit modal.
        targetPrice: Number(r.side === "short" ? suggestStop(r.entryPrice) : suggestTarget(r.entryPrice)),
        stopLoss: Number(r.side === "short" ? suggestTarget(r.entryPrice) : suggestStop(r.entryPrice)),
        source: "Self" as const,
        partition,
        notes: `Round-trip from tradebook (${r.rawSymbol})`.slice(0, 140),
        status: "closed" as const,
        exitDate: r.exitDate,
        exitPrice: r.exitPrice,
        pnl: (r.exitPrice - r.entryPrice) * r.qty,
        netPnl: r.netPnl,
        charges: r.charges,
        closeReason: "other" as const,
        closeExecutionId: r.closeExecutionId,
        exitReason: "tradebook_sync" as const,
        ...(r.assetClass === "fno"
          ? {
              assetClass: "fno" as const,
              expiry: r.fno?.expiry,
              strike: r.fno?.strike ?? undefined,
              optionType: r.fno?.optionType,
            }
          : {}),
      }));
      addTrades(entries);
    }

    if (selectedBuys.length > 0) {
      const entries: Array<Omit<Trade, "id" | "status">> = selectedBuys.map((r) => ({
        ticker: r.symbol,
        entryDate: r.dateISO,
        direction: "LONG",
        qty: r.quantity,
        entryPrice: r.price,
        targetPrice: Number(r.targetPrice),
        stopLoss: Number(r.stopLoss),
        source: "Self",
        partition,
        // rawSymbol is already capped at the parser (see MAX_TICKER_LEN's
        // sibling cap in tradebookParser.ts), but slice again here too —
        // matching CsvImportDrawer's NOTES_MAX convention exactly, so this
        // stays correct even if that upstream cap ever changes independently.
        notes: `Imported from tradebook (${r.rawSymbol})`.slice(0, 140),
        // Recorded on the OPEN trade so a future import's Pass 2 can add the
        // exit leg's charges to this entry leg's when it eventually closes.
        charges: r.charges,
        ...(r.assetClass === "fno"
          ? {
              assetClass: "fno" as const,
              expiry: r.fno?.expiry,
              strike: r.fno?.strike ?? undefined,
              optionType: r.fno?.optionType,
            }
          : {}),
      }));
      addTrades(entries);
    }

    // Looped rather than a new batch mutator: import-driven closes are
    // bounded by how many positions are currently open (realistically dozens
    // for a personal swing book), unlike bulk buys which can be hundreds of
    // historical rows — addTrades exists for that volume difference, this
    // doesn't need the same treatment.
    for (const r of selectedCloses) {
      closeTrade(r.matchedTradeId, "other", `Auto-closed from tradebook SELL (${r.rawSymbol})`.slice(0, 140), {
        exitDate: r.dateISO,
        exitPrice: r.price,
        pnl: r.pnl,
        netPnl: r.netPnl,
        charges: r.charges,
        closeExecutionId: executionFingerprint(r, partition),
      });
    }

    setImporting(false);
    const parts: string[] = [];
    if (selectedRoundTrips.length)
      parts.push(`${selectedRoundTrips.length} round trip${selectedRoundTrips.length !== 1 ? "s" : ""}`);
    if (selectedBuys.length) parts.push(`${selectedBuys.length} new trade${selectedBuys.length !== 1 ? "s" : ""}`);
    if (selectedCloses.length)
      parts.push(`${selectedCloses.length} closed position${selectedCloses.length !== 1 ? "s" : ""}`);
    toast.success(`Imported ${parts.join(", ")}`);
    onOpenChange(false);
    resetAll();
  };

  const rendered = filtered.slice(0, ROW_RENDER_CAP);
  const commitLabel = (() => {
    const parts: string[] = [];
    if (selectedRoundTrips.length) parts.push(`${selectedRoundTrips.length} round trip${selectedRoundTrips.length !== 1 ? "s" : ""}`);
    if (selectedBuys.length) parts.push(`${selectedBuys.length} new`);
    if (selectedCloses.length) parts.push(`${selectedCloses.length} close${selectedCloses.length !== 1 ? "s" : ""}`);
    return parts.length ? `Import ${parts.join(" + ")}` : "Import";
  })();

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) resetAll();
      }}
    >
      <DialogContent className="glass-strong border-glass-border sm:max-w-4xl w-[calc(100vw-2rem)] max-h-[88vh] flex flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-glass-border shrink-0">
          <DialogTitle className="font-display tracking-tight flex items-center gap-2">
            <FileSpreadsheet className="size-4 text-primary" /> Import tradebook
          </DialogTitle>
          <DialogDescription>
            Reconciles round trips, new positions, and closes in one pass — review, then import.
          </DialogDescription>
        </DialogHeader>

        {/* ── Step 1: drop ─────────────────────────────────────────────────── */}
        {step === "drop" && (
          <div className="px-6 py-6 space-y-5 overflow-y-auto">
            <div>
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Target partition
              </Label>
              {brokerPartitions.length === 0 ? (
                <p className="text-sm text-muted-foreground mt-2">
                  No broker partitions configured yet — add one in Settings first.
                </p>
              ) : (
                <Select value={partition} onValueChange={(v: PartitionId) => setPartition(v)}>
                  <SelectTrigger className="bg-input/40 border-glass-border mt-1.5">
                    <SelectValue placeholder="Pick a partition" />
                  </SelectTrigger>
                  <SelectContent>
                    {brokerPartitions.map((p: BrokerPartition) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                void handleFile(e.dataTransfer.files?.[0]);
              }}
              className={`w-full rounded-2xl border-2 border-dashed p-8 flex flex-col items-center gap-3 transition-all ${
                dragging
                  ? "border-primary bg-primary/10 shadow-[0_0_40px_-8px_oklch(0.72_0.18_155)] animate-pulse"
                  : "border-glass-border hover:border-primary/40 hover:bg-white/[0.03]"
              }`}
            >
              <UploadCloud className={`size-9 ${dragging ? "text-primary" : "text-muted-foreground"}`} />
              <div className="text-center">
                <p className="text-sm font-medium">
                  {dragging ? "Drop it here" : "Drag & drop your tradebook CSV"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  or click to browse — from Zerodha, Groww, Dhan, or another broker export
                </p>
              </div>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              className="hidden"
              onChange={(e) => {
                void handleFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />

            <div className="space-y-1.5">
              <p className="text-[11px] text-muted-foreground">Get your tradebook from:</p>
              <div className="flex flex-wrap gap-1.5">
                {TRADEBOOK_HELPER_LINKS.map((l) => (
                  <HelperLinkPill key={l.url} {...l} />
                ))}
              </div>
            </div>

            <p className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider px-2.5 py-1 rounded-full border border-[oklch(0.72_0.18_155_/_0.35)] text-[oklch(0.78_0.16_155)]">
              🛡️ 100% client-side tradebook parsing — runs entirely in your browser's memory
            </p>
          </div>
        )}

        {/* ── Step 1.5: manual column mapper (only on auto-detect failure) ──── */}
        {step === "map" && mapCtx && (
          <div className="px-6 py-6 space-y-4 overflow-y-auto">
            <p className="text-sm text-muted-foreground">
              Couldn't auto-detect the columns — map them by hand below.
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              <MapField label="Symbol column" value={mapSymbol} onChange={setMapSymbol} headers={mapCtx.headers} />
              <MapField label="Date column" value={mapDate} onChange={setMapDate} headers={mapCtx.headers} />
              <MapField label="Buy/Sell column" value={mapSide} onChange={setMapSide} headers={mapCtx.headers} />
              <MapField label="Quantity column" value={mapQty} onChange={setMapQty} headers={mapCtx.headers} />
              <MapField label="Price column" value={mapPrice} onChange={setMapPrice} headers={mapCtx.headers} />
            </div>
            <div className="flex justify-between pt-2">
              <Button variant="outline" className="border-glass-border" onClick={resetAll}>
                Back
              </Button>
              <Button onClick={applyManualMapping} className="gradient-primary text-primary-foreground border-0">
                Continue to review
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 2: staging review ────────────────────────────────────────── */}
        {step === "review" && (
          <>
            <div className="px-6 py-4 space-y-3 border-b border-glass-border shrink-0">
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
                <SummaryStat label="Total rows" value={String(staged.length)} />
                {roundTripRowsAll.length > 0 && (
                  <SummaryStat label="Round trips matched" value={String(roundTripRowsAll.length)} tone={CYAN} />
                )}
                <SummaryStat label="New buys" value={String(buyRows.length)} tone={EMERALD} />
                {unmatchedSellRows.length > 0 && (
                  <SummaryStat label="Unmatched sells" value={String(unmatchedSellRows.length)} tone={ROSE} />
                )}
                {(roundTripRowsAll.length > 0 || closeRows.length > 0) && (
                  <SummaryStat
                    label="Estimated net P&L"
                    value={inr(estimatedNetPnl)}
                    tone={estimatedNetPnl >= 0 ? EMERALD : ROSE}
                    sensitive
                  />
                )}
                {closeRows.length > 0 && (
                  <SummaryStat label="Auto-close matches" value={String(closeRows.length)} tone={SKY} />
                )}
                {dupCount > 0 && <SummaryStat label="Duplicates" value={String(dupCount)} tone={AMBER} />}
                {(skippedRows > 0 || fnoSkipped > 0) && (
                  <SummaryStat label="Skipped" value={String(skippedRows + fnoSkipped)} tone={AMBER} />
                )}
                <span className="text-muted-foreground ml-auto truncate max-w-[14rem]" title={fileName}>
                  {fileName}
                </span>
              </div>
              {!enableFnoTracking && fnoSkipped > 0 && (
                <p className={`flex items-start gap-1.5 text-[11px] ${AMBER}`}>
                  <TriangleAlert className="size-3.5 shrink-0 mt-0.5" />
                  {fnoSkipped} row{fnoSkipped !== 1 ? "s" : ""} skipped — F&O instruments aren't
                  tracked (turn on F&O tracking in Settings to import them).
                </p>
              )}
              <p className="text-[11px] text-muted-foreground">
                <span className={CYAN}>ROUND-TRIP</span> pairs two fills for the same ticker found in
                this file into one already-closed trade — buy-then-sell is <span className={EMERALD}>LONG</span>,
                sell-then-buy is <span className={ROSE}>SHORT</span>.{" "}
                <span className={SKY}>CLOSE</span> matches a SELL to an existing open position.
                Unpaired <span className={EMERALD}>BUY</span> rows open new trades. Orphan sells (no
                match anywhere) are shown for context only.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[10rem]">
                  <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search ticker…"
                    className="pl-8 h-8 text-sm bg-input/40 border-glass-border"
                  />
                </div>
                {roundTripRowsAll.length > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 border-glass-border gap-1.5"
                    onClick={toggleAllRoundTrips}
                  >
                    {roundTripRowsAll.every((r) => r.selected) ? (
                      <CheckSquare className="size-3.5" />
                    ) : (
                      <Square className="size-3.5" />
                    )}
                    {roundTripRowsAll.every((r) => r.selected) ? "Deselect all round trips" : "Select all round trips"}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 border-glass-border gap-1.5"
                  onClick={toggleAllBuys}
                  disabled={buyRows.length === 0}
                >
                  {buyRows.every((r) => r.selected) && buyRows.length > 0 ? (
                    <CheckSquare className="size-3.5" />
                  ) : (
                    <Square className="size-3.5" />
                  )}
                  {buyRows.every((r) => r.selected) && buyRows.length > 0 ? "Deselect all buys" : "Select all buys"}
                </Button>
                {closeRows.length > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 border-glass-border gap-1.5"
                    onClick={toggleAllCloses}
                  >
                    {closeRows.every((r) => r.selected) ? (
                      <CheckSquare className="size-3.5" />
                    ) : (
                      <Square className="size-3.5" />
                    )}
                    {closeRows.every((r) => r.selected) ? "Deselect all closes" : "Select all closes"}
                  </Button>
                )}
                {dupCount > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 border-glass-border"
                    onClick={deselectDuplicates}
                  >
                    Deselect duplicates
                  </Button>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-3">
              {rendered.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground py-10">
                  No rows match the current search.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {rendered.map((r) => {
                    if (r.kind === "round-trip") {
                      return (
                        <li
                          key={r.key}
                          className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-colors ${
                            r.selected
                              ? "border-[oklch(0.76_0.13_195_/_0.4)] bg-[oklch(0.76_0.13_195_/_0.06)]"
                              : "border-glass-border/50 opacity-60"
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => patchRow(r.key, { selected: !r.selected })}
                            className={`shrink-0 ${r.selected ? CYAN : "text-muted-foreground"}`}
                            aria-label={r.selected ? "Deselect row" : "Select row"}
                          >
                            {r.selected ? <CheckSquare className="size-4" /> : <Square className="size-4" />}
                          </button>
                          <span
                            className="text-xs font-semibold tracking-wider px-2 py-0.5 rounded-md bg-white/[0.06] border border-glass-border shrink-0"
                            title={r.rawSymbol}
                          >
                            {r.symbol}
                          </span>
                          <span
                            className={`text-[9px] font-semibold tracking-wider px-1.5 py-0.5 rounded-md shrink-0 border border-[oklch(0.76_0.13_195_/_0.4)] ${CYAN}`}
                          >
                            ROUND-TRIP
                          </span>
                          <span
                            className={`text-[9px] font-semibold tracking-wider px-1.5 py-0.5 rounded-md shrink-0 border ${
                              r.side === "short"
                                ? `border-[oklch(0.7_0.22_20_/_0.4)] ${ROSE}`
                                : `border-[oklch(0.72_0.18_155_/_0.4)] ${EMERALD}`
                            }`}
                            title={
                              r.side === "short"
                                ? "Sold to open, bought to cover"
                                : "Bought to open, sold to close"
                            }
                          >
                            {r.side === "short" ? "SHORT" : "LONG"}
                          </span>
                          {r.assetClass === "fno" && (
                            <span
                              className={`text-[9px] font-semibold tracking-wider px-1.5 py-0.5 rounded-md border border-glass-border shrink-0 ${AMBER}`}
                              title={
                                r.fno
                                  ? `${r.fno.instrument} ${r.fno.optionType}${r.fno.strike ? ` ${r.fno.strike}` : ""} · ${r.fno.expiry}`
                                  : "F&O contract — couldn't decode the symbol shape"
                              }
                            >
                              F&O{r.fno?.optionType ? ` ${r.fno.optionType}` : ""}
                            </span>
                          )}
                          {r.qtyMismatch && (
                            <span
                              className={`shrink-0 inline-flex items-center gap-1 text-[9px] font-semibold tracking-wider px-1.5 py-0.5 rounded-md border border-[oklch(0.78_0.14_80_/_0.4)] ${AMBER}`}
                              title="The buy and sell legs in this file had different quantities — review before confirming"
                            >
                              <TriangleAlert className="size-2.5" /> QTY MISMATCH
                            </span>
                          )}
                          {r.isDuplicate && (
                            <span
                              className={`shrink-0 inline-flex items-center gap-1 text-[9px] font-semibold tracking-wider px-1.5 py-0.5 rounded-md border border-[oklch(0.78_0.14_80_/_0.4)] ${AMBER}`}
                              title="A trade with this same execution already exists from a past import"
                            >
                              <TriangleAlert className="size-2.5" /> DUP
                            </span>
                          )}
                          <span className="text-[11px] text-muted-foreground shrink-0 tnum">
                            <Sensitive>{inr(r.entryPrice)}</Sensitive> ➔ <Sensitive>{inr(r.exitPrice)}</Sensitive>
                          </span>
                          <span className="text-[10px] text-muted-foreground shrink-0">
                            {r.durationDays === 0 ? "Intraday" : `${r.durationDays}d`}
                          </span>
                          <span className="text-[10px] text-muted-foreground shrink-0 tnum ml-auto md:ml-0">
                            Charges <Sensitive>{inr(r.charges)}</Sensitive>
                          </span>
                          <span className={`tnum text-xs font-semibold shrink-0 ${r.netPnl >= 0 ? EMERALD : ROSE}`}>
                            <Sensitive>
                              {r.netPnl >= 0 ? "+" : ""}
                              {inr(r.netPnl)}
                            </Sensitive>
                          </span>
                          <span className={`tnum text-[10px] shrink-0 ${r.roiPct >= 0 ? EMERALD : ROSE}`}>
                            {r.roiPct >= 0 ? "+" : ""}
                            {(r.roiPct * 100).toFixed(1)}%
                          </span>
                        </li>
                      );
                    }
                    return (
                    <li
                      key={r.key}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-colors ${
                        r.kind === "unmatched-sell"
                          ? "border-glass-border/40 opacity-50"
                          : r.kind === "close"
                            ? r.selected
                              ? "border-[oklch(0.75_0.14_230_/_0.4)] bg-[oklch(0.75_0.14_230_/_0.06)]"
                              : "border-glass-border/50 opacity-60"
                            : r.selected
                              ? "border-glass-border bg-white/[0.04]"
                              : "border-glass-border/50 opacity-60"
                      }`}
                    >
                      {r.kind !== "unmatched-sell" ? (
                        <button
                          type="button"
                          onClick={() => patchRow(r.key, { selected: !r.selected })}
                          className={`shrink-0 ${r.selected ? (r.kind === "close" ? SKY : "text-primary") : "text-muted-foreground"}`}
                          aria-label={r.selected ? "Deselect row" : "Select row"}
                        >
                          {r.selected ? <CheckSquare className="size-4" /> : <Square className="size-4" />}
                        </button>
                      ) : (
                        <span className="size-4 shrink-0" />
                      )}
                      <span className="tnum text-xs text-muted-foreground shrink-0 w-16">
                        {fmtDate(r.dateISO).slice(0, 6)}
                      </span>
                      <span
                        className="text-xs font-semibold tracking-wider px-2 py-0.5 rounded-md bg-white/[0.06] border border-glass-border shrink-0"
                        title={r.rawSymbol}
                      >
                        {r.symbol}
                      </span>
                      <span
                        className={`text-[9px] font-semibold tracking-wider px-1.5 py-0.5 rounded-md shrink-0 ${
                          r.kind === "close"
                            ? `border border-[oklch(0.75_0.14_230_/_0.4)] ${SKY}`
                            : r.side === "buy"
                              ? `border border-[oklch(0.72_0.18_155_/_0.4)] ${EMERALD}`
                              : `border border-[oklch(0.7_0.22_20_/_0.4)] ${ROSE}`
                        }`}
                      >
                        {r.kind === "close" ? "CLOSE" : r.side.toUpperCase()}
                      </span>
                      {r.kind === "buy" && r.assetClass === "fno" && (
                        <span
                          className={`text-[9px] font-semibold tracking-wider px-1.5 py-0.5 rounded-md border border-glass-border shrink-0 ${AMBER}`}
                          title={
                            r.fno
                              ? `${r.fno.instrument} ${r.fno.optionType}${r.fno.strike ? ` ${r.fno.strike}` : ""} · ${r.fno.expiry}`
                              : "F&O contract — couldn't decode the symbol shape"
                          }
                        >
                          F&O{r.fno?.optionType ? ` ${r.fno.optionType}` : ""}
                          {r.fno?.strike ? ` ${r.fno.strike}` : ""}
                        </span>
                      )}
                      {r.kind === "buy" && r.isDuplicate && (
                        <span
                          className={`shrink-0 inline-flex items-center gap-1 text-[9px] font-semibold tracking-wider px-1.5 py-0.5 rounded-md border border-[oklch(0.78_0.14_80_/_0.4)] ${AMBER}`}
                          title="An open trade with the same ticker, date, quantity and price already exists in this partition"
                        >
                          <TriangleAlert className="size-2.5" /> DUP
                        </span>
                      )}
                      {r.kind === "close" && r.qtyMismatch && (
                        <span
                          className={`shrink-0 inline-flex items-center gap-1 text-[9px] font-semibold tracking-wider px-1.5 py-0.5 rounded-md border border-[oklch(0.78_0.14_80_/_0.4)] ${AMBER}`}
                          title={`Sold ${r.quantity} but the matched open position was ${r.matchedTrade.qty} — review before confirming`}
                        >
                          <TriangleAlert className="size-2.5" /> QTY {r.quantity}≠{r.matchedTrade.qty}
                        </span>
                      )}
                      {r.kind === "unmatched-sell" && !r.alreadyClosed && (
                        <span
                          className={`shrink-0 inline-flex items-center gap-1 text-[9px] font-semibold tracking-wider px-1.5 py-0.5 rounded-md border border-[oklch(0.78_0.14_80_/_0.4)] ${AMBER}`}
                        >
                          <TriangleAlert className="size-2.5" /> NO MATCH
                        </span>
                      )}
                      <span className="tnum text-xs text-muted-foreground shrink-0 w-14 text-right">
                        {r.quantity}
                      </span>
                      <span className="tnum text-sm shrink-0 w-24 text-right">
                        <Sensitive>{inr(r.price)}</Sensitive>
                      </span>
                      <span className="tnum text-sm font-semibold shrink-0 w-28 text-right">
                        <Sensitive>{inr(r.quantity * r.price)}</Sensitive>
                      </span>
                      {r.kind === "buy" && (
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Input
                            type="number"
                            step="0.05"
                            value={r.targetPrice}
                            onChange={(e) => patchRow(r.key, { targetPrice: e.target.value })}
                            className="h-7 w-20 text-xs bg-input/40 border-glass-border tnum"
                            placeholder="Target"
                            title="Target price"
                          />
                          <Input
                            type="number"
                            step="0.05"
                            value={r.stopLoss}
                            onChange={(e) => patchRow(r.key, { stopLoss: e.target.value })}
                            className="h-7 w-20 text-xs bg-input/40 border-glass-border tnum"
                            placeholder="Stop"
                            title="Stop loss"
                          />
                        </div>
                      )}
                      {r.kind === "close" && (
                        <div className="flex items-center gap-2 shrink-0 w-[15rem] justify-end">
                          <span
                            className="text-[10px] text-muted-foreground truncate max-w-[5.5rem]"
                            title={`Entered ${fmtDate(r.matchedTrade.entryDate)} @ ${inr(r.matchedTrade.entryPrice)}`}
                          >
                            vs {inr(r.matchedTrade.entryPrice)}
                          </span>
                          {r.charges > 0 && (
                            <span className="text-[10px] text-muted-foreground tnum" title="Charges deducted">
                              -{inr(r.charges)}
                            </span>
                          )}
                          <span className={`tnum text-xs font-semibold ${r.netPnl >= 0 ? EMERALD : ROSE}`}>
                            <Sensitive>{inr(r.netPnl)}</Sensitive>
                          </span>
                          <span className={`tnum text-[10px] ${r.roiPct >= 0 ? EMERALD : ROSE}`}>
                            {r.roiPct >= 0 ? "+" : ""}
                            {(r.roiPct * 100).toFixed(1)}%
                          </span>
                        </div>
                      )}
                      {r.kind === "unmatched-sell" && (
                        <span className="text-[10px] text-muted-foreground shrink-0 w-[10.5rem]">
                          {r.alreadyClosed ? "already closed (past import)" : "no matching open position"}
                        </span>
                      )}
                    </li>
                    );
                  })}
                </ul>
              )}
              {filtered.length > ROW_RENDER_CAP && (
                <p className="text-center text-xs text-muted-foreground py-3">
                  Showing first {ROW_RENDER_CAP} of {filtered.length} matching rows — refine the
                  search to see the rest. Selection still applies to all of them.
                </p>
              )}
            </div>

            <div className="px-6 py-4 border-t border-glass-border shrink-0 space-y-2">
              {/* Persistent, not just a toast on click — a disabled button
                  with no visible reason (e.g. every suggested stop landed on
                  ₹0 because Settings has the risk cap configured at 100%) is
                  a silent dead end otherwise. */}
              {invalidSelected && (
                <p className={`flex items-start gap-1.5 text-[11px] ${AMBER}`}>
                  <TriangleAlert className="size-3.5 shrink-0 mt-0.5" />
                  Every selected buy needs a target and stop loss greater than zero — check the
                  highlighted rows above.
                </p>
              )}
              {qtyMismatchCount > 0 && (
                <p className={`flex items-start gap-1.5 text-[11px] ${AMBER}`}>
                  <TriangleAlert className="size-3.5 shrink-0 mt-0.5" />
                  {qtyMismatchCount} row{qtyMismatchCount !== 1 ? "s" : ""} left unchecked — the buy
                  and sell quantities didn't exactly match. Review before including them.
                </p>
              )}
              <div className="flex items-center justify-between gap-3">
                <Button
                  type="button"
                  variant="outline"
                  className="border-glass-border"
                  onClick={() => {
                    onOpenChange(false);
                    resetAll();
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={() => void handleCommit()}
                  disabled={
                    importing ||
                    (selectedRoundTrips.length === 0 && selectedBuys.length === 0 && selectedCloses.length === 0) ||
                    invalidSelected
                  }
                  className="gradient-primary text-primary-foreground border-0 gap-2 glow"
                >
                  {importing ? <Loader2 className="size-4 animate-spin" /> : <FileSpreadsheet className="size-4" />}
                  {commitLabel}
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Small pieces ────────────────────────────────────────────────────────────
function SummaryStat({
  label,
  value,
  tone,
  sensitive,
}: {
  label: string;
  value: string;
  tone?: string;
  sensitive?: boolean;
}) {
  const val = <span className={`tnum font-semibold ${tone ?? "text-foreground"}`}>{value}</span>;
  return (
    <span className="text-muted-foreground">
      {label}: {sensitive ? <Sensitive>{val}</Sensitive> : val}
    </span>
  );
}

function MapField({
  label,
  value,
  onChange,
  headers,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  headers: string[];
}) {
  return (
    <div>
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="bg-input/40 border-glass-border mt-1.5">
          <SelectValue placeholder="Pick a column" />
        </SelectTrigger>
        <SelectContent>
          {headers.map((h, i) => (
            <SelectItem key={i} value={String(i)}>
              {h}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
