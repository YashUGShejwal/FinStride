/**
 * Manual full-edit modal for a single Trade (open or closed) — the escape
 * hatch for correcting anything the import/close flows got wrong or
 * couldn't know: a typo'd quantity, backfilling F&O contract details by
 * hand, reclassifying a mis-paired long/short, or just fixing a broker's own
 * P&L figure. Reachable from the Edit (✏️) button on every trade card,
 * equity or F&O, open or closed.
 *
 * A single persistent instance (same convention as TradeImportModal) rather
 * than one dialog per card — its form state is re-seeded from the `trade`
 * prop via an effect keyed on `trade?.id`, so switching which trade is being
 * edited resyncs every field without remounting (which would kill the
 * open/close animation, unlike a key-based remount).
 *
 * Realized P&L auto-recalculates from Entry/Exit price + Qty + Side (and
 * Charges) whenever any of THOSE change, net of charges and respecting
 * direction — SHORT profits when price drops, LONG when it rises. The field
 * stays directly editable too: typing into it doesn't retrigger the
 * recalculation (it isn't one of the effect's own dependencies), so a
 * deliberate manual override is never immediately clobbered back. ROI is
 * always a pure display derivation from entry/qty/pnl — not stored.
 */

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useStore, type Trade, type TradeDirection, type TradeStatus } from "@/lib/store";
import { inr } from "@/lib/format";
import { Sensitive } from "@/components/Sensitive";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

/** ISO instant -> the "YYYY-MM-DD" an <input type="date"> wants. Only the calendar day matters here — see the file doc comment on why round-tripping through this input necessarily drops any time-of-day precision an imported trade's entryDate/exitDate might carry. */
const toDateInputValue = (iso?: string): string => (iso ? iso.slice(0, 10) : "");

const EMERALD = "text-[oklch(0.78_0.16_155)]";
const ROSE = "text-[oklch(0.78_0.18_25)]";

export function EditTradeModal({
  trade,
  open,
  onOpenChange,
}: {
  /** null when nothing is currently selected for editing — the Dialog stays closed via `open`, this just avoids the parent needing a separate guard. */
  trade: Trade | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { updateTrade } = useStore();

  const [ticker, setTicker] = useState("");
  const [side, setSide] = useState<TradeDirection>("LONG");
  const [status, setStatus] = useState<TradeStatus>("open");
  const [entryDate, setEntryDate] = useState("");
  const [entryPrice, setEntryPrice] = useState("");
  const [exitDate, setExitDate] = useState("");
  const [exitPrice, setExitPrice] = useState("");
  const [qty, setQty] = useState("");
  const [target, setTarget] = useState("");
  const [stop, setStop] = useState("");
  const [pnl, setPnl] = useState("");
  const [charges, setCharges] = useState("");
  const [notes, setNotes] = useState("");
  const [expiry, setExpiry] = useState("");
  const [strike, setStrike] = useState("");
  const [lotSize, setLotSize] = useState("");

  // Re-seed every field whenever a DIFFERENT trade is loaded for editing —
  // not on every render, and not on `open` alone (closing shouldn't wipe the
  // fields mid-close-animation before the dialog has fully hidden).
  useEffect(() => {
    if (!trade) return;
    setTicker(trade.ticker);
    setSide(trade.direction);
    setStatus(trade.status);
    setEntryDate(toDateInputValue(trade.entryDate));
    setEntryPrice(String(trade.entryPrice));
    setExitDate(toDateInputValue(trade.exitDate));
    setExitPrice(trade.exitPrice !== undefined ? String(trade.exitPrice) : "");
    setQty(String(trade.qty));
    setTarget(String(trade.targetPrice));
    setStop(String(trade.stopLoss));
    setPnl(
      trade.netPnl !== undefined
        ? String(trade.netPnl)
        : trade.pnl !== undefined
          ? String(trade.pnl)
          : "",
    );
    setCharges(trade.charges !== undefined ? String(trade.charges) : "");
    setNotes(trade.notes ?? "");
    setExpiry(trade.expiry ?? "");
    setStrike(trade.strike !== undefined ? String(trade.strike) : "");
    setLotSize(trade.lotSize !== undefined ? String(trade.lotSize) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trade?.id]);

  // Auto-recalculate whenever an input the P&L formula actually depends on
  // changes. `pnl` itself is deliberately NOT a dependency — editing it
  // directly must never immediately get overwritten by this effect.
  useEffect(() => {
    const e = Number(entryPrice);
    const x = Number(exitPrice);
    const q = Number(qty);
    if (!(e > 0) || !(x > 0) || !(q > 0)) return;
    const gross = side === "LONG" ? (x - e) * q : (e - x) * q;
    const ch = Number(charges) || 0;
    setPnl((gross - ch).toFixed(2));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryPrice, exitPrice, qty, side, charges]);

  const entryNum = Number(entryPrice);
  const qtyNum = Number(qty);
  const pnlNum = pnl !== "" ? Number(pnl) : null;
  const roiPct = entryNum > 0 && qtyNum > 0 && pnlNum !== null ? pnlNum / (entryNum * qtyNum) : null;

  const handleSave = () => {
    if (!trade) return;
    const trimmedTicker = ticker.trim().toUpperCase();
    const entry = Number(entryPrice);
    const q = Number(qty);
    if (!trimmedTicker || !(entry > 0) || !(q > 0)) {
      toast.error("Symbol, entry price, and quantity are required");
      return;
    }
    const isClosed = status === "closed";
    const updates: Partial<Trade> = {
      ticker: trimmedTicker,
      direction: side,
      status,
      entryDate: entryDate ? new Date(entryDate).toISOString() : trade.entryDate,
      entryPrice: entry,
      qty: q,
      targetPrice: Number(target) || 0,
      stopLoss: Number(stop) || 0,
      notes: notes.trim() || undefined,
      charges: charges !== "" ? Number(charges) : undefined,
      expiry: expiry.trim() || undefined,
      strike: strike !== "" ? Number(strike) : undefined,
      lotSize: lotSize !== "" ? Number(lotSize) : undefined,
      exitDate: isClosed && exitDate ? new Date(exitDate).toISOString() : undefined,
      exitPrice: isClosed && exitPrice !== "" ? Number(exitPrice) : undefined,
      pnl: isClosed && pnl !== "" ? Number(pnl) : undefined,
      netPnl: isClosed && pnl !== "" ? Number(pnl) : undefined,
      // Preserve whatever exit-outcome classification the trade already has
      // (e.g. "target" or "tradebook_sync" from an earlier auto-close) —
      // only default to "manual" the FIRST time this modal is what closes
      // it, never overwrite a real classification just because someone
      // opened this form to tweak an unrelated field.
      exitReason: isClosed ? (trade.exitReason ?? "manual") : undefined,
      closeReason: isClosed ? (trade.closeReason ?? "other") : undefined,
    };
    updateTrade(trade.id, updates);
    toast.success("Trade updated");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-strong border-glass-border sm:max-w-2xl w-[calc(100vw-2rem)] max-h-[88vh] flex flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-glass-border shrink-0">
          <DialogTitle className="font-display tracking-tight">Edit trade</DialogTitle>
          <DialogDescription>
            Full manual control — corrects anything the import or close flows got wrong.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-5 space-y-4 overflow-y-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <EField className="col-span-2 md:col-span-1" label="Symbol">
              <Input
                value={ticker}
                onChange={(e) => setTicker(e.target.value)}
                className="bg-input/40 border-glass-border uppercase tracking-wider"
              />
            </EField>
            <EField label="Side">
              <Select value={side} onValueChange={(v: TradeDirection) => setSide(v)}>
                <SelectTrigger className="bg-input/40 border-glass-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="LONG">LONG</SelectItem>
                  <SelectItem value="SHORT">SHORT</SelectItem>
                </SelectContent>
              </Select>
            </EField>
            <EField label="Status">
              <Select value={status} onValueChange={(v: TradeStatus) => setStatus(v)}>
                <SelectTrigger className="bg-input/40 border-glass-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                </SelectContent>
              </Select>
            </EField>
            <EField label="Quantity">
              <Input
                type="number"
                min="0"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                className="bg-input/40 border-glass-border tnum"
              />
            </EField>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <EField label="Entry Date">
              <Input
                type="date"
                value={entryDate}
                onChange={(e) => setEntryDate(e.target.value)}
                className="bg-input/40 border-glass-border"
              />
            </EField>
            <EField label="Entry Price (₹)">
              <Input
                type="number"
                step="0.05"
                value={entryPrice}
                onChange={(e) => setEntryPrice(e.target.value)}
                className="bg-input/40 border-glass-border tnum"
              />
            </EField>
            <EField label="Exit Date">
              <Input
                type="date"
                value={exitDate}
                onChange={(e) => setExitDate(e.target.value)}
                disabled={status !== "closed"}
                className="bg-input/40 border-glass-border disabled:opacity-40"
              />
            </EField>
            <EField label="Exit Price (₹)">
              <Input
                type="number"
                step="0.05"
                value={exitPrice}
                onChange={(e) => setExitPrice(e.target.value)}
                disabled={status !== "closed"}
                className="bg-input/40 border-glass-border tnum disabled:opacity-40"
              />
            </EField>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <EField label="Target (₹)">
              <Input
                type="number"
                step="0.05"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                className="bg-input/40 border-glass-border tnum"
              />
            </EField>
            <EField label="Stop Loss (₹)">
              <Input
                type="number"
                step="0.05"
                value={stop}
                onChange={(e) => setStop(e.target.value)}
                className="bg-input/40 border-glass-border tnum"
              />
            </EField>
            <EField label="Realized P&L (₹)">
              <Input
                type="number"
                step="0.01"
                value={pnl}
                onChange={(e) => setPnl(e.target.value)}
                disabled={status !== "closed"}
                className="bg-input/40 border-glass-border tnum disabled:opacity-40"
                placeholder="Auto from entry/exit"
              />
            </EField>
            <EField label="Charges (₹)">
              <Input
                type="number"
                step="0.01"
                min="0"
                value={charges}
                onChange={(e) => setCharges(e.target.value)}
                className="bg-input/40 border-glass-border tnum"
              />
            </EField>
          </div>

          {status === "closed" && roiPct !== null && (
            <p className="text-xs text-muted-foreground">
              ROI at these numbers:{" "}
              <Sensitive>
                <span className={`tnum font-semibold ${roiPct >= 0 ? EMERALD : ROSE}`}>
                  {roiPct >= 0 ? "+" : ""}
                  {(roiPct * 100).toFixed(1)}%
                </span>
              </Sensitive>{" "}
              on <Sensitive>{inr(entryNum * qtyNum)}</Sensitive> deployed.
            </p>
          )}

          <div>
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              F&O details (optional — leave blank for equity)
            </Label>
            <div className="grid grid-cols-3 gap-3 mt-1.5">
              <Input
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
                placeholder="Expiry"
                className="bg-input/40 border-glass-border"
              />
              <Input
                type="number"
                value={strike}
                onChange={(e) => setStrike(e.target.value)}
                placeholder="Strike"
                className="bg-input/40 border-glass-border tnum"
              />
              <Input
                type="number"
                value={lotSize}
                onChange={(e) => setLotSize(e.target.value)}
                placeholder="Lot size"
                className="bg-input/40 border-glass-border tnum"
              />
            </div>
          </div>

          <EField label="Notes">
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="bg-input/40 border-glass-border text-sm min-h-[60px]"
            />
          </EField>
        </div>

        <div className="px-6 py-4 border-t border-glass-border shrink-0 flex items-center justify-between gap-3">
          <Button type="button" variant="outline" className="border-glass-border" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            className="gradient-primary text-primary-foreground border-0 gap-2 glow"
          >
            Save changes
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EField({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</Label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
