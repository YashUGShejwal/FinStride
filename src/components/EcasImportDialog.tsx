/**
 * eCAS (CDSL/NSDL Consolidated Account Statement) PDF import — decrypt,
 * detect holdings, map each to a brokerPartition, commit as one batch of
 * portfolio snapshots (Track 3.2).
 *
 * The parser (src/lib/parsers/ecasParser.ts) is pulled in via a DYNAMIC
 * import inside the submit handler, never a static top-level import here.
 * Two independent reasons: pdfjs-dist is a large, worker-dependent library
 * that most sessions never touch (most users won't import an eCAS the
 * moment the analytics page loads), and — more importantly — this app is
 * server-rendered (TanStack Start), and pdf.js has no SSR-safe entry this
 * app relies on. A static import would put it on the path the server
 * bundle has to resolve; a dynamic import confines it to a lazy chunk that
 * only ever loads from this component's own client-side event handler.
 */

import { useMemo, useRef, useState } from "react";
import {
  CheckSquare, Eye, EyeOff, FileLock2, Loader2, Lock, Square, TriangleAlert, UploadCloud,
} from "lucide-react";
import { toast } from "sonner";
import { useStore, type BrokerPartition, type PartitionId } from "@/lib/store";
import type { EcasHolding, EcasHoldingCategory } from "@/lib/parsers/ecasParser";
import { inr, pinToNoonUTC, todayLocalISO } from "@/lib/format";
import { Sensitive } from "@/components/Sensitive";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

type Step = "upload" | "review";

type StagedHolding = EcasHolding & {
  key: number;
  selected: boolean;
  partitionId: PartitionId;
};

const EMERALD = "text-[oklch(0.78_0.16_155)]";
const AMBER = "text-[oklch(0.82_0.13_80)]";

/** First brokerPartition matching the holding's category, else the first partition overall. */
function defaultPartitionFor(category: EcasHoldingCategory, brokerPartitions: BrokerPartition[]): PartitionId {
  return (brokerPartitions.find((p) => p.category === category) ?? brokerPartitions[0])?.id ?? "";
}

export function EcasImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { brokerPartitions, partitionLabel, portfolioSnapshots, addPortfolioSnapshots } = useStore();

  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [rawPreview, setRawPreview] = useState("");
  const [showRawPreview, setShowRawPreview] = useState(false);

  const [statementDate, setStatementDate] = useState(todayLocalISO());
  const [staged, setStaged] = useState<StagedHolding[]>([]);
  const [committing, setCommitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetAll = () => {
    setStep("upload");
    setFile(null);
    setPassword("");
    setShowPassword(false);
    setDragging(false);
    setParsing(false);
    setErrorMsg(null);
    setRawPreview("");
    setShowRawPreview(false);
    setStatementDate(todayLocalISO());
    setStaged([]);
    setCommitting(false);
  };

  const pickFile = (f: File | undefined | null) => {
    if (!f) return;
    if (!/\.pdf$/i.test(f.name) && f.type !== "application/pdf") {
      toast.error("That doesn't look like a PDF file");
      return;
    }
    setFile(f);
    setErrorMsg(null);
  };

  // ── Decrypt + parse ────────────────────────────────────────────────────────
  const handleDecrypt = async () => {
    if (parsing) return; // Enter-key + button-click race — avoid overlapping parses
    if (!file) {
      toast.error("Choose your eCAS PDF first");
      return;
    }
    setParsing(true);
    setErrorMsg(null);
    try {
      const buffer = await file.arrayBuffer();
      // Dynamic import — see the file-level doc comment for why this can
      // never become a static import.
      const { parseEcasPdf } = await import("@/lib/parsers/ecasParser");
      const outcome = await parseEcasPdf(buffer, password);

      if (outcome.status === "password-required") {
        setErrorMsg("This PDF is password-protected — enter the password above.");
        return;
      }
      if (outcome.status === "wrong-password") {
        setErrorMsg("That password didn't unlock the file — check the PAN/DOB format and try again.");
        return;
      }
      if (outcome.status === "error") {
        setErrorMsg(outcome.reason);
        return;
      }

      setRawPreview(outcome.rawTextPreview ?? "");
      setStatementDate(outcome.statementDate || todayLocalISO());
      setStaged(
        outcome.holdings.map((h, i) => ({
          ...h,
          key: i,
          selected: true,
          partitionId: defaultPartitionFor(h.category, brokerPartitions),
        })),
      );
      setStep("review");
    } catch {
      setErrorMsg("Couldn't process this PDF — it may be corrupted or in an unsupported format.");
    } finally {
      setParsing(false);
    }
  };

  // ── Review derivations ─────────────────────────────────────────────────────
  const pinnedDate = useMemo(() => pinToNoonUTC(statementDate), [statementDate]);
  const willUpdate = (partitionId: PartitionId) =>
    portfolioSnapshots.some((s) => s.brokerPartition === partitionId && s.snapshotDate === pinnedDate);

  const selectedRows = staged.filter((r) => r.selected);
  const selectedTotal = selectedRows.reduce((s, r) => s + r.amount, 0);

  const patchRow = (key: number, patch: Partial<StagedHolding>) =>
    setStaged((s) => s.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  // ── Commit ─────────────────────────────────────────────────────────────────
  const handleCommit = async () => {
    if (!statementDate) {
      toast.error("Pick a statement date first");
      return;
    }
    if (selectedRows.length === 0) {
      toast.error("Select at least one holding to record");
      return;
    }
    setCommitting(true);
    await new Promise((r) => setTimeout(r, 60)); // let the spinner paint before the sync batch write
    addPortfolioSnapshots(
      selectedRows.map((r) => ({ brokerPartition: r.partitionId, currentValue: r.amount })),
      "Imported from eCAS PDF",
      pinnedDate,
    );
    setCommitting(false);
    toast.success(
      `Recorded ${selectedRows.length} snapshot${selectedRows.length !== 1 ? "s" : ""} from your eCAS statement`,
    );
    onOpenChange(false);
    resetAll();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) resetAll();
      }}
    >
      <DialogContent className="glass-strong border-glass-border sm:max-w-2xl w-[calc(100vw-2rem)] max-h-[88vh] flex flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-glass-border shrink-0">
          <DialogTitle className="font-display tracking-tight flex items-center gap-2">
            <FileLock2 className="size-4 text-primary" /> Import eCAS statement
          </DialogTitle>
          <DialogDescription>
            Decrypt your CDSL/NSDL Consolidated Account Statement and record holdings as portfolio
            snapshots.
          </DialogDescription>
        </DialogHeader>

        {/* ── Step 1: upload & password ────────────────────────────────────── */}
        {step === "upload" && (
          <div className="px-6 py-6 space-y-5 overflow-y-auto">
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
                pickFile(e.dataTransfer.files?.[0]);
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
                  {file ? file.name : dragging ? "Drop it here" : "Drag & drop your eCAS PDF"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {file ? "Click to choose a different file" : "or click to browse — from CDSL, NSDL, or your broker's app"}
                </p>
              </div>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,application/pdf"
              className="hidden"
              onChange={(e) => {
                pickFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />

            <div>
              <Label htmlFor="ecas-pw" className="text-[10px] uppercase tracking-wider text-muted-foreground">
                PDF Password
              </Label>
              <div className="relative mt-1.5">
                <Lock className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="ecas-pw"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), void handleDecrypt())}
                  className="pl-9 pr-10 bg-input/40 border-glass-border"
                  placeholder="••••••••"
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1.5">
                Usually your PAN in UPPERCASE, or your date of birth as DDMMYYYY.
              </p>
            </div>

            {errorMsg && (
              <p className={`flex items-start gap-1.5 text-xs ${AMBER}`}>
                <TriangleAlert className="size-3.5 shrink-0 mt-0.5" /> {errorMsg}
              </p>
            )}

            <p className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider px-2.5 py-1 rounded-full border border-[oklch(0.72_0.18_155_/_0.35)] text-[oklch(0.78_0.16_155)]">
              🛡️ 100% client-side decryption — runs in your browser's memory; the PDF and password
              never leave this device
            </p>

            <div className="flex justify-between pt-1">
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
                onClick={() => void handleDecrypt()}
                disabled={!file || parsing}
                className="gradient-primary text-primary-foreground border-0 gap-2"
              >
                {parsing ? <Loader2 className="size-4 animate-spin" /> : <FileLock2 className="size-4" />}
                Decrypt &amp; continue
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 2: mapping & review ──────────────────────────────────────── */}
        {step === "review" && (
          <>
            <div className="px-6 py-4 space-y-3 border-b border-glass-border shrink-0">
              <div>
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Statement date
                </Label>
                <Input
                  type="date"
                  value={statementDate}
                  onChange={(e) => setStatementDate(e.target.value)}
                  className="bg-input/40 border-glass-border mt-1.5 max-w-[12rem]"
                />
                {!statementDate && (
                  <p className={`text-[11px] mt-1 ${AMBER}`}>Couldn't detect a date — pick one above.</p>
                )}
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  {staged.length} holding{staged.length !== 1 ? "s" : ""} detected ·{" "}
                  {selectedRows.length} selected
                </span>
                <span className={`tnum font-semibold ${EMERALD}`}>
                  <Sensitive>{inr(selectedTotal)}</Sensitive>
                </span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-3">
              {staged.length === 0 ? (
                <div className="text-center py-8 space-y-3">
                  <p className="text-sm text-muted-foreground">
                    No holdings were auto-detected in this statement. Your data model here doesn't
                    change what's in the PDF — you can still add snapshots manually from the values
                    shown in your statement.
                  </p>
                  {rawPreview && (
                    <button
                      type="button"
                      onClick={() => setShowRawPreview((v) => !v)}
                      className="text-xs text-primary underline underline-offset-2"
                    >
                      {showRawPreview ? "Hide" : "Show"} extracted text (for troubleshooting)
                    </button>
                  )}
                  {showRawPreview && (
                    <pre className="text-left text-[10px] leading-relaxed text-muted-foreground bg-white/[0.03] border border-glass-border rounded-xl p-3 max-h-56 overflow-y-auto whitespace-pre-wrap">
                      {rawPreview}
                    </pre>
                  )}
                </div>
              ) : (
                <ul className="space-y-1.5">
                  {staged.map((r) => (
                    <li
                      key={r.key}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-colors ${
                        r.selected ? "border-glass-border bg-white/[0.04]" : "border-glass-border/50 opacity-60"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => patchRow(r.key, { selected: !r.selected })}
                        className={`shrink-0 ${r.selected ? "text-primary" : "text-muted-foreground"}`}
                        aria-label={r.selected ? "Exclude this holding" : "Include this holding"}
                      >
                        {r.selected ? <CheckSquare className="size-4" /> : <Square className="size-4" />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{r.sourceName}</p>
                        {willUpdate(r.partitionId) && (
                          <p className={`text-[10px] ${AMBER}`}>
                            Updates the existing snapshot for {partitionLabel(r.partitionId)} on this date
                          </p>
                        )}
                      </div>
                      <span className="tnum text-sm font-semibold shrink-0">
                        <Sensitive>{inr(r.amount)}</Sensitive>
                      </span>
                      <Select
                        value={r.partitionId}
                        onValueChange={(v: PartitionId) => patchRow(r.key, { partitionId: v })}
                      >
                        <SelectTrigger className="h-8 w-40 text-xs bg-input/40 border-glass-border shrink-0">
                          <SelectValue placeholder="Pick partition" />
                        </SelectTrigger>
                        <SelectContent>
                          {brokerPartitions.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="px-6 py-4 border-t border-glass-border flex items-center justify-between gap-3 shrink-0">
              <Button
                type="button"
                variant="outline"
                className="border-glass-border"
                onClick={() => setStep("upload")}
              >
                Back
              </Button>
              <Button
                type="button"
                onClick={() => void handleCommit()}
                disabled={committing || selectedRows.length === 0 || brokerPartitions.length === 0}
                className="gradient-primary text-primary-foreground border-0 gap-2 glow"
              >
                {committing ? <Loader2 className="size-4 animate-spin" /> : <FileLock2 className="size-4" />}
                Record {selectedRows.length} snapshot{selectedRows.length !== 1 ? "s" : ""}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
