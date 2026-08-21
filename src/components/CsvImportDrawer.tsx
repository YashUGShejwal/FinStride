/**
 * CSV statement import — staging & review drawer (Track 3.1).
 *
 * Three linear steps inside one modal:
 *   A "drop"   — pick the target account, drop/browse a CSV file.
 *   B "map"    — ONLY when auto-detection fails: manual column mapping.
 *   C "review" — staging grid: search/filter, bulk actions, per-row category
 *                edit, duplicate flags, then one atomic addTransactions().
 *
 * Everything is processed in memory on this device — the file is read with
 * File.text() and never uploaded anywhere (the only network write is the
 * app's own ledger sync, same as manual entry).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckSquare, Columns3, ExternalLink, FileSpreadsheet, Loader2, Search, Square, TriangleAlert,
  UploadCloud,
} from "lucide-react";
import { toast } from "sonner";
import { useStore, type PaymentMode, type Transaction, type TxType } from "@/lib/store";
import {
  applyMapping,
  categorizeNarration,
  parseStatementCsv,
  type ColumnMapping,
  type ParsedStatementRow,
} from "@/lib/parsers/csvStatementParser";
import { inr, fmtDate } from "@/lib/format";
import { Sensitive } from "@/components/Sensitive";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

// ─── Staging model ───────────────────────────────────────────────────────────
type StagedRow = {
  /** Source-grid row index — stable key across filtering/sorting. */
  key: number;
  dateISO: string;
  rawDate: string;
  narration: string;
  cleanedNarration: string;
  amount: number;
  direction: "debit" | "credit";
  refNo?: string;
  type: TxType;
  category: string;
  selected: boolean;
  isDuplicate: boolean;
};

type Step = "drop" | "map" | "review";
type DupFilter = "all" | "new" | "dup";

/** What the manual mapper (and the review step's "re-map") works from. */
type MapContext = {
  headers: string[];
  headerRowIndex: number;
  grid: string[][];
  reason: string;
};

/**
 * Duplicate identity versus the existing ledger: same day + amount + account
 * + TYPE. Type matters: amounts are positive magnitudes on both sides, so
 * without it an existing ₹5,000 expense would falsely flag a same-day ₹5,000
 * CREDIT as its duplicate and silently deselect a legitimate inflow.
 */
const dupKey = (dayISO: string, amount: number, account: string, type: TxType) =>
  `${dayISO.slice(0, 10)}|${amount}|${account}|${type}`;

/** Rendering cap — selection/bulk actions still cover the FULL filtered set. */
const ROW_RENDER_CAP = 200;
const NOTES_MAX = 140;

const EMERALD = "text-[oklch(0.78_0.16_155)]";
const ROSE = "text-[oklch(0.78_0.18_25)]";
const AMBER = "text-[oklch(0.82_0.13_80)]";

/** Quick portals to the statement-download page for the brokers/banks this parser targets. */
const STATEMENT_HELPER_LINKS = [
  { label: "Zerodha Console", url: "https://console.zerodha.com/reports/statement" },
  { label: "Groww Reports", url: "https://groww.in/user/reports" },
  { label: "Dhan Reports", url: "https://login.dhan.co/" },
  { label: "HDFC NetBanking", url: "https://netbanking.hdfcbank.com/" },
  { label: "ICICI NetBanking", url: "https://infinity.icicibank.com/" },
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

export function CsvImportDrawer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const {
    transactions, addTransactions, accountModes, accountLabel,
    incomeCategories, expenseCategories,
  } = useStore();

  const [step, setStep] = useState<Step>("drop");
  const [fileName, setFileName] = useState("");
  // Statements come from banks/cards, so default the target to the first
  // bank-type account; anything is still pickable.
  const [accountId, setAccountId] = useState<PaymentMode>(
    () => (accountModes.find((a) => a.type === "bank") ?? accountModes[0])?.id ?? "",
  );
  const [staged, setStaged] = useState<StagedRow[]>([]);
  const [skippedRows, setSkippedRows] = useState(0);
  const [mapCtx, setMapCtx] = useState<MapContext | null>(null);
  const [mapDate, setMapDate] = useState("");
  const [mapNarration, setMapNarration] = useState("");
  const [mapAmount, setMapAmount] = useState("");
  const [mapCredit, setMapCredit] = useState("none");
  const [mapDrCr, setMapDrCr] = useState("none");
  const [noHeader, setNoHeader] = useState(false);
  const [q, setQ] = useState("");
  const [dupFilter, setDupFilter] = useState<DupFilter>("all");
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // The initializer above runs once at page mount, BEFORE the store finishes
  // hydrating — deleted accounts are still present then. Re-point once the
  // real list settles so the Select never sits blank on a dangling id and an
  // import can never target an account nothing resolves (same pattern as the
  // ledger form's account field in cashflow.tsx).
  useEffect(() => {
    if (accountModes.length === 0) return;
    if (accountModes.some((a) => a.id === accountId)) return;
    setAccountId((accountModes.find((a) => a.type === "bank") ?? accountModes[0]).id);
  }, [accountModes, accountId]);

  // A suggested category can name a default the user has deleted (they're
  // tombstonable) — clamp to the live list so no row Select ever sits blank.
  const clampCategory = (cat: string, type: TxType): string => {
    const list = type === "income" ? incomeCategories : expenseCategories;
    return list.includes(cat) ? cat : (list.find((c) => c === "Other") ?? list[0] ?? cat);
  };

  const resetAll = () => {
    setStep("drop");
    setFileName("");
    setStaged([]);
    setSkippedRows(0);
    setMapCtx(null);
    setMapDate("");
    setMapNarration("");
    setMapAmount("");
    setMapCredit("none");
    setMapDrCr("none");
    setNoHeader(false);
    setQ("");
    setDupFilter("all");
    setDragging(false);
    setImporting(false);
  };

  // Membership set for POST-staging duplicate rechecks (direction flips).
  // Initial staging uses a count-aware pass instead — see stageRows.
  const existingKeySet = useMemo(() => {
    const set = new Set<string>();
    for (const t of transactions) {
      if (t.account === accountId) set.add(dupKey(t.date, t.amount, t.account, t.type));
    }
    return set;
  }, [transactions, accountId]);

  // ── Staging from parsed rows ───────────────────────────────────────────────
  const stageRows = (rows: ParsedStatementRow[], skipped: number) => {
    // COUNT-AWARE duplicate matching: N existing ledger rows flag at most N
    // staged rows. A plain membership check would flag BOTH of two distinct
    // ₹500 spends on one day because a single ₹500 entry already exists —
    // silently dropping the second, real transaction.
    const counts = new Map<string, number>();
    for (const t of transactions) {
      if (t.account !== accountId) continue;
      const k = dupKey(t.date, t.amount, t.account, t.type);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const next: StagedRow[] = rows.map((r) => {
      const category = clampCategory(r.suggestedCategory, r.suggestedType);
      const k = dupKey(r.dateISO, r.amount, accountId, r.suggestedType);
      const remaining = counts.get(k) ?? 0;
      if (remaining > 0) counts.set(k, remaining - 1);
      const dup = remaining > 0;
      return {
        key: r.sourceIndex,
        dateISO: r.dateISO,
        rawDate: r.rawDate,
        narration: r.narration,
        cleanedNarration: r.cleanedNarration,
        amount: r.amount,
        direction: r.direction,
        refNo: r.refNo,
        type: r.suggestedType,
        category,
        isDuplicate: dup,
        // Likely-duplicates start unticked so a re-uploaded statement can't
        // silently double the ledger; one click re-includes any of them.
        selected: !dup,
      };
    });
    setStaged(next);
    setSkippedRows(skipped);
    setStep("review");
  };

  // ── File intake ────────────────────────────────────────────────────────────
  const handleFile = async (file: File | undefined | null) => {
    if (!file) return;
    if (!/\.(csv|txt)$/i.test(file.name) && !file.type.includes("csv") && !file.type.includes("text")) {
      toast.error("That doesn't look like a CSV file");
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
    const result = parseStatementCsv(text);
    if (result.status === "error") {
      toast.error(result.reason);
      return;
    }
    if (result.status === "needs-mapping") {
      setMapCtx(result);
      setStep("map");
      return;
    }
    // Keep the grid around so "Re-map columns" stays available from the
    // review step — auto-detection can succeed while still picking a wrong
    // column (or dropping one side of a split), and the user needs a way
    // back that isn't abandoning the whole import.
    setMapCtx({
      headers: result.headers.map((h, i) => h || `Column ${i + 1}`),
      headerRowIndex: result.headerRowIndex,
      grid: result.grid,
      reason: "Re-map the columns if auto-detection got something wrong, then re-stage the file.",
    });
    stageRows(result.rows, result.skippedRows);
  };

  const applyManualMapping = () => {
    if (!mapCtx) return;
    if (!mapDate || !mapNarration || !mapAmount) {
      toast.error("Map the Date, Description and Amount columns first");
      return;
    }
    const mapping: ColumnMapping =
      mapCredit !== "none"
        ? {
            date: Number(mapDate),
            narration: Number(mapNarration),
            debit: Number(mapAmount),
            credit: Number(mapCredit),
          }
        : {
            date: Number(mapDate),
            narration: Number(mapNarration),
            amount: Number(mapAmount),
            drcr: mapDrCr !== "none" ? Number(mapDrCr) : undefined,
          };
    // "No header row": extraction starts at row 0 instead of headerRowIndex+1
    // — otherwise the guessed "header" (a real transaction) and everything
    // above it would silently never import.
    const { rows, skippedRows: skipped } = applyMapping(
      mapCtx.grid,
      noHeader ? -1 : mapCtx.headerRowIndex,
      mapping,
    );
    if (rows.length === 0) {
      toast.error("No parsable transactions with that mapping — check the column choices");
      return;
    }
    stageRows(rows, skipped);
  };

  // ── Review derivations ─────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return staged.filter((r) => {
      if (s && !r.cleanedNarration.toLowerCase().includes(s) && !r.narration.toLowerCase().includes(s)) {
        return false;
      }
      if (dupFilter === "new") return !r.isDuplicate;
      if (dupFilter === "dup") return r.isDuplicate;
      return true;
    });
  }, [staged, q, dupFilter]);

  const selectedRows = useMemo(() => staged.filter((r) => r.selected), [staged]);
  const dupCount = useMemo(() => staged.filter((r) => r.isDuplicate).length, [staged]);
  const outflowTotal = selectedRows.filter((r) => r.direction === "debit").reduce((s, r) => s + r.amount, 0);
  const inflowTotal = selectedRows.filter((r) => r.direction === "credit").reduce((s, r) => s + r.amount, 0);
  const allFilteredSelected = filtered.length > 0 && filtered.every((r) => r.selected);
  // Single-signed-amount statements with no Dr/Cr info parse every unsigned
  // row as credit — a card export full of charges would import as all-income.
  // Can't be fixed blind, but it CAN be surfaced.
  const allOneDirection =
    staged.length >= 5 && staged.every((r) => r.direction === staged[0].direction);

  const patchRow = (key: number, patch: Partial<StagedRow>) =>
    setStaged((s) => s.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  // Flip a mis-detected row's direction in place: type follows direction, the
  // category suggestion re-runs for the new side, and the duplicate flag is
  // rechecked (dup identity includes type).
  const flipDirection = (row: StagedRow) => {
    const direction = row.direction === "debit" ? "credit" : "debit";
    const type: TxType = direction === "debit" ? "expense" : "income";
    const { category } = categorizeNarration(row.narration, direction);
    patchRow(row.key, {
      direction,
      type,
      category: clampCategory(category, type),
      isDuplicate: existingKeySet.has(dupKey(row.dateISO, row.amount, accountId, type)),
    });
  };

  const toggleAllFiltered = () => {
    const target = !allFilteredSelected;
    const keys = new Set(filtered.map((r) => r.key));
    setStaged((s) => s.map((r) => (keys.has(r.key) ? { ...r, selected: target } : r)));
  };

  const deselectDuplicates = () =>
    setStaged((s) => s.map((r) => (r.isDuplicate ? { ...r, selected: false } : r)));

  // Bulk category values are group-prefixed ("expense:Dining" / "income:Salary")
  // because "Other" exists on both sides — the bare string is ambiguous. Scope:
  // selected rows WITHIN THE CURRENT FILTER whose type matches the group —
  // the user is looking at the filtered grid, so acting on hidden rows (the
  // whole file starts selected) would rewrite hundreds of categories unseen.
  const applyBulkCategory = (value: string) => {
    const [type, ...rest] = value.split(":");
    const category = rest.join(":");
    if (type !== "income" && type !== "expense") return;
    // Resolve the target set BEFORE setState — the updater runs at render
    // time, so counting inside it would report 0 to the toast.
    const targets = new Set(
      filtered.filter((r) => r.selected && r.type === type).map((r) => r.key),
    );
    if (targets.size === 0) {
      toast.error(`No selected ${type} rows in the current view`);
      return;
    }
    setStaged((s) => s.map((r) => (targets.has(r.key) ? { ...r, category } : r)));
    toast.success(`Category "${category}" applied to ${targets.size} ${type} row${targets.size !== 1 ? "s" : ""} in view`);
  };

  // ── Import ─────────────────────────────────────────────────────────────────
  const runImport = async () => {
    if (selectedRows.length === 0) {
      toast.error("Select at least one transaction");
      return;
    }
    if (!accountId) {
      toast.error("Pick a target account first");
      return;
    }
    setImporting(true);
    // Yield one frame so the spinner paints before the (synchronous) batch
    // state update lands.
    await new Promise((r) => setTimeout(r, 60));
    const txs: Omit<Transaction, "id">[] = selectedRows.map((r) => {
      // Truncate the narration, never the ref — appending before slicing
      // would drop the reference number exactly on the long UPI/NEFT
      // narrations where it matters most.
      const refSuffix = r.refNo ? ` · Ref ${r.refNo}` : "";
      return {
        date: r.dateISO,
        type: r.type,
        category: r.category,
        account: accountId,
        amount: r.amount,
        tags: ["imported"],
        notes: `${r.cleanedNarration.slice(0, Math.max(0, NOTES_MAX - refSuffix.length))}${refSuffix}`,
      };
    });
    addTransactions(txs);
    setImporting(false);
    toast.success(`Imported ${txs.length} transaction${txs.length !== 1 ? "s" : ""} into ${accountLabel(accountId)}`);
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
            <FileSpreadsheet className="size-4 text-primary" /> Import bank statement
          </DialogTitle>
          <DialogDescription className="flex items-center gap-2 flex-wrap">
            <span>
              Stage, review and tag transactions from a CSV export. Imported rows sync to your
              ledger exactly like manual entries.
            </span>
            {/* Scoped to what's true: PARSING is fully local — the file never
                uploads anywhere. Rows the user imports sync like any manual
                entry, so "zero data sent to servers" would be a false promise. */}
            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border border-[oklch(0.72_0.18_155_/_0.35)] text-[oklch(0.78_0.16_155)]">
              🛡️ Parsed 100% on-device — your file never leaves this browser
            </span>
          </DialogDescription>
        </DialogHeader>

        {/* ── Step A: dropzone ─────────────────────────────────────────────── */}
        {step === "drop" && (
          <div className="px-6 py-6 space-y-5 overflow-y-auto">
            <div>
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Statement belongs to
              </Label>
              {accountModes.length === 0 ? (
                <p className="text-sm text-muted-foreground mt-2">
                  No accounts configured yet — add one in Settings first.
                </p>
              ) : (
                <Select value={accountId} onValueChange={(v: PaymentMode) => setAccountId(v)}>
                  <SelectTrigger className="bg-input/40 border-glass-border mt-1.5">
                    <SelectValue placeholder="Pick an account" />
                  </SelectTrigger>
                  <SelectContent>
                    {accountModes.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {accountLabel(a.id)}
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
              className={`w-full rounded-2xl border-2 border-dashed p-10 flex flex-col items-center gap-3 transition-all ${
                dragging
                  ? "border-primary bg-primary/10 shadow-[0_0_40px_-8px_oklch(0.72_0.18_155)] animate-pulse"
                  : "border-glass-border hover:border-primary/40 hover:bg-white/[0.03]"
              }`}
            >
              <UploadCloud className={`size-10 ${dragging ? "text-primary" : "text-muted-foreground"}`} />
              <div className="text-center">
                <p className="text-sm font-medium">
                  {dragging ? "Drop it here" : "Drag & drop your CSV statement"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  or click to browse · HDFC, ICICI, SBI, Axis & most Indian bank/card exports
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
                e.target.value = ""; // allow re-picking the same file
              }}
            />

            <div className="space-y-1.5">
              <p className="text-[11px] text-muted-foreground">Get your statement from:</p>
              <div className="flex flex-wrap gap-1.5">
                {STATEMENT_HELPER_LINKS.map((l) => (
                  <HelperLinkPill key={l.url} {...l} />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Step B: manual column mapper ─────────────────────────────────── */}
        {step === "map" && mapCtx && (
          <div className="px-6 py-6 space-y-4 overflow-y-auto">
            <p className="text-sm text-muted-foreground">{mapCtx.reason}</p>
            {(() => {
              // With "no header" the labels ARE data — show samples instead
              // of pretending a transaction row is a set of column names.
              const columnLabels = mapCtx.headers.map((h, i) =>
                noHeader
                  ? `Column ${i + 1} · "${(mapCtx.grid[0]?.[i] ?? "").trim().slice(0, 18)}"`
                  : h,
              );
              return (
                <div className="grid sm:grid-cols-2 gap-3">
                  <MapField label="Date column" value={mapDate} onChange={setMapDate} headers={columnLabels} />
                  <MapField label="Description column" value={mapNarration} onChange={setMapNarration} headers={columnLabels} />
                  <MapField
                    label="Amount column (signed, or Debit)"
                    value={mapAmount}
                    onChange={setMapAmount}
                    headers={columnLabels}
                  />
                  <div>
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Credit column (only if separate)
                    </Label>
                    <Select value={mapCredit} onValueChange={setMapCredit}>
                      <SelectTrigger className="bg-input/40 border-glass-border mt-1.5">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">— single amount column —</SelectItem>
                        {columnLabels.map((h, i) => (
                          <SelectItem key={i} value={String(i)}>
                            {h}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {mapCredit === "none" && (
                    <div>
                      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        Dr/Cr type column (optional)
                      </Label>
                      <Select value={mapDrCr} onValueChange={setMapDrCr}>
                        <SelectTrigger className="bg-input/40 border-glass-border mt-1.5">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">— amounts carry their own sign —</SelectItem>
                          {columnLabels.map((h, i) => (
                            <SelectItem key={i} value={String(i)}>
                              {h}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              );
            })()}
            <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={noHeader}
                onChange={(e) => setNoHeader(e.target.checked)}
                className="accent-[oklch(0.72_0.18_155)]"
              />
              This file has no header row (the first line is already a transaction)
            </label>
            <div className="flex justify-between pt-2">
              <Button
                variant="outline"
                className="border-glass-border"
                onClick={() => (staged.length > 0 ? setStep("review") : resetAll())}
              >
                Back
              </Button>
              <Button
                onClick={applyManualMapping}
                className="gradient-primary text-primary-foreground border-0"
              >
                Continue to review
              </Button>
            </div>
          </div>
        )}

        {/* ── Step C: staging grid ─────────────────────────────────────────── */}
        {step === "review" && (
          <>
            <div className="px-6 py-4 space-y-3 border-b border-glass-border shrink-0">
              {/* Summary bar */}
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
                <SummaryStat label="Rows" value={String(staged.length)} />
                <SummaryStat label="Selected" value={String(selectedRows.length)} tone="text-primary" />
                <SummaryStat
                  label="New spends"
                  value={inr(outflowTotal)}
                  tone={ROSE}
                  sensitive
                />
                <SummaryStat label="Inflow" value={inr(inflowTotal)} tone={EMERALD} sensitive />
                <SummaryStat
                  label="Duplicates"
                  value={String(dupCount)}
                  tone={dupCount > 0 ? AMBER : undefined}
                />
                {skippedRows > 0 && (
                  <SummaryStat label="Skipped lines" value={String(skippedRows)} />
                )}
                <span className="text-muted-foreground ml-auto truncate max-w-[16rem]" title={fileName}>
                  {fileName} → {accountLabel(accountId)}
                </span>
              </div>

              {allOneDirection && (
                <p className={`flex items-start gap-1.5 text-[11px] ${AMBER}`}>
                  <TriangleAlert className="size-3.5 shrink-0 mt-0.5" />
                  Every row parsed as {staged[0].direction === "credit" ? "an inflow" : "an outflow"}.
                  Card statements often list charges unsigned — if directions look wrong, click any
                  amount to flip that row, or use "Re-map columns" to pick a Dr/Cr column.
                </p>
              )}

              {/* Search / filter / bulk actions */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[10rem]">
                  <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search merchant…"
                    className="pl-8 h-8 text-sm bg-input/40 border-glass-border"
                  />
                </div>
                <div className="inline-flex items-center gap-1 p-0.5 rounded-lg glass">
                  {(
                    [
                      { key: "all", label: "All" },
                      { key: "new", label: "New" },
                      { key: "dup", label: "Duplicates" },
                    ] as const
                  ).map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => setDupFilter(f.key)}
                      className={`px-2.5 py-1 rounded-md text-xs transition-colors ${
                        dupFilter === f.key
                          ? "bg-white/[0.08] text-foreground font-medium"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 border-glass-border gap-1.5"
                  onClick={toggleAllFiltered}
                >
                  {allFilteredSelected ? <CheckSquare className="size-3.5" /> : <Square className="size-3.5" />}
                  {allFilteredSelected ? "Deselect all" : "Select all"}
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
                {mapCtx && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 border-glass-border gap-1.5"
                    onClick={() => setStep("map")}
                    title="Go back and pick the columns by hand — re-staging replaces this grid"
                  >
                    <Columns3 className="size-3.5" /> Re-map columns
                  </Button>
                )}
                <Select value="" onValueChange={applyBulkCategory}>
                  <SelectTrigger className="h-8 w-40 text-xs bg-input/40 border-glass-border">
                    <SelectValue placeholder="Bulk set category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        Expense
                      </SelectLabel>
                      {expenseCategories.map((c) => (
                        <SelectItem key={`expense:${c}`} value={`expense:${c}`}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                    <SelectGroup>
                      <SelectLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        Income
                      </SelectLabel>
                      {incomeCategories.map((c) => (
                        <SelectItem key={`income:${c}`} value={`income:${c}`}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Row grid */}
            <div className="flex-1 overflow-y-auto px-6 py-3">
              {rendered.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground py-10">
                  No rows match the current search/filter.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {rendered.map((r) => {
                    const dup = r.isDuplicate;
                    const rowCategories = r.type === "income" ? incomeCategories : expenseCategories;
                    return (
                      <li
                        key={r.key}
                        className={`flex items-center gap-3 px-3 py-2 rounded-xl border transition-colors ${
                          r.selected
                            ? "border-glass-border bg-white/[0.04]"
                            : "border-glass-border/50 opacity-60"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => patchRow(r.key, { selected: !r.selected })}
                          className={`shrink-0 ${r.selected ? "text-primary" : "text-muted-foreground"}`}
                          aria-label={r.selected ? "Deselect row" : "Select row"}
                        >
                          {r.selected ? <CheckSquare className="size-4" /> : <Square className="size-4" />}
                        </button>
                        <span className="tnum text-xs text-muted-foreground shrink-0 w-20" title={r.rawDate}>
                          {fmtDate(r.dateISO).slice(0, 6)}
                        </span>
                        <span className="text-sm truncate flex-1 min-w-0" title={r.narration}>
                          {r.cleanedNarration}
                        </span>
                        {dup && (
                          <span
                            className={`shrink-0 inline-flex items-center gap-1 text-[9px] font-semibold tracking-wider px-1.5 py-0.5 rounded-md border border-[oklch(0.78_0.14_80_/_0.4)] ${AMBER}`}
                            title="A ledger entry with the same date, amount and account already exists"
                          >
                            <TriangleAlert className="size-2.5" /> DUP
                          </span>
                        )}
                        <Select
                          value={r.category}
                          onValueChange={(v) => patchRow(r.key, { category: v })}
                        >
                          <SelectTrigger className="h-7 w-32 text-xs bg-input/40 border-glass-border shrink-0">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {rowCategories.map((c) => (
                              <SelectItem key={c} value={c}>
                                {c}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <button
                          type="button"
                          onClick={() => flipDirection(r)}
                          title="Click to flip between inflow and outflow"
                          className={`tnum text-sm font-semibold shrink-0 w-24 text-right rounded-md px-1 -mx-1 hover:bg-white/[0.06] transition-colors ${
                            r.direction === "credit" ? EMERALD : ROSE
                          }`}
                        >
                          <Sensitive>
                            {r.direction === "credit" ? "+" : "−"}
                            {inr(r.amount)}
                          </Sensitive>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {filtered.length > ROW_RENDER_CAP && (
                <p className="text-center text-xs text-muted-foreground py-3">
                  Showing first {ROW_RENDER_CAP} of {filtered.length} matching rows — refine the
                  search to see the rest. Selection and bulk actions still apply to all of them.
                </p>
              )}
            </div>

            {/* Sticky footer */}
            <div className="px-6 py-4 border-t border-glass-border flex items-center justify-between gap-3 shrink-0">
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
                onClick={() => void runImport()}
                disabled={importing || selectedRows.length === 0}
                className="gradient-primary text-primary-foreground border-0 gap-2 glow"
              >
                {importing ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <FileSpreadsheet className="size-4" />
                )}
                Import {selectedRows.length} selected transaction{selectedRows.length !== 1 ? "s" : ""}
              </Button>
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
