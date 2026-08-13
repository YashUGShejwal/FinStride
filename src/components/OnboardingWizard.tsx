import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronLeft, ChevronRight, Landmark, Plus, Trash2, TrendingUp, Wallet, X } from "lucide-react";
import { toast } from "sonner";
import {
  DEFAULT_ACCOUNT_MODES,
  DEFAULT_BROKER_PARTITIONS,
  useStore,
  type AccountType,
  type PartitionCategory,
  type PaymentChannel,
} from "@/lib/store";
import { inr } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Sensitive } from "@/components/Sensitive";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// One-click suggestions for the free-text fields below the toggle chips —
// never block or gate the built-in defaults, which are already active for
// every account regardless of this wizard.
const BANK_SUGGESTIONS: { name: string; type: AccountType; channel?: PaymentChannel }[] = [
  { name: "HDFC Bank", type: "bank", channel: "NetBanking" },
  { name: "SBI", type: "bank", channel: "NetBanking" },
  { name: "ICICI Bank", type: "bank", channel: "NetBanking" },
  { name: "Axis Bank", type: "bank", channel: "NetBanking" },
  { name: "Paytm", type: "wallet", channel: "UPI" },
  { name: "Google Pay", type: "wallet", channel: "UPI" },
];
const BROKER_SUGGESTIONS: { name: string; category: PartitionCategory }[] = [
  { name: "Zerodha", category: "equity_swing" },
  { name: "Dhan", category: "equity_swing" },
  { name: "Groww", category: "mutual_funds" },
  { name: "Upstox", category: "equity_swing" },
  { name: "Angel One", category: "equity_swing" },
];

const STEP_META = [
  { label: "Accounts & Cards", icon: Wallet },
  { label: "Brokers & Partitions", icon: TrendingUp },
  { label: "Fixed Obligations", icon: Landmark },
] as const;

/**
 * First-run 3-step setup. Mounted unconditionally in the workstation shell —
 * decides its own visibility from the store (hydrated + first-time-user +
 * not-yet-completed) so call sites don't need to thread any props.
 *
 * Accounts & Partitions are shown as toggle chips — every built-in default is
 * ON by default (matching how they behave everywhere else in the app) and can
 * be switched off, since defaults are just as deletable as anything custom.
 * Toggling only takes effect when "Finish setup" is clicked; dismissing the
 * wizard any other way (Skip, Escape, backdrop click) leaves every list
 * untouched, exactly like before this toggle model existed.
 */
export function OnboardingWizard() {
  const {
    hydrated, onboardingCompleted, isFirstTimeUser, completeOnboarding,
    accountModes, addAccountMode, deleteAccountMode,
    brokerPartitions, addBrokerPartition, deleteBrokerPartition,
  } = useStore();
  const [step, setStep] = useState(0);

  // `open` is latched state, not a direct derivation of isFirstTimeUser: the
  // wizard's whole PURPOSE is to have the user add their first account/
  // partition/obligation, which flips isFirstTimeUser to false the instant
  // they add anything — a raw derivation would slam the dialog shut mid-step
  // the moment they add their very first item. The effect below only ever
  // opens it; closing is exclusively the user's action via close().
  const shouldOpen = hydrated && !onboardingCompleted && isFirstTimeUser;
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (shouldOpen) setOpen(true);
  }, [shouldOpen]);

  // Toggle-chip state for the two default+suggestion rows — local until
  // "Finish setup" reconciles it against the store. Keyed by id/name.
  const [accountChecked, setAccountChecked] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const a of DEFAULT_ACCOUNT_MODES) initial[a.id] = true;
    for (const s of BANK_SUGGESTIONS) initial[s.name] = false;
    return initial;
  });
  const [partitionChecked, setPartitionChecked] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const p of DEFAULT_BROKER_PARTITIONS) initial[p.id] = true;
    for (const s of BROKER_SUGGESTIONS) initial[s.name] = false;
    return initial;
  });

  const dismiss = () => {
    completeOnboarding();
    setOpen(false);
    setStep(0);
  };

  const finishSetup = () => {
    for (const a of DEFAULT_ACCOUNT_MODES) {
      if (accountChecked[a.id] === false) deleteAccountMode(a.id);
    }
    for (const s of BANK_SUGGESTIONS) {
      if (accountChecked[s.name] && !accountModes.some((a) => a.id === s.name)) {
        addAccountMode(s.name, s.type, s.channel);
      }
    }
    for (const p of DEFAULT_BROKER_PARTITIONS) {
      if (partitionChecked[p.id] === false) deleteBrokerPartition(p.id);
    }
    for (const s of BROKER_SUGGESTIONS) {
      if (partitionChecked[s.name] && !brokerPartitions.some((p) => p.id === s.name)) {
        addBrokerPartition(s.name, s.category);
      }
    }
    dismiss();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) dismiss(); }}>
      <DialogContent className="glass-strong border-glass-border max-w-lg p-0 overflow-hidden [&>button]:hidden">
        <DialogTitle className="sr-only">First-time setup</DialogTitle>
        <DialogDescription className="sr-only">
          Set up the accounts, brokers, and fixed obligations FinStride tracks for you.
        </DialogDescription>

        <div className="flex items-center justify-between px-6 pt-6">
          <div className="flex items-center gap-2">
            {STEP_META.map((s, i) => (
              <div key={s.label} className="flex items-center gap-2">
                <div
                  className={cn(
                    "size-7 rounded-full grid place-items-center text-xs font-semibold transition-colors",
                    i === step
                      ? "gradient-primary text-primary-foreground glow"
                      : i < step
                        ? "bg-[oklch(0.72_0.18_155/0.2)] text-[oklch(0.82_0.16_155)]"
                        : "bg-white/5 text-muted-foreground",
                  )}
                >
                  {i < step ? <Check className="size-3.5" /> : i + 1}
                </div>
                {i < STEP_META.length - 1 && (
                  <div className={cn("h-px w-6", i < step ? "bg-[oklch(0.72_0.18_155/0.4)]" : "bg-white/10")} />
                )}
              </div>
            ))}
          </div>
          <button
            onClick={dismiss}
            aria-label="Skip setup"
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="px-6 py-6 min-h-[280px]">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            >
              {step === 0 && (
                <AccountsStep checked={accountChecked} onToggle={(k) => setAccountChecked((c) => ({ ...c, [k]: !c[k] }))} />
              )}
              {step === 1 && (
                <PartitionsStep checked={partitionChecked} onToggle={(k) => setPartitionChecked((c) => ({ ...c, [k]: !c[k] }))} />
              )}
              {step === 2 && <ObligationsStep />}
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-glass-border bg-white/[0.02]">
          <Button type="button" variant="ghost" onClick={dismiss} className="text-muted-foreground">
            Use Default Blueprint
          </Button>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <Button type="button" variant="secondary" onClick={() => setStep((s) => s - 1)} className="gap-1.5">
                <ChevronLeft className="size-4" /> Back
              </Button>
            )}
            {step < STEP_META.length - 1 ? (
              <Button
                type="button"
                onClick={() => setStep((s) => s + 1)}
                className="gap-1.5 gradient-primary text-primary-foreground border-0"
              >
                Next <ChevronRight className="size-4" />
              </Button>
            ) : (
              <Button
                type="button"
                onClick={finishSetup}
                className="gap-1.5 gradient-primary text-primary-foreground border-0"
              >
                Finish setup <Check className="size-4" />
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Shared toggle-chip row (defaults + suggestions, checked = will be kept/added) ─
function ToggleChipRow({
  items,
  checked,
  onToggle,
}: {
  items: string[];
  checked: Record<string, boolean>;
  onToggle: (key: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((key) => {
        const isChecked = checked[key] ?? false;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onToggle(key)}
            className={cn(
              "flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-full border transition-all",
              isChecked
                ? "border-[oklch(0.72_0.18_155/0.4)] bg-[oklch(0.72_0.18_155/0.1)] text-[oklch(0.82_0.16_155)]"
                : "border-glass-border glass hover:border-primary/30 hover:bg-white/5 text-muted-foreground",
            )}
          >
            {isChecked ? <Check className="size-3.5" /> : <span className="size-3.5" />} {key}
          </button>
        );
      })}
    </div>
  );
}

// ─── Free-text add/remove list (immediately committed to the store) ───────
function CustomAddList({
  added,
  onAdd,
  onDelete,
  placeholder,
}: {
  added: string[];
  onAdd: (name: string) => void;
  onDelete: (name: string) => void;
  placeholder: string;
}) {
  const [input, setInput] = useState("");
  const addedLower = new Set(added.map((a) => a.toLowerCase()));

  const submitInput = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    if (addedLower.has(trimmed.toLowerCase())) {
      toast.error(`"${trimmed}" is already on the list`);
      return;
    }
    onAdd(trimmed);
    setInput("");
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), submitInput())}
          placeholder={placeholder}
          className="bg-input/40 border-glass-border h-9 text-sm"
        />
        <Button type="button" onClick={submitInput} size="sm" className="gradient-primary text-primary-foreground border-0 h-9 px-3 shrink-0">
          <Plus className="size-4" />
        </Button>
      </div>

      {added.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {added.map((a) => (
            <span
              key={a}
              className="flex items-center gap-1.5 text-xs pl-2.5 pr-1.5 py-1 rounded-full bg-white/5 border border-glass-border text-muted-foreground"
            >
              {a}
              <button onClick={() => onDelete(a)} aria-label={`Remove ${a}`} className="hover:text-destructive">
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function AccountsStep({
  checked,
  onToggle,
}: {
  checked: Record<string, boolean>;
  onToggle: (key: string) => void;
}) {
  const { accountModes, addAccountMode, deleteAccountMode } = useStore();
  const knownIds = new Set([
    ...DEFAULT_ACCOUNT_MODES.map((a) => a.id),
    ...BANK_SUGGESTIONS.map((s) => s.name),
  ]);
  // Anything already added via the free-text field below (not one of the
  // toggle chips above) — e.g. from a prior partial run of this wizard.
  const customAdded = accountModes.filter((a) => !knownIds.has(a.id)).map((a) => a.id);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-display font-semibold tracking-tight text-lg">Bank accounts & credit cards</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Every checked chip will be active once setup finishes — untick anything you don't use, or
          tick a suggestion to add it.
        </p>
      </div>

      <ToggleChipRow
        items={[...DEFAULT_ACCOUNT_MODES.map((a) => a.id), ...BANK_SUGGESTIONS.map((s) => s.name)]}
        checked={checked}
        onToggle={onToggle}
      />

      <p className="text-[11px] uppercase tracking-wider text-muted-foreground/70 pt-1">
        Something else?
      </p>
      <CustomAddList
        added={customAdded}
        onAdd={(name) => addAccountMode(name, "bank")}
        onDelete={(id) => deleteAccountMode(id)}
        placeholder="Type a bank or card name…"
      />
    </div>
  );
}

function PartitionsStep({
  checked,
  onToggle,
}: {
  checked: Record<string, boolean>;
  onToggle: (key: string) => void;
}) {
  const { brokerPartitions, addBrokerPartition, deleteBrokerPartition } = useStore();
  const knownIds = new Set([
    ...DEFAULT_BROKER_PARTITIONS.map((p) => p.id),
    ...BROKER_SUGGESTIONS.map((s) => s.name),
  ]);
  const customAdded = brokerPartitions.filter((p) => !knownIds.has(p.id)).map((p) => p.id);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-display font-semibold tracking-tight text-lg">Investment brokers & partitions</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Every checked chip will be active once setup finishes — untick anything you don't use, or
          tick a suggestion to add it.
        </p>
      </div>

      <ToggleChipRow
        items={[...DEFAULT_BROKER_PARTITIONS.map((p) => p.id), ...BROKER_SUGGESTIONS.map((s) => s.name)]}
        checked={checked}
        onToggle={onToggle}
      />

      <p className="text-[11px] uppercase tracking-wider text-muted-foreground/70 pt-1">
        Something else?
      </p>
      <CustomAddList
        added={customAdded}
        onAdd={(name) => addBrokerPartition(name, "equity_swing")}
        onDelete={(id) => { deleteBrokerPartition(id); }}
        placeholder="Type a broker name…"
      />
    </div>
  );
}

function ObligationsStep() {
  const { customObligations, addObligation, deleteObligation } = useStore();
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");

  const submit = () => {
    const trimmed = label.trim();
    if (!trimmed) return;
    if (customObligations.some((o) => o.label.toLowerCase() === trimmed.toLowerCase())) {
      toast.error(`"${trimmed}" is already on the list`);
      return;
    }
    const n = Number(amount);
    if (amount.trim() !== "" && (isNaN(n) || n < 0)) {
      toast.error("Amount must be a positive number");
      return;
    }
    addObligation(trimmed, amount.trim() === "" ? 0 : n);
    setLabel("");
    setAmount("");
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-display font-semibold tracking-tight text-lg">Fixed monthly obligations</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Rent, EMIs, and SIPs configured in Settings are already tracked. List anything else recurring
          — e.g. Netflix, gym membership, a car loan EMI.
        </p>
      </div>

      <div className="flex gap-2">
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), submit())}
          placeholder="e.g. Car Loan EMI"
          className="bg-input/40 border-glass-border h-9 text-sm flex-1"
        />
        <Input
          type="number"
          min="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), submit())}
          placeholder="₹ / month"
          className="bg-input/40 border-glass-border h-9 text-sm tnum w-28 shrink-0"
        />
        <Button type="button" onClick={submit} size="sm" className="gradient-primary text-primary-foreground border-0 h-9 px-3 shrink-0">
          <Plus className="size-4" />
        </Button>
      </div>

      {customObligations.length > 0 && (
        <ul className="space-y-1.5">
          {customObligations.map((o) => (
            <li
              key={o.id}
              className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl border border-glass-border bg-white/3 text-sm"
            >
              <span className="min-w-0 truncate">{o.label}</span>
              <div className="flex items-center gap-3 shrink-0">
                <Sensitive>
                  <span className="tnum text-muted-foreground">{inr(o.amount)}</span>
                </Sensitive>
                <button onClick={() => deleteObligation(o.id)} aria-label={`Remove ${o.label}`} className="text-muted-foreground hover:text-destructive">
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
