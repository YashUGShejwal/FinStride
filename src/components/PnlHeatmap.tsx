/**
 * GitHub-style daily P&L activity heatmap — one cell per calendar day over
 * the last 14 weeks, colored by that day's aggregated realized P&L from
 * closed trades.
 *
 * Renders nothing until mounted. The grid's layout is anchored on "today",
 * which can differ between server and client render (different clocks) —
 * computing it only after mount avoids a hydration mismatch, the same
 * defensive pattern store.tsx already uses for isOffline/isStealthMode.
 *
 * Every date key used here — the grid's cells AND a trade's bucket — is the
 * plain UTC-slice of its ISO string ("YYYY-MM-DD"), matching the convention
 * `dupKey`/exit-date grouping already use elsewhere in this app. Building the
 * grid from local calendar arithmetic instead would risk its cell keys not
 * lining up with a trade's bucket key for users on either side of a UTC day
 * boundary — this keeps the two derived the exact same way.
 *
 * Colors intentionally reuse this app's own oklch palette (matching
 * PNL_EMERALD/PNL_ROSE's hues, 155 and 25, from swing.tsx) rather than
 * Tailwind's stock emerald/rose scale, so the heatmap's greens/reds read as
 * the SAME green/red used everywhere else in the app. They're applied via
 * inline style, not Tailwind classes — the color is computed per-cell at
 * runtime from trade data, and Tailwind's build-time scanner can't generate
 * CSS for a class name it never sees literally in the source.
 */
import { useEffect, useMemo, useState } from "react";
import { useStore, type Trade } from "@/lib/store";
import { inr, fmtDate, todayLocalISO } from "@/lib/format";
import { Sensitive } from "@/components/Sensitive";

const WEEKS = 14;
const TOTAL_DAYS = WEEKS * 7;

type DayBucket = {
  key: string;
  netPnl: number;
  trades: number;
  wins: number;
  losses: number;
};

type DayCell = {
  key: string;
  isFuture: boolean;
  bucket?: DayBucket;
};

const EMERALD_LEVELS = [
  "oklch(0.28 0.06 155 / 0.55)",
  "oklch(0.4 0.11 155 / 0.75)",
  "oklch(0.52 0.15 155 / 0.9)",
  "oklch(0.66 0.18 155)",
];
const ROSE_LEVELS = [
  "oklch(0.28 0.08 25 / 0.55)",
  "oklch(0.4 0.14 25 / 0.75)",
  "oklch(0.52 0.19 25 / 0.9)",
  "oklch(0.66 0.21 25)",
];
const EMERALD_TEXT = "text-[oklch(0.78_0.16_155)]";
const ROSE_TEXT = "text-[oklch(0.78_0.18_25)]";

function cellColor(netPnl: number, maxAbs: number): string | undefined {
  if (netPnl === 0) return undefined;
  const levels = netPnl > 0 ? EMERALD_LEVELS : ROSE_LEVELS;
  const intensity = maxAbs > 0 ? Math.min(1, Math.abs(netPnl) / maxAbs) : 0;
  const idx = intensity <= 0.25 ? 0 : intensity <= 0.5 ? 1 : intensity <= 0.75 ? 2 : 3;
  return levels[idx];
}

/** Add `days` (may be negative) to a "YYYY-MM-DD" key, staying in UTC throughout. */
function addDays(key: string, days: number): string {
  const d = new Date(`${key}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function utcDayOfWeek(key: string): number {
  return new Date(`${key}T00:00:00.000Z`).getUTCDay();
}

const signed = (n: number) => `${n >= 0 ? "+" : ""}${inr(n)}`;

export function PnlHeatmap({ trades }: { trades: Trade[] }) {
  const { isStealthMode } = useStore();
  const [todayKey, setTodayKey] = useState<string | null>(null);
  useEffect(() => {
    setTodayKey(todayLocalISO());
  }, []);

  const grid = useMemo(() => {
    if (!todayKey) return null;

    const dayMap = new Map<string, DayBucket>();
    for (const t of trades) {
      if (t.status !== "closed" || !t.exitDate) continue;
      const pnl = t.netPnl ?? t.pnl;
      if (pnl === undefined) continue;
      const key = t.exitDate.slice(0, 10);
      const bucket = dayMap.get(key) ?? { key, netPnl: 0, trades: 0, wins: 0, losses: 0 };
      bucket.netPnl += pnl;
      bucket.trades += 1;
      if (pnl > 0) bucket.wins += 1;
      else if (pnl < 0) bucket.losses += 1;
      dayMap.set(key, bucket);
    }

    // End the grid on the Saturday of the CURRENT week so every column is a
    // full 7-day week (simpler, rectangular layout) — days after today just
    // never have a bucket, rendering identically to any other inactive day.
    const gridEndKey = addDays(todayKey, 6 - utcDayOfWeek(todayKey));
    const gridStartKey = addDays(gridEndKey, -(TOTAL_DAYS - 1));

    const weeks: DayCell[][] = [];
    let cursor = gridStartKey;
    for (let w = 0; w < WEEKS; w++) {
      const week: DayCell[] = [];
      for (let d = 0; d < 7; d++) {
        week.push({ key: cursor, isFuture: cursor > todayKey, bucket: dayMap.get(cursor) });
        cursor = addDays(cursor, 1);
      }
      weeks.push(week);
    }

    const activeDays = [...dayMap.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
    const maxAbs = activeDays.reduce((m, b) => Math.max(m, Math.abs(b.netPnl)), 0);

    // Current streak: consecutive TRADING days (only days with activity —
    // weekends and off days don't break it) walking back from the most
    // recent one, while net P&L stays positive.
    let streak = 0;
    for (let i = activeDays.length - 1; i >= 0; i--) {
      if (activeDays[i].netPnl > 0) streak++;
      else break;
    }

    const best = activeDays.reduce<DayBucket | null>((m, b) => (!m || b.netPnl > m.netPnl ? b : m), null);
    const worst = activeDays.reduce<DayBucket | null>((m, b) => (!m || b.netPnl < m.netPnl ? b : m), null);

    return { weeks, maxAbs, activeDays: activeDays.length, streak, best, worst };
  }, [todayKey, trades]);

  if (!grid || grid.activeDays === 0) return null;

  // Stealth Mode hides the heatmap+stats OUTRIGHT rather than routing them
  // through <Sensitive> the way individual figures elsewhere in the app are
  // blurred — a color-coded calendar reveals relative profit/loss magnitude
  // and streak length just from its SHAPE, which blurring the numbers alone
  // wouldn't hide. Checked after the "no data yet" guard above: with nothing
  // to show either way, there's nothing to announce as hidden.
  if (isStealthMode) {
    return (
      <section className="glass rounded-2xl p-5 flex items-center justify-center text-center">
        <p className="text-sm text-muted-foreground">
          🔒 Trading Activity Heatmap hidden in Stealth Mode
        </p>
      </section>
    );
  }

  return (
    <section className="glass rounded-2xl p-5">
      <h2 className="font-display font-semibold tracking-tight mb-4">Trading Activity</h2>
      <div className="flex flex-col lg:flex-row lg:items-start gap-5">
        <div className="overflow-x-auto pb-1">
          <div className="flex gap-1 mb-1">
            {grid.weeks.map((week, wi) => {
              const month = week[0].key.slice(0, 7);
              const prevMonth = wi > 0 ? grid.weeks[wi - 1][0].key.slice(0, 7) : "";
              const label = month !== prevMonth ? fmtDate(week[0].key).split(" ")[1] : "";
              return (
                <div key={wi} className="w-3 shrink-0 text-[9px] text-muted-foreground">
                  {label}
                </div>
              );
            })}
          </div>
          <div className="flex gap-1">
            {grid.weeks.map((week, wi) => (
              <div key={wi} className="flex flex-col gap-1">
                {week.map((day) => {
                  const color = day.bucket ? cellColor(day.bucket.netPnl, grid.maxAbs) : undefined;
                  const isToday = day.key === todayKey;
                  return (
                    <div key={day.key} className="relative group">
                      <div
                        className={`size-3 rounded-[2px] ${
                          color ? "" : "bg-white/[0.02] border border-white/[0.04]"
                        } ${isToday ? "ring-1 ring-white/40" : ""}`}
                        style={color ? { backgroundColor: color } : undefined}
                      />
                      {day.bucket && (
                        <div className="pointer-events-none absolute z-20 hidden group-hover:flex flex-col gap-0.5 bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-max max-w-[13rem] rounded-lg border border-glass-border bg-[#05070a] px-2.5 py-2 text-[10px] shadow-lg">
                          <span className="font-semibold whitespace-nowrap">
                            {fmtDate(day.bucket.key)}
                          </span>
                          <Sensitive>
                            <span
                              className={`tnum font-semibold ${
                                day.bucket.netPnl >= 0 ? EMERALD_TEXT : ROSE_TEXT
                              }`}
                            >
                              {signed(day.bucket.netPnl)}
                            </span>
                          </Sensitive>
                          <span className="text-muted-foreground whitespace-nowrap">
                            {day.bucket.trades} trade{day.bucket.trades !== 1 ? "s" : ""} ·{" "}
                            {day.bucket.wins}W · {day.bucket.losses}L
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 shrink-0">
          <HeatmapStat
            label="Streak"
            value={grid.streak > 0 ? `${grid.streak} day${grid.streak !== 1 ? "s" : ""}` : "—"}
            tone={grid.streak > 0 ? EMERALD_TEXT : undefined}
          />
          <HeatmapStat
            label="Best Day"
            value={grid.best ? signed(grid.best.netPnl) : "—"}
            sub={grid.best ? fmtDate(grid.best.key) : undefined}
            tone={EMERALD_TEXT}
            sensitive
          />
          <HeatmapStat
            label="Worst Day"
            value={grid.worst ? signed(grid.worst.netPnl) : "—"}
            sub={grid.worst ? fmtDate(grid.worst.key) : undefined}
            tone={grid.worst && grid.worst.netPnl < 0 ? ROSE_TEXT : EMERALD_TEXT}
            sensitive
          />
          <HeatmapStat label="Trading Days" value={`${grid.activeDays} / ${TOTAL_DAYS}`} />
        </div>
      </div>
    </section>
  );
}

function HeatmapStat({
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
  const val = <span className={`text-sm font-semibold tnum ${tone ?? ""}`}>{value}</span>;
  return (
    <div className="rounded-xl border border-glass-border bg-white/[0.02] px-3 py-2 min-w-[6.5rem]">
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-0.5">{sensitive ? <Sensitive>{val}</Sensitive> : val}</p>
      {sub && <p className="text-[9px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}
