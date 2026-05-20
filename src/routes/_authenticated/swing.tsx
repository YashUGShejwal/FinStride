import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type FormEvent } from "react";
import {
  Plus, Trash2, AlertTriangle, ShieldAlert, TrendingUp, Lock,
  CheckCircle2, XCircle, MinusCircle, ChevronDown, ChevronUp,
  Wallet, Pencil,
} from "lucide-react";
import {
  useStore, BLUEPRINT, INVESTMENT_APPS, PORTFOLIO_PARTITIONS,
  type BrokerPartition, type CloseReason, type PortfolioPartitionKey,
} from "@/lib/store";
import { inr, fmtDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/swing")({ component: SwingPage });

// Blueprint Rule 2 — F&O ban regex (always active)
const FNO_REGEX =
  /\b(CALL|PUT|CE|PE|NIFTY|SENSEX|BANKNIFTY|FINNIFTY)\b|\d{2}(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\d{0,4}(CE|PE)?/i;

const CLOSE_REASONS: {
  value: CloseReason;
  label: string;
  icon: React.ReactNode;
  color: string;
}[] = [
  {
    value: "target",
    label: "Target Hit",
    icon: <CheckCircle2 className="size-4" />,
    color:
      "border-[oklch(0.72_0.18_155/0.5)] bg-[oklch(0.72_0.18_155/0.1)] text-[oklch(0.82_0.16_155)]",
  },
  {
    value: "stoploss",
    label: "Stop Loss",
    icon: <XCircle className="size-4" />,
    color:
      "border-[oklch(0.7_0.22_20/0.5)] bg-[oklch(0.7_0.22_20/0.1)] text-[oklch(0.82_0.18_25)]",
  },
  {
    value: "other",
    label: "Other",
    icon: <MinusCircle className="size-4" />,
    color: "border-glass-border bg-white/5 text-muted-foreground",
  },
];

// ─── Capital Snapshot Panel ────────────────────────────────────────────────
function CapitalSnapshotPanel() {
  const { latestSnapshot, addPortfolioSnapshot, dhanSwingCapital } = useStore();
  const [open, setOpen] = useState(false);
  const [snapNotes, setSnapNotes] = useState("");
  const [values, setValues] = useState<Partial<Record<PortfolioPartitionKey, string>>>({});

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const parsed: Partial<Record<PortfolioPartitionKey, number>> = {};
    for (const p of PORTFOLIO_PARTITIONS) {
      const raw = values[p.key];
      if (raw && raw.trim() !== "") {
        const n = Number(raw);
        if (!isNaN(n) && n >= 0) parsed[p.key] = n;
      }
    }
    if (Object.keys(parsed).length === 0) {
      toast.error("Enter at least one partition value");
      return;
    }
    addPortfolioSnapshot(parsed, snapNotes.trim() || undefined);
    toast.success("Portfolio snapshot saved");
    setValues({});
    setSnapNotes("");
    setOpen(false);
  };

  return (
    <section className="glass rounded-2xl overflow-hidden">
      {/* Header row */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="size-8 rounded-lg gradient-primary grid place-items-center">
            <Wallet className="size-4 text-primary-foreground" />
          </div>
          <div className="text-left">
            <p className="text-sm font-semibold">Capital Snapshot</p>
            <p className="text-xs text-muted-foreground">
              Dhan Swing active capital:{" "}
              <span className="text-foreground font-medium tabular-nums">{inr(dhanSwingCapital)}</span>
              {!latestSnapshot && (
                <span className="ml-1 text-[oklch(0.78_0.18_80)]">(using default)</span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Pencil className="size-3.5" />
          {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </div>
      </button>

      {/* Partition value tiles — always visible summary */}
      {latestSnapshot && !open && (
        <div className="px-4 pb-4 grid grid-cols-2 md:grid-cols-4 gap-2">
          {PORTFOLIO_PARTITIONS.map((p) => {
            const val = latestSnapshot.values[p.key];
            return (
              <div key={p.key} className="glass rounded-xl p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {p.label}
                </p>
                <p className="text-sm font-semibold tabular-nums mt-1">
                  {val !== undefined ? inr(val) : <span className="text-muted-foreground">—</span>}
                </p>
              </div>
            );
          })}
          {latestSnapshot.notes && (
            <p className="col-span-2 md:col-span-4 text-xs text-muted-foreground/70 italic px-1">
              {fmtDate(latestSnapshot.recordedAt)} — {latestSnapshot.notes}
            </p>
          )}
        </div>
      )}

      {/* Edit / entry form */}
      {open && (
        <form
          onSubmit={handleSubmit}
          className="border-t border-glass-border px-4 py-4 space-y-4"
        >
          <p className="text-xs text-muted-foreground uppercase tracking-wider">
            Enter current portfolio values (leave blank to skip a partition)
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {PORTFOLIO_PARTITIONS.map((p) => (
              <div key={p.key}>
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {p.label}
                </Label>
                <div className="mt-1.5 relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                    ₹
                  </span>
                  <Input
                    type="number"
                    step="1"
                    min="0"
                    value={values[p.key] ?? ""}
                    onChange={(e) => setValues((v) => ({ ...v, [p.key]: e.target.value }))}
                    className="bg-input/40 border-glass-border tabular-nums pl-7"
                    placeholder={
                      latestSnapshot?.values[p.key] !== undefined
                        ? String(latestSnapshot.values[p.key])
                        : "0"
                    }
                  />
                </div>
                <p className="text-[10px] text-muted-foreground/70 mt-1">{p.description}</p>
              </div>
            ))}
          </div>
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Notes (optional)
              </Label>
              <Input
                value={snapNotes}
                onChange={(e) => setSnapNotes(e.target.value)}
                className="bg-input/40 border-glass-border mt-1.5"
                placeholder="Post-market valuation, rebalance note…"
              />
            </div>
            <Button
              type="submit"
              className="gradient-primary text-primary-foreground border-0 gap-2 h-9 text-sm shrink-0"
            >
              <Plus className="size-4" /> Save snapshot
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────
function SwingPage() {
  const { trades, addTrade, closeTrade, deleteTrade, dhanSwingCapital } = useStore();

  // ── entry form state ──────────────────────────────────────────────────────
  const [partition, setPartition] = useState<BrokerPartition>("Dhan Swing");
  const [ticker, setTicker] = useState("");
  const [fnoBlocked, setFnoBlocked] = useState(false);
  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10));
  const [qty, setQty] = useState("");
  const [entry, setEntry] = useState("");
  const [target, setTarget] = useState("");
  const [stop, setStop] = useState("");
  const [source, setSource] = useState<"TheDoji" | "Self">("TheDoji");
  const [entryNotes, setEntryNotes] = useState("");

  // ── close-out panel state ─────────────────────────────────────────────────
  const [closingId, setClosingId] = useState<string | null>(null);
  const [closeReason, setCloseReason] = useState<CloseReason | null>(null);
  const [closeNotes, setCloseNotes] = useState("");

  // ── dynamic risk cap from latest Dhan Swing snapshot ─────────────────────
  const cap = useMemo(
    () => dhanSwingCapital * BLUEPRINT.riskCapPct,
    [dhanSwingCapital],
  );
  const exposure = useMemo(() => Number(qty) * Number(entry) || 0, [qty, entry]);
  const exceedsCap = exposure > cap;

  const openTrades = trades.filter((t) => t.status === "open");
  const closedTrades = trades.filter((t) => t.status === "closed");

  const handleTickerChange = (raw: string) => {
    const upper = raw.toUpperCase();
    if (FNO_REGEX.test(upper)) {
      setTicker("");
      setFnoBlocked(true);
      toast.error("Blueprint Violation: Equity Swing Trading only.");
      return;
    }
    setFnoBlocked(false);
    setTicker(upper);
  };

  const canSubmit =
    !fnoBlocked &&
    !exceedsCap &&
    ticker &&
    Number(qty) > 0 &&
    Number(entry) > 0 &&
    Number(target) > 0 &&
    Number(stop) > 0;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    addTrade({
      ticker,
      entryDate: new Date(entryDate).toISOString(),
      direction: "LONG",
      quantity: Number(qty),
      entryPrice: Number(entry),
      targetPrice: Number(target),
      stopLoss: Number(stop),
      source,
      partition,
      notes: entryNotes.trim() || undefined,
    });
    toast.success(`${ticker} logged`);
    setTicker("");
    setQty("");
    setEntry("");
    setTarget("");
    setStop("");
    setEntryNotes("");
  };

  const handleClose = (id: string) => {
    if (!closeReason) return toast.error("Select an outcome first");
    closeTrade(id, closeReason, closeNotes.trim() || undefined);
    toast.success("Trade closed");
    setClosingId(null);
    setCloseReason(null);
    setCloseNotes("");
  };

  const openClosePanel = (id: string) => {
    setClosingId((prev) => (prev === id ? null : id));
    setCloseReason(null);
    setCloseNotes("");
  };

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Module</p>
        <h1 className="text-3xl md:text-4xl font-semibold mt-1">
          <span className="text-gradient">Swing</span> trade logger
        </h1>
        <p className="text-sm text-muted-foreground mt-2">
          Rule-enforced. Equity only. 3% risk cap on{" "}
          <span className="text-foreground font-medium">{inr(dhanSwingCapital)}</span> Dhan Swing
          capital → max {inr(cap)} per position.
        </p>
      </header>

      {/* F&O violation banner */}
      {fnoBlocked && (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-4 flex items-start gap-3 animate-in fade-in slide-in-from-top-2">
          <ShieldAlert className="size-5 text-destructive shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-destructive">
              Blueprint Violation: Equity Swing Trading only.
            </p>
            <p className="text-xs text-destructive/80 mt-1">
              F&O instruments (CE/PE, weekly expiries, NIFTY/SENSEX/BANKNIFTY) are blocked. Use
              cash equity tickers only.
            </p>
          </div>
        </div>
      )}

      {/* ── Capital snapshot panel ────────────────────────────────────────────── */}
      <CapitalSnapshotPanel />

      {/* ── Entry form ───────────────────────────────────────────────────────── */}
      <section className="glass-strong rounded-2xl p-5 md:p-6">
        <h2 className="font-semibold mb-4 flex items-center gap-2">
          <TrendingUp className="size-4 text-primary" /> New swing entry
        </h2>
        <form onSubmit={submit} className="grid grid-cols-2 md:grid-cols-6 gap-3">
          {/* Row 1 */}
          <Field className="col-span-2 md:col-span-2" label="Ticker">
            <Input
              value={ticker}
              onChange={(e) => handleTickerChange(e.target.value)}
              className={`bg-input/40 border-glass-border uppercase tracking-wider ${
                fnoBlocked ? "border-destructive ring-1 ring-destructive" : ""
              }`}
              placeholder="e.g. RELIANCE, INFY"
              required
            />
          </Field>
          <Field className="col-span-1 md:col-span-1" label="Entry Date">
            <Input
              type="date"
              value={entryDate}
              onChange={(e) => setEntryDate(e.target.value)}
              className="bg-input/40 border-glass-border"
            />
          </Field>
          <Field className="col-span-1 md:col-span-1" label="Direction">
            <div className="h-9 px-3 rounded-md bg-input/40 border border-glass-border flex items-center justify-between text-sm">
              <span className="font-semibold text-[oklch(0.82_0.16_155)]">LONG</span>
              <Lock className="size-3.5 text-muted-foreground" />
            </div>
          </Field>
          <Field className="col-span-1 md:col-span-1" label="Quantity">
            <Input
              type="number"
              min="1"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className="bg-input/40 border-glass-border tabular-nums"
              placeholder="0"
            />
          </Field>
          <Field className="col-span-1 md:col-span-1" label="Partition">
            <Select value={partition} onValueChange={(v: BrokerPartition) => setPartition(v)}>
              <SelectTrigger className="bg-input/40 border-glass-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INVESTMENT_APPS.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {/* Row 2 */}
          <Field className="col-span-1 md:col-span-1" label="Source">
            <Select
              value={source}
              onValueChange={(v: "TheDoji" | "Self") => setSource(v)}
            >
              <SelectTrigger className="bg-input/40 border-glass-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="TheDoji">TheDoji</SelectItem>
                <SelectItem value="Self">Self</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field className="col-span-1 md:col-span-2" label="Entry Price (₹)">
            <Input
              type="number"
              step="0.05"
              value={entry}
              onChange={(e) => setEntry(e.target.value)}
              className="bg-input/40 border-glass-border tabular-nums"
              placeholder="0.00"
            />
          </Field>
          <Field className="col-span-1 md:col-span-2" label="Target Price (₹)">
            <Input
              type="number"
              step="0.05"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="bg-input/40 border-glass-border tabular-nums"
              placeholder="0.00"
            />
          </Field>
          <Field className="col-span-2 md:col-span-2" label="Stop Loss (₹)">
            <Input
              type="number"
              step="0.05"
              value={stop}
              onChange={(e) => setStop(e.target.value)}
              className="bg-input/40 border-glass-border tabular-nums"
              placeholder="0.00"
            />
          </Field>

          {/* Notes */}
          <Field className="col-span-2 md:col-span-6" label="Notes (optional)">
            <Input
              value={entryNotes}
              onChange={(e) => setEntryNotes(e.target.value)}
              className="bg-input/40 border-glass-border"
              placeholder="Trade rationale, setup type, catalyst…"
            />
          </Field>

          {/* Dynamic risk meter */}
          <div className="col-span-2 md:col-span-6 glass rounded-xl p-4">
            <div className="flex items-center justify-between text-xs">
              <div>
                <span className="text-muted-foreground uppercase tracking-wider">
                  Position exposure
                </span>
                <span className="ml-2 text-muted-foreground/60">
                  (3% of {inr(dhanSwingCapital)} Dhan Swing)
                </span>
              </div>
              <span className="tabular-nums font-medium">
                {inr(exposure)} / {inr(cap)} cap
              </span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-white/5 overflow-hidden">
              <div
                className={`h-full transition-all duration-200 ${
                  exceedsCap ? "bg-destructive" : "gradient-primary"
                }`}
                style={{ width: `${Math.min(100, (exposure / cap) * 100)}%` }}
              />
            </div>
            {exceedsCap && (
              <p className="mt-2 text-xs text-destructive flex items-center gap-1.5 font-medium">
                <AlertTriangle className="size-3.5" />
                Risk Limit Exceeded: Position size is greater than 3% of active Dhan Swing
                allocation.
              </p>
            )}
          </div>

          <div className="col-span-2 md:col-span-6 flex justify-end">
            <Button
              type="submit"
              disabled={!canSubmit}
              className="gradient-primary text-primary-foreground border-0 gap-2 glow h-10 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Plus className="size-4" /> Log trade
            </Button>
          </div>
        </form>
      </section>

      {/* ── Open positions ────────────────────────────────────────────────────── */}
      <section className="glass rounded-2xl p-5">
        <h2 className="font-semibold mb-4">
          Open positions
          {openTrades.length > 0 && (
            <span className="ml-2 text-xs text-muted-foreground font-normal">
              ({openTrades.length})
            </span>
          )}
        </h2>
        {openTrades.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No open trades.</p>
        ) : (
          <ul className="space-y-2">
            {openTrades.map((t) => {
              const r =
                (t.targetPrice - t.entryPrice) / (t.entryPrice - t.stopLoss);
              const isClosing = closingId === t.id;
              return (
                <li key={t.id} className="glass rounded-xl overflow-hidden">
                  <div className="p-4 flex items-center gap-3 justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold tracking-wider">{t.ticker}</p>
                        <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-[oklch(0.72_0.18_155/0.18)] text-[oklch(0.82_0.16_155)]">
                          LONG
                        </span>
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          {t.source}
                        </span>
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          {t.partition}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {fmtDate(t.entryDate)} • {t.quantity} × {inr(t.entryPrice)} • Tgt{" "}
                        {inr(t.targetPrice)} • SL {inr(t.stopLoss)}
                      </p>
                      {t.notes && (
                        <p className="text-xs text-muted-foreground/70 mt-1 italic">{t.notes}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="text-right">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          R:R
                        </p>
                        <p className="font-semibold tabular-nums text-sm">
                          {isFinite(r) ? r.toFixed(2) : "—"}
                        </p>
                      </div>
                      <button
                        onClick={() => openClosePanel(t.id)}
                        className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-all ${
                          isClosing
                            ? "border-primary/40 bg-primary/10 text-primary"
                            : "border-glass-border text-muted-foreground hover:text-foreground hover:bg-white/5"
                        }`}
                      >
                        {isClosing ? (
                          <>
                            <ChevronUp className="size-3.5" /> Cancel
                          </>
                        ) : (
                          <>
                            <ChevronDown className="size-3.5" /> Close
                          </>
                        )}
                      </button>
                      <button
                        onClick={() => {
                          deleteTrade(t.id);
                          toast.success("Trade removed");
                        }}
                        className="text-muted-foreground hover:text-destructive p-2"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </div>

                  {/* Inline close panel */}
                  {isClosing && (
                    <div className="border-t border-glass-border px-4 py-4 space-y-3 bg-white/[0.03]">
                      <p className="text-xs uppercase tracking-wider text-muted-foreground">
                        How did this trade close?
                      </p>
                      <div className="flex gap-2 flex-wrap">
                        {CLOSE_REASONS.map((cr) => (
                          <button
                            key={cr.value}
                            type="button"
                            onClick={() => setCloseReason(cr.value)}
                            className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-medium transition-all ${
                              closeReason === cr.value
                                ? cr.color + " ring-1 ring-current"
                                : "border-glass-border text-muted-foreground hover:bg-white/5"
                            }`}
                          >
                            {cr.icon} {cr.label}
                          </button>
                        ))}
                      </div>
                      <Textarea
                        value={closeNotes}
                        onChange={(e) => setCloseNotes(e.target.value)}
                        rows={2}
                        className="bg-input/40 border-glass-border text-sm min-h-[60px]"
                        placeholder="Exit price, observations, lesson… (optional)"
                      />
                      <div className="flex justify-end">
                        <Button
                          type="button"
                          onClick={() => handleClose(t.id)}
                          disabled={!closeReason}
                          className="gradient-primary text-primary-foreground border-0 gap-2 h-9 text-sm disabled:opacity-40"
                        >
                          Confirm close
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── Closed positions ─────────────────────────────────────────────────── */}
      {closedTrades.length > 0 && (
        <section className="glass rounded-2xl p-5">
          <h2 className="font-semibold mb-4">
            Closed positions
            <span className="ml-2 text-xs text-muted-foreground font-normal">
              ({closedTrades.length})
            </span>
          </h2>
          <ul className="space-y-2">
            {closedTrades.map((t) => {
              const outcomeInfo = CLOSE_REASONS.find((cr) => cr.value === t.closeReason);
              return (
                <li
                  key={t.id}
                  className="glass rounded-xl p-4 flex items-start gap-3 justify-between opacity-70 hover:opacity-90 transition-opacity"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold tracking-wider line-through text-muted-foreground">
                        {t.ticker}
                      </p>
                      {outcomeInfo && (
                        <span
                          className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${outcomeInfo.color}`}
                        >
                          {outcomeInfo.icon} {outcomeInfo.label}
                        </span>
                      )}
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        {t.partition}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Entry {fmtDate(t.entryDate)}
                      {t.closedAt ? ` → Closed ${fmtDate(t.closedAt)}` : ""} • {t.quantity} ×{" "}
                      {inr(t.entryPrice)} • Tgt {inr(t.targetPrice)} • SL {inr(t.stopLoss)}
                    </p>
                    {t.notes && (
                      <p className="text-xs text-muted-foreground/60 mt-0.5 italic">{t.notes}</p>
                    )}
                    {t.closeNotes && (
                      <p className="text-xs text-muted-foreground/80 mt-0.5">↳ {t.closeNotes}</p>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      deleteTrade(t.id);
                      toast.success("Trade removed");
                    }}
                    className="text-muted-foreground hover:text-destructive p-2 shrink-0"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

function Field({
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
      <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</Label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
