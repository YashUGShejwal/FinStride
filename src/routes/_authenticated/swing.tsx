import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type FormEvent } from "react";
import { Plus, Trash2, AlertTriangle, ShieldAlert, TrendingUp, Lock } from "lucide-react";
import { useStore, BLUEPRINT, appsForScope, type BrokerPartition } from "@/lib/store";
import { inr, fmtDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/swing")({ component: SwingPage });

// Blueprint Rule 2 — F&O ban regex
const FNO_REGEX = /\b(CALL|PUT|CE|PE|NIFTY|SENSEX|BANKNIFTY|FINNIFTY)\b|\d{2}(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\d{0,4}(CE|PE)?/i;
const SWING_APPS = appsForScope("swing");


function SwingPage() {
  const { trades, addTrade, deleteTrade } = useStore();

  const [partition, setPartition] = useState<BrokerPartition>("Dhan Swing");
  const [ticker, setTicker] = useState("");
  const [fnoBlocked, setFnoBlocked] = useState(false);
  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10));
  const [qty, setQty] = useState("");
  const [entry, setEntry] = useState("");
  const [target, setTarget] = useState("");
  const [stop, setStop] = useState("");
  const [source, setSource] = useState<"TheDoji" | "Self">("TheDoji");

  const exposure = useMemo(() => Number(qty) * Number(entry) || 0, [qty, entry]);
  const cap = BLUEPRINT.accountBalance * BLUEPRINT.riskCapPct;
  const exceedsCap = exposure > cap;

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

  const canSubmit = !fnoBlocked && !exceedsCap && ticker && Number(qty) > 0 && Number(entry) > 0 && Number(target) > 0 && Number(stop) > 0;

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
    });
    toast.success(`${ticker} logged`);
    setTicker(""); setQty(""); setEntry(""); setTarget(""); setStop("");
  };

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Module</p>
        <h1 className="text-3xl md:text-4xl font-semibold mt-1">
          <span className="text-gradient">Swing</span> trade logger
        </h1>
        <p className="text-sm text-muted-foreground mt-2">Rule-enforced. Equity only. Risk-capped at 3% of {inr(BLUEPRINT.accountBalance)}.</p>
      </header>

      {fnoBlocked && (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-4 flex items-start gap-3 animate-in fade-in slide-in-from-top-2">
          <ShieldAlert className="size-5 text-destructive shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-destructive">Blueprint Violation: Equity Swing Trading only.</p>
            <p className="text-xs text-destructive/80 mt-1">F&O instruments (CE/PE, weekly expiries, NIFTY/SENSEX/BANKNIFTY) are blocked. Use cash equity tickers only.</p>
          </div>
        </div>
      )}

      {/* Entry form */}
      <section className="glass-strong rounded-2xl p-5 md:p-6">
        <h2 className="font-semibold mb-4 flex items-center gap-2">
          <TrendingUp className="size-4 text-primary" /> New swing entry
        </h2>
        <form onSubmit={submit} className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <Field className="col-span-2 md:col-span-2" label="Ticker">
            <Input value={ticker} onChange={(e) => handleTickerChange(e.target.value)}
              className={`bg-input/40 border-glass-border uppercase tracking-wider ${fnoBlocked ? "border-destructive ring-1 ring-destructive" : ""}`}
              placeholder="e.g. RELIANCE, INFY" required />
          </Field>
          <Field className="col-span-1 md:col-span-1" label="Entry Date">
            <Input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} className="bg-input/40 border-glass-border" />
          </Field>
          <Field className="col-span-1 md:col-span-1" label="Direction">
            <div className="h-9 px-3 rounded-md bg-input/40 border border-glass-border flex items-center justify-between text-sm">
              <span className="font-semibold text-[oklch(0.82_0.16_155)]">LONG</span>
              <Lock className="size-3.5 text-muted-foreground" />
            </div>
          </Field>
          <Field className="col-span-1 md:col-span-1" label="Quantity">
            <Input type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)}
              className="bg-input/40 border-glass-border tabular-nums" placeholder="0" />
          </Field>
          <Field className="col-span-1 md:col-span-1" label="Partition">
            <Select value={partition} onValueChange={(v: BrokerPartition) => setPartition(v)}>
              <SelectTrigger className="bg-input/40 border-glass-border"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SWING_APPS.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field className="col-span-1 md:col-span-1" label="Source">
            <Select value={source} onValueChange={(v: "TheDoji" | "Self") => setSource(v)}>
              <SelectTrigger className="bg-input/40 border-glass-border"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="TheDoji">TheDoji</SelectItem>
                <SelectItem value="Self">Self</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field className="col-span-2 md:col-span-2" label="Entry Price (₹)">
            <Input type="number" step="0.05" value={entry} onChange={(e) => setEntry(e.target.value)}
              className="bg-input/40 border-glass-border tabular-nums" placeholder="0.00" />
          </Field>
          <Field className="col-span-1 md:col-span-2" label="Target Price (₹)">
            <Input type="number" step="0.05" value={target} onChange={(e) => setTarget(e.target.value)}
              className="bg-input/40 border-glass-border tabular-nums" placeholder="0.00" />
          </Field>
          <Field className="col-span-1 md:col-span-2" label="Stop Loss (₹)">
            <Input type="number" step="0.05" value={stop} onChange={(e) => setStop(e.target.value)}
              className="bg-input/40 border-glass-border tabular-nums" placeholder="0.00" />
          </Field>

          {/* Risk meter */}
          <div className="col-span-2 md:col-span-6 glass rounded-xl p-4">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground uppercase tracking-wider">Position exposure</span>
              <span className="tabular-nums font-medium">{inr(exposure)} / {inr(cap)} cap</span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-white/5 overflow-hidden">
              <div
                className={`h-full transition-all ${exceedsCap ? "bg-destructive" : "gradient-primary"}`}
                style={{ width: `${Math.min(100, (exposure / cap) * 100)}%` }}
              />
            </div>
            {exceedsCap && (
              <p className="mt-2 text-xs text-destructive flex items-center gap-1.5 font-medium">
                <AlertTriangle className="size-3.5" /> 3% Limit Wall exceeded. Reduce quantity or price to proceed.
              </p>
            )}
          </div>

          <div className="col-span-2 md:col-span-6 flex justify-end">
            <Button type="submit" disabled={!canSubmit}
              className="gradient-primary text-primary-foreground border-0 gap-2 glow h-10 disabled:opacity-40 disabled:cursor-not-allowed disabled:glow-none">
              <Plus className="size-4" /> Log trade
            </Button>
          </div>
        </form>
      </section>

      {/* Trades list */}
      <section className="glass rounded-2xl p-5">
        <h2 className="font-semibold mb-4">Open log</h2>
        {trades.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">No trades logged yet.</p>
        ) : (
          <ul className="space-y-2">
            {trades.map((t) => {
              const r = (t.targetPrice - t.entryPrice) / (t.entryPrice - t.stopLoss);
              return (
                <li key={t.id} className="glass rounded-xl p-4 flex items-center gap-3 justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold tracking-wider">{t.ticker}</p>
                      <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-[oklch(0.72_0.18_155/0.18)] text-[oklch(0.82_0.16_155)]">LONG</span>
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t.source}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {fmtDate(t.entryDate)} • {t.partition} • {t.quantity} × {inr(t.entryPrice)} • Tgt {inr(t.targetPrice)} • SL {inr(t.stopLoss)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">R:R</p>
                      <p className="font-semibold tabular-nums text-sm">{isFinite(r) ? r.toFixed(2) : "—"}</p>
                    </div>
                    <button onClick={() => { deleteTrade(t.id); toast.success("Trade removed"); }} className="text-muted-foreground hover:text-destructive p-2">
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</Label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
