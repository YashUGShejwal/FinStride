import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  MILESTONE_TARGET_TYPES,
  useStore,
  type Milestone,
  type MilestoneTargetType,
} from "@/lib/store";
import { inr, inrCompact } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * Add/edit modal for a wealth milestone. `milestone: null` is add-mode;
 * a non-null milestone is edit-mode — only reachable for isCustom milestones
 * (defaults can't be edited in place, matching AccountMode/BrokerPartition).
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
  const [amount, setAmount] = useState("");
  const [targetType, setTargetType] = useState<MilestoneTargetType>("custom");

  // Re-seed whenever a DIFFERENT milestone is loaded for editing, or the
  // dialog re-opens in add-mode — same convention as EditTradeModal.
  useEffect(() => {
    if (!open) return;
    setName(milestone?.name ?? "");
    setAmount(milestone ? String(milestone.targetAmount) : "");
    setTargetType(milestone?.targetType ?? "custom");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, milestone?.id]);

  const amountNum = Number(amount);
  const isValid = name.trim() !== "" && amountNum > 0;

  const handleSave = () => {
    if (!isValid) {
      toast.error("Give the milestone a name and a target amount above ₹0");
      return;
    }
    if (milestone) {
      const ok = updateMilestone(milestone.id, { name, targetAmount: amountNum, targetType });
      if (!ok) {
        toast.error("Only custom milestones can be edited");
        return;
      }
      toast.success("Milestone updated");
    } else {
      addMilestone({ name, targetAmount: amountNum, targetType });
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
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Target Amount in ₹
            </Label>
            <Input
              type="number"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="4000000"
              className="mt-1.5 bg-input/40 border-white/10 tnum"
            />
            {amountNum > 0 && (
              <p className="text-xs text-muted-foreground mt-1.5 tnum">
                {inr(amountNum)} · ≈ {inrCompact(amountNum)}
              </p>
            )}
          </div>

          <div>
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Target Type
            </Label>
            <Select value={targetType} onValueChange={(v: MilestoneTargetType) => setTargetType(v)}>
              <SelectTrigger className="mt-1.5 bg-input/40 border-white/10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MILESTONE_TARGET_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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
