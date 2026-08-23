import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Plus, Trash2, AlertTriangle, ShieldAlert, Lock,
  CheckCircle2, XCircle, MinusCircle, ChevronDown, ChevronUp,
  Wallet, Pencil, FileSpreadsheet,
} from "lucide-react";
import { TradeImportModal } from "@/components/TradeImportModal";
import { EditTradeModal } from "@/components/EditTradeModal";
import { PnlHeatmap } from "@/components/PnlHeatmap";
import {
  useStore,
  type CloseReason, type PartitionId, type Trade, type ExitReason,
} from "@/lib/store";
import { FNO_REGEX, getUnderlyingSymbol } from "@/lib/blueprintRules";
import { inr, fmtDate, todayLocalISO } from "@/lib/format";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { Sensitive } from "@/components/Sensitive";
import { useGlowRipple } from "@/hooks/useGlowRipple";
import { QuickLogDrawer } from "@/components/ui/QuickLogDrawer";
import { SpotlightCard } from "@/components/ui/SpotlightCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

type SwingSearch = { action?: "add" };

export const Route = createFileRoute("/_authenticated/swing")({
  validateSearch: (search: Record<string, unknown>): SwingSearch => ({
    action: search.action === "add" ? "add" : undefined,
  }),
  component: SwingPage,
});

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
  const {
    latestSnapshotValues, addPortfolioSnapshots, riskCapCapital,
    brokerPartitions, blueprintSettings, partitionLabel,
  } = useStore();
  const [open, setOpen] = useState(false);
  const [snapNotes, setSnapNotes] = useState("");
  const [values, setValues] = useState<Partial<Record<PartitionId, string>>>({});

  // Partition ids only — latestSnapshotValues can also carry bank/cash ACCOUNT
  // ids (recorded via the Analytics snapshot dialog), which this panel's grid
  // iterates brokerPartitions and therefore can't display. Counting them here
  // would flip the panel out of its empty state to a grid of all-"—" rows.
  const hasAnySnapshot = brokerPartitions.some((p) => latestSnapshotValues[p.id] !== undefined);
  // Specifically whether the CONFIGURED risk-cap partition has a snapshot — hasAnySnapshot
  // (any partition at all) would otherwise hide this hint once the user has snapshotted a
  // *different* partition, leaving "₹0 active capital" with no explanation for why it's 0.
  const riskCapPartitionHasSnapshot =
    latestSnapshotValues[blueprintSettings.riskCapPartition] !== undefined;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const entries: Array<{ brokerPartition: PartitionId; currentValue: number }> = [];
    for (const p of brokerPartitions) {
      const raw = values[p.id];
      if (raw && raw.trim() !== "") {
        const n = Number(raw);
        if (!isNaN(n) && n >= 0) entries.push({ brokerPartition: p.id, currentValue: n });
      }
    }
    if (entries.length === 0) {
      toast.error("Enter at least one partition value");
      return;
    }
    addPortfolioSnapshots(entries, snapNotes.trim() || undefined);
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
            <p className="text-sm font-display font-semibold tracking-tight">Capital Snapshot</p>
            <p className="text-xs text-muted-foreground">
              {partitionLabel(blueprintSettings.riskCapPartition)} active capital:{" "}
              <Sensitive>
                <span className="text-foreground font-medium tnum">
                  <AnimatedNumber value={riskCapCapital} format={inr} />
                </span>
              </Sensitive>
              {!riskCapPartitionHasSnapshot && (
                <span className="ml-1 text-[oklch(0.78_0.18_80)]">(no snapshot yet)</span>
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
      {hasAnySnapshot && !open && (
        <div className="px-4 pb-4 grid grid-cols-2 md:grid-cols-4 gap-2">
          {brokerPartitions.map((p) => {
            const val = latestSnapshotValues[p.id];
            return (
              <SpotlightCard key={p.id} className="rounded-xl p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {p.name}
                </p>
                <p className="text-sm font-semibold tnum mt-1">
                  {val !== undefined ? (
                    <Sensitive>
                      <AnimatedNumber value={val} format={inr} />
                    </Sensitive>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </p>
              </SpotlightCard>
            );
          })}
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
            {brokerPartitions.map((p) => (
              <div key={p.id}>
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {p.name}
                </Label>
                <div className="mt-1.5 relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                    ₹
                  </span>
                  <Input
                    type="number"
                    step="1"
                    min="0"
                    value={values[p.id] ?? ""}
                    onChange={(e) => setValues((v) => ({ ...v, [p.id]: e.target.value }))}
                    className="bg-input/40 border-glass-border tnum pl-7"
                    placeholder={
                      latestSnapshotValues[p.id] !== undefined
                        ? String(latestSnapshotValues[p.id])
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
  const {
    trades, addTrade, closeTrade, deleteTrade, riskCapCapital, blueprintSettings,
    brokerPartitions, partitionLabel, enableFnoTracking,
  } = useStore();
  const riskCapPartitionLabel = partitionLabel(blueprintSettings.riskCapPartition);

  // ── entry form state ──────────────────────────────────────────────────────
  // Seeded from the live list rather than the hardcoded "Primary Broker" id:
  // that built-in is deletable, and a dangling seed left the Select blank
  // while still stamping trades with a partition nothing resolves.
  const [partition, setPartition] = useState<PartitionId>(brokerPartitions[0]?.id ?? "");
  const [ticker, setTicker] = useState("");
  const [fnoBlocked, setFnoBlocked] = useState(false);
  const [entryDate, setEntryDate] = useState(todayLocalISO);
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

  // ── quick-log drawer + logged-trade ripple ───────────────────────────────
  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editingTrade, setEditingTrade] = useState<Trade | null>(null);
  const positionsRipple = useGlowRipple();

  // ── F&O Desk sub-view (only reachable when enableFnoTracking is on) ──────
  const [deskView, setDeskView] = useState<"equity" | "fno">("equity");
  // Derived rather than raw `deskView` everywhere below: if enableFnoTracking
  // gets turned off elsewhere (Settings) while this page is still mounted
  // with deskView==="fno", the toggle that would switch it back disappears
  // too (it's gated on enableFnoTracking) — without this fallback the page
  // would render neither section, stuck on a view with no way out.
  const effectiveDeskView = enableFnoTracking ? deskView : "equity";

  // ── Closed-trade grouping (independent per desk view — F&O day-trading
  // review and equity swing review call for different default shapes) ──────
  const [equityGroupBy, setEquityGroupBy] = useState<GroupBy>("flat");
  const [fnoGroupBy, setFnoGroupBy] = useState<GroupBy>("date");
  const groupBy = effectiveDeskView === "equity" ? equityGroupBy : fnoGroupBy;
  const setGroupBy = effectiveDeskView === "equity" ? setEquityGroupBy : setFnoGroupBy;

  // Deep-link intent (command palette "New Swing Trade", dashboard quick
  // card): ?action=add expands the drawer, then the param self-clears.
  const { action } = Route.useSearch();
  const nav = useNavigate({ from: Route.fullPath });
  useEffect(() => {
    if (action === "add") {
      setFormOpen(true);
      void nav({ search: {}, replace: true });
    }
  }, [action, nav]);

  // The seed above runs before the store hydrates, so a partition the user
  // deleted is still present at that moment. Once the real list settles,
  // re-point the field if what it holds no longer exists.
  useEffect(() => {
    if (brokerPartitions.length === 0) return;
    if (brokerPartitions.some((p) => p.id === partition)) return;
    setPartition(brokerPartitions[0].id);
  }, [brokerPartitions, partition]);

  const toggleForm = () => {
    // Closing the drawer unmounts the ticker input, which is the only thing
    // that can clear the F&O violation banner — reset it here so the banner
    // can't be left orphaned above a collapsed drawer.
    if (formOpen) setFnoBlocked(false);
    setFormOpen((v) => !v);
  };

  // ── dynamic risk cap from latest snapshot of the configured risk-cap partition ──
  const cap = useMemo(
    () => riskCapCapital * blueprintSettings.defaultRiskCapPct,
    [riskCapCapital, blueprintSettings.defaultRiskCapPct],
  );
  const exposure = useMemo(() => Number(qty) * Number(entry) || 0, [qty, entry]);
  const exceedsCap = exposure > cap;

  const openTrades = trades.filter((t) => t.status === "open");
  const closedTrades = trades.filter((t) => t.status === "closed");
  // Split by asset class so the F&O Desk view (contract columns) and the
  // equity swing view (targetPrice/stopLoss/R:R) never mix rows that don't
  // share those metrics — F&O trades only ever enter via tradebook import
  // (see TradeImportModal), never manual entry.
  const equityOpenTrades = openTrades.filter((t) => t.assetClass !== "fno");
  const equityClosedTrades = closedTrades.filter((t) => t.assetClass !== "fno");
  const fnoOpenTrades = openTrades.filter((t) => t.assetClass === "fno");
  const fnoClosedTrades = closedTrades.filter((t) => t.assetClass === "fno");
  // Open + closed together, for the Performance Ribbon's charges-paid total
  // (charges accrue on the entry fill too, before a position ever closes).
  const equityTrades = trades.filter((t) => t.assetClass !== "fno");
  const fnoTrades = trades.filter((t) => t.assetClass === "fno");

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
      qty: Number(qty),
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
    positionsRipple.trigger();
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
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Module</p>
          <h1 className="text-3xl md:text-4xl font-display font-semibold tracking-tight mt-1">
            <span className="text-gradient">Swing</span> trade logger
          </h1>
          <p className="text-sm text-muted-foreground mt-2">
            Rule-enforced. Equity only. 3% risk cap on{" "}
            <Sensitive>
              <span className="text-foreground font-medium tnum">{inr(riskCapCapital)}</span>
            </Sensitive>{" "}
            {riskCapPartitionLabel} capital → max <Sensitive><span className="tnum">{inr(cap)}</span></Sensitive> per
            position.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => setImportOpen(true)}
            className="border-glass-border gap-2 h-10 hover:border-primary/40"
          >
            <FileSpreadsheet className="size-4" /> Import Tradebook
          </Button>
        </div>
      </header>

      {/* F&O Desk sub-view toggle — only reachable once the user opts in via Settings */}
      {enableFnoTracking && (
        <div className="inline-flex items-center gap-1 p-1 rounded-xl border border-glass-border bg-white/[0.03] w-fit">
          <button
            type="button"
            onClick={() => setDeskView("equity")}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
              effectiveDeskView === "equity"
                ? "gradient-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Equity Swing
          </button>
          <button
            type="button"
            onClick={() => setDeskView("fno")}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
              effectiveDeskView === "fno"
                ? "gradient-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            F&O Desk
            {fnoOpenTrades.length > 0 && (
              <span className="ml-1.5 opacity-70">({fnoOpenTrades.length})</span>
            )}
          </button>
        </div>
      )}

      {/* F&O violation banner */}
      {effectiveDeskView === "equity" && fnoBlocked && (
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

      {/* ── Entry form — collapsed by default so open positions lead. Equity-only: F&O positions only ever enter via tradebook import. ── */}
      {effectiveDeskView === "equity" && (
      <QuickLogDrawer label="Quick Log Trade" open={formOpen} onToggle={toggleForm}>
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
              className="bg-input/40 border-glass-border tnum"
              placeholder="0"
            />
          </Field>
          <Field className="col-span-1 md:col-span-1" label="Partition">
            <Select value={partition} onValueChange={(v: PartitionId) => setPartition(v)}>
              <SelectTrigger className="bg-input/40 border-glass-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {brokerPartitions.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
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
              className="bg-input/40 border-glass-border tnum"
              placeholder="0.00"
            />
          </Field>
          <Field className="col-span-1 md:col-span-2" label="Target Price (₹)">
            <Input
              type="number"
              step="0.05"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="bg-input/40 border-glass-border tnum"
              placeholder="0.00"
            />
          </Field>
          <Field className="col-span-2 md:col-span-2" label="Stop Loss (₹)">
            <Input
              type="number"
              step="0.05"
              value={stop}
              onChange={(e) => setStop(e.target.value)}
              className="bg-input/40 border-glass-border tnum"
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
                  (3% of <Sensitive><span className="tnum">{inr(riskCapCapital)}</span></Sensitive>{" "}
                  {riskCapPartitionLabel})
                </span>
              </div>
              <span className="tnum font-medium">
                <Sensitive>
                  {inr(exposure)} / {inr(cap)} cap
                </Sensitive>
              </span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-white/5 overflow-hidden">
              <div
                className={`h-full transition-all duration-200 ${
                  exceedsCap ? "bg-destructive" : "gradient-primary"
                }`}
                style={{ width: `${cap > 0 ? Math.min(100, (exposure / cap) * 100) : 0}%` }}
              />
            </div>
            {exceedsCap && (
              <p className="mt-2 text-xs text-destructive flex items-center gap-1.5 font-medium">
                <AlertTriangle className="size-3.5" />
                Risk Limit Exceeded: Position size is greater than 3% of active{" "}
                {riskCapPartitionLabel} allocation.
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
      </QuickLogDrawer>
      )}

      <TradeImportModal open={importOpen} onOpenChange={setImportOpen} />
      <EditTradeModal
        trade={editingTrade}
        open={editingTrade !== null}
        onOpenChange={(v) => {
          if (!v) setEditingTrade(null);
        }}
      />

      {effectiveDeskView === "equity" && (
      <>
      <PerformanceRibbon trades={equityTrades} />
      <PnlHeatmap trades={equityTrades} />
      {/* ── Open positions ────────────────────────────────────────────────────── */}
      <section className={`glass rounded-2xl p-5 ${positionsRipple.className}`}>
        <h2 className="font-display font-semibold tracking-tight mb-4">
          Open positions{enableFnoTracking ? " (Equity)" : ""}
          {equityOpenTrades.length > 0 && (
            <span className="ml-2 text-xs text-muted-foreground font-normal">
              ({equityOpenTrades.length})
            </span>
          )}
        </h2>
        {equityOpenTrades.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No open trades.</p>
        ) : (
          <ul className="space-y-2">
            {equityOpenTrades.map((t) => {
              const r =
                (t.targetPrice - t.entryPrice) / (t.entryPrice - t.stopLoss);
              const isClosing = closingId === t.id;
              return (
                <li key={t.id} className="glass rounded-xl overflow-hidden">
                  <div className="p-4 flex items-center gap-3 justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold tracking-wider">{t.ticker}</p>
                        <span
                          className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${
                            t.direction === "SHORT"
                              ? "bg-[oklch(0.7_0.22_20/0.18)] text-[oklch(0.82_0.18_25)]"
                              : "bg-[oklch(0.72_0.18_155/0.18)] text-[oklch(0.82_0.16_155)]"
                          }`}
                        >
                          {t.direction}
                        </span>
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          {t.source}
                        </span>
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          {partitionLabel(t.partition)}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {fmtDate(t.entryDate)} •{" "}
                        <Sensitive>
                          <span className="tnum">
                            {t.qty} × {inr(t.entryPrice)} • Tgt {inr(t.targetPrice)} • SL{" "}
                            {inr(t.stopLoss)}
                          </span>
                        </Sensitive>
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
                        <p className="font-semibold tnum text-sm">
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
                        onClick={() => setEditingTrade(t)}
                        className="text-muted-foreground hover:text-foreground p-2"
                        aria-label="Edit trade"
                      >
                        <Pencil className="size-4" />
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
      {equityClosedTrades.length > 0 && (
        <section className="glass rounded-2xl p-5">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
            <h2 className="font-display font-semibold tracking-tight">
              Closed positions{enableFnoTracking ? " (Equity)" : ""}
              <span className="ml-2 text-xs text-muted-foreground font-normal">
                ({equityClosedTrades.length})
              </span>
            </h2>
            <GroupBySwitcher value={groupBy} onChange={setGroupBy} />
          </div>
          <GroupedClosedTrades
            trades={equityClosedTrades}
            groupBy={groupBy}
            partitionLabel={partitionLabel}
            onEdit={setEditingTrade}
            onDelete={(t) => {
              deleteTrade(t.id);
              toast.success("Trade removed");
            }}
          />
        </section>
      )}
      </>
      )}

      {/* ── F&O Desk ──────────────────────────────────────────────────────────── */}
      {effectiveDeskView === "fno" && (
        <>
          <PerformanceRibbon trades={fnoTrades} />
          <PnlHeatmap trades={fnoTrades} />
          <section className="glass rounded-2xl p-5">
            <h2 className="font-display font-semibold tracking-tight mb-4">
              F&O open positions
              {fnoOpenTrades.length > 0 && (
                <span className="ml-2 text-xs text-muted-foreground font-normal">
                  ({fnoOpenTrades.length})
                </span>
              )}
            </h2>
            {fnoOpenTrades.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                No open F&O positions — import a tradebook (with F&O tracking on) to bring
                contracts in here.
              </p>
            ) : (
              <ul className="space-y-2">
                {fnoOpenTrades.map((t) => {
                  const isClosing = closingId === t.id;
                  return (
                    <li key={t.id} className="glass rounded-xl overflow-hidden">
                      <div className="p-4 flex items-center gap-3 justify-between flex-wrap">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-semibold tracking-wider">{t.ticker}</p>
                            {t.optionType && (
                              <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-[oklch(0.75_0.14_230/0.18)] text-[oklch(0.75_0.14_230)]">
                                {t.optionType}
                              </span>
                            )}
                            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                              {partitionLabel(t.partition)}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {fmtDate(t.entryDate)} •{" "}
                            <Sensitive>
                              <span className="tnum">
                                {t.qty} × {inr(t.entryPrice)}
                              </span>
                            </Sensitive>
                          </p>
                        </div>
                        <div className="flex items-center gap-4 shrink-0">
                          <FnoStat label="Expiry" value={t.expiry ?? "—"} />
                          <FnoStat label="Strike" value={t.strike !== undefined ? String(t.strike) : "—"} />
                          <FnoStat label="Lot size" value={t.lotSize !== undefined ? String(t.lotSize) : "—"} />
                          <FnoStat label="P&L" value="—" title="Unrealized — FinStride has no live quote feed" />
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
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
                            onClick={() => setEditingTrade(t)}
                            className="text-muted-foreground hover:text-foreground p-2"
                            aria-label="Edit trade"
                          >
                            <Pencil className="size-4" />
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

                      {isClosing && (
                        <div className="border-t border-glass-border px-4 py-4 space-y-3 bg-white/[0.03]">
                          <p className="text-xs uppercase tracking-wider text-muted-foreground">
                            How did this position close?
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

          {fnoClosedTrades.length > 0 && (
            <section className="glass rounded-2xl p-5">
              <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
                <h2 className="font-display font-semibold tracking-tight">
                  F&O closed positions
                  <span className="ml-2 text-xs text-muted-foreground font-normal">
                    ({fnoClosedTrades.length})
                  </span>
                </h2>
                <GroupBySwitcher value={groupBy} onChange={setGroupBy} />
              </div>
              <GroupedClosedTrades
                trades={fnoClosedTrades}
                groupBy={groupBy}
                partitionLabel={partitionLabel}
                onEdit={setEditingTrade}
                onDelete={(t) => {
                  deleteTrade(t.id);
                  toast.success("Trade removed");
                }}
                fnoExtra={(t) => (
                  <div className="flex items-center gap-3 shrink-0">
                    <FnoStat label="Expiry" value={t.expiry ?? "—"} />
                    <FnoStat label="Strike" value={t.strike !== undefined ? String(t.strike) : "—"} />
                    <FnoStat label="Lot size" value={t.lotSize !== undefined ? String(t.lotSize) : "—"} />
                  </div>
                )}
              />
            </section>
          )}
        </>
      )}
    </div>
  );
}

function FnoStat({
  label,
  value,
  tone,
  title,
}: {
  label: string;
  value: string;
  tone?: string;
  title?: string;
}) {
  return (
    <div className="text-right" title={title}>
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`text-xs font-semibold tnum ${tone ?? ""}`}>{value}</p>
    </div>
  );
}

// ─── Performance Ribbon ──────────────────────────────────────────────────────
const PNL_EMERALD = "text-[oklch(0.78_0.16_155)]";
const PNL_ROSE = "text-[oklch(0.78_0.18_25)]";

/**
 * KPI strip scoped to whichever desk view (Equity/F&O) is active. P&L-based
 * stats (Net Realized P&L, Win Rate, Profit Factor) only ever consider
 * closed trades that HAVE a recorded netPnl/pnl — a trade closed through the
 * ORIGINAL manual close flow (still the only path for most existing users'
 * historical trades) never collected an exit price, so there is nothing to
 * net there; silently treating that as ₹0 would misclassify a real profit or
 * loss as a scratch. Avg Hold Time and Charges Paid don't have that gap
 * (hold time only needs entry/exit dates; charges accrue on the entry fill
 * even for a still-open position), so they're computed more broadly.
 */
function PerformanceRibbon({ trades }: { trades: Trade[] }) {
  const closed = trades.filter((t) => t.status === "closed");
  if (closed.length === 0) return null;

  const realized = (t: Trade): number | undefined => t.netPnl ?? t.pnl;
  const withPnl = closed.filter((t) => realized(t) !== undefined);
  const wins = withPnl.filter((t) => (realized(t) as number) > 0);
  const losses = withPnl.filter((t) => (realized(t) as number) < 0);
  const netPnlTotal = withPnl.reduce((s, t) => s + (realized(t) as number), 0);
  const grossWins = wins.reduce((s, t) => s + (realized(t) as number), 0);
  const grossLosses = Math.abs(losses.reduce((s, t) => s + (realized(t) as number), 0));
  const decidedCount = wins.length + losses.length;
  const winRate = decidedCount > 0 ? (wins.length / decidedCount) * 100 : null;
  const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : null;

  const holdable = closed.filter((t) => t.exitDate);
  const avgHoldDays =
    holdable.length > 0
      ? holdable.reduce(
          (s, t) => s + Math.max(0, (new Date(t.exitDate!).getTime() - new Date(t.entryDate).getTime()) / 86400000),
          0,
        ) / holdable.length
      : null;

  const totalCharges = trades.reduce((s, t) => s + (t.charges ?? 0), 0);

  return (
    <section className="glass rounded-2xl p-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <RibbonStat
          label="Net Realized P&L"
          value={withPnl.length > 0 ? `${netPnlTotal >= 0 ? "+" : ""}${inr(netPnlTotal)}` : "—"}
          tone={withPnl.length > 0 ? (netPnlTotal >= 0 ? PNL_EMERALD : PNL_ROSE) : undefined}
          sensitive
        />
        <RibbonStat
          label="Win Rate"
          value={winRate !== null ? `${winRate.toFixed(0)}%` : "—"}
          sub={decidedCount > 0 ? `${wins.length}W · ${losses.length}L` : undefined}
        />
        <RibbonStat
          label="Profit Factor"
          value={profitFactor === null ? "—" : profitFactor === Infinity ? "∞" : profitFactor.toFixed(2)}
        />
        <RibbonStat label="Avg Hold Time" value={avgHoldDays !== null ? `${avgHoldDays.toFixed(1)}d` : "—"} />
        <RibbonStat label="Charges Paid" value={inr(totalCharges)} sensitive />
      </div>
      {closed.length !== withPnl.length && (
        <p className="text-[10px] text-muted-foreground mt-3">
          P&L stats based on {withPnl.length} of {closed.length} closed trade
          {closed.length !== 1 ? "s" : ""} with a recorded exit price — trades closed manually
          without one aren't counted.
        </p>
      )}
    </section>
  );
}

function RibbonStat({
  label,
  value,
  sub,
  tone,
  sensitive,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
  sensitive?: boolean;
}) {
  const val = <span className={`text-lg font-semibold tnum ${tone ?? ""}`}>{value}</span>;
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-0.5">{sensitive ? <Sensitive>{val}</Sensitive> : val}</p>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── Closed position card ────────────────────────────────────────────────────
const EXIT_REASON_META: Record<ExitReason, { label: string; emoji: string; color: string }> = {
  target: {
    label: "Target Hit",
    emoji: "🎯",
    color: "border-[oklch(0.72_0.18_155/0.5)] bg-[oklch(0.72_0.18_155/0.1)] text-[oklch(0.82_0.16_155)]",
  },
  stop_loss: {
    label: "Stop Hit",
    emoji: "🛑",
    color: "border-[oklch(0.7_0.22_20/0.5)] bg-[oklch(0.7_0.22_20/0.1)] text-[oklch(0.82_0.18_25)]",
  },
  tradebook_sync: {
    label: "Sync Exit",
    emoji: "⚡",
    color: "border-[oklch(0.75_0.14_230/0.5)] bg-[oklch(0.75_0.14_230/0.1)] text-[oklch(0.75_0.14_230)]",
  },
  manual: {
    label: "Manual Close",
    emoji: "✍️",
    color: "border-glass-border bg-white/5 text-muted-foreground",
  },
};

/**
 * exitReason is a new field — trades closed before it existed only have the
 * older closeReason (target/stoploss/other from the manual close panel).
 * Mapped here with the EXACT same rule closeTrade itself uses for a manual
 * close, so a legacy trade's badge matches what it would have gotten had it
 * closed today.
 */
function resolveExitReason(t: Trade): ExitReason | undefined {
  if (t.exitReason) return t.exitReason;
  if (t.closeReason === "target") return "target";
  if (t.closeReason === "stoploss") return "stop_loss";
  if (t.closeReason === "other") return "manual";
  return undefined;
}

/**
 * Shared by the equity and F&O closed-position lists. `rightExtra` is where
 * F&O-specific columns (Expiry/Strike/Lot Size) slot in, ahead of the
 * performance badge both lists share.
 */
function ClosedTradeCard({
  t,
  partitionName,
  rightExtra,
  onEdit,
  onDelete,
}: {
  t: Trade;
  partitionName: string;
  rightExtra?: React.ReactNode;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const realizedPnl = t.netPnl ?? t.pnl;
  const hasExitData = t.exitPrice !== undefined && realizedPnl !== undefined;
  const roiPct = hasExitData && t.entryPrice > 0 ? realizedPnl! / (t.entryPrice * t.qty) : undefined;
  const holdDays = t.exitDate
    ? Math.max(0, Math.round((new Date(t.exitDate).getTime() - new Date(t.entryDate).getTime()) / 86400000))
    : undefined;
  const meta = EXIT_REASON_META[resolveExitReason(t) as ExitReason];

  return (
    <li className="glass rounded-xl p-4 flex items-start gap-3 justify-between flex-wrap opacity-70 hover:opacity-90 transition-opacity">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-semibold tracking-wider line-through text-muted-foreground">{t.ticker}</p>
          <span
            className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${
              t.direction === "SHORT"
                ? "bg-[oklch(0.7_0.22_20/0.18)] text-[oklch(0.82_0.18_25)]"
                : "bg-[oklch(0.72_0.18_155/0.18)] text-[oklch(0.82_0.16_155)]"
            }`}
          >
            {t.direction}
          </span>
          {t.optionType && (
            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-glass-border text-muted-foreground">
              {t.optionType === "FUT" ? "FUT" : `${t.optionType}${t.strike !== undefined ? ` ${t.strike}` : ""}`}
            </span>
          )}
          {meta && (
            <span
              className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${meta.color}`}
            >
              {meta.emoji} {meta.label}
            </span>
          )}
          {holdDays !== undefined && (
            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-glass-border text-muted-foreground">
              {holdDays === 0 ? "Intraday" : `Held ${holdDays}d`}
            </span>
          )}
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{partitionName}</span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {hasExitData ? (
            <Sensitive>
              <span className="tnum">
                Entry {inr(t.entryPrice)} ➔ Exit {inr(t.exitPrice!)} · {t.qty} qty
              </span>
            </Sensitive>
          ) : (
            <>
              Entry {fmtDate(t.entryDate)}
              {t.exitDate ? ` → Closed ${fmtDate(t.exitDate)}` : ""} •{" "}
              <Sensitive>
                <span className="tnum">
                  {t.qty} × {inr(t.entryPrice)}
                </span>
              </Sensitive>{" "}
              — no exit price recorded
            </>
          )}
        </p>
        {t.notes && <p className="text-xs text-muted-foreground/60 mt-0.5 italic">{t.notes}</p>}
        {t.closeNotes && <p className="text-xs text-muted-foreground/80 mt-0.5">↳ {t.closeNotes}</p>}
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {rightExtra}
        <div
          className="text-right"
          title={t.charges !== undefined ? `Charges deducted: ${inr(t.charges)}` : undefined}
        >
          {hasExitData ? (
            <>
              <p className={`text-sm font-semibold tnum ${realizedPnl! >= 0 ? PNL_EMERALD : PNL_ROSE}`}>
                <Sensitive>
                  {realizedPnl! >= 0 ? "+" : ""}
                  {inr(realizedPnl!)}
                </Sensitive>
              </p>
              {roiPct !== undefined && (
                <p className={`text-[10px] tnum ${roiPct >= 0 ? PNL_EMERALD : PNL_ROSE}`}>
                  {roiPct >= 0 ? "+" : ""}
                  {(roiPct * 100).toFixed(1)}%
                </p>
              )}
            </>
          ) : (
            <p className="text-[10px] text-muted-foreground italic">No exit price recorded</p>
          )}
        </div>
        <button onClick={onEdit} className="text-muted-foreground hover:text-foreground p-2" aria-label="Edit trade">
          <Pencil className="size-4" />
        </button>
        <button onClick={onDelete} className="text-muted-foreground hover:text-destructive p-2">
          <Trash2 className="size-4" />
        </button>
      </div>
    </li>
  );
}

// ─── Closed-trade grouping ───────────────────────────────────────────────────
type GroupBy = "date" | "symbol-date" | "flat";

const signedInr = (n: number) => `${n >= 0 ? "+" : ""}${inr(n)}`;

const GROUP_BY_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: "date", label: "📅 By Date" },
  { value: "symbol-date", label: "🏷️ By Symbol & Date" },
  { value: "flat", label: "📋 Flat List" },
];

function GroupBySwitcher({ value, onChange }: { value: GroupBy; onChange: (v: GroupBy) => void }) {
  return (
    <div className="inline-flex items-center gap-1 p-1 rounded-xl border border-glass-border bg-white/[0.03] w-fit flex-wrap">
      {GROUP_BY_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
            value === opt.value
              ? "gradient-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/** Wins/losses only ever count trades WITH realized P&L data — same convention as PerformanceRibbon, for the same reason (a manually-closed trade with no exit price recorded has nothing to net). */
function summarizeSession(trades: Trade[]) {
  const realized = (t: Trade) => t.netPnl ?? t.pnl;
  const withPnl = trades.filter((t) => realized(t) !== undefined);
  const netPnl = withPnl.reduce((s, t) => s + (realized(t) as number), 0);
  const wins = withPnl.filter((t) => (realized(t) as number) > 0).length;
  const losses = withPnl.filter((t) => (realized(t) as number) < 0).length;
  const charges = trades.reduce((s, t) => s + (t.charges ?? 0), 0);
  return { count: trades.length, hasPnl: withPnl.length > 0, netPnl, wins, losses, charges };
}

/** "" (no exit date recorded) -> a fallback label; otherwise "21 Aug 2026 · Thursday". */
function sessionDateLabel(day: string): string {
  if (!day) return "No exit date recorded";
  const weekday = new Date(`${day}T00:00:00.000Z`).toLocaleDateString("en-IN", { weekday: "long" });
  return `${fmtDate(day)} · ${weekday}`;
}

/**
 * Dispatches to one of the three grouping shapes. `trades` is expected
 * already scoped to one desk view (equity or F&O) by the caller — this
 * component only ever groups/sorts what it's handed, never filters by
 * asset class itself.
 */
function GroupedClosedTrades({
  trades,
  groupBy,
  partitionLabel,
  onEdit,
  onDelete,
  fnoExtra,
}: {
  trades: Trade[];
  groupBy: GroupBy;
  partitionLabel: (id: string) => string;
  onEdit: (t: Trade) => void;
  onDelete: (t: Trade) => void;
  fnoExtra?: (t: Trade) => React.ReactNode;
}) {
  const card = (t: Trade) => (
    <ClosedTradeCard
      key={t.id}
      t={t}
      partitionName={partitionLabel(t.partition)}
      onEdit={() => onEdit(t)}
      onDelete={() => onDelete(t)}
      rightExtra={fnoExtra?.(t)}
    />
  );

  if (groupBy === "flat") {
    return <ul className="space-y-2">{trades.map(card)}</ul>;
  }

  // Exit day, UTC-sliced — same convention PnlHeatmap and TradeImportModal's
  // dupKey already use, so a trade lands in the same "day" everywhere it's
  // grouped across the app. "" (no exitDate) buckets separately rather than
  // being dropped, so a data gap is visible instead of silently vanishing.
  const exitDay = (t: Trade) => (t.exitDate ? t.exitDate.slice(0, 10) : "");

  if (groupBy === "date") {
    const groups = new Map<string, Trade[]>();
    for (const t of trades) {
      const k = exitDay(t);
      const list = groups.get(k) ?? [];
      list.push(t);
      groups.set(k, list);
    }
    const sortedKeys = [...groups.keys()].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
    return (
      <div className="space-y-3">
        {sortedKeys.map((day) => (
          <DaySessionCard key={day || "unknown"} day={day} trades={groups.get(day)!} renderCard={card} />
        ))}
      </div>
    );
  }

  // "symbol-date" — grouped by UNDERLYING, not raw ticker: RELIANCE24AUG2900CE,
  // RELIANCE24AUG2950CE, and RELIANCE24SEPFUT all collapse into one
  // "RELIANCE" master card instead of three separate ones, since they're the
  // same underlying position risk even though every strike/expiry is a
  // distinct ticker string. Most-recently-traded underlying first; each
  // master card splits into its own per-day session blocks underneath so
  // different trading days for the same underlying never merge.
  const bySymbol = new Map<string, Trade[]>();
  for (const t of trades) {
    const underlying = getUnderlyingSymbol(t.ticker);
    const list = bySymbol.get(underlying) ?? [];
    list.push(t);
    bySymbol.set(underlying, list);
  }
  const latestExit = (list: Trade[]) =>
    list.reduce((m, t) => (t.exitDate && t.exitDate > m ? t.exitDate : m), "");
  const symbolKeys = [...bySymbol.keys()].sort((a, b) =>
    latestExit(bySymbol.get(b)!).localeCompare(latestExit(bySymbol.get(a)!)),
  );

  return (
    <div className="space-y-3">
      {symbolKeys.map((symbol) => {
        const symbolTrades = bySymbol.get(symbol)!;
        const symbolStats = summarizeSession(symbolTrades);
        const sessions = new Map<string, Trade[]>();
        for (const t of symbolTrades) {
          const k = exitDay(t);
          const list = sessions.get(k) ?? [];
          list.push(t);
          sessions.set(k, list);
        }
        const sessionKeys = [...sessions.keys()].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
        return (
          <div key={symbol} className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
            <div className="flex items-center justify-between gap-3 flex-wrap mb-3 pb-3 border-b border-white/[0.06]">
              <p className="text-sm font-display font-semibold tracking-wider">{symbol}</p>
              <div className="flex items-center gap-3">
                <span className="text-[11px] text-muted-foreground">
                  {symbolStats.count} trade{symbolStats.count !== 1 ? "s" : ""}
                </span>
                <span
                  className={`tnum text-sm font-semibold ${
                    symbolStats.hasPnl
                      ? symbolStats.netPnl >= 0
                        ? PNL_EMERALD
                        : PNL_ROSE
                      : "text-muted-foreground"
                  }`}
                >
                  <Sensitive>{symbolStats.hasPnl ? signedInr(symbolStats.netPnl) : "—"}</Sensitive>
                </span>
              </div>
            </div>
            <div className="space-y-2">
              {sessionKeys.map((day) => (
                <SessionBlock key={day || "unknown"} day={day} trades={sessions.get(day)!} renderCard={card} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** "By Date" mode's per-day container — collapsible, full session stats in the header. */
function DaySessionCard({
  day,
  trades,
  renderCard,
}: {
  day: string;
  trades: Trade[];
  renderCard: (t: Trade) => React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const stats = summarizeSession(trades);
  return (
    <section className="glass rounded-2xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 p-4 hover:bg-white/5 transition-colors flex-wrap text-left"
      >
        <div>
          <p className="text-sm font-display font-semibold tracking-tight">{sessionDateLabel(day)}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {stats.count} trade{stats.count !== 1 ? "s" : ""} · {stats.wins}W · {stats.losses}L
            {stats.charges > 0 && (
              <>
                {" "}
                · Charges <Sensitive>{inr(stats.charges)}</Sensitive>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`tnum text-sm font-semibold ${
              stats.hasPnl ? (stats.netPnl >= 0 ? PNL_EMERALD : PNL_ROSE) : "text-muted-foreground"
            }`}
          >
            <Sensitive>{stats.hasPnl ? signedInr(stats.netPnl) : "—"}</Sensitive>
          </span>
          {open ? (
            <ChevronUp className="size-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="size-4 text-muted-foreground" />
          )}
        </div>
      </button>
      {open && (
        <ul className="space-y-2 px-4 pb-4 pt-1 border-t border-glass-border">{trades.map(renderCard)}</ul>
      )}
    </section>
  );
}

/** "By Symbol & Date" mode's per-session block, nested under a symbol group — lighter weight than DaySessionCard since the ticker badge already lives one level up. */
function SessionBlock({
  day,
  trades,
  renderCard,
}: {
  day: string;
  trades: Trade[];
  renderCard: (t: Trade) => React.ReactNode;
}) {
  const stats = summarizeSession(trades);
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.015] p-3">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
        {/* Lighter weight + smaller than the master symbol header on purpose —
            this is a sub-header one level down, not a second title. */}
        <p className="text-[11px] font-medium text-muted-foreground">
          {day ? fmtDate(day) : "No exit date recorded"} · {stats.count} trade{stats.count !== 1 ? "s" : ""}
        </p>
        <span
          className={`tnum text-xs font-semibold ${
            stats.hasPnl ? (stats.netPnl >= 0 ? PNL_EMERALD : PNL_ROSE) : "text-muted-foreground"
          }`}
        >
          <Sensitive>{stats.hasPnl ? signedInr(stats.netPnl) : "—"}</Sensitive>
        </span>
      </div>
      <ul className="space-y-2">{trades.map(renderCard)}</ul>
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
