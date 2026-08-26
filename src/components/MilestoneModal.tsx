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
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const DP_PERCENT_PRESETS = [10, 20, 25, 50] as const;
/** How long .shake-error's keyframe animation runs — kept in sync with styles.css. */
const SHAKE_DURATION_MS = 500;

const AMOUNT_REQUIRED_MSG = "Please enter an amount greater than ₹0";

type TouchedField = "name" | "amount" | "totalAssetCost" | "downpayment";

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
 * affordability-multiplier engine — the user enters an item's cost (or, in
 * Down Payment financing mode, a down payment) and a % of net worth it's
 * capped at, and targetAmount is DERIVED (calculateRequiredNetWorth in
 * projectionEngine.ts).
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
  const [amount, setAmount] = useState(""); // targetAmount for net_worth, itemCost for the affordability types (unfinanced)
  const [allocationPercent, setAllocationPercent] = useState(
    MILESTONE_TARGET_TYPE_META.net_worth.defaultAllocationPercent,
  );
  const [isFinanced, setIsFinanced] = useState(false);
  const [totalAssetCost, setTotalAssetCost] = useState("");
  const [downpaymentAmount, setDownpaymentAmount] = useState("");

  // Validation feedback: a field's error only SHOWS once it's been touched
  // (blurred) or a save attempt has already failed — never on first paint,
  // so a fresh "Add milestone" dialog doesn't greet the user with red fields.
  const [touched, setTouched] = useState<Partial<Record<TouchedField, boolean>>>({});
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);
  const [isShaking, setIsShaking] = useState(false);
  const markTouched = (field: TouchedField) => setTouched((t) => ({ ...t, [field]: true }));

  // Re-seed whenever a DIFFERENT milestone is loaded for editing, or the
  // dialog re-opens in add-mode — same convention as EditTradeModal.
  useEffect(() => {
    if (!open) return;
    const type = milestone?.targetType ?? "net_worth";
    setTargetType(type);
    setName(milestone?.name ?? "");
    setTouched({});
    setAttemptedSubmit(false);
    const financedExisting = type !== "net_worth" && milestone?.isFinanced === true;
    setIsFinanced(financedExisting);
    if (!milestone || type === "net_worth") {
      setAmount(milestone ? String(milestone.targetAmount) : "");
      setTotalAssetCost("");
      setDownpaymentAmount("");
      setAllocationPercent(MILESTONE_TARGET_TYPE_META.net_worth.defaultAllocationPercent);
    } else if (financedExisting) {
      setAmount("");
      setTotalAssetCost(milestone.totalAssetCost !== undefined ? String(milestone.totalAssetCost) : "");
      setDownpaymentAmount(milestone.downpaymentAmount !== undefined ? String(milestone.downpaymentAmount) : "");
      setAllocationPercent(milestone.allocationPercent ?? MILESTONE_TARGET_TYPE_META[type].defaultAllocationPercent);
    } else {
      setAmount(milestone.itemCost !== undefined ? String(milestone.itemCost) : "");
      setTotalAssetCost("");
      setDownpaymentAmount("");
      setAllocationPercent(milestone.allocationPercent ?? MILESTONE_TARGET_TYPE_META[type].defaultAllocationPercent);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, milestone?.id]);

  // Switching category mid-edit: the numbers mean something different in
  // every category (a direct target vs. an item cost vs. a down payment), so
  // they're cleared rather than silently reinterpreted.
  const handleTypeSelect = (type: MilestoneTargetType) => {
    setTargetType(type);
    setAllocationPercent(MILESTONE_TARGET_TYPE_META[type].defaultAllocationPercent);
    setAmount("");
    setIsFinanced(false);
    setTotalAssetCost("");
    setDownpaymentAmount("");
    setTouched({});
  };

  const isAffordability = targetType !== "net_worth";
  const financed = isAffordability && isFinanced;
  const meta = MILESTONE_TARGET_TYPE_META[targetType];
  const amountNum = Number(amount);
  const totalAssetCostNum = Number(totalAssetCost);
  const downpaymentNum = Number(downpaymentAmount);
  // The number the safety multiplier actually evaluates against: the real
  // out-of-pocket down payment when financed, otherwise the plain item cost.
  const effectiveCost = financed ? downpaymentNum : amountNum;
  const requiredNetWorth = isAffordability ? calculateRequiredNetWorth(effectiveCost, allocationPercent) : amountNum;
  const multiplier = affordabilityMultiplier(allocationPercent);

  // Per-field error messages — null when that field is currently valid.
  const nameError = name.trim() === "" ? "Milestone name is required" : null;
  const amountError = !financed && !(amountNum > 0) ? AMOUNT_REQUIRED_MSG : null;
  const totalAssetCostError = financed && !(totalAssetCostNum > 0) ? AMOUNT_REQUIRED_MSG : null;
  const downpaymentError = financed
    ? !(downpaymentNum > 0)
      ? AMOUNT_REQUIRED_MSG
      : downpaymentNum > totalAssetCostNum
        ? "Down payment cannot exceed total asset cost"
        : null
    : null;
  const firstError = nameError ?? totalAssetCostError ?? downpaymentError ?? amountError;

  // A field's error only renders once touched or a submit has been attempted.
  const showError = (field: TouchedField, error: string | null) =>
    (touched[field] || attemptedSubmit) && error ? error : null;
  const errorInputClass = "border-red-500/50 bg-red-500/[0.04]";

  const triggerShake = () => {
    setIsShaking(true);
    setTimeout(() => setIsShaking(false), SHAKE_DURATION_MS);
  };

  const handleSave = () => {
    setAttemptedSubmit(true);
    if (firstError) {
      toast.error(firstError);
      triggerShake();
      return;
    }
    const payload: MilestoneInput = {
      name,
      targetType,
      targetAmount: requiredNetWorth,
      itemCost: isAffordability ? effectiveCost : undefined,
      allocationPercent: isAffordability ? allocationPercent : undefined,
      isFinanced: financed,
      totalAssetCost: financed ? totalAssetCostNum : undefined,
      downpaymentAmount: financed ? downpaymentNum : undefined,
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
      <DialogContent
        className={cn(
          "bg-[#060913]/95 border border-white/10 backdrop-blur-2xl sm:max-w-md",
          isShaking && "shake-error",
        )}
      >
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
              onBlur={() => markTouched("name")}
              placeholder="House Downpayment, Early Retirement, Dream Car…"
              className={cn("mt-1.5 bg-input/40 border-white/10", showError("name", nameError) && errorInputClass)}
              autoFocus
            />
            {showError("name", nameError) && (
              <p className="text-xs text-red-400 mt-1.5">{showError("name", nameError)}</p>
            )}
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

          {isAffordability && (
            <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5">
              <div>
                <Label htmlFor="is-financed" className="text-sm">
                  Financed Purchase
                </Label>
                <p className="text-[10px] text-muted-foreground">Down Payment Target</p>
              </div>
              <Switch
                id="is-financed"
                checked={isFinanced}
                onCheckedChange={(v) => {
                  setIsFinanced(v);
                  setAmount("");
                  setTotalAssetCost("");
                  setDownpaymentAmount("");
                  setTouched({});
                }}
              />
            </div>
          )}

          {financed ? (
            <>
              <div>
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Total Asset Cost (₹)
                </Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={totalAssetCost}
                  onChange={(e) => setTotalAssetCost(e.target.value)}
                  onBlur={() => markTouched("totalAssetCost")}
                  placeholder="2500000"
                  className={cn(
                    "mt-1.5 bg-input/40 border-white/10 tnum",
                    showError("totalAssetCost", totalAssetCostError) && errorInputClass,
                  )}
                />
                {totalAssetCostNum > 0 && (
                  <p className="text-xs text-muted-foreground mt-1.5 tnum">
                    {inr(totalAssetCostNum)} · ≈ {inrCompact(totalAssetCostNum)}
                  </p>
                )}
                {showError("totalAssetCost", totalAssetCostError) && (
                  <p className="text-xs text-red-400 mt-1.5">{showError("totalAssetCost", totalAssetCostError)}</p>
                )}
              </div>
              <div>
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Estimated Down Payment (₹)
                </Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={downpaymentAmount}
                  onChange={(e) => setDownpaymentAmount(e.target.value)}
                  onBlur={() => markTouched("downpayment")}
                  placeholder="500000"
                  className={cn(
                    "mt-1.5 bg-input/40 border-white/10 tnum",
                    showError("downpayment", downpaymentError) && errorInputClass,
                  )}
                />
                <div className="flex gap-1.5 mt-2">
                  {DP_PERCENT_PRESETS.map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      disabled={!(totalAssetCostNum > 0)}
                      onClick={() => {
                        setDownpaymentAmount(String(Math.round(totalAssetCostNum * (pct / 100))));
                        markTouched("downpayment");
                      }}
                      className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:border-white/25 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                    >
                      {pct}%
                    </button>
                  ))}
                </div>
                {downpaymentNum > 0 && !downpaymentError && (
                  <p className="text-xs text-muted-foreground mt-1.5 tnum">
                    {inr(downpaymentNum)} · ≈ {inrCompact(downpaymentNum)}
                  </p>
                )}
                {showError("downpayment", downpaymentError) && (
                  <p className="text-xs text-red-400 mt-1.5">{showError("downpayment", downpaymentError)}</p>
                )}
              </div>
            </>
          ) : (
            <div>
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {isAffordability ? "Item / Purchase Cost" : "Target Amount in ₹"}
              </Label>
              <Input
                type="number"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                onBlur={() => markTouched("amount")}
                placeholder="4000000"
                className={cn(
                  "mt-1.5 bg-input/40 border-white/10 tnum",
                  showError("amount", amountError) && errorInputClass,
                )}
              />
              {amountNum > 0 && !isAffordability && (
                <p className="text-xs text-muted-foreground mt-1.5 tnum">
                  {inr(amountNum)} · ≈ {inrCompact(amountNum)}
                </p>
              )}
              {showError("amount", amountError) && (
                <p className="text-xs text-red-400 mt-1.5">{showError("amount", amountError)}</p>
              )}
            </div>
          )}

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

              {effectiveCost > 0 && (
                <div className="rounded-xl border border-primary/20 bg-primary/[0.06] p-3 mt-3 text-xs leading-relaxed">
                  <p className="text-muted-foreground">
                    {financed ? (
                      <>
                        To safely fund a{" "}
                        <span className="text-foreground font-semibold tnum">{inr(downpaymentNum)}</span> Down
                        Payment on your{" "}
                        <span className="text-foreground font-semibold tnum">{inr(totalAssetCostNum)}</span> Asset
                        (max <span className="text-foreground font-semibold tnum">{allocationPercent}%</span>{" "}
                        {meta.label} buffer), your target Net Worth is{" "}
                        <span className="text-primary font-bold tnum">{inr(requiredNetWorth)}</span>.
                      </>
                    ) : (
                      <>
                        To safely spend{" "}
                        <span className="text-foreground font-semibold tnum">{inr(amountNum)}</span> on{" "}
                        <span className="text-foreground font-semibold">{name.trim() || "this"}</span> (max{" "}
                        <span className="text-foreground font-semibold tnum">{allocationPercent}%</span> of NW),
                        your required target Net Worth is{" "}
                        <span className="text-primary font-bold tnum">{inr(requiredNetWorth)}</span> (
                        <span className="font-semibold tnum">{multiplier.toFixed(1)}×</span> buffer).
                      </>
                    )}
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
            className="gradient-primary text-primary-foreground border-0 gap-2 glow"
          >
            {milestone ? "Save changes" : "Add milestone"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
