/**
 * GitHub-style daily P&L activity heatmap — one cell per calendar day over
 * the last 26 weeks (~6 months), colored by that day's aggregated realized
 * P&L from closed trades.
 *
 * Renders nothing until mounted. The grid's layout is anchored on "today",
 * which can differ between server and client render (different clocks) —
 * computing it only after mount avoids a hydration mismatch, the same
 * defensive pattern store.tsx already uses for isOffline/isStealthMode.
 *
 * Every date key used here — the grid's cells AND a trade's bucket — is the
 * plain UTC-slice of its ISO string ("YYYY-MM-DD"), matching the convention
 * `dupKey`/exit-date grouping already use elsewhere in this app.
 *
 * COLOR CHOICE: every "neon" accent here (cell glow, ring, stat-card auras,
 * gradient text) is expressed as this app's own oklch palette — matching
 * PNL_EMERALD/PNL_ROSE's hues (155, 25) and --accent's cyan (195) from
 * styles.css — rather than Tailwind's stock emerald-400/rose-400/cyan-400.
 * Both technically work in this project (verified directly against the
 * compiled CSS output), but every other emerald/rose accent in the app — the
 * ribbon above this component, the closed-trade cards, the exit-reason
 * badges — uses the custom oklch scale, and Tailwind's stock colors render a
 * visibly different exact hue. Introducing a second, slightly-off "emerald"
 * into the same page would look inconsistent even though it would
 * technically render.
 *
 * HORIZONTAL TOOLTIP ANCHORING: `anchorFor` computes, from actual pixel
 * geometry, which edge of a cell's own box a same-axis tooltip should extend
 * from so it never crosses the grid's own [0, total] span — replacing an
 * earlier hand-derived split point that broke the moment tile/gap/tooltip
 * sizes changed (a real bug from an earlier pass: a tooltip wider than
 * several grid columns, centered, was overflowing the horizontal scroll
 * container and toggling a scrollbar on hover). Still used for the
 * horizontal axis below.
 *
 * VERTICAL TOOLTIP ANCHORING: the vertical axis instead uses a fixed split —
 * the top 3 rows (Sun/Mon/Tue) render their tooltip below the cell, the
 * bottom 4 (Wed-Sat) render above. Because that's a fixed rule rather than a
 * per-row fit check, some rows extend past the grid's own top/bottom edge
 * (e.g. row 3, the first "above" row, needs more headroom than 3 row-pitches
 * provide). The scroller wrapping the grid needs `overflow-x-auto` for
 * narrow viewports, and per the CSS overflow spec, giving one axis a
 * non-`visible` value forces the other axis's computed `visible` to become
 * `auto` too — so without reserving that overflow inside the scroller's own
 * content box, it would be silently clipped exactly like the original
 * horizontal bug above. SCROLLER_PAD_TOP_PX/SCROLLER_PAD_BOTTOM_PX reserve
 * exactly that much room, derived from the same geometry constants so they
 * self-correct if cell/gap/tooltip sizes change again.
 */
import { useEffect, useMemo, useState } from "react";
import { useStore, type Trade } from "@/lib/store";
import { inr, fmtDate, todayLocalISO } from "@/lib/format";
import { Sensitive } from "@/components/Sensitive";

const WEEKS = 26;
const TOTAL_DAYS = WEEKS * 7;

// Pixel geometry of the grid — kept as named constants (not re-derived from
// the Tailwind classes below) because anchorFor's math depends on them
// exactly matching the rendered size. If the cell/gap classes below ever
// change, these numbers need to change with them.
const CELL_PX = 18; // w-[18px] / h-[18px]
const GAP_PX = 6; // gap-1.5
const PITCH_PX = CELL_PX + GAP_PX;
const GRID_WIDTH_PX = WEEKS * CELL_PX + (WEEKS - 1) * GAP_PX;
const GRID_HEIGHT_PX = 7 * CELL_PX + 6 * GAP_PX;
const TOOLTIP_WIDTH_PX = 140;
const TOOLTIP_HEIGHT_PX = 84; // header line + large P&L line + footer pill, generously rounded up
const TOOLTIP_GAP_PX = 10; // mt-2.5 / mb-2.5

const BELOW_ROWS = [0, 1, 2]; // Sun, Mon, Tue -> tooltip renders below the cell
const ABOVE_ROWS = [3, 4, 5, 6]; // Wed, Thu, Fri, Sat -> tooltip renders above the cell

const SCROLLER_PAD_TOP_PX = Math.max(
  0,
  ...ABOVE_ROWS.map((row) => TOOLTIP_GAP_PX + TOOLTIP_HEIGHT_PX - row * PITCH_PX),
);
const SCROLLER_PAD_BOTTOM_PX = Math.max(
  0,
  ...BELOW_ROWS.map((row) => row * PITCH_PX + CELL_PX + TOOLTIP_GAP_PX + TOOLTIP_HEIGHT_PX - GRID_HEIGHT_PX),
);

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
const EMERALD_GLOW = "shadow-[0_0_10px_oklch(0.72_0.18_155_/_0.35)] ring-1 ring-[oklch(0.72_0.18_155_/_0.4)]";
const ROSE_GLOW = "shadow-[0_0_10px_oklch(0.7_0.2_25_/_0.35)] ring-1 ring-[oklch(0.7_0.2_25_/_0.4)]";
const TOOLTIP_SHADOW_WIN = "shadow-[0_0_20px_rgba(0,0,0,0.8),0_0_16px_oklch(0.72_0.18_155_/_0.25)]";
const TOOLTIP_SHADOW_LOSS = "shadow-[0_0_20px_rgba(0,0,0,0.8),0_0_16px_oklch(0.7_0.2_25_/_0.25)]";
const WEEKDAY_LABELS = ["", "M", "", "W", "", "F", ""];

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

/**
 * Which edge of a cell's own bounding box a same-axis tooltip of the given
 * size should anchor to, so that (as long as `size`/`count` match the
 * rendered CSS) it never extends past the grid's own [0, total] span on that
 * axis — see the file doc comment for why this replaced a hand-picked
 * threshold. `index` is the cell's position along the axis (column here;
 * the row axis uses a fixed split instead, see BELOW_ROWS/ABOVE_ROWS).
 */
function anchorFor(
  index: number,
  total: number,
  tooltipSize: number,
): "start" | "end" {
  const nearEdge = index * PITCH_PX;
  const farEdge = nearEdge + CELL_PX;
  const fitsExtendingForward = nearEdge + tooltipSize <= total;
  const fitsExtendingBackward = farEdge - tooltipSize >= 0;
  if (fitsExtendingForward && !fitsExtendingBackward) return "start";
  if (!fitsExtendingForward && fitsExtendingBackward) return "end";
  // Both fit, or neither fits cleanly (tooltip bigger than the grid itself)
  // — pick whichever direction leaves more room either way.
  const forwardMargin = total - (nearEdge + tooltipSize);
  const backwardMargin = farEdge - tooltipSize;
  return forwardMargin >= backwardMargin ? "start" : "end";
}

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
      <section data-tour="pnl-heatmap" className="glass rounded-2xl p-5 flex items-center justify-center text-center">
        <p className="text-sm text-muted-foreground">
          🔒 Trading Activity Heatmap hidden in Stealth Mode
        </p>
      </section>
    );
  }

  return (
    <section data-tour="pnl-heatmap" className="glass rounded-2xl p-5">
      <h2 className="font-display font-semibold tracking-tight mb-4">Trading Activity &amp; Performance</h2>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
        {/* Left: dedicated glass box for the heatmap. No overflow-hidden here
            or on any ancestor — see the vertical-anchoring doc comment above
            for why the scroller's own padding, not this box, is what keeps
            tooltips from being clipped. */}
        <div className="lg:col-span-8 relative flex justify-center items-center w-full rounded-2xl border border-white/[0.08] bg-white/[0.015] p-4 shadow-lg">
          <div
            className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            style={{ paddingTop: SCROLLER_PAD_TOP_PX, paddingBottom: SCROLLER_PAD_BOTTOM_PX }}
          >
            <div className="flex gap-1.5 mb-1.5">
              <div className="w-5 shrink-0" />
              {grid.weeks.map((week, wi) => {
                const month = week[0].key.slice(0, 7);
                const prevMonth = wi > 0 ? grid.weeks[wi - 1][0].key.slice(0, 7) : "";
                const label = month !== prevMonth ? fmtDate(week[0].key).split(" ")[1] : "";
                return (
                  <div
                    key={wi}
                    className="w-[18px] h-[18px] shrink-0 text-xs font-medium text-white/75"
                  >
                    {label}
                  </div>
                );
              })}
            </div>
            <div className="flex gap-1.5">
              {/* Weekday labels — only every other one (M/W/F), matching the
                  understated GitHub/fintech convention rather than labeling
                  all 7 rows. */}
              <div className="flex flex-col gap-1.5 w-5 shrink-0">
                {WEEKDAY_LABELS.map((label, i) => (
                  <div
                    key={i}
                    className="w-[18px] h-[18px] flex items-center text-[11px] font-semibold uppercase tracking-wide text-white/60"
                  >
                    {label}
                  </div>
                ))}
              </div>
              {grid.weeks.map((week, wi) => {
                const hAnchor = anchorFor(wi, GRID_WIDTH_PX, TOOLTIP_WIDTH_PX);
                const hAlign = hAnchor === "start" ? "left-0" : "right-0";
                return (
                  <div key={wi} className="flex flex-col gap-1.5">
                    {week.map((day, di) => {
                      const color = day.bucket ? cellColor(day.bucket.netPnl, grid.maxAbs) : undefined;
                      const isToday = day.key === todayKey;
                      const vAlign = BELOW_ROWS.includes(di) ? "top-full mt-2.5" : "bottom-full mb-2.5";
                      const glow = !day.bucket
                        ? ""
                        : day.bucket.netPnl > 0
                          ? EMERALD_GLOW
                          : day.bucket.netPnl < 0
                            ? ROSE_GLOW
                            : "";
                      return (
                        <div key={day.key} className="relative group">
                          <div
                            className={`w-[18px] h-[18px] rounded-[4px] transition-all duration-150 cursor-pointer hover:scale-130 hover:z-20 ${
                              color
                                ? glow
                                : "bg-white/[0.025] border border-white/[0.04] hover:bg-white/[0.08] hover:border-white/20"
                            } ${isToday ? "ring-1 ring-white/40" : ""}`}
                            style={color ? { backgroundColor: color } : undefined}
                          />
                          {day.bucket && (
                            <div
                              className={`pointer-events-none absolute z-50 hidden group-hover:flex flex-col gap-1 ${vAlign} ${hAlign} min-w-[140px] w-max max-w-[140px] rounded-xl border border-white/15 bg-[#060913]/95 backdrop-blur-2xl p-2.5 ${
                                day.bucket.netPnl >= 0 ? TOOLTIP_SHADOW_WIN : TOOLTIP_SHADOW_LOSS
                              }`}
                            >
                              <span className="text-[10px] text-white/50 font-medium tracking-wide whitespace-nowrap">
                                {fmtDate(day.bucket.key)}
                              </span>
                              <Sensitive>
                                <span
                                  className={`tnum text-base font-bold leading-tight whitespace-nowrap ${
                                    day.bucket.netPnl >= 0
                                      ? `${EMERALD_TEXT} drop-shadow-[0_0_8px_oklch(0.72_0.18_155_/_0.5)]`
                                      : `${ROSE_TEXT} drop-shadow-[0_0_8px_oklch(0.7_0.2_25_/_0.5)]`
                                  }`}
                                >
                                  {signed(day.bucket.netPnl)}
                                </span>
                              </Sensitive>
                              <span className="inline-flex w-fit items-center rounded-md border border-white/[0.06] bg-white/[0.05] px-1.5 py-0.5 text-[9px] text-white/60 whitespace-nowrap">
                                {day.bucket.trades} trade{day.bucket.trades !== 1 ? "s" : ""} ·{" "}
                                {day.bucket.wins}W {day.bucket.losses}L
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right: 2x2 stat grid, height-matched to the left box via items-stretch above. */}
        <div className="lg:col-span-4 grid grid-cols-2 gap-3 h-full">
          <HeatmapStat
            label="Streak"
            value={grid.streak > 0 ? `${grid.streak} day${grid.streak !== 1 ? "s" : ""}` : "—"}
            tone={grid.streak > 0 ? EMERALD_TEXT : undefined}
            glow={grid.streak > 0 ? "emerald" : "none"}
          />
          <HeatmapStat
            label="Best Day"
            value={grid.best ? signed(grid.best.netPnl) : "—"}
            sub={grid.best ? fmtDate(grid.best.key) : undefined}
            tone={EMERALD_TEXT}
            glow="emerald"
            sensitive
          />
          <HeatmapStat
            label="Worst Day"
            value={grid.worst ? signed(grid.worst.netPnl) : "—"}
            sub={grid.worst ? fmtDate(grid.worst.key) : undefined}
            tone={grid.worst && grid.worst.netPnl < 0 ? ROSE_TEXT : EMERALD_TEXT}
            glow={grid.worst && grid.worst.netPnl < 0 ? "rose" : "emerald"}
            sensitive
          />
          <HeatmapStat label="Trading Days" value={`${grid.activeDays} / ${TOTAL_DAYS}`} glow="cyan" />
        </div>
      </div>
    </section>
  );
}

const GLOW_BACKDROP: Record<"emerald" | "rose" | "cyan" | "none", string> = {
  emerald: "bg-[radial-gradient(circle_at_25%_15%,oklch(0.72_0.18_155_/_0.1),transparent_65%)]",
  rose: "bg-[radial-gradient(circle_at_25%_15%,oklch(0.7_0.2_25_/_0.1),transparent_65%)]",
  cyan: "bg-[radial-gradient(circle_at_25%_15%,oklch(0.72_0.14_195_/_0.1),transparent_65%)]",
  none: "",
};

function HeatmapStat({
  label,
  value,
  sub,
  tone,
  sensitive,
  glow = "none",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
  sensitive?: boolean;
  glow?: "emerald" | "rose" | "cyan" | "none";
}) {
  const cyanGradient =
    glow === "cyan"
      ? "bg-gradient-to-r from-[oklch(0.72_0.14_195)] to-white bg-clip-text text-transparent"
      : "";
  const val = (
    <span
      className={`text-lg lg:text-xl font-display font-bold tnum ${cyanGradient || tone || ""} ${
        glow === "emerald"
          ? "drop-shadow-[0_0_8px_oklch(0.72_0.18_155_/_0.4)]"
          : glow === "rose"
            ? "drop-shadow-[0_0_8px_oklch(0.7_0.2_25_/_0.4)]"
            : ""
      }`}
    >
      {value}
    </span>
  );
  return (
    <div
      className={`relative h-full flex flex-col justify-center overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.015] p-3 hover:border-white/20 transition-colors ${GLOW_BACKDROP[glow]}`}
    >
      <p className="relative text-[11px] font-semibold uppercase tracking-wider text-white/60">{label}</p>
      <p className="relative mt-0.5">{sensitive ? <Sensitive>{val}</Sensitive> : val}</p>
      {sub && <p className="relative text-xs font-medium text-white/50 mt-0.5 truncate">{sub}</p>}
    </div>
  );
}
