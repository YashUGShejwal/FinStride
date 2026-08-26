import { useId, useMemo, useState } from "react";
import { format } from "date-fns";
import { Pencil, Plus, Target, Trash2 } from "lucide-react";
import {
  affordabilityMultiplier,
  calculateMilestoneETA,
  milestoneProgress,
  type MilestoneETAResult,
} from "@/lib/projectionEngine";
import { MILESTONE_TARGET_TYPE_META, useStore, type Milestone, type MilestoneTargetType } from "@/lib/store";
import { cn } from "@/lib/utils";
import { inrCompact } from "@/lib/format";
import { Sensitive } from "@/components/Sensitive";
import { Button } from "@/components/ui/button";
import { MilestoneModal } from "@/components/MilestoneModal";

const R = 30;
const CIRCUMFERENCE = 2 * Math.PI * R;

/**
 * Prestige theming per category — a distinctive border/ambient-glow/ring
 * identity so the tracker reads as a hierarchy at a glance (👑 amber for the
 * top-tier net worth goals down to ☕ steel-slate for minor wants), matching
 * each category's Tailwind color family exactly between the card chrome
 * (real utility classes) and the SVG progress ring (hex, since SVG stopColor
 * can't consume Tailwind classes directly).
 */
const CATEGORY_THEME: Record<
  MilestoneTargetType,
  { card: string; pill: string; ring: { from: string; to: string } }
> = {
  net_worth: {
    card: "border-amber-500/30 bg-amber-500/[0.02] shadow-[0_0_15px_rgba(245,158,11,0.08)] hover:border-amber-500/50",
    pill: "border-amber-500/30 bg-amber-500/10 text-amber-400",
    ring: { from: "#fbbf24", to: "#f59e0b" },
  },
  need: {
    card: "border-cyan-500/30 bg-cyan-500/[0.02] shadow-[0_0_15px_rgba(6,182,212,0.08)] hover:border-cyan-500/50",
    pill: "border-cyan-500/30 bg-cyan-500/10 text-cyan-400",
    ring: { from: "#22d3ee", to: "#06b6d4" },
  },
  major_want: {
    card: "border-purple-500/30 bg-purple-500/[0.02] shadow-[0_0_15px_rgba(168,85,247,0.08)] hover:border-purple-500/50",
    pill: "border-purple-500/30 bg-purple-500/10 text-purple-400",
    ring: { from: "#c084fc", to: "#a855f7" },
  },
  minor_want: {
    card: "border-slate-500/25 bg-slate-500/[0.02] shadow-[0_0_15px_rgba(148,163,184,0.05)] hover:border-slate-500/45",
    pill: "border-slate-500/25 bg-slate-500/10 text-slate-400",
    ring: { from: "#94a3b8", to: "#64748b" },
  },
};

function formatEta(totalMonths: number): string {
  if (totalMonths < 1) return "this month";
  if (totalMonths < 12) return `in ${totalMonths} mo`;
  return `in ${(totalMonths / 12).toFixed(1)} yrs`;
}

/** "Net Worth Goal" for a direct target, or e.g. "Major Want • 5.0× Buffer" for an affordability category. */
function categoryPillText(m: Milestone): string {
  const meta = MILESTONE_TARGET_TYPE_META[m.targetType];
  if (m.targetType === "net_worth") return meta.label;
  const pct = m.allocationPercent ?? meta.defaultAllocationPercent;
  return `${meta.label} • ${affordabilityMultiplier(pct).toFixed(1)}× Buffer`;
}

type Row = {
  milestone: Milestone;
  progress: number;
  achieved: boolean;
  eta: MilestoneETAResult | null;
};

/**
 * Milestone Velocity Tracker — a grid of wealth targets, each showing % of
 * the way there, an achieved/in-progress badge, and the calculateMilestoneETA
 * projected date. The nearest not-yet-achieved milestone gets a continuous
 * breathing glow (.next-up-pulse) so the page always foregrounds "what's
 * next," layered on top of that card's own category theme. Edit/Delete are
 * scoped to custom milestones only — the 6 seeded defaults are fixed
 * reference points, matching AccountMode/BrokerPartition's convention.
 */
export function MilestoneTracker() {
  const { milestones, currentNetWorth, projectionSettings, deleteMilestone } = useStore();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Milestone | null>(null);

  const rows = useMemo<Row[]>(() => {
    return [...milestones]
      .sort((a, b) => a.targetAmount - b.targetAmount)
      .map((milestone) => {
        const achieved = currentNetWorth >= milestone.targetAmount;
        return {
          milestone,
          progress: milestoneProgress(currentNetWorth, milestone.targetAmount),
          achieved,
          eta: achieved
            ? null
            : calculateMilestoneETA(
                milestone.targetAmount,
                currentNetWorth,
                projectionSettings.monthlySip,
                projectionSettings.stepUpPercent,
                projectionSettings.expectedCagr,
                // When "Headline in real terms" is on, evaluate ETA against
                // the inflation-adjusted curve instead of the nominal one —
                // see calculateMilestoneETA's doc comment.
                projectionSettings.adjustForInflation
                  ? { inflationPercent: projectionSettings.inflationRate }
                  : undefined,
              ),
        };
      });
  }, [milestones, currentNetWorth, projectionSettings]);

  const nextUpId = rows.find((r) => !r.achieved)?.milestone.id;

  const openAdd = () => {
    setEditing(null);
    setModalOpen(true);
  };
  const openEdit = (m: Milestone) => {
    setEditing(m);
    setModalOpen(true);
  };

  return (
    <section className="rounded-2xl border border-white/[0.08] bg-white/[0.015] p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Target className="size-4 text-muted-foreground" />
          <h2 className="font-display font-semibold tracking-tight">Milestone Velocity Tracker</h2>
        </div>
        <Button data-tour="add-milestone-btn" variant="ghost" size="sm" onClick={openAdd}>
          <Plus className="size-3.5" />
          Add Milestone
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          No milestones yet — add your first wealth target above.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {rows.map((row) => (
            <MilestoneCard
              key={row.milestone.id}
              row={row}
              isNextUp={row.milestone.id === nextUpId}
              onEdit={() => openEdit(row.milestone)}
              onDelete={() => deleteMilestone(row.milestone.id)}
            />
          ))}
        </div>
      )}

      <MilestoneModal milestone={editing} open={modalOpen} onOpenChange={setModalOpen} />
    </section>
  );
}

function MilestoneCard({
  row,
  isNextUp,
  onEdit,
  onDelete,
}: {
  row: Row;
  isNextUp: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { milestone, progress, achieved, eta } = row;
  const dashOffset = CIRCUMFERENCE * (1 - progress);
  const gid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const theme = CATEGORY_THEME[milestone.targetType];

  const ringTone = achieved
    ? { from: "oklch(0.74 0.17 160)", to: "oklch(0.72 0.18 155)" }
    : isNextUp
      ? { from: "oklch(0.78 0.15 165)", to: "oklch(0.72 0.14 195)" }
      : theme.ring;

  return (
    <div className={cn("group relative rounded-2xl border p-4 transition-colors", theme.card, isNextUp && "next-up-pulse")}>
      {isNextUp && (
        <span className="absolute -top-2.5 left-4 rounded-full border border-primary/40 bg-[#060913] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-primary">
          Next Up
        </span>
      )}

      {milestone.isCustom && (
        <div className="absolute top-3 right-3 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={onEdit}
            aria-label={`Edit ${milestone.name} milestone`}
            className="text-muted-foreground hover:text-foreground"
          >
            <Pencil className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Remove ${milestone.name} milestone`}
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      )}

      <div className="flex items-start justify-between gap-3 pr-5">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-white/50">Milestone Target</p>
          <p className="text-xl font-display font-bold tnum mt-0.5">{milestone.name}</p>
          {milestone.isCustom && (
            <>
              <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                <span className={cn("inline-flex items-center rounded-md border px-1.5 py-0.5 text-[9px] font-semibold", theme.pill)}>
                  {categoryPillText(milestone)}
                </span>
                {milestone.isFinanced && (
                  <span className="inline-flex items-center rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold text-primary">
                    DP Goal
                  </span>
                )}
              </div>
              <Sensitive>
                {milestone.isFinanced ? (
                  <>
                    <p className="text-[11px] text-muted-foreground tnum mt-1">
                      Asset: {inrCompact(milestone.totalAssetCost ?? 0)} · DP:{" "}
                      {inrCompact(milestone.downpaymentAmount ?? 0)}
                    </p>
                    <p className="text-[11px] text-muted-foreground tnum">
                      Target NW: {inrCompact(milestone.targetAmount)}
                    </p>
                  </>
                ) : (
                  <p className="text-[11px] text-muted-foreground tnum mt-1">
                    Target: {inrCompact(milestone.targetAmount)}
                    {milestone.itemCost !== undefined && ` · Cost: ${inrCompact(milestone.itemCost)}`}
                  </p>
                )}
              </Sensitive>
            </>
          )}
        </div>
        <span
          className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
            achieved
              ? "border-[oklch(0.72_0.18_155_/_0.4)] bg-[oklch(0.72_0.18_155_/_0.12)] text-[oklch(0.78_0.2_155)]"
              : "border-white/[0.08] bg-white/[0.05] text-white/60"
          }`}
        >
          {achieved ? "Achieved" : "In Progress"}
        </span>
      </div>

      <div className="flex items-center gap-4 mt-4">
        <div className="relative size-[76px] shrink-0">
          <svg viewBox="0 0 76 76" className="size-full -rotate-90">
            <defs>
              <linearGradient id={`mring-${gid}`} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor={ringTone.from} />
                <stop offset="1" stopColor={ringTone.to} />
              </linearGradient>
            </defs>
            <circle cx="38" cy="38" r={R} fill="none" stroke="oklch(1 0 0 / 0.06)" strokeWidth="6" />
            <circle
              cx="38"
              cy="38"
              r={R}
              fill="none"
              stroke={`url(#mring-${gid})`}
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={dashOffset}
              style={{ transition: "stroke-dashoffset 500ms ease" }}
            />
          </svg>
          <div className="absolute inset-0 grid place-items-center">
            <Sensitive>
              <span className="text-sm font-bold tnum">{Math.round(progress * 100)}%</span>
            </Sensitive>
          </div>
        </div>

        <div className="min-w-0">
          {achieved ? (
            <p className="text-sm font-medium text-[oklch(0.78_0.2_155)]">Target met 🎉</p>
          ) : eta ? (
            <>
              <p className="text-sm font-medium tnum">{format(eta.targetDate, "MMM yyyy")}</p>
              <p className="text-[11px] text-muted-foreground">{formatEta(eta.totalMonths)}</p>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">Not reachable at the current pace</p>
          )}
        </div>
      </div>
    </div>
  );
}
