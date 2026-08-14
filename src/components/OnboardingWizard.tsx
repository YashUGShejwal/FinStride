import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Building2, Check, ChevronLeft, ChevronRight, CreditCard, Landmark, Link2, Plus,
  Smartphone, Tags, Trash2, TrendingUp, Wallet, X,
} from "lucide-react";
import { toast } from "sonner";
import {
  DEFAULT_ACCOUNT_MODES,
  DEFAULT_BROKER_PARTITIONS,
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_INCOME_CATEGORIES,
  useStore,
  type AccountMode,
  type AccountType,
  type PartitionPurpose,
} from "@/lib/store";
import { inr } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Sensitive } from "@/components/Sensitive";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const BANK_SUGGESTIONS = ["HDFC Bank", "ICICI Bank", "SBI", "Axis Bank", "Kotak"];
const UPI_SUGGESTIONS = ["GPay", "PhonePe", "Paytm"];

const STEP_META = [
  { label: "Accounts & Channels", icon: Wallet },
  { label: "Investment Partitions", icon: TrendingUp },
  { label: "Categories", icon: Tags },
  { label: "Fixed Obligations", icon: Landmark },
] as const;

/**
 * Broker groups for step 2, in the order they're presented. `purpose` is what
 * gets stored; the copy is what makes the choice obvious to someone who has
 * never thought about "partitions" before.
 */
const PARTITION_GROUPS: {
  purpose: PartitionPurpose;
  title: string;
  hint: string;
  placeholder: string;
  suggestions: string[];
  /**
   * Prefix for the composed partition name — typing "Zerodha" under
   * Long-term creates "Long-Term (Zerodha)". The purpose is baked into the
   * NAME, not just the grouping, because the swing-trade and snapshot
   * partition dropdowns render a flat list with no headings: there, a bare
   * "Zerodha" would say nothing about what the money is for. `null` means
   * "use exactly what was typed" — the free-form group.
   */
  noun: string | null;
}[] = [
  {
    purpose: "long_term",
    title: "Long-term broker(s)",
    hint: "Where you hold delivery equity, ETFs, and mutual funds you don't trade.",
    placeholder: "e.g. Zerodha, Groww…",
    suggestions: ["Zerodha", "Groww", "Kuvera"],
    noun: "Long-Term",
  },
  {
    purpose: "swing",
    title: "Primary / swing broker(s)",
    hint: "Your active trading book — the account the risk cap is sized against.",
    placeholder: "e.g. Dhan, Upstox…",
    suggestions: ["Dhan", "Upstox", "Angel One"],
    noun: "Swing",
  },
  {
    purpose: "international",
    title: "International broker(s)",
    hint: "US or other non-domestic equities. Skip if you don't hold any.",
    placeholder: "e.g. INDmoney, Vested…",
    suggestions: ["INDmoney", "Vested"],
    noun: "International",
  },
  {
    purpose: "crypto",
    title: "Crypto",
    hint: "Exchange accounts or wallets you hold coins in.",
    placeholder: "e.g. CoinDCX, WazirX…",
    suggestions: ["CoinDCX", "WazirX"],
    noun: "Crypto",
  },
  {
    purpose: "custom",
    title: "Anything else",
    hint: "Gold, a side pot, an emergency fund — anything you want tracked separately.",
    placeholder: "e.g. Emergency Fund…",
    suggestions: [],
    noun: null,
  },
];

/**
 * First-run 4-step setup. Mounted unconditionally in the workstation shell —
 * decides its own visibility from the store (hydrated + first-time-user +
 * not-yet-completed) so call sites don't need to thread any props.
 *
 * TWO DIFFERENT COMMIT MODELS live here, deliberately:
 *
 *   - Accounts, partitions and obligations (steps 1, 2, 4) commit to the store
 *     IMMEDIATELY as you add them. They're relational — a credit card has to
 *     pick a bank that already exists — so deferring them would mean building
 *     a shadow copy of the store's linking rules inside this component.
 *   - Category toggles (step 3) are LATCHED local state, reconciled once on
 *     "Finish setup". Deleting a default category the instant a chip is
 *     unticked would fight the user mid-decision, and unlike accounts nothing
 *     downstream depends on the intermediate state.
 *
 * Dismissing by any other means (Skip, Escape, backdrop, "Use Default
 * Blueprint") leaves the category defaults exactly as they were — only the
 * items already committed in steps 1/2/4 persist.
 */
export function OnboardingWizard() {
  const {
    hydrated, onboardingCompleted, isFirstTimeUser, completeOnboarding,
    incomeCategories, expenseCategories, addCategory, deleteCategory,
  } = useStore();
  const [step, setStep] = useState(0);

  // `open` is latched state, not a direct derivation of isFirstTimeUser: the
  // wizard's whole PURPOSE is to have the user add their first account/
  // partition/obligation, which flips isFirstTimeUser to false the instant
  // they add anything — a raw derivation would slam the dialog shut mid-step
  // the moment they add their very first item. The effect below only ever
  // opens it; closing is exclusively the user's action.
  const shouldOpen = hydrated && !onboardingCompleted && isFirstTimeUser;
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (shouldOpen) setOpen(true);
  }, [shouldOpen]);

  // Step 3 chip state — every default starts ticked (matching how defaults
  // behave everywhere else in the app), unticking one marks it for deletion.
  const [catChecked, setCatChecked] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const c of DEFAULT_INCOME_CATEGORIES) initial[`income:${c}`] = true;
    for (const c of DEFAULT_EXPENSE_CATEGORIES) initial[`expense:${c}`] = true;
    return initial;
  });

  /** Every default ticked again — the state a fresh wizard starts in. */
  const allCategoriesChecked = () => {
    const initial: Record<string, boolean> = {};
    for (const c of DEFAULT_INCOME_CATEGORIES) initial[`income:${c}`] = true;
    for (const c of DEFAULT_EXPENSE_CATEGORIES) initial[`expense:${c}`] = true;
    return initial;
  };

  const dismiss = () => {
    completeOnboarding();
    setOpen(false);
    setStep(0);
    // Reset the latch too. It is NOT reconciled on dismissal, so leaving a
    // previous lifetime's unticks in place would let them apply the next time
    // the wizard opens and the user happens to hit Finish — deleting
    // categories from a decision made in a session they abandoned.
    setCatChecked(allCategoriesChecked());
  };

  const finishSetup = () => {
    for (const c of DEFAULT_INCOME_CATEGORIES) {
      if (catChecked[`income:${c}`] === false) deleteCategory("income", c);
    }
    for (const c of DEFAULT_EXPENSE_CATEGORIES) {
      if (catChecked[`expense:${c}`] === false) deleteCategory("expense", c);
    }
    dismiss();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) dismiss(); }}>
      <DialogContent className="glass-strong border-glass-border max-w-xl p-0 overflow-hidden [&>button]:hidden">
        <DialogTitle className="sr-only">First-time setup</DialogTitle>
        <DialogDescription className="sr-only">
          Set up the accounts, investment partitions, categories, and fixed obligations FinStride tracks for you.
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
                  <div className={cn("h-px w-4", i < step ? "bg-[oklch(0.72_0.18_155/0.4)]" : "bg-white/10")} />
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

        <div className="px-6 py-5 min-h-[340px] max-h-[60vh] overflow-y-auto">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            >
              {step === 0 && <AccountsStep />}
              {step === 1 && <PartitionsStep />}
              {step === 2 && (
                <CategoriesStep
                  checked={catChecked}
                  onToggle={(k) => setCatChecked((c) => ({ ...c, [k]: !(c[k] ?? true) }))}
                  incomeCategories={incomeCategories}
                  expenseCategories={expenseCategories}
                  onAddCustom={addCategory}
                  // "Keep Defaults" has to actually KEEP them: re-tick
                  // everything before advancing, or the button silently
                  // deletes whatever the user had already unticked — the exact
                  // opposite of what it says.
                  onKeepDefaults={() => {
                    setCatChecked(allCategoriesChecked());
                    setStep(3);
                  }}
                />
              )}
              {step === 3 && <ObligationsStep />}
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

// ─── Shared bits ────────────────────────────────────────────────────────────
function StepHeader({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="mb-4">
      <h3 className="font-display font-semibold tracking-tight text-lg">{title}</h3>
      <p className="text-sm text-muted-foreground mt-1">{hint}</p>
    </div>
  );
}

function GroupHeading({ icon: Icon, children }: { icon: typeof Wallet; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground/80 font-semibold">
      <Icon className="size-3.5" /> {children}
    </p>
  );
}

/** Text field + add button. Enter submits; blank input is a no-op. */
function AddRow({
  value,
  onChange,
  onSubmit,
  placeholder,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder: string;
  /** Extra controls (e.g. a bank Select) rendered between the input and the button. */
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), onSubmit())}
        placeholder={placeholder}
        className="bg-input/40 border-glass-border h-9 text-sm flex-1 min-w-[9rem]"
      />
      {children}
      <Button
        type="button"
        onClick={onSubmit}
        size="sm"
        className="gradient-primary text-primary-foreground border-0 h-9 px-3 shrink-0"
      >
        <Plus className="size-4" />
      </Button>
    </div>
  );
}

function SuggestionChips({
  suggestions,
  taken,
  onPick,
  composeName,
}: {
  suggestions: string[];
  taken: Set<string>;
  onPick: (name: string) => void;
  /** Maps a suggestion to the name it would actually create, for the taken check. */
  composeName?: (name: string) => string;
}) {
  const remaining = suggestions.filter(
    (s) => !taken.has((composeName ? composeName(s) : s).toLowerCase()),
  );
  if (remaining.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {remaining.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onPick(s)}
          className="text-xs px-2.5 py-1 rounded-full border border-glass-border glass hover:border-primary/30 hover:bg-white/5 text-muted-foreground transition-all"
        >
          + {s}
        </button>
      ))}
    </div>
  );
}

/** One added row: name, optional trailing badge, delete. */
function AddedRow({
  label,
  badge,
  onDelete,
}: {
  label: string;
  badge?: React.ReactNode;
  onDelete: () => void;
}) {
  return (
    <li className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl border border-glass-border bg-white/3 text-sm">
      <span className="min-w-0 truncate flex items-center gap-2">
        {label}
        {badge}
      </span>
      <button
        onClick={onDelete}
        aria-label={`Remove ${label}`}
        className="text-muted-foreground hover:text-destructive shrink-0"
      >
        <Trash2 className="size-3.5" />
      </button>
    </li>
  );
}

function LinkedBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/8 text-muted-foreground shrink-0">
      <Link2 className="size-2.5" /> {children}
    </span>
  );
}

// ─── Step 1 — Accounts & payment channels ───────────────────────────────────
/**
 * Banks first, then the things that hang off them. The ordering isn't
 * cosmetic: a credit card or UPI handle can only link to a bank that already
 * exists, so the funding accounts genuinely have to come first.
 */
function AccountsStep() {
  const { accountModes, bankAccounts, addAccountMode, deleteAccountMode } = useStore();

  const [bankInput, setBankInput] = useState("");
  const [cardInput, setCardInput] = useState("");
  const [cardBank, setCardBank] = useState("none");
  const [upiInput, setUpiInput] = useState("");
  const [upiBank, setUpiBank] = useState("none");

  const taken = new Set(accountModes.map((a) => a.id.toLowerCase()));
  const cards = accountModes.filter((a) => a.type === "credit_card");
  const upis = accountModes.filter((a) => a.type === "upi");

  const bankName = (id?: string) => accountModes.find((a) => a.id === id)?.name;

  const add = (name: string, type: AccountType, linkedBankId?: string) => {
    const trimmed = name.trim();
    if (!trimmed) return false;
    const resolvedBankId = linkedBankId && linkedBankId !== "none" ? linkedBankId : undefined;
    // Same name is only a duplicate when paired with the SAME funding bank (or
    // "no bank" on both sides) — "GPay via HDFC" and "GPay via ICICI" are two
    // distinct real accounts that happen to share a display name.
    const duplicate = accountModes.some(
      (a) =>
        a.name.toLowerCase() === trimmed.toLowerCase() &&
        (a.linkedBankId ?? "") === (resolvedBankId ?? ""),
    );
    if (duplicate) {
      const bank = resolvedBankId ? bankName(resolvedBankId) : undefined;
      toast.error(bank ? `"${trimmed}" via ${bank} is already on the list` : `"${trimmed}" is already on the list`);
      return false;
    }
    addAccountMode(trimmed, type, { linkedBankId: resolvedBankId });
    return true;
  };

  const remove = (a: AccountMode) => {
    if (!deleteAccountMode(a.id)) {
      toast.error(`"${a.name}" is already used by a transaction — remove that first`);
    }
  };

  /** Bank <Select> shared by the card and UPI rows. */
  const bankSelect = (value: string, onChange: (v: string) => void) => (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="bg-input/40 border-glass-border h-9 text-xs w-36 shrink-0">
        <SelectValue placeholder="Linked bank" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">No linked bank</SelectItem>
        {bankAccounts.map((b) => (
          <SelectItem key={b.id} value={b.id}>
            {b.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <div>
      <StepHeader
        title="Accounts & payment channels"
        hint="Add your banks first, then link the cards and UPI handles that draw from them."
      />

      <div className="space-y-5">
        {/* Banks */}
        <section className="space-y-2">
          <GroupHeading icon={Building2}>Bank accounts</GroupHeading>
          {bankAccounts.length > 0 && (
            <ul className="space-y-1.5">
              {bankAccounts.map((b) => (
                <AddedRow key={b.id} label={b.name} onDelete={() => remove(b)} />
              ))}
            </ul>
          )}
          <AddRow
            value={bankInput}
            onChange={setBankInput}
            onSubmit={() => add(bankInput, "bank") && setBankInput("")}
            placeholder="e.g. HDFC Bank…"
          />
          <SuggestionChips
            suggestions={BANK_SUGGESTIONS}
            taken={taken}
            onPick={(n) => add(n, "bank")}
          />
        </section>

        {/* Credit cards */}
        <section className="space-y-2">
          <GroupHeading icon={CreditCard}>Credit cards</GroupHeading>
          {cards.length > 0 && (
            <ul className="space-y-1.5">
              {cards.map((c) => (
                <AddedRow
                  key={c.id}
                  label={c.name}
                  badge={
                    bankName(c.linkedBankId) ? (
                      <LinkedBadge>{bankName(c.linkedBankId)}</LinkedBadge>
                    ) : undefined
                  }
                  onDelete={() => remove(c)}
                />
              ))}
            </ul>
          )}
          <AddRow
            value={cardInput}
            onChange={setCardInput}
            onSubmit={() => add(cardInput, "credit_card", cardBank) && setCardInput("")}
            placeholder="e.g. Amazon Pay…"
          >
            {bankAccounts.length > 0 && bankSelect(cardBank, setCardBank)}
          </AddRow>
          {bankAccounts.length === 0 && (
            <p className="text-[11px] text-muted-foreground/70">
              Add a bank above to link cards to it — you can also add a card now and link it later in Settings.
            </p>
          )}
        </section>

        {/* UPI handles */}
        <section className="space-y-2">
          <GroupHeading icon={Smartphone}>UPI handles</GroupHeading>
          {upis.length > 0 && (
            <ul className="space-y-1.5">
              {upis.map((u) => (
                <AddedRow
                  key={u.id}
                  label={u.name}
                  badge={
                    bankName(u.linkedBankId) ? (
                      <LinkedBadge>{bankName(u.linkedBankId)}</LinkedBadge>
                    ) : undefined
                  }
                  onDelete={() => remove(u)}
                />
              ))}
            </ul>
          )}
          <AddRow
            value={upiInput}
            onChange={setUpiInput}
            onSubmit={() => add(upiInput, "upi", upiBank) && setUpiInput("")}
            placeholder="e.g. GPay…"
          >
            {bankAccounts.length > 0 && bankSelect(upiBank, setUpiBank)}
          </AddRow>
          <SuggestionChips
            suggestions={UPI_SUGGESTIONS}
            taken={taken}
            onPick={(n) => add(n, "upi", upiBank)}
          />
        </section>

        <p className="text-[11px] text-muted-foreground/70 pt-1">
          {DEFAULT_ACCOUNT_MODES.length} generic defaults (Bank Account, Credit Card, UPI, Cash) are
          already active — manage or remove them any time in Settings.
        </p>
      </div>
    </div>
  );
}

// ─── Step 2 — Investment partitions ─────────────────────────────────────────
function PartitionsStep() {
  const { brokerPartitions, addBrokerPartition, deleteBrokerPartition } = useStore();
  const [inputs, setInputs] = useState<Record<string, string>>({});

  const taken = new Set(brokerPartitions.map((p) => p.id.toLowerCase()));

  const add = (group: (typeof PARTITION_GROUPS)[number], rawName: string) => {
    const broker = rawName.trim();
    if (!broker) return false;
    // What the user types here IS the broker ("Zerodha" under Long-term), so
    // it fills brokerApp; the display name composes purpose + broker, giving
    // the ticket's own example — "Long-Term (Zerodha)" alongside
    // "Long-Term (Groww)": two brokers, one strategy, distinct partitions.
    const name = group.noun ? `${group.noun} (${broker})` : broker;
    if (taken.has(name.toLowerCase())) {
      toast.error(`"${name}" is already on the list`);
      return false;
    }
    addBrokerPartition(name, group.purpose, {
      brokerApp: group.noun ? broker : undefined,
    });
    return true;
  };

  return (
    <div>
      <StepHeader
        title="Investment partitions"
        hint="Group your money by what it's FOR. Several brokers can share one purpose — a long-term pot at two brokers is still one strategy."
      />

      <div className="space-y-5">
        {PARTITION_GROUPS.map((g) => {
          const mine = brokerPartitions.filter((p) => p.purpose === g.purpose);
          return (
            <section key={g.purpose} className="space-y-2">
              <GroupHeading icon={TrendingUp}>{g.title}</GroupHeading>
              <p className="text-[11px] text-muted-foreground/70 -mt-1">{g.hint}</p>
              {mine.length > 0 && (
                <ul className="space-y-1.5">
                  {mine.map((p) => (
                    <AddedRow
                      key={p.id}
                      label={p.name}
                      onDelete={() => {
                        if (!deleteBrokerPartition(p.id)) {
                          toast.error(`"${p.name}" already has trades or snapshots — remove those first`);
                        }
                      }}
                    />
                  ))}
                </ul>
              )}
              <AddRow
                value={inputs[g.purpose] ?? ""}
                onChange={(v) => setInputs((s) => ({ ...s, [g.purpose]: v }))}
                onSubmit={() =>
                  add(g, inputs[g.purpose] ?? "") &&
                  setInputs((s) => ({ ...s, [g.purpose]: "" }))
                }
                placeholder={g.placeholder}
              />
              <SuggestionChips
                suggestions={g.suggestions}
                // A suggestion is "taken" once its COMPOSED name exists, not
                // its bare broker name — otherwise picking Zerodha under
                // Long-term would leave the chip showing as still available.
                taken={new Set(brokerPartitions.map((p) => p.name.toLowerCase()))}
                composeName={(n) => (g.noun ? `${g.noun} (${n})` : n)}
                onPick={(n) => add(g, n)}
              />
            </section>
          );
        })}

        <p className="text-[11px] text-muted-foreground/70 pt-1">
          {DEFAULT_BROKER_PARTITIONS.length} generic partitions are already active — rename, regroup,
          or remove them any time in Settings.
        </p>
      </div>
    </div>
  );
}

// ─── Step 3 — Categories ────────────────────────────────────────────────────
function CategoriesStep({
  checked,
  onToggle,
  incomeCategories,
  expenseCategories,
  onAddCustom,
  onKeepDefaults,
}: {
  checked: Record<string, boolean>;
  onToggle: (key: string) => void;
  incomeCategories: string[];
  expenseCategories: string[];
  onAddCustom: (type: "income" | "expense", name: string) => void;
  onKeepDefaults: () => void;
}) {
  const [adding, setAdding] = useState<"income" | "expense" | null>(null);
  const [draft, setDraft] = useState("");

  const submitCustom = () => {
    const trimmed = draft.trim();
    if (!trimmed || !adding) return;
    const existing = adding === "income" ? incomeCategories : expenseCategories;
    if (existing.some((c) => c.toLowerCase() === trimmed.toLowerCase())) {
      toast.error(`"${trimmed}" already exists`);
      return;
    }
    onAddCustom(adding, trimmed);
    setDraft("");
    setAdding(null);
  };

  const chipRow = (type: "income" | "expense", defaults: readonly string[], all: string[]) => {
    // Customs added right here in the wizard render alongside the defaults,
    // always ticked — there's no "untick" semantic for something you just
    // typed; removing it is the trash affordance in Settings.
    const customs = all.filter((c) => !defaults.includes(c));
    return (
      <div className="flex flex-wrap gap-1.5">
        {defaults.map((c) => {
          const key = `${type}:${c}`;
          const on = checked[key] ?? true;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onToggle(key)}
              className={cn(
                "flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-all",
                on
                  ? "border-[oklch(0.72_0.18_155/0.4)] bg-[oklch(0.72_0.18_155/0.1)] text-[oklch(0.82_0.16_155)]"
                  : "border-glass-border glass text-muted-foreground/60 line-through",
              )}
            >
              {on ? <Check className="size-3" /> : <X className="size-3" />} {c}
            </button>
          );
        })}
        {customs.map((c) => (
          <span
            key={c}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border border-primary/30 bg-primary/10 text-foreground"
          >
            <Check className="size-3" /> {c}
          </span>
        ))}
      </div>
    );
  };

  return (
    <div>
      <StepHeader
        title="Categories"
        hint="Untick anything you'll never use — you can always re-add it later. Nothing is locked."
      />

      <div className="space-y-5">
        <section className="space-y-2">
          <GroupHeading icon={Tags}>Income · {DEFAULT_INCOME_CATEGORIES.length} defaults</GroupHeading>
          {chipRow("income", DEFAULT_INCOME_CATEGORIES, incomeCategories)}
          {adding === "income" ? (
            <AddRow
              value={draft}
              onChange={setDraft}
              onSubmit={submitCustom}
              placeholder="New income category…"
            />
          ) : (
            <button
              type="button"
              onClick={() => { setAdding("income"); setDraft(""); }}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              <Plus className="size-3" /> Add Custom Category
            </button>
          )}
        </section>

        <section className="space-y-2">
          <GroupHeading icon={Tags}>Expense · {DEFAULT_EXPENSE_CATEGORIES.length} defaults</GroupHeading>
          {chipRow("expense", DEFAULT_EXPENSE_CATEGORIES, expenseCategories)}
          {adding === "expense" ? (
            <AddRow
              value={draft}
              onChange={setDraft}
              onSubmit={submitCustom}
              placeholder="New expense category…"
            />
          ) : (
            <button
              type="button"
              onClick={() => { setAdding("expense"); setDraft(""); }}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              <Plus className="size-3" /> Add Custom Category
            </button>
          )}
        </section>

        <button
          type="button"
          onClick={onKeepDefaults}
          className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-4"
        >
          Keep Defaults &amp; Next
        </button>
      </div>
    </div>
  );
}

// ─── Step 4 — Fixed obligations ─────────────────────────────────────────────
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
    <div>
      <StepHeader
        title="Fixed monthly obligations"
        hint="Rent, EMIs, and SIPs from your blueprint are already tracked. List anything else recurring — Netflix, a gym membership, a car loan."
      />

      <div className="space-y-3">
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
          <Button
            type="button"
            onClick={submit}
            size="sm"
            className="gradient-primary text-primary-foreground border-0 h-9 px-3 shrink-0"
          >
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
                  <button
                    onClick={() => deleteObligation(o.id)}
                    aria-label={`Remove ${o.label}`}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <p className="text-[11px] text-muted-foreground/70">
          That's everything — hit Finish setup and your workstation is ready.
        </p>
      </div>
    </div>
  );
}
