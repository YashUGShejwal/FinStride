/**
 * Tradebook CSV import — staging & review modal for the Swing Desk.
 *
 * Three linear steps: drop (target partition + file) -> (map, only on
 * auto-detect failure) -> review (stage, edit target/stop, commit).
 *
 * MODELING NOTE (see tradebookParser.ts for the full reasoning): a tradebook
 * row is a BUY or a SELL fill, not a "trade". Only BUY rows map cleanly onto
 * this app's Trade model (open a new LONG position) — a SELL row exits a
 * position that must already exist as a tracked open trade, and this app has
 * no lot-matching/FIFO engine to reconcile that automatically. SELL rows are
 * still shown (so the user can see everything the file actually contains,
 * and reconcile the exit manually via the Swing Desk's own close flow) but
 * are never independently selectable/importable here.
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
import { FNO_REGEX } from "@/lib/blueprintRules";
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
type StagedTradeRow = ParsedTradeRow & {
  key: number;
  /** Only ever true for "buy" rows — sells are never independently importable (see file doc comment). */
  selected: boolean;
  isDuplicate: boolean;
  targetPrice: string;
  stopLoss: string;
};

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
// Trade counts are typically much smaller than bank-statement transaction
// counts, so this is a generous ceiling — but it must still hold regardless
// of size: see the forced-deselect-beyond-cap logic in stageRows below,
// which keeps "what's shown" and "what's committed" in sync even if a file
// somehow exceeds it.
const ROW_RENDER_CAP = 500;

/** Same-day + ticker + qty + price + partition — mirrors the CSV importer's dupKey shape. */
const dupKey = (dayISO: string, symbol: string, qty: number, price: number, partition: string) =>
  `${dayISO.slice(0, 10)}|${symbol}|${qty}|${price}|${partition}`;

export function TradeImportModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { trades, addTrades, brokerPartitions, blueprintSettings } = useStore();

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

  // ── Staging from parsed rows ───────────────────────────────────────────────
  const stageRows = (rows: ParsedTradeRow[], skipped: number) => {
    const fno = rows.filter((r) => FNO_REGEX.test(r.symbol));
    const equityRows = rows.filter((r) => !FNO_REGEX.test(r.symbol));

    // Count-aware duplicate matching against ALL existing trades (open AND
    // closed) in the target partition — mirrors the CSV importer's approach:
    // N existing trades flag at most N staged rows, so two distinct
    // same-day/same-price buys don't both get wrongly flagged off one
    // existing match. Deliberately NOT scoped to status==="open": closeTrade
    // never touches ticker/entryDate/entryPrice/qty/partition, so a trade
    // that's since been closed keeps the exact same dedup key it had while
    // open — excluding closed trades would make re-uploading an overlapping
    // tradebook (the normal case, since most broker exports are date-range
    // or since-inception, not incremental) silently re-create every position
    // the user already closed out.
    const counts = new Map<string, number>();
    for (const t of trades) {
      if (t.partition !== partition) continue;
      const k = dupKey(t.entryDate, t.ticker, t.qty, t.entryPrice, t.partition);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }

    const next: StagedTradeRow[] = equityRows.map((r, index) => {
      let isDuplicate = false;
      if (r.side === "buy") {
        const k = dupKey(r.dateISO, r.symbol, r.quantity, r.price, partition);
        const remaining = counts.get(k) ?? 0;
        if (remaining > 0) {
          counts.set(k, remaining - 1);
          isDuplicate = true;
        }
      }
      // Rows past the render cap are never auto-selected: the review grid's
      // search box re-slices `filtered` from this SAME staged order, so a
      // row out here can still be found and selected later once the user
      // actually filters down to see it — this only prevents committing
      // something that was never shown by default.
      const withinRenderCap = index < ROW_RENDER_CAP;
      return {
        ...r,
        key: r.sourceIndex,
        selected: r.side === "buy" && !isDuplicate && withinRenderCap,
        isDuplicate,
        targetPrice: r.side === "buy" ? suggestTarget(r.price) : "",
        stopLoss: r.side === "buy" ? suggestStop(r.price) : "",
      };
    });

    setStaged(next);
    setSkippedRows(skipped);
    setFnoSkipped(fno.length);
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

  const selectedRows = staged.filter((r) => r.selected);
  const buyRows = staged.filter((r) => r.side === "buy");
  const sellRows = staged.filter((r) => r.side === "sell");
  const buyVolume = buyRows.reduce((s, r) => s + r.quantity * r.price, 0);
  const sellVolume = sellRows.reduce((s, r) => s + r.quantity * r.price, 0);
  const tickerCount = new Set(staged.map((r) => r.symbol)).size;
  const dupCount = staged.filter((r) => r.isDuplicate).length;

  const patchRow = (key: number, patch: Partial<StagedTradeRow>) =>
    setStaged((s) => s.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const toggleAllBuys = () => {
    const target = !buyRows.every((r) => r.selected);
    setStaged((s) => s.map((r) => (r.side === "buy" ? { ...r, selected: target } : r)));
  };

  const deselectDuplicates = () =>
    setStaged((s) => s.map((r) => (r.isDuplicate ? { ...r, selected: false } : r)));

  // ── Commit ─────────────────────────────────────────────────────────────────
  const invalidSelected = selectedRows.some(
    (r) => !(Number(r.targetPrice) > 0) || !(Number(r.stopLoss) > 0),
  );

  const handleCommit = async () => {
    if (selectedRows.length === 0) {
      toast.error("Select at least one trade to import");
      return;
    }
    if (invalidSelected) {
      toast.error("Every selected trade needs a target and stop loss greater than zero");
      return;
    }
    setImporting(true);
    await new Promise((r) => setTimeout(r, 60));
    const entries: Omit<Trade, "id" | "status">[] = selectedRows.map((r) => ({
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
    }));
    addTrades(entries);
    setImporting(false);
    toast.success(`Imported ${entries.length} trade${entries.length !== 1 ? "s" : ""}`);
    onOpenChange(false);
    resetAll();
  };

  const rendered = filtered.slice(0, ROW_RENDER_CAP);

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
            Stage buy fills from a broker tradebook CSV into new swing positions.
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
                {/* "Rows parsed", not "Total trades" — staged includes SELL
                    rows, which never import as trades (see the modeling note
                    below); labeling this "trades" would read as a promise
                    the "Import N trades" button several lines down doesn't keep. */}
                <SummaryStat label="Rows parsed" value={String(staged.length)} />
                <SummaryStat label="Buy volume" value={inr(buyVolume)} tone={EMERALD} sensitive />
                <SummaryStat label="Sell volume" value={inr(sellVolume)} tone={ROSE} sensitive />
                <SummaryStat label="Tickers" value={String(tickerCount)} />
                {dupCount > 0 && <SummaryStat label="Duplicates" value={String(dupCount)} tone={AMBER} />}
                {(skippedRows > 0 || fnoSkipped > 0) && (
                  <SummaryStat
                    label="Skipped"
                    value={String(skippedRows + fnoSkipped)}
                    tone={AMBER}
                  />
                )}
                <span className="text-muted-foreground ml-auto truncate max-w-[14rem]" title={fileName}>
                  {fileName}
                </span>
              </div>
              {fnoSkipped > 0 && (
                <p className={`flex items-start gap-1.5 text-[11px] ${AMBER}`}>
                  <TriangleAlert className="size-3.5 shrink-0 mt-0.5" />
                  {fnoSkipped} row{fnoSkipped !== 1 ? "s" : ""} skipped — F&O instruments aren't
                  tracked here (equity swing only, per Blueprint Rule 2).
                </p>
              )}
              <p className="text-[11px] text-muted-foreground">
                Only <span className={EMERALD}>BUY</span> rows open new trades — a{" "}
                <span className={ROSE}>SELL</span> row exits a position that must already be
                tracked, so it's shown for context but isn't independently importable. Close the
                matching open trade from the Swing Desk list instead.
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
                  {rendered.map((r) => (
                    <li
                      key={r.key}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-colors ${
                        r.side === "sell"
                          ? "border-glass-border/40 opacity-50"
                          : r.selected
                            ? "border-glass-border bg-white/[0.04]"
                            : "border-glass-border/50 opacity-60"
                      }`}
                    >
                      {r.side === "buy" ? (
                        <button
                          type="button"
                          onClick={() => patchRow(r.key, { selected: !r.selected })}
                          className={`shrink-0 ${r.selected ? "text-primary" : "text-muted-foreground"}`}
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
                          r.side === "buy"
                            ? `border border-[oklch(0.72_0.18_155_/_0.4)] ${EMERALD}`
                            : `border border-[oklch(0.7_0.22_20_/_0.4)] ${ROSE}`
                        }`}
                      >
                        {r.side.toUpperCase()}
                      </span>
                      {r.isDuplicate && (
                        <span
                          className={`shrink-0 inline-flex items-center gap-1 text-[9px] font-semibold tracking-wider px-1.5 py-0.5 rounded-md border border-[oklch(0.78_0.14_80_/_0.4)] ${AMBER}`}
                          title="An open trade with the same ticker, date, quantity and price already exists in this partition"
                        >
                          <TriangleAlert className="size-2.5" /> DUP
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
                      {r.side === "buy" ? (
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
                      ) : (
                        <span className="text-[10px] text-muted-foreground shrink-0 w-[10.5rem]">
                          exits an existing position
                        </span>
                      )}
                    </li>
                  ))}
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
                  Every selected trade needs a target and stop loss greater than zero — check the
                  highlighted rows above.
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
                  disabled={importing || selectedRows.length === 0 || invalidSelected}
                  className="gradient-primary text-primary-foreground border-0 gap-2 glow"
                >
                  {importing ? <Loader2 className="size-4 animate-spin" /> : <FileSpreadsheet className="size-4" />}
                  Import {selectedRows.length} trade{selectedRows.length !== 1 ? "s" : ""}
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
