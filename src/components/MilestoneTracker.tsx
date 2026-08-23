import { useId, useMemo, useState, type FormEvent } from "react";
import { format } from "date-fns";
import { Plus, Target, Trash2, X } from "lucide-react";
import { calculateMilestoneETA, milestoneProgress, type MilestoneETAResult } from "@/lib/projectionEngine";
import { useStore, type Milestone } from "@/lib/store";
import { inrCompact } from "@/lib/format";
import { Sensitive } from "@/components/Sensitive";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const R = 30;
const CIRCUMFERENCE = 2 * Math.PI * R;

function formatEta(totalMonths: number): string {
  if (totalMonths < 1) return "this month";
  if (totalMonths < 12) return `in ${totalMonths} mo`;
  return `in ${(totalMonths / 12).toFixed(1)} yrs`;
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
 * projected date. The nearest not-yet-achieved milestone gets an ambient
 * neon highlight so the page always foregrounds "what's next."
 */
export function MilestoneTracker() {
  const { milestones, currentNetWorth, projectionSettings, addMilestone, deleteMilestone } = useStore();
  const [adding, setAdding] = useState(false);

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
              ),
        };
      });
  }, [milestones, currentNetWorth, projectionSettings]);

  const nextUpId = rows.find((r) => !r.achieved)?.milestone.id;

  return (
    <section className="rounded-2xl border border-white/[0.08] bg-white/[0.015] p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Target className="size-4 text-muted-foreground" />
          <h2 className="font-display font-semibold tracking-tight">Milestone Velocity Tracker</h2>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setAdding((v) => !v)}>
          {adding ? <X className="size-3.5" /> : <Plus className="size-3.5" />}
          {adding ? "Cancel" : "Add Milestone"}
        </Button>
      </div>

      {adding && (
        <AddMilestoneForm
          onAdd={(amount, label) => {
            addMilestone(amount, label);
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      )}

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
              onDelete={() => deleteMilestone(row.milestone.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function MilestoneCard({
  row,
  isNextUp,
  onDelete,
}: {
  row: Row;
  isNextUp: boolean;
  onDelete: () => void;
}) {
  const { milestone, progress, achieved, eta } = row;
  const title = milestone.label?.trim() || inrCompact(milestone.targetAmount);
  const dashOffset = CIRCUMFERENCE * (1 - progress);
  const gid = useId().replace(/[^a-zA-Z0-9_-]/g, "");

  const ringTone = achieved
    ? { from: "oklch(0.74 0.17 160)", to: "oklch(0.72 0.18 155)" }
    : isNextUp
      ? { from: "oklch(0.78 0.15 165)", to: "oklch(0.72 0.14 195)" }
      : { from: "oklch(0.6 0.03 260)", to: "oklch(0.5 0.03 260)" };

  return (
    <div
      className={`group relative rounded-2xl border p-4 transition-colors ${
        isNextUp
          ? "border-primary/40 bg-primary/[0.04] shadow-[0_0_40px_-14px_oklch(0.78_0.15_165_/_0.55)]"
          : "border-white/[0.08] bg-white/[0.015] hover:border-white/20"
      }`}
    >
      {isNextUp && (
        <span className="absolute -top-2.5 left-4 rounded-full border border-primary/40 bg-[#060913] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-primary">
          Next Up
        </span>
      )}

      <button
        type="button"
        onClick={onDelete}
        aria-label={`Remove ${title} milestone`}
        className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
      >
        <Trash2 className="size-3.5" />
      </button>

      <div className="flex items-start justify-between gap-3 pr-5">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-white/50">Milestone Target</p>
          <p className="text-xl font-display font-bold tnum mt-0.5">{title}</p>
          {milestone.label && (
            <p className="text-[11px] text-muted-foreground tnum">{inrCompact(milestone.targetAmount)}</p>
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

function AddMilestoneForm({
  onAdd,
  onCancel,
}: {
  onAdd: (amount: number, label?: string) => void;
  onCancel: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [label, setLabel] = useState("");

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const value = Number(amount);
    if (!(value > 0)) return;
    onAdd(value, label);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col sm:flex-row gap-2 mb-4 p-3 rounded-xl border border-white/[0.08] bg-white/[0.02]"
    >
      <Input
        type="number"
        inputMode="decimal"
        placeholder="Target amount (₹)"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        className="sm:max-w-[180px]"
        autoFocus
      />
      <Input
        type="text"
        placeholder="Label (optional, e.g. House Downpayment)"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        className="flex-1"
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={!(Number(amount) > 0)}>
          Add
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
