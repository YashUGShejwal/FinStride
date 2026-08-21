import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  PieChart, Pie, Cell, ResponsiveContainer,
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import {
  PieChart as PieChartIcon, TrendingUp, X, Filter,
  Plus, History, ChevronDown, ChevronUp, Trash2, TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import {
  useStore,
  getSnapshotTargets,
  type PartitionId,
  type PortfolioSnapshot,
  type SnapshotTarget,
} from "@/lib/store";
import { inr, fmtDate, todayLocalISO } from "@/lib/format";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { Sensitive } from "@/components/Sensitive";
import { SpotlightCard } from "@/components/ui/SpotlightCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

type AnalyticsSearch = { action?: "add-snapshot" };

export const Route = createFileRoute("/_authenticated/analytics")({
  validateSearch: (search: Record<string, unknown>): AnalyticsSearch => ({
    action: search.action === "add-snapshot" ? "add-snapshot" : undefined,
  }),
  component: AnalyticsPage,
});

// ─── Dark theme colours per snapshot target ────────────────────────────────
// Hand-picked for the 4 built-in defaults; any custom partition or bank
// account falls back to a hue cycled by its position in the target list.
const PARTITION_COLORS: Partial<Record<string, string>> = {
  "Long-Term Portfolio":  "oklch(0.72 0.18 250)", // blue
  "Primary Broker":       "oklch(0.72 0.18 155)", // green
  "International Broker": "oklch(0.72 0.15 290)", // purple
  "Cash":                 "oklch(0.78 0.14 80)",  // amber
};
const FALLBACK_HUES = [20, 340, 200, 60, 130, 280] as const;
function colorForPartition(key: string, index: number): string {
  return PARTITION_COLORS[key] ?? `oklch(0.72 0.16 ${FALLBACK_HUES[index % FALLBACK_HUES.length]})`;
}

// Recharts needs hex/rgb for the legend dot; provide a parallel hex map + fallback
const PARTITION_HEX: Partial<Record<string, string>> = {
  "Long-Term Portfolio":  "#4f8ef7",
  "Primary Broker":       "#3ecf75",
  "International Broker": "#a78bfa",
  "Cash":                 "#f59e0b",
};
const FALLBACK_HEX = ["#fb7185", "#f472b6", "#38bdf8", "#facc15", "#34d399", "#c084fc"] as const;
function hexForPartition(key: string, index: number): string {
  return PARTITION_HEX[key] ?? FALLBACK_HEX[index % FALLBACK_HEX.length];
}

// ─── Filter state ──────────────────────────────────────────────────────────
type AnalyticsFilter = {
  partitions: PartitionId[];
  dateFrom?: string;
  dateTo?: string;
};

// ─── Total Capital vs Investments Only ─────────────────────────────────────
type ViewMode = "total" | "investments";
const VIEW_MODE_KEY = "finstride_analytics_view_mode";
const VIEW_MODES: readonly { key: ViewMode; label: string }[] = [
  { key: "total", label: "Total Capital" },
  { key: "investments", label: "Investments Only" },
];

/**
 * Liquid ids in the unified snapshot-target list: liquid broker partitions
 * (category or purpose "liquid" — the built-in "Cash" bucket) AND every
 * bank/cash account mode. getSnapshotTargets() already classifies both sides
 * into SnapshotTarget.group, so this just projects the liquid ids into a Set;
 * the components below wrap it in an id-based isLiquidPartition(id) check.
 */
function liquidTargetIds(targets: readonly SnapshotTarget[]): Set<string> {
  return new Set(targets.filter((t) => t.group === "liquid").map((t) => t.id));
}

// ─── Recharts custom tooltips ──────────────────────────────────────────────
function DarkTooltip({
  active, payload, label,
}: {
  active?: boolean;
  payload?: Array<{ color: string; dataKey: string; name?: string; value: number }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass-strong rounded-xl border border-glass-border p-3 text-xs space-y-1 shadow-xl">
      <p className="text-muted-foreground mb-1">{label}</p>
      {payload.map((e, i) => (
        <p key={i} style={{ color: e.color }} className="font-medium tnum">
          {e.name ?? e.dataKey}: <Sensitive>{inr(e.value)}</Sensitive>
        </p>
      ))}
    </div>
  );
}

function PieTooltip({
  active, payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: { name: string; value: number; pct: number }; color: string }>;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="glass-strong rounded-xl border border-glass-border p-3 text-xs shadow-xl space-y-0.5">
      <p className="font-semibold text-foreground">{d.name}</p>
      <p className="tnum text-muted-foreground">
        <Sensitive>{inr(d.value)}</Sensitive>
      </p>
      <p className="tnum text-muted-foreground">{d.pct.toFixed(1)}%</p>
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────
function AnalyticsPage() {
  const {
    transactions, portfolioSnapshots, latestSnapshotValues,
    brokerPartitions, accountModes, partitionLabel, isStealthMode,
  } = useStore();

  // Starts on "Total Capital" (SSR has no localStorage) and corrects after
  // mount if "Investments Only" was persisted — same one-tick-correction
  // tradeoff this file already accepts for `mounted` below and that
  // isStealthMode uses elsewhere in this app.
  const [viewMode, setViewMode] = useState<ViewMode>("total");
  useEffect(() => {
    try {
      if (localStorage.getItem(VIEW_MODE_KEY) === "investments") setViewMode("investments");
    } catch {
      // Ignore — stays on the default "Total Capital" view this session.
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_MODE_KEY, viewMode);
    } catch {
      // Ignore — the in-memory choice still applies for this session.
    }
  }, [viewMode]);

  // The unified snapshot-target list: broker partitions PLUS bank/cash
  // accounts. Everything below derives from this (not brokerPartitions
  // directly), so bank accounts participate in every chart/tile/dropdown and
  // "Investments Only" propagates to every consumer of ALL_PARTITIONS /
  // activePartitionIds without each needing its own view-mode check.
  const snapshotTargets = useMemo(
    () => getSnapshotTargets(brokerPartitions, accountModes),
    [brokerPartitions, accountModes],
  );
  const targetById = useMemo(
    () => new Map(snapshotTargets.map((t) => [t.id, t])),
    [snapshotTargets],
  );
  const resolveSnapshotTarget = (id: PartitionId): SnapshotTarget | undefined => targetById.get(id);
  // Falls back to partitionLabel (which itself falls back to the raw id) for
  // orphaned/legacy ids that no current target claims.
  const targetLabel = (id: PartitionId): string => resolveSnapshotTarget(id)?.name ?? partitionLabel(id);

  const liquidIds = useMemo(() => liquidTargetIds(snapshotTargets), [snapshotTargets]);
  /** True if `id` belongs to a liquid broker partition OR any bank/cash account mode. */
  const isLiquidPartition = (id: string): boolean => liquidIds.has(id);

  const viewTargets = useMemo(
    () => (viewMode === "investments" ? snapshotTargets.filter((t) => t.group === "investment") : snapshotTargets),
    [snapshotTargets, viewMode],
  );
  const ALL_PARTITIONS = useMemo(() => viewTargets.map((t) => t.id), [viewTargets]);
  // A target's position in the canonical, UNFILTERED list (not viewTargets) —
  // used as the seed for fallback colors so the same target keeps the same
  // color regardless of view mode or which locally-filtered/reordered array
  // (pieData, the active partition filter, etc.) happens to be rendering it.
  const canonicalPartitionIndex = (key: PartitionId) =>
    Math.max(0, snapshotTargets.findIndex((t) => t.id === key));
  const [mounted, setMounted] = useState(false);
  const [filters, setFilters] = useState<AnalyticsFilter>(() => ({ partitions: [...ALL_PARTITIONS] }));
  const [addSnapshotOpen, setAddSnapshotOpen] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  // Deep-link intent from the command palette: ?action=add-snapshot opens the
  // dialog, then the param is cleared so refresh/back doesn't re-trigger it.
  const { action } = Route.useSearch();
  const nav = useNavigate({ from: Route.fullPath });
  useEffect(() => {
    if (action === "add-snapshot") {
      setAddSnapshotOpen(true);
      void nav({ search: {}, replace: true });
    }
  }, [action, nav]);

  // Resets the fine-grained partition selection to "everything in the new
  // scope" whenever the view toggle flips. Deliberately scoped to viewMode
  // alone (not brokerPartitions) — switching Total Capital <-> Investments
  // Only should reset the selection, but an unrelated partition added/removed
  // in Settings while this page is open should NOT silently blow away a
  // selection the user already narrowed by hand.
  useEffect(() => {
    setFilters((f) => ({ ...f, partitions: [...ALL_PARTITIONS] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode]);

  // ── Global KPI math (unfiltered — transfers are portfolio-wide) ────────────
  const summary = useMemo(() => {
    const totalDeposits = transactions
      .filter((t) => t.category === "Capital Transfer (Out)")
      .reduce((s, t) => s + t.amount, 0);
    const totalWithdrawals = transactions
      .filter((t) => t.category === "Capital Transfer (In)")
      .reduce((s, t) => s + t.amount, 0);
    const netInvestment = totalDeposits - totalWithdrawals;
    const currentValue = Object.values(latestSnapshotValues).reduce<number>(
      (s, v) => s + (v ?? 0), 0,
    );
    const absoluteReturn = currentValue - netInvestment;
    const percentageReturn = netInvestment > 0 ? (absoluteReturn / netInvestment) * 100 : 0;
    return { totalDeposits, totalWithdrawals, netInvestment, currentValue, absoluteReturn, percentageReturn };
  }, [transactions, latestSnapshotValues]);

  // ── View-scoped current value (excludes liquid partitions AND bank/cash
  // accounts when the toggle above is set to "Investments Only") ─────────────
  // Unknown/legacy ids (not in the snapshot-target list — see the Snapshot
  // History fix elsewhere on this page) default to INCLUDED here: we can't
  // prove they're liquid, and treating unclassifiable money as investment
  // capital is safer than silently dropping it from the total.
  const investmentValue = useMemo(
    () =>
      Object.entries(latestSnapshotValues).reduce(
        (sum, [key, v]) => (liquidIds.has(key) ? sum : sum + (v ?? 0)),
        0,
      ),
    [latestSnapshotValues, liquidIds],
  );
  const hasInvestmentSnapshot = useMemo(
    () => portfolioSnapshots.some((s) => !liquidIds.has(s.brokerPartition)),
    [portfolioSnapshots, liquidIds],
  );
  // Absolute/percentage return recomputed against the view-scoped current
  // value too — leaving them pinned to the all-partition total while Current
  // Value visibly changes next to them would make the KPI row self-contradict.
  const displaySummary = useMemo(() => {
    const currentValue = viewMode === "investments" ? investmentValue : summary.currentValue;
    const absoluteReturn = currentValue - summary.netInvestment;
    const percentageReturn =
      summary.netInvestment > 0 ? (absoluteReturn / summary.netInvestment) * 100 : 0;
    return { currentValue, absoluteReturn, percentageReturn };
  }, [summary, investmentValue, viewMode]);

  // Manual multi-select on top of the current view scope — falls back to
  // "everything the view mode allows" when nothing's been narrowed by hand.
  // Shared by the pie/line charts, the Line-chart render below, and the
  // broker-breakdown empty-state, which all previously repeated this exact
  // ternary independently.
  const activePartitionIds = useMemo(
    () => (filters.partitions.length > 0 ? filters.partitions : ALL_PARTITIONS),
    [filters.partitions, ALL_PARTITIONS],
  );

  // ── Pie chart data (filtered by selected targets) ─────────────────────────
  const pieData = useMemo(() => {
    const items = activePartitionIds
      .map((key) => {
        const t = targetById.get(key);
        return { name: t?.name ?? key, key, value: latestSnapshotValues[key] ?? 0 };
      })
      .filter((d) => d.value > 0);
    const total = items.reduce((s, d) => s + d.value, 0);
    return items.map((d) => ({ ...d, pct: total > 0 ? (d.value / total) * 100 : 0 }));
  }, [latestSnapshotValues, activePartitionIds, targetById]);

  // ── Line chart data (filtered by partitions + date range, carry-forward) ──
  const lineData = useMemo(() => {
    const activePartitions = activePartitionIds;

    // All dates in range that have at least one snapshot
    const allDates = [
      ...new Set(
        portfolioSnapshots
          .filter((s) => {
            if (filters.dateFrom && s.snapshotDate < filters.dateFrom) return false;
            if (filters.dateTo   && s.snapshotDate > filters.dateTo)   return false;
            return true;
          })
          .map((s) => s.snapshotDate),
      ),
    ].sort();

    return allDates
      .map((date) => {
        const point: Record<string, unknown> = {
          date: new Date(date).toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
          fullDate: date,
        };
        for (const partition of activePartitions) {
          const exact = portfolioSnapshots.find(
            (s) => s.brokerPartition === partition && s.snapshotDate === date,
          );
          if (exact) {
            point[partition] = exact.currentValue;
          } else {
            // Carry-forward: most recent row before this date
            const prev = portfolioSnapshots
              .filter((s) => s.brokerPartition === partition && s.snapshotDate < date)
              .sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate))[0];
            if (prev) point[partition] = prev.currentValue;
          }
        }
        return point;
      })
      .filter((pt) => activePartitions.some((p) => pt[p] !== undefined));
  }, [portfolioSnapshots, filters, activePartitionIds]);

  // ── Partition chip helpers ─────────────────────────────────────────────────
  const togglePartition = (key: PartitionId) => {
    setFilters((f) => {
      const already = f.partitions.includes(key);
      const next = already ? f.partitions.filter((p) => p !== key) : [...f.partitions, key];
      return { ...f, partitions: next.length === 0 ? [...ALL_PARTITIONS] : next };
    });
  };

  const removePartitionChip = (key: PartitionId) => {
    setFilters((f) => {
      const next = f.partitions.filter((p) => p !== key);
      return { ...f, partitions: next.length === 0 ? [...ALL_PARTITIONS] : next };
    });
  };

  const allSelected = filters.partitions.length === ALL_PARTITIONS.length;

  // ── Breakdown card rows ────────────────────────────────────────────────────
  // Real value rows from pieData when anything in scope has a positive value;
  // otherwise explicit ₹0 rows for every target the scope covers — more
  // informative than collapsing the card to one generic placeholder, whether
  // nothing's ever been recorded or "Investments Only" is active and every
  // snapshot so far happens to be liquid.
  const breakdownRows =
    pieData.length > 0
      ? pieData.map((d) => ({ key: d.key, name: d.name, value: d.value, pct: d.pct, hasData: true }))
      : activePartitionIds.map((key) => ({
          key, name: targetLabel(key), value: 0, pct: 0, hasData: false,
        }));
  // "Total Capital" splits the rows into Investments vs a distinct
  // "Bank / Liquid" section; "Investments Only" already excludes every liquid
  // target from scope, so it stays a single flat (untitled) section.
  const breakdownSections: { title: string | null; rows: typeof breakdownRows }[] = (
    viewMode === "total"
      ? [
          { title: "Investments", rows: breakdownRows.filter((r) => !isLiquidPartition(r.key)) },
          { title: "Bank / Liquid", rows: breakdownRows.filter((r) => isLiquidPartition(r.key)) },
        ]
      : [{ title: null, rows: breakdownRows }]
  ).filter((s) => s.rows.length > 0);

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Module</p>
          <h1 className="text-3xl md:text-4xl font-display font-semibold tracking-tight mt-1">
            Portfolio <span className="text-gradient">analytics</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-2">
            Investment returns, allocation breakdown, and value trends over time.
          </p>
        </div>
        <Button
          onClick={() => setAddSnapshotOpen(true)}
          className="gradient-primary text-primary-foreground border-0 gap-2 h-10 shrink-0"
        >
          <Plus className="size-4" /> Add Snapshot
        </Button>
      </header>

      <AddSnapshotDialog open={addSnapshotOpen} onOpenChange={setAddSnapshotOpen} />

      {/* ── Global KPI tiles ─────────────────────────────────────────────── */}
      <section className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <KpiTile label="Total Deposits" value={summary.totalDeposits} format={inr} tone="neutral" />
        <KpiTile label="Total Withdrawals" value={summary.totalWithdrawals} format={inr} tone="neutral" />
        <KpiTile label="Net Investment" value={summary.netInvestment} format={inr} tone="neutral" />
        <KpiTile
          label="Current Value"
          value={displaySummary.currentValue}
          format={inr}
          tone="primary"
          subtext={
            viewMode === "investments"
              ? hasInvestmentSnapshot
                ? "Active market assets"
                : "(no snapshot yet)"
              : portfolioSnapshots.length === 0
                ? "(no snapshot yet)"
                : undefined
          }
        />
        <KpiTile
          label="Absolute Return"
          value={displaySummary.absoluteReturn}
          format={(n) => (n >= 0 ? "+" : "−") + inr(Math.abs(n))}
          tone={displaySummary.absoluteReturn >= 0 ? "success" : "danger"}
        />
        <KpiTile
          label="Return %"
          value={displaySummary.percentageReturn}
          format={(n) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`}
          tone={displaySummary.percentageReturn >= 0 ? "success" : "danger"}
          subtext={
            viewMode === "investments"
              ? "Returns computed against investment partitions only"
              : "Returns computed against all partitions"
          }
        />
      </section>

      {/* ── Filter bar ───────────────────────────────────────────────────── */}
      <section className="glass rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Filter className="size-4 text-muted-foreground" />
            <span className="text-sm font-semibold">Chart filters</span>
            <span className="text-xs text-muted-foreground ml-1">(applies to charts below only)</span>
          </div>
          <div className="inline-flex items-center gap-1 p-1 rounded-xl glass shrink-0">
            {VIEW_MODES.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => setViewMode(m.key)}
                aria-pressed={viewMode === m.key}
                className={`px-3.5 py-1.5 rounded-lg text-sm transition-colors ${
                  viewMode === m.key
                    ? "bg-white/[0.08] text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Partition multi-select */}
          <div className="md:col-span-1 space-y-1.5">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Partitions</Label>
            <Select
              value=""
              onValueChange={(v) => {
                if (v === "__all__") {
                  setFilters((f) => ({ ...f, partitions: [...ALL_PARTITIONS] }));
                } else {
                  togglePartition(v as PartitionId);
                }
              }}
            >
              <SelectTrigger className="bg-input/40 border-glass-border text-sm h-9">
                <SelectValue
                  placeholder={
                    allSelected
                      ? "All partitions"
                      : `${filters.partitions.length} selected`
                  }
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__" className={allSelected ? "font-semibold" : ""}>
                  All partitions
                </SelectItem>
                {/* viewTargets, not snapshotTargets — a liquid target (Cash, a bank
                    account) must not be manually re-selectable while "Investments
                    Only" is active, or picking it here would silently undo what the
                    view toggle just excluded. */}
                {viewTargets.map((t) => {
                  const sel = filters.partitions.includes(t.id);
                  return (
                    <SelectItem key={t.id} value={t.id} className={sel ? "font-semibold" : "text-muted-foreground"}>
                      {t.name}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
          {/* Date range */}
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">From date</Label>
            <Input
              type="date"
              value={filters.dateFrom ?? ""}
              onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value || undefined }))}
              className="bg-input/40 border-glass-border h-9 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">To date</Label>
            <Input
              type="date"
              value={filters.dateTo ?? ""}
              onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value || undefined }))}
              className="bg-input/40 border-glass-border h-9 text-sm"
            />
          </div>
        </div>

        {/* Active partition chips */}
        {!allSelected && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {filters.partitions.map((key) => (
              <button
                key={key}
                onClick={() => removePartitionChip(key)}
                className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full border border-glass-border bg-white/8 text-muted-foreground hover:text-foreground transition-colors"
              >
                {targetLabel(key)} <X className="size-3" />
              </button>
            ))}
          </div>
        )}
      </section>

      {/* ── Pie + broker list ────────────────────────────────────────────── */}
      <section className="grid md:grid-cols-2 gap-4">
        {/* Allocation pie */}
        <div className="glass rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <PieChartIcon className="size-4 text-primary" />
            <h2 className="font-display font-semibold tracking-tight">Portfolio allocation</h2>
          </div>
          {mounted && pieData.length > 0 ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    dataKey="value"
                    labelLine={false}
                    label={({ name, pct }: { name: string; pct: number }) =>
                      `${name}: ${pct.toFixed(0)}%`
                    }
                  >
                    {pieData.map((d) => (
                      <Cell
                        key={d.key}
                        fill={colorForPartition(d.key, canonicalPartitionIndex(d.key))}
                        stroke="transparent"
                      />
                    ))}
                  </Pie>
                  <Tooltip content={<PieTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyChart icon={<PieChartIcon className="size-10 opacity-30" />} text="No snapshot data" />
          )}
        </div>

        {/* Breakdown list — grouped into Investments vs Bank / Liquid in Total Capital view */}
        <div className="glass rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <PieChartIcon className="size-4 text-[oklch(0.72_0.18_155)]" />
            <h2 className="font-display font-semibold tracking-tight">Breakdown by holding</h2>
          </div>
          {breakdownSections.length > 0 ? (
            <div className="space-y-4">
              {breakdownSections.map((section) => (
                <div key={section.title ?? "all"} className="space-y-1.5">
                  {section.title && (
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                      {section.title}
                    </p>
                  )}
                  <ul className="space-y-2">
                    {section.rows.map((d) => (
                      <li
                        key={d.key}
                        className="flex items-center justify-between gap-3 p-3 rounded-xl border border-glass-border bg-white/3"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span
                            className={`size-3 rounded-full shrink-0${d.hasData ? "" : " opacity-40"}`}
                            style={{ backgroundColor: hexForPartition(d.key, canonicalPartitionIndex(d.key)) }}
                          />
                          <div className="min-w-0">
                            <p className={`text-sm font-medium truncate${d.hasData ? "" : " text-muted-foreground"}`}>
                              {d.name}
                            </p>
                            {d.hasData ? (
                              <p className="text-[11px] text-muted-foreground">
                                <span className="tnum">{d.pct.toFixed(1)}%</span> of portfolio
                              </p>
                            ) : (
                              <p className="text-[11px] text-muted-foreground/70">(no snapshot yet)</p>
                            )}
                          </div>
                        </div>
                        {d.hasData ? (
                          <p className="font-semibold tnum text-sm shrink-0">
                            <Sensitive>
                              <AnimatedNumber value={d.value} format={inr} />
                            </Sensitive>
                          </p>
                        ) : (
                          <p className="font-semibold tnum text-sm text-muted-foreground shrink-0">{inr(0)}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : (
            // Degenerate case: the current view mode excludes every target that
            // exists (e.g. "Investments Only" with nothing but liquid targets
            // defined at all) — there's nothing to list a zero row for, so fall
            // back to the plain placeholder instead of an empty list.
            <EmptyChart icon={<PieChartIcon className="size-10 opacity-30" />} text="No data for selected partitions" />
          )}
        </div>
      </section>

      {/* ── Portfolio value over time ─────────────────────────────────────── */}
      <section className="glass rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="size-4 text-accent" />
          <h2 className="font-display font-semibold tracking-tight">Portfolio value over time</h2>
        </div>
        {mounted && lineData.length > 0 ? (
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={lineData}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="oklch(0.5 0 0 / 0.15)"
                />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: "oklch(0.65 0 0)" }}
                  angle={-35}
                  textAnchor="end"
                  height={50}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "oklch(0.65 0 0)" }}
                  // Recharts renders ticks as raw SVG text that the Sensitive
                  // wrapper can't blur, so stealth mode masks them outright.
                  tickFormatter={(v: number) =>
                    isStealthMode ? "₹•••" : `₹${(v / 1000).toFixed(0)}K`
                  }
                  width={60}
                />
                <Tooltip content={<DarkTooltip />} />
                <Legend
                  wrapperStyle={{ fontSize: 11, paddingTop: 12 }}
                />
                {activePartitionIds.map((key) => (
                  <Line
                    key={key}
                    type="monotone"
                    dataKey={key}
                    name={targetLabel(key)}
                    stroke={hexForPartition(key, canonicalPartitionIndex(key))}
                    strokeWidth={2.5}
                    dot={{ r: 4, fill: hexForPartition(key, canonicalPartitionIndex(key)), strokeWidth: 0 }}
                    activeDot={{ r: 6 }}
                    connectNulls={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyChart
            icon={<TrendingUp className="size-10 opacity-30" />}
            text={portfolioSnapshots.length === 0 ? "Log portfolio snapshots on the Swing page to see trends" : "No data matches the selected filters"}
          />
        )}
      </section>

      {/* ── Snapshot history ────────────────────────────────────────────────── */}
      <SnapshotHistorySection />
    </div>
  );
}

// ─── Add Snapshot dialog ───────────────────────────────────────────────────
function pinToNoonUTC(dateOnly: string): string {
  return `${dateOnly}T12:00:00.000Z`;
}

function AddSnapshotDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { addPortfolioSnapshots, brokerPartitions, accountModes } = useStore();
  // The unified target list: investment partitions first, then bank/cash
  // accounts — the same two groups the dropdown below renders under headings.
  const snapshotTargets = useMemo(
    () => getSnapshotTargets(brokerPartitions, accountModes),
    [brokerPartitions, accountModes],
  );
  const investmentTargets = snapshotTargets.filter((t) => t.group === "investment");
  const liquidTargets = snapshotTargets.filter((t) => t.group === "liquid");
  const targetName = (id: PartitionId) => snapshotTargets.find((t) => t.id === id)?.name ?? id;

  const [date, setDate] = useState(todayLocalISO);
  const [partition, setPartition] = useState<PartitionId>(
    () => snapshotTargets[0]?.id ?? "Cash",
  );
  const [value, setValue] = useState("");
  const [notes, setNotes] = useState("");

  // Keeps the selection valid when the target list changes under the mounted
  // dialog — remote settings arriving after mount (the initializer above runs
  // against the pre-hydration default list), or a target deleted in Settings.
  // Same clamp pattern the cashflow account picker and swing partition picker
  // use; without it a stale selection submits an orphaned snapshot id.
  useEffect(() => {
    if (snapshotTargets.length === 0) return;
    if (snapshotTargets.some((t) => t.id === partition)) return;
    setPartition(snapshotTargets[0].id);
  }, [snapshotTargets, partition]);

  const resetForm = () => {
    setDate(todayLocalISO());
    setPartition(snapshotTargets[0]?.id ?? "Cash");
    setValue("");
    setNotes("");
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!date) {
      toast.error("Pick a date");
      return;
    }
    const n = Number(value);
    if (isNaN(n) || n < 0) {
      toast.error("Enter a valid current value");
      return;
    }
    addPortfolioSnapshots(
      [{ brokerPartition: partition, currentValue: n }],
      notes.trim() || undefined,
      pinToNoonUTC(date),
    );
    toast.success(`Snapshot saved for ${targetName(partition)}`);
    resetForm();
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) resetForm();
      }}
    >
      <DialogContent className="glass-strong border-glass-border">
        <DialogHeader>
          <DialogTitle>Add portfolio snapshot</DialogTitle>
          <DialogDescription>
            Record a point-in-time value for one investment partition or bank account.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Date
              </Label>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="bg-input/40 border-glass-border mt-1.5"
                required
              />
            </div>
            <div>
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Snapshot Target
              </Label>
              <Select value={partition} onValueChange={(v: PartitionId) => setPartition(v)}>
                <SelectTrigger className="bg-input/40 border-glass-border mt-1.5">
                  <SelectValue placeholder="Select target" />
                </SelectTrigger>
                <SelectContent>
                  {investmentTargets.length > 0 && (
                    <SelectGroup>
                      <SelectLabel className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                        Investment Partitions
                      </SelectLabel>
                      {investmentTargets.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                  {liquidTargets.length > 0 && (
                    <SelectGroup>
                      <SelectLabel className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                        Bank Accounts &amp; Liquid Reserves
                      </SelectLabel>
                      {liquidTargets.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Current Value (₹)
            </Label>
            <div className="mt-1.5 relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                ₹
              </span>
              <Input
                type="number"
                step="1"
                min="0"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="bg-input/40 border-glass-border tnum pl-7"
                placeholder="0"
                required
              />
            </div>
          </div>

          <div>
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Notes (optional)
            </Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="bg-input/40 border-glass-border mt-1.5"
              placeholder="Post-market valuation, rebalance note…"
            />
          </div>

          <DialogFooter>
            <Button type="submit" className="gradient-primary text-primary-foreground border-0 gap-2">
              <Plus className="size-4" /> Save snapshot
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Must match the toast `duration` below — otherwise the Undo action can
// disappear from screen before the deferred delete it's meant to cancel fires.
const UNDO_WINDOW_MS = 5000;

// ─── Snapshot history (grouped by partition, delete-with-undo) ────────────
function SnapshotHistorySection() {
  const {
    portfolioSnapshots, deletePortfolioSnapshot, clearAllSnapshots,
    brokerPartitions, accountModes, isStealthMode,
  } = useStore();
  // History rows can name any target in the unified list — a broker partition
  // OR a bank/cash account (see getSnapshotTargets) — so labels resolve
  // against that list, not brokerPartitions alone.
  const snapshotTargets = useMemo(
    () => getSnapshotTargets(brokerPartitions, accountModes),
    [brokerPartitions, accountModes],
  );
  const targetById = useMemo(
    () => new Map(snapshotTargets.map((t) => [t.id, t])),
    [snapshotTargets],
  );
  const resolveSnapshotTarget = (id: PartitionId): SnapshotTarget | undefined => targetById.get(id);
  const [expanded, setExpanded] = useState<Set<PartitionId>>(new Set());
  const [pendingDeleteIds, setPendingDeleteIds] = useState<Set<string>>(new Set());
  const deleteTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Same fallback used for the group headers below — a plain partitionLabel()
  // lookup falls back to the raw id, which would make this toast (and the
  // group header) disagree on what to call an unmapped/legacy target.
  const groupLabel = (id: PartitionId) => resolveSnapshotTarget(id)?.name ?? "Legacy Partition";

  const togglePartition = (key: PartitionId) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Optimistic delete: hide immediately, defer the actual store mutation, and
  // let an "Undo" toast action cancel it before it fires.
  const handleDelete = (snap: PortfolioSnapshot) => {
    // Guard against re-entrancy (e.g. a fast double-click on the same row
    // before the optimistic hide re-renders) orphaning a previous timer.
    const existingTimer = deleteTimers.current.get(snap.id);
    if (existingTimer) clearTimeout(existingTimer);

    setPendingDeleteIds((prev) => new Set(prev).add(snap.id));

    const timer = setTimeout(() => {
      deletePortfolioSnapshot(snap.id);
      deleteTimers.current.delete(snap.id);
      setPendingDeleteIds((prev) => {
        const next = new Set(prev);
        next.delete(snap.id);
        return next;
      });
    }, UNDO_WINDOW_MS);
    deleteTimers.current.set(snap.id, timer);

    // A toast string can't carry the Sensitive blur wrapper, so stealth mode
    // masks the balance outright instead of broadcasting it for 5 seconds.
    toast("Snapshot removed", {
      duration: UNDO_WINDOW_MS,
      description: `${groupLabel(snap.brokerPartition)} • ${isStealthMode ? "₹••••••" : inr(snap.currentValue)} • ${fmtDate(snap.snapshotDate)}`,
      action: {
        label: "Undo",
        onClick: () => {
          const t = deleteTimers.current.get(snap.id);
          if (t) {
            clearTimeout(t);
            deleteTimers.current.delete(snap.id);
          }
          setPendingDeleteIds((prev) => {
            const next = new Set(prev);
            next.delete(snap.id);
            return next;
          });
        },
      },
    });
  };

  // Cancels a Clear All in flight before it's finished clearing everything.
  const handleClearAll = () => {
    // Any single-row deletes still mid-Undo-window get folded into the bulk
    // clear immediately — their deferred timers would otherwise still fire
    // (harmlessly, since the rows are already gone either way) but their
    // "Undo" toasts would stay onscreen promising to restore a snapshot that
    // Clear All just wiped everywhere, local and remote.
    for (const t of deleteTimers.current.values()) clearTimeout(t);
    deleteTimers.current.clear();
    setPendingDeleteIds(new Set());
    clearAllSnapshots();
    toast.success("All snapshots cleared");
  };

  const visibleSnapshots = portfolioSnapshots.filter((s) => !pendingDeleteIds.has(s.id));

  // Grouped by whatever target ids are ACTUALLY PRESENT in the data, not by
  // iterating the current snapshot-target list. A snapshot can outlive the
  // partition/account it names — an imported backup naming one that was never
  // re-created locally, or data from before an earlier renaming pass — and
  // iterating the target list instead would make such a row silently
  // disappear from this page with no way to see or delete it.
  const presentIds = [...new Set(visibleSnapshots.map((s) => s.brokerPartition))];
  const knownIds = new Set(snapshotTargets.map((t) => t.id));
  const unmappedIds = presentIds.filter((id) => !knownIds.has(id));
  const orderedIds = [
    ...snapshotTargets.map((t) => t.id).filter((id) => presentIds.includes(id)),
    ...unmappedIds,
  ];
  // Known targets keep the SAME color index used everywhere else on this
  // page (their position in snapshotTargets); legacy ones get a stable index
  // past the end of that list so they never coincidentally reuse a real
  // target's color.
  const colorIndexFor = (id: PartitionId) => {
    const known = snapshotTargets.findIndex((t) => t.id === id);
    return known >= 0 ? known : snapshotTargets.length + unmappedIds.indexOf(id);
  };

  return (
    <section className="glass rounded-2xl p-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <History className="size-4 text-primary" />
          <h2 className="font-display font-semibold tracking-tight">Snapshot history</h2>
          <span className="text-xs text-muted-foreground font-normal ml-1">
            ({visibleSnapshots.length} total)
          </span>
        </div>
        {visibleSnapshots.length > 0 && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5 h-8 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="size-3.5" /> Clear All History
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="glass-strong border-glass-border">
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center gap-2">
                  <TriangleAlert className="size-4 text-destructive" /> Delete all snapshots?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to delete all historical snapshots? This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleClearAll}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Delete all snapshots
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      {visibleSnapshots.length === 0 ? (
        <EmptyChart icon={<History className="size-10 opacity-30" />} text="No snapshots recorded yet" />
      ) : (
        <div className="space-y-3">
          {orderedIds.map((id) => {
            const rows = visibleSnapshots
              .filter((s) => s.brokerPartition === id)
              .sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate));
            if (rows.length === 0) return null;

            const known = resolveSnapshotTarget(id);
            const isOpen = expanded.has(id);
            const latest = rows[0];

            return (
              <div key={id} className="rounded-xl border border-glass-border overflow-hidden">
                <button
                  type="button"
                  onClick={() => togglePartition(id)}
                  className="w-full flex items-center justify-between p-3.5 hover:bg-white/5 transition-colors"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className="size-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: hexForPartition(id, colorIndexFor(id)) }}
                    />
                    <div className="text-left min-w-0">
                      <p className="text-sm font-medium">
                        {known?.name ?? "Legacy Partition"}
                        {known && (
                          // BANK covers the whole liquid layer (bank/cash
                          // accounts AND liquid partitions like the built-in
                          // Cash bucket) — the same split the breakdown card's
                          // "Bank / Liquid" section and the add-snapshot
                          // dialog's group headings draw.
                          <span
                            className={`ml-1.5 align-middle text-[9px] font-semibold tracking-wider px-1.5 py-0.5 rounded-md border ${
                              known.group === "liquid"
                                ? "border-[oklch(0.78_0.14_80_/_0.4)] text-[oklch(0.78_0.14_80)]"
                                : "border-primary/40 text-primary"
                            }`}
                          >
                            {known.group === "liquid" ? "BANK" : "INVESTMENT"}
                          </span>
                        )}
                        {!known && (
                          <span className="ml-1.5 text-[10px] font-normal text-muted-foreground/60">
                            ({id})
                          </span>
                        )}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {rows.length} snapshot{rows.length !== 1 ? "s" : ""} • latest{" "}
                        <Sensitive>
                          <span className="tnum">{inr(latest.currentValue)}</span>
                        </Sensitive>{" "}
                        on {fmtDate(latest.snapshotDate)}
                      </p>
                    </div>
                  </div>
                  {isOpen ? (
                    <ChevronUp className="size-4 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronDown className="size-4 text-muted-foreground shrink-0" />
                  )}
                </button>

                {isOpen && (
                  <ul className="border-t border-glass-border divide-y divide-glass-border">
                    {rows.map((s) => (
                      <li key={s.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                        <div className="min-w-0">
                          <p className="text-sm font-medium tnum">
                            <Sensitive>{inr(s.currentValue)}</Sensitive>
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            {fmtDate(s.snapshotDate)}
                            {s.notes ? ` • ${s.notes}` : ""}
                          </p>
                        </div>
                        <button
                          onClick={() => handleDelete(s)}
                          title="Delete snapshot"
                          aria-label="Delete snapshot"
                          className="text-muted-foreground hover:text-destructive p-1.5 shrink-0"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ─── KPI tile ──────────────────────────────────────────────────────────────
function KpiTile({
  label,
  value,
  format,
  tone,
  subtext,
}: {
  label: string;
  value: number;
  format: (n: number) => string;
  tone: "neutral" | "primary" | "success" | "danger";
  subtext?: string;
}) {
  const color =
    tone === "primary" ? "text-primary"
    : tone === "success" ? "text-[oklch(0.78_0.16_155)]"
    : tone === "danger"  ? "text-[oklch(0.78_0.18_25)]"
    : "text-foreground";
  return (
    <SpotlightCard className="rounded-xl p-4 flex flex-col gap-1">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`text-lg font-semibold tnum ${color}`}>
        <Sensitive>
          <AnimatedNumber value={value} format={format} />
        </Sensitive>
      </p>
      {subtext && <p className="text-[10px] text-muted-foreground/70 leading-tight">{subtext}</p>}
    </SpotlightCard>
  );
}

function EmptyChart({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-muted-foreground">
      {icon}
      <p className="text-sm text-center">{text}</p>
    </div>
  );
}
