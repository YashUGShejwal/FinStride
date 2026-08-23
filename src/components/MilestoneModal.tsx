import { useEffect, useState } from "react";
import { toast } from "sonner";
import { affordabilityMultiplier, calculateRequiredNetWorth } from "@/lib/projectionEngine";
import {
  MILESTONE_TARGET_TYPE_META,
  MILESTONE_TARGET_TYPE_ORDER,
  useStore,
  type Milestone,
  type MilestoneInput,
  type MilestoneTargetType,
} from "@/lib/store";
import { cn } from "@/lib/utils";
import { inr, inrCompact } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** e.g. "Default 50% NW · 2.0× Multiplier" / "Direct 100% NW Target" for the net-worth pill. */
function pillSubtitle(type: MilestoneTargetType): string {
  const meta = MILESTONE_TARGET_TYPE_META[type];
  if (type === "net_worth") return `Direct ${meta.defaultAllocationPercent}% NW Target`;
  return `Default ${meta.defaultAllocationPercent}% NW · ${affordabilityMultiplier(meta.defaultAllocationPercent).toFixed(1)}× Multiplier`;
}

/**
 * Add/edit modal for a wealth milestone. `milestone: null` is add-mode;
 * a non-null milestone is edit-mode — only reachable for isCustom milestones
 * (defaults can't be edited in place, matching AccountMode/BrokerPartition).
 *
 * Net Worth Goal is a direct target; the other 3 categories are the
 * affordability-multiplier engine — the user enters an item's cost and a %
 * of net worth it's capped at, and targetAmount is DERIVED
 * (calculateRequiredNetWorth in projectionEngine.ts).
 */
export function MilestoneModal({
  milestone,
  open,
  onOpenChange,
}: {
  milestone: Milestone | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { addMilestone, updateMilestone } = useStore();
  const [name, setName] = useState("");
  const [targetType, setTargetType] = useState<MilestoneTargetType>("net_worth");
  const [amount, setAmount] = useState(""); // targetAmount for net_worth, itemCost for the affordability types
  const [allocationPercent, setAllocationPercent] = useState(
    MILESTONE_TARGET_TYPE_META.net_worth.defaultAllocationPercent,
  );

  // Re-seed whenever a DIFFERENT milestone is loaded for editing, or the
  // dialog re-opens in add-mode — same convention as EditTradeModal.
  useEffect(() => {
    if (!open) return;
    const type = milestone?.targetType ?? "net_worth";
    setTargetType(type);
    setName(milestone?.name ?? "");
    if (!milestone) {
      setAmount("");
      setAllocationPercent(MILESTONE_TARGET_TYPE_META.net_worth.defaultAllocationPercent);
    } else if (type === "net_worth") {
      setAmount(String(milestone.targetAmount));
      setAllocationPercent(MILESTONE_TARGET_TYPE_META.net_worth.defaultAllocationPercent);
    } else {
      setAmount(milestone.itemCost !== undefined ? String(milestone.itemCost) : "");
      setAllocationPercent(milestone.allocationPercent ?? MILESTONE_TARGET_TYPE_META[type].defaultAllocationPercent);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, milestone?.id]);

  // Switching category mid-edit: the number in `amount` means something
  // different in every category (a direct target vs. an item cost), so it's
  // cleared rather than silently reinterpreted.
  const handleTypeSelect = (type: MilestoneTargetType) => {
    setTargetType(type);
    setAllocationPercent(MILESTONE_TARGET_TYPE_META[type].defaultAllocationPercent);
    setAmount("");
  };

  const isAffordability = targetType !== "net_worth";
  const meta = MILESTONE_TARGET_TYPE_META[targetType];
  const amountNum = Number(amount);
  const requiredNetWorth = isAffordability ? calculateRequiredNetWorth(amountNum, allocationPercent) : amountNum;
  const multiplier = affordabilityMultiplier(allocationPercent);
  const isValid = name.trim() !== "" && amountNum > 0;

  const handleSave = () => {
    if (!isValid) {
      toast.error(
        isAffordability
          ? "Give the goal a name and an item cost above ₹0"
          : "Give the milestone a name and a target amount above ₹0",
      );
      return;
    }
    const payload: MilestoneInput = {
      name,
      targetType,
      targetAmount: requiredNetWorth,
      itemCost: isAffordability ? amountNum : undefined,
      allocationPercent: isAffordability ? allocationPercent : undefined,
    };
    if (milestone) {
      const ok = updateMilestone(milestone.id, payload);
      if (!ok) {
        toast.error("Only custom milestones can be edited");
        return;
      }
      toast.success("Milestone updated");
    } else {
      addMilestone(payload);
      toast.success("Milestone added");
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#060913]/95 border border-white/10 backdrop-blur-2xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display tracking-tight">
            {milestone ? "Edit milestone" : "Add milestone"}
          </DialogTitle>
          <DialogDescription>
            A wealth target the Milestone Tracker watches for and projects an ETA against.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Milestone Name
            </Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="House Downpayment, Early Retirement, Dream Car…"
              className="mt-1.5 bg-input/40 border-white/10"
              autoFocus
            />
          </div>

          <div>
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5 block">
              Target Type
            </Label>
            <div className="grid grid-cols-2 gap-2">
              {MILESTONE_TARGET_TYPE_ORDER.map((type) => {
                const typeMeta = MILESTONE_TARGET_TYPE_META[type];
                const active = targetType === type;
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => handleTypeSelect(type)}
                    aria-pressed={active}
                    className={cn(
                      "flex flex-col items-start gap-0.5 rounded-xl border p-2.5 text-left transition-colors",
                      active
                        ? "border-primary/40 bg-primary/10"
                        : "border-white/10 bg-white/[0.02] hover:border-white/20",
                    )}
                  >
                    <span className="text-sm font-semibold">
                      {typeMeta.icon} {typeMeta.label}
                    </span>
                    <span className="text-[10px] text-muted-foreground">{pillSubtitle(type)}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {isAffordability ? "Item / Purchase Cost" : "Target Amount in ₹"}
            </Label>
            <Input
              type="number"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="4000000"
              className="mt-1.5 bg-input/40 border-white/10 tnum"
            />
            {amountNum > 0 && !isAffordability && (
              <p className="text-xs text-muted-foreground mt-1.5 tnum">
                {inr(amountNum)} · ≈ {inrCompact(amountNum)}
              </p>
            )}
          </div>

          {isAffordability && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-sm text-muted-foreground">Safety Allocation</Label>
                <span className="text-sm font-semibold tnum">
                  {allocationPercent}% NW · {multiplier.toFixed(1)}× buffer
                </span>
              </div>
              <Slider
                value={[allocationPercent]}
                min={meta.minAllocationPercent}
                max={meta.maxAllocationPercent}
                step={1}
                onValueChange={([v]) => setAllocationPercent(v)}
              />
              <div className="flex items-center justify-between text-[10px] text-muted-foreground mt-1.5">
                <span>More buffer ({meta.minAllocationPercent}%)</span>
                <span>Less buffer ({meta.maxAllocationPercent}%)</span>
              </div>

              {amountNum > 0 && (
                <div className="rounded-xl border border-primary/20 bg-primary/[0.06] p-3 mt-3 text-xs leading-relaxed">
                  <p className="text-muted-foreground">
                    To safely spend{" "}
                    <span className="text-foreground font-semibold tnum">{inr(amountNum)}</span> on{" "}
                    <span className="text-foreground font-semibold">{name.trim() || "this"}</span> (max{" "}
                    <span className="text-foreground font-semibold tnum">{allocationPercent}%</span> of NW),
                    your required target Net Worth is{" "}
                    <span className="text-primary font-bold tnum">{inr(requiredNetWorth)}</span> (
                    <span className="font-semibold tnum">{multiplier.toFixed(1)}×</span> buffer).
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <Button type="button" variant="outline" className="border-white/10" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={!isValid}
            className="gradient-primary text-primary-foreground border-0 gap-2 glow"
          >
            {milestone ? "Save changes" : "Add milestone"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
