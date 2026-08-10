import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  PieChart, Pie, Cell, ResponsiveContainer,
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { PieChart as PieChartIcon, TrendingUp, X, Filter } from "lucide-react";
import {
  useStore,
  PORTFOLIO_PARTITIONS,
  type PortfolioPartitionKey,
} from "@/lib/store";
import { inr } from "@/lib/format";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/analytics")({ component: AnalyticsPage });

// ─── Dark theme colours per partition ─────────────────────────────────────
const PARTITION_COLORS: Record<PortfolioPartitionKey, string> = {
  "Zerodha Vault": "oklch(0.72 0.18 250)",   // blue
  "Dhan Swing":    "oklch(0.72 0.18 155)",   // green
  "INDmoney US":   "oklch(0.72 0.15 290)",   // purple
  "Cash":          "oklch(0.78 0.14 80)",    // amber
};

// Recharts needs hex/rgb for the legend dot; provide a parallel hex map
const PARTITION_HEX: Record<PortfolioPartitionKey, string> = {
  "Zerodha Vault": "#4f8ef7",
  "Dhan Swing":    "#3ecf75",
  "INDmoney US":   "#a78bfa",
  "Cash":          "#f59e0b",
};

// ─── Filter state ──────────────────────────────────────────────────────────
type AnalyticsFilter = {
  partitions: PortfolioPartitionKey[];
  dateFrom?: string;
  dateTo?: string;
};

const ALL_PARTITIONS = PORTFOLIO_PARTITIONS.map((p) => p.key) as PortfolioPartitionKey[];

// ─── Recharts custom tooltips ──────────────────────────────────────────────
function DarkTooltip({
  active, payload, label,
}: {
  active?: boolean;
  payload?: Array<{ color: string; dataKey: string; value: number }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass-strong rounded-xl border border-glass-border p-3 text-xs space-y-1 shadow-xl">
      <p className="text-muted-foreground mb-1">{label}</p>
      {payload.map((e, i) => (
        <p key={i} style={{ color: e.color }} className="font-medium tabular-nums">
          {e.dataKey}: {inr(e.value)}
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
      <p className="tabular-nums text-muted-foreground">{inr(d.value)}</p>
      <p className="tabular-nums text-muted-foreground">{d.pct.toFixed(1)}%</p>
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────
function AnalyticsPage() {
  const { transactions, portfolioSnapshots, latestSnapshotValues } = useStore();
  const [mounted, setMounted] = useState(false);
  const [filters, setFilters] = useState<AnalyticsFilter>({ partitions: [...ALL_PARTITIONS] });

  useEffect(() => { setMounted(true); }, []);

  // ── Global KPI math (unfiltered — transfers are portfolio-wide) ────────────
  const summary = useMemo(() => {
    const totalDeposits = transactions
      .filter((t) => t.category === "Capital Transfer (Out)")
      .reduce((s, t) => s + t.amount, 0);
    const totalWithdrawals = transactions
      .filter((t) => t.category === "Capital Transfer (In)")
      .reduce((s, t) => s + t.amount, 0);
    const netInvestment = totalDeposits - totalWithdrawals;
    const currentValue = Object.values(latestSnapshotValues).reduce(
      (s, v) => s + (v ?? 0), 0,
    );
    const absoluteReturn = currentValue - netInvestment;
    const percentageReturn = netInvestment > 0 ? (absoluteReturn / netInvestment) * 100 : 0;
    return { totalDeposits, totalWithdrawals, netInvestment, currentValue, absoluteReturn, percentageReturn };
  }, [transactions, latestSnapshotValues]);

  // ── Pie chart data (filtered by selected partitions) ──────────────────────
  const pieData = useMemo(() => {
    const active = filters.partitions.length > 0 ? filters.partitions : ALL_PARTITIONS;
    const items = active
      .map((key) => {
        const p = PORTFOLIO_PARTITIONS.find((x) => x.key === key)!;
        return { name: p.label, key, value: latestSnapshotValues[key] ?? 0 };
      })
      .filter((d) => d.value > 0);
    const total = items.reduce((s, d) => s + d.value, 0);
    return items.map((d) => ({ ...d, pct: total > 0 ? (d.value / total) * 100 : 0 }));
  }, [latestSnapshotValues, filters.partitions]);

  // ── Line chart data (filtered by partitions + date range, carry-forward) ──
  const lineData = useMemo(() => {
    const activePartitions = filters.partitions.length > 0 ? filters.partitions : ALL_PARTITIONS;

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
  }, [portfolioSnapshots, filters]);

  // ── Partition chip helpers ─────────────────────────────────────────────────
  const togglePartition = (key: PortfolioPartitionKey) => {
    setFilters((f) => {
      const already = f.partitions.includes(key);
      const next = already ? f.partitions.filter((p) => p !== key) : [...f.partitions, key];
      return { ...f, partitions: next.length === 0 ? [...ALL_PARTITIONS] : next };
    });
  };

  const removePartitionChip = (key: PortfolioPartitionKey) => {
    setFilters((f) => {
      const next = f.partitions.filter((p) => p !== key);
      return { ...f, partitions: next.length === 0 ? [...ALL_PARTITIONS] : next };
    });
  };

  const allSelected = filters.partitions.length === ALL_PARTITIONS.length;

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Module</p>
        <h1 className="text-3xl md:text-4xl font-semibold mt-1">
          Portfolio <span className="text-gradient">analytics</span>
        </h1>
        <p className="text-sm text-muted-foreground mt-2">
          Investment returns, allocation breakdown, and value trends over time.
        </p>
      </header>

      {/* ── Global KPI tiles ─────────────────────────────────────────────── */}
      <section className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <KpiTile label="Total Deposits"      value={inr(summary.totalDeposits)}   tone="neutral" />
        <KpiTile label="Total Withdrawals"   value={inr(summary.totalWithdrawals)} tone="neutral" />
        <KpiTile label="Net Investment"       value={inr(summary.netInvestment)}    tone="neutral" />
        <KpiTile label="Current Value"        value={inr(summary.currentValue)}     tone="primary" />
        <KpiTile
          label="Absolute Return"
          value={(summary.absoluteReturn >= 0 ? "+" : "") + inr(Math.abs(summary.absoluteReturn))}
          tone={summary.absoluteReturn >= 0 ? "success" : "danger"}
        />
        <KpiTile
          label="Return %"
          value={`${summary.percentageReturn >= 0 ? "+" : ""}${summary.percentageReturn.toFixed(2)}%`}
          tone={summary.percentageReturn >= 0 ? "success" : "danger"}
          subtext="Returns computed against all partitions"
        />
      </section>

      {/* ── Filter bar ───────────────────────────────────────────────────── */}
      <section className="glass rounded-2xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Filter className="size-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Chart filters</span>
          <span className="text-xs text-muted-foreground ml-1">(applies to charts below only)</span>
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
                  togglePartition(v as PortfolioPartitionKey);
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
                {ALL_PARTITIONS.map((key) => {
                  const p = PORTFOLIO_PARTITIONS.find((x) => x.key === key)!;
                  const sel = filters.partitions.includes(key);
                  return (
                    <SelectItem key={key} value={key} className={sel ? "font-semibold" : "text-muted-foreground"}>
                      {p.label}
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
                {key} <X className="size-3" />
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
            <h2 className="font-semibold">Portfolio allocation</h2>
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
                        fill={PARTITION_COLORS[d.key]}
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

        {/* Broker list */}
        <div className="glass rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <PieChartIcon className="size-4 text-[oklch(0.72_0.18_155)]" />
            <h2 className="font-semibold">Breakdown by broker</h2>
          </div>
          {pieData.length > 0 ? (
            <ul className="space-y-2">
              {pieData.map((d) => (
                <li
                  key={d.key}
                  className="flex items-center justify-between gap-3 p-3 rounded-xl border border-glass-border bg-white/3"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className="size-3 rounded-full shrink-0"
                      style={{ backgroundColor: PARTITION_HEX[d.key] }}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{d.name}</p>
                      <p className="text-[11px] text-muted-foreground">{d.pct.toFixed(1)}% of portfolio</p>
                    </div>
                  </div>
                  <p className="font-semibold tabular-nums text-sm shrink-0">{inr(d.value)}</p>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyChart icon={<PieChartIcon className="size-10 opacity-30" />} text="No data for selected partitions" />
          )}
        </div>
      </section>

      {/* ── Portfolio value over time ─────────────────────────────────────── */}
      <section className="glass rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="size-4 text-accent" />
          <h2 className="font-semibold">Portfolio value over time</h2>
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
                  tickFormatter={(v: number) => `₹${(v / 1000).toFixed(0)}K`}
                  width={60}
                />
                <Tooltip content={<DarkTooltip />} />
                <Legend
                  wrapperStyle={{ fontSize: 11, paddingTop: 12 }}
                />
                {(filters.partitions.length > 0 ? filters.partitions : ALL_PARTITIONS).map((key) => (
                  <Line
                    key={key}
                    type="monotone"
                    dataKey={key}
                    stroke={PARTITION_HEX[key]}
                    strokeWidth={2.5}
                    dot={{ r: 4, fill: PARTITION_HEX[key], strokeWidth: 0 }}
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
    </div>
  );
}

// ─── KPI tile ──────────────────────────────────────────────────────────────
function KpiTile({
  label,
  value,
  tone,
  subtext,
}: {
  label: string;
  value: string;
  tone: "neutral" | "primary" | "success" | "danger";
  subtext?: string;
}) {
  const color =
    tone === "primary" ? "text-primary"
    : tone === "success" ? "text-[oklch(0.78_0.16_155)]"
    : tone === "danger"  ? "text-[oklch(0.78_0.18_25)]"
    : "text-foreground";
  return (
    <div className="glass rounded-xl p-4 flex flex-col gap-1">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${color}`}>{value}</p>
      {subtext && <p className="text-[10px] text-muted-foreground/70 leading-tight">{subtext}</p>}
    </div>
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
