import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Settings, Trash2, Plus, RotateCcw, Save, Wallet, Sparkles,
  Download, Upload, TriangleAlert, DatabaseZap, Monitor, CheckCircle2, CalendarClock,
  Pencil, X, KeyRound,
} from "lucide-react";
import {
  useStore,
  DEFAULT_BLUEPRINT,
  DEFAULT_INCOME_CATEGORIES,
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_ACCOUNT_MODES,
  DEFAULT_BROKER_PARTITIONS,
  ACCOUNT_TYPES,
  PAYMENT_CHANNEL_SUGGESTIONS,
  PARTITION_CATEGORIES,
  PARTITION_PURPOSES,
  CATEGORY_BY_PURPOSE,
  type AccountMode,
  type AccountType,
  type BrokerPartition,
  type PartitionCategory,
  type PartitionPurpose,
  type CustomObligation,
} from "@/lib/store";
import { inr } from "@/lib/format";
import { Sensitive } from "@/components/Sensitive";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/settings")({ component: SettingsPage });

const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  bank: "Bank",
  credit_card: "Credit Card",
  upi: "UPI",
  cash: "Cash",
  wallet: "Wallet",
};

/**
 * Sub-headings for the grouped account list. Banks lead because they're the
 * linkable targets every card / UPI handle points at — the list reads
 * top-down as "here are the accounts, here's what settles against them".
 */
const ACCOUNT_GROUP_LABELS: Record<AccountType, string> = {
  bank: "Banks",
  credit_card: "Credit Cards",
  upi: "UPI Handles",
  cash: "Cash",
  wallet: "Wallets",
};

/** Only cards and UPI handles are funded by a bank — see AccountMode.linkedBankId. */
const LINKABLE_TYPES: readonly AccountType[] = ["credit_card", "upi"];
const isLinkable = (t: AccountType) => LINKABLE_TYPES.includes(t);

const PARTITION_CATEGORY_LABELS: Record<PartitionCategory, string> = {
  equity_swing: "Equity / Swing",
  long_term_etf: "Long-Term / ETF",
  mutual_funds: "Mutual Funds",
  crypto: "Crypto",
  liquid: "Liquid",
};

/** Sub-headings for the grouped partition list — WHY the money sits there. */
const PARTITION_PURPOSE_LABELS: Record<PartitionPurpose, string> = {
  long_term: "Long-Term",
  swing: "Swing",
  international: "International",
  crypto: "Crypto",
  custom: "Custom",
};

function SettingsPage() {
  const {
    blueprintSettings,
    updateBlueprintSettings,
    incomeCategories,
    expenseCategories,
    addCategory,
    deleteCategory,
    renameCategory,
    accountModes,
    bankAccounts,
    addAccountMode,
    deleteAccountMode,
    updateAccountMode,
    brokerPartitions,
    addBrokerPartition,
    deleteBrokerPartition,
    updateBrokerPartition,
    partitionLabel,
    showPersonalQuotes,
    setShowPersonalQuotes,
    isOwnerUnlocked,
    unlockOwnerReflections,
    exportData,
    importData,
    resetAllData,
    canInstallApp,
    isAppInstalled,
    installApp,
    customObligations,
    addObligation,
    deleteObligation,
    hydrated,
  } = useStore();
  const nav = useNavigate();
  const importInputRef = useRef<HTMLInputElement>(null);
  const [pinModalOpen, setPinModalOpen] = useState(false);

  const riskCapPartitionLabel = partitionLabel(blueprintSettings.riskCapPartition);

  const handleExport = () => {
    if (exportData()) toast.success("Backup downloaded");
    else toast.error("Couldn't create the backup file");
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file next time
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      const result = importData(text);
      if (result.success) toast.success("Backup restored");
      else toast.error(result.error ?? "Import failed");
    };
    reader.onerror = () => toast.error("Couldn't read that file");
    reader.readAsText(file);
  };

  const handleDeleteAll = () => {
    resetAllData();
    toast.success("All local data cleared");
    nav({ to: "/dashboard" });
  };

  const handleInstall = async () => {
    const accepted = await installApp();
    if (accepted) toast.success("FinStride installed");
  };

  const handleToggleQuotes = (checked: boolean) => {
    if (!checked) {
      setShowPersonalQuotes(false);
      return;
    }
    if (isOwnerUnlocked) {
      setShowPersonalQuotes(true);
      return;
    }
    setPinModalOpen(true);
  };

  const handleUnlocked = () => {
    setShowPersonalQuotes(true);
    setPinModalOpen(false);
  };

  // ── Blueprint form local state (controlled, saved on submit) ──────────────
  const bpFromStore = () => ({
    defaultSalary:    String(blueprintSettings.defaultSalary),
    fixedRunrate:     String(blueprintSettings.fixedRunrate),
    scooterEmi:       String(blueprintSettings.scooterEmi),
    growwMfSip:       String(blueprintSettings.growwMfSip),
    riskCapPct:       String(Math.round(blueprintSettings.defaultRiskCapPct * 100)),
  });
  const [bp, setBp] = useState(bpFromStore);

  // Re-seed once the store finishes loading THIS identity's blueprint. The
  // initializer above runs at mount, which for a cloud account is before the
  // remote fetch resolves — so the inputs would sit on pre-hydration zeros,
  // and hitting "Save changes" would write those zeros straight over the real
  // saved blueprint. Keyed on `hydrated` (not the blueprint value) so it fires
  // exactly once per identity and never fights the user mid-edit.
  const [bpHydratedFor, setBpHydratedFor] = useState(false);
  useEffect(() => {
    if (hydrated && !bpHydratedFor) {
      setBp(bpFromStore());
      setBpHydratedFor(true);
    }
    if (!hydrated && bpHydratedFor) setBpHydratedFor(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, bpHydratedFor, blueprintSettings]);

  const handleBlueprintSave = (e: FormEvent) => {
    e.preventDefault();
    const salary = Number(bp.defaultSalary);
    const runrate = Number(bp.fixedRunrate);
    const emi = Number(bp.scooterEmi);
    const sip = Number(bp.growwMfSip);
    const riskPct = Number(bp.riskCapPct);
    if ([salary, runrate, emi, sip].some((v) => isNaN(v) || v < 0)) {
      return toast.error("All amounts must be positive numbers");
    }
    if (isNaN(riskPct) || riskPct <= 0 || riskPct > 100) {
      return toast.error("Risk cap must be between 0 and 100");
    }
    updateBlueprintSettings({
      defaultSalary: salary,
      fixedRunrate: runrate,
      scooterEmi: emi,
      growwMfSip: sip,
      defaultRiskCapPct: riskPct / 100,
    });
    toast.success("Blueprint saved");
  };

  const handleReset = () => {
    updateBlueprintSettings(DEFAULT_BLUEPRINT);
    setBp({
      defaultSalary: String(DEFAULT_BLUEPRINT.defaultSalary),
      fixedRunrate:  String(DEFAULT_BLUEPRINT.fixedRunrate),
      scooterEmi:    String(DEFAULT_BLUEPRINT.scooterEmi),
      growwMfSip:    String(DEFAULT_BLUEPRINT.growwMfSip),
      riskCapPct:    String(Math.round(DEFAULT_BLUEPRINT.defaultRiskCapPct * 100)),
    });
    toast.success("Blueprint reset to defaults");
  };

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Configuration</p>
        <h1 className="text-3xl md:text-4xl font-display font-semibold tracking-tight mt-1">
          App <span className="text-gradient">settings</span>
        </h1>
        <p className="text-sm text-muted-foreground mt-2">
          Personalise your blueprint targets and cashflow categories.
        </p>
      </header>

      {/* Blueprint Configuration */}
      <section className="glass-strong rounded-2xl p-5 md:p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="size-9 rounded-xl gradient-primary grid place-items-center shrink-0">
            <Settings className="size-4 text-primary-foreground" />
          </div>
          <div>
            <h2 className="font-display font-semibold tracking-tight">Blueprint Configuration</h2>
            <p className="text-xs text-muted-foreground">
              Changes reflect immediately in Dashboard KPIs, Cash Flow's Obligations & Dues, and
              the Swing risk cap.
            </p>
          </div>
        </div>

        <form onSubmit={handleBlueprintSave} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <BpField
              label="Monthly Salary Baseline (₹)"
              hint={<CurrentAmount value={blueprintSettings.defaultSalary} />}
              value={bp.defaultSalary}
              onChange={(v) => setBp((s) => ({ ...s, defaultSalary: v }))}
            />
            <BpField
              label="Fixed Runrate / Rent (₹)"
              hint={<CurrentAmount value={blueprintSettings.fixedRunrate} />}
              value={bp.fixedRunrate}
              onChange={(v) => setBp((s) => ({ ...s, fixedRunrate: v }))}
            />
            <BpField
              label="Loan/EMI (₹)"
              hint={<CurrentAmount value={blueprintSettings.scooterEmi} />}
              value={bp.scooterEmi}
              onChange={(v) => setBp((s) => ({ ...s, scooterEmi: v }))}
            />
            <BpField
              label="Investment SIP (₹)"
              hint={<CurrentAmount value={blueprintSettings.growwMfSip} />}
              value={bp.growwMfSip}
              onChange={(v) => setBp((s) => ({ ...s, growwMfSip: v }))}
            />
            <BpField
              label="Swing Risk Cap (%)"
              hint={`Currently: ${(blueprintSettings.defaultRiskCapPct * 100).toFixed(1)}% per trade`}
              value={bp.riskCapPct}
              onChange={(v) => setBp((s) => ({ ...s, riskCapPct: v }))}
              suffix="%"
              min="0.1"
              max="100"
              step="0.1"
            />
            <div className="md:col-span-2">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Risk Cap Partition
              </Label>
              <div className="mt-1.5">
                <Select
                  value={blueprintSettings.riskCapPartition}
                  onValueChange={(v) => {
                    updateBlueprintSettings({ riskCapPartition: v });
                    toast.success(`Risk cap partition set to "${partitionLabel(v)}"`);
                  }}
                >
                  <SelectTrigger className="bg-input/40 border-glass-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {brokerPartitions.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                Which broker partition's latest snapshot backs the 3% swing-trade risk cap (currently: {riskCapPartitionLabel})
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <Button type="submit" className="gradient-primary text-primary-foreground border-0 gap-2 h-10">
              <Save className="size-4" /> Save changes
            </Button>
            <button
              type="button"
              onClick={handleReset}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <RotateCcw className="size-3.5" /> Reset to defaults
            </button>
          </div>
        </form>
      </section>

      {/* Category Manager */}
      <section className="glass rounded-2xl p-5 md:p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="size-9 rounded-xl gradient-success grid place-items-center shrink-0">
            <Settings className="size-4 text-background" />
          </div>
          <div>
            <h2 className="font-display font-semibold tracking-tight">Category Manager</h2>
            <p className="text-xs text-muted-foreground">
              Add, rename, or remove any income / expense category — including the built-in ones.
            </p>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <CategoryColumn
            title="Income Categories"
            allCategories={incomeCategories}
            defaults={DEFAULT_INCOME_CATEGORIES}
            onAdd={(name) => addCategory("income", name)}
            onDelete={(name) => deleteCategory("income", name)}
            onRename={(oldName, newName) => renameCategory("income", oldName, newName)}
          />
          <CategoryColumn
            title="Expense Categories"
            allCategories={expenseCategories}
            defaults={DEFAULT_EXPENSE_CATEGORIES}
            onAdd={(name) => addCategory("expense", name)}
            onDelete={(name) => deleteCategory("expense", name)}
            onRename={(oldName, newName) => renameCategory("expense", oldName, newName)}
          />
        </div>
      </section>

      {/* Monthly Obligations Manager */}
      <section className="glass rounded-2xl p-5 md:p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="size-9 rounded-xl gradient-primary grid place-items-center shrink-0">
            <CalendarClock className="size-4 text-primary-foreground" />
          </div>
          <div>
            <h2 className="font-display font-semibold tracking-tight">Monthly Obligations</h2>
            <p className="text-xs text-muted-foreground">
              Custom recurring items (rent, EMIs, SIPs, subscriptions) tracked alongside the
              blueprint obligations in Cash Flow's Obligations & Dues tab.
            </p>
          </div>
        </div>
        <ObligationColumn obligations={customObligations} onAdd={addObligation} onDelete={deleteObligation} />
      </section>

      {/* Accounts & Cards */}
      <section className="glass rounded-2xl p-5 md:p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="size-9 rounded-xl gradient-success grid place-items-center shrink-0">
            <Wallet className="size-4 text-background" />
          </div>
          <div>
            <h2 className="font-display font-semibold tracking-tight">Accounts & Cards</h2>
            <p className="text-xs text-muted-foreground">
              Add, rename, or remove any account/card — including the built-in ones. Link each card
              or UPI handle to the bank that funds it, and the Cash Flow ledger reads
              "Amazon Pay (ICICI Credit Card)" instead of a bare name.
            </p>
          </div>
        </div>
        <AccountModeColumn
          accountModes={accountModes}
          bankAccounts={bankAccounts}
          defaultIds={DEFAULT_ACCOUNT_MODES.map((a) => a.id)}
          onAdd={addAccountMode}
          onDelete={deleteAccountMode}
          onUpdate={updateAccountMode}
        />
      </section>

      {/* Broker Partitions */}
      <section className="glass rounded-2xl p-5 md:p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="size-9 rounded-xl gradient-success grid place-items-center shrink-0">
            <Wallet className="size-4 text-background" />
          </div>
          <div>
            <h2 className="font-display font-semibold tracking-tight">Broker Partitions</h2>
            <p className="text-xs text-muted-foreground">
              Add, rename, or remove any broker/investment partition — including the built-in
              ones. Partitions are grouped by purpose, so one strategy split across brokers
              (e.g. "Long-Term (Zerodha)" and "Long-Term (Groww)") reads as a single Long-Term
              bucket.
            </p>
          </div>
        </div>
        <BrokerPartitionColumn
          brokerPartitions={brokerPartitions}
          defaultIds={DEFAULT_BROKER_PARTITIONS.map((p) => p.id)}
          onAdd={addBrokerPartition}
          onDelete={deleteBrokerPartition}
          onUpdate={updateBrokerPartition}
        />
      </section>

      {/* Personalization */}
      <section className="glass rounded-2xl p-5 md:p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="size-9 rounded-xl gradient-primary grid place-items-center shrink-0">
            <Sparkles className="size-4 text-primary-foreground" />
          </div>
          <div>
            <h2 className="font-display font-semibold tracking-tight">Personalization</h2>
            <p className="text-xs text-muted-foreground">
              Tune what shows up on your dashboard.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 px-3 py-2.5 rounded-xl border border-glass-border bg-white/3">
          <div>
            <Label className="text-sm">Show personal reflection quotes</Label>
            <p className="text-[11px] text-muted-foreground mt-1">
              When off (default), only general motivational quotes are shown on the dashboard. Turn on to also see the app owner's personal reflections — protected by a passcode.
            </p>
          </div>
          <Switch checked={showPersonalQuotes} onCheckedChange={handleToggleQuotes} />
        </div>
      </section>

      <OwnerPinModal
        open={pinModalOpen}
        onOpenChange={setPinModalOpen}
        onUnlock={unlockOwnerReflections}
        onUnlocked={handleUnlocked}
      />

      {/* Progressive Web App — only shown when there's something actionable
          to say: either the browser has offered an install prompt, or the
          app is already running installed. Browsers that never fire the
          prompt (iOS Safari, or before the browser decides) show nothing
          here — the mobile install banner covers those cases separately. */}
      {(canInstallApp || isAppInstalled) && (
        <section className="glass rounded-2xl p-5 md:p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="size-9 rounded-xl gradient-primary grid place-items-center shrink-0">
              <Monitor className="size-4 text-primary-foreground" />
            </div>
            <div>
              <h2 className="font-display font-semibold tracking-tight">Progressive Web App</h2>
              <p className="text-xs text-muted-foreground">
                Run FinStride in its own window, with offline access to your last saved data.
              </p>
            </div>
          </div>

          {isAppInstalled ? (
            <div className="flex items-center gap-2 text-sm text-[oklch(0.78_0.16_155)]">
              <CheckCircle2 className="size-4" /> FinStride is installed on this device.
            </div>
          ) : (
            <Button
              type="button"
              onClick={handleInstall}
              className="gap-2 h-10 gradient-primary text-primary-foreground border-0"
            >
              <Monitor className="size-4" /> Install Desktop App
            </Button>
          )}
        </section>
      )}

      {/* Data Management */}
      <section className="glass rounded-2xl p-5 md:p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="size-9 rounded-xl gradient-success grid place-items-center shrink-0">
            <DatabaseZap className="size-4 text-background" />
          </div>
          <div>
            <h2 className="font-display font-semibold tracking-tight">Data Management</h2>
            <p className="text-xs text-muted-foreground">
              Back up everything to a file, restore from a backup, or wipe local data and start
              fresh. Backups also include legacy Grind Deck data recorded before that module was
              retired.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            onClick={handleExport}
            variant="secondary"
            className="gap-2 h-10 glass-strong border-glass-border"
          >
            <Download className="size-4" /> Export Data (JSON)
          </Button>

          <Button
            type="button"
            onClick={() => importInputRef.current?.click()}
            variant="secondary"
            className="gap-2 h-10 glass-strong border-glass-border"
          >
            <Upload className="size-4" /> Import Data (JSON)
          </Button>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            onChange={handleImportFile}
            className="hidden"
          />

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                className="gap-2 h-10 border-0 bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                <Trash2 className="size-4" /> Delete All Data
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="glass-strong border-glass-border">
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center gap-2">
                  <TriangleAlert className="size-4 text-destructive" /> Delete all local data?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently clears every transaction, trade, portfolio snapshot, and
                  setting stored on this device, and resets everything to zero/empty defaults.
                  Export a backup first if you want to keep a copy. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDeleteAll}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Delete everything
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </section>
    </div>
  );
}

// ─── Owner passcode modal ───────────────────────────────────────────────────
/**
 * Glassmorphism PIN gate for showPersonalQuotes. This is a client-side speed
 * bump, not real security — VITE_OWNER_PIN (or the "hagemaru9966" fallback) ships
 * inside the JS bundle like any other build-time env var, so it's visible to
 * anyone who opens devtools. It only prevents a casual accidental toggle.
 */
function OwnerPinModal({
  open,
  onOpenChange,
  onUnlock,
  onUnlocked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUnlock: (pin: string) => boolean;
  onUnlocked: () => void;
}) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);

  const close = (v: boolean) => {
    if (!v) {
      setPin("");
      setError(false);
    }
    onOpenChange(v);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (onUnlock(pin)) {
      setPin("");
      setError(false);
      onUnlocked();
    } else {
      setError(true);
      setPin("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="glass-strong border-glass-border max-w-sm">
        <div className="flex items-center gap-3 mb-1">
          <div className="size-9 rounded-xl gradient-primary grid place-items-center shrink-0">
            <KeyRound className="size-4 text-primary-foreground" />
          </div>
          <DialogTitle className="font-display font-semibold tracking-tight">
            Owner passcode
          </DialogTitle>
        </div>
        <DialogDescription className="text-xs text-muted-foreground">
          Enter the owner passcode to unlock personal reflection quotes on this device.
        </DialogDescription>
        <form onSubmit={submit} className="space-y-3 mt-2">
          <Input
            type="password"
            inputMode="numeric"
            autoFocus
            value={pin}
            onChange={(e) => {
              setPin(e.target.value);
              setError(false);
            }}
            placeholder="Enter passcode"
            className="bg-input/40 border-glass-border text-center tracking-widest"
          />
          {error && (
            <p className="text-xs text-destructive flex items-center gap-1.5">
              <TriangleAlert className="size-3.5" /> Invalid Passcode
            </p>
          )}
          <div className="flex items-center gap-2 justify-end">
            <Button type="button" variant="ghost" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button type="submit" className="gradient-primary text-primary-foreground border-0">
              Unlock
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Blueprint field ────────────────────────────────────────────────────────
/** "Currently: ₹X" hint — the amount blurs in stealth mode like every other figure. */
function CurrentAmount({ value }: { value: number }) {
  return (
    <>
      Currently:{" "}
      <Sensitive>
        <span className="tnum">{inr(value)}</span>
      </Sensitive>
    </>
  );
}

function BpField({
  label,
  hint,
  value,
  onChange,
  suffix,
  min = "0",
  max,
  step = "1",
}: {
  label: string;
  hint: React.ReactNode;
  value: string;
  onChange: (v: string) => void;
  suffix?: string;
  min?: string;
  max?: string;
  step?: string;
}) {
  return (
    <div>
      <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</Label>
      <div className="mt-1.5 relative">
        {suffix && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm select-none">
            {suffix}
          </span>
        )}
        <Input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`bg-input/40 border-glass-border tnum ${suffix ? "pr-8" : ""}`}
        />
      </div>
      <p className="text-[11px] text-muted-foreground mt-1">{hint}</p>
    </div>
  );
}

// ─── Category column (100% editable/deletable, defaults included) ─────────
function CategoryColumn({
  title,
  allCategories,
  defaults,
  onAdd,
  onDelete,
  onRename,
}: {
  title: string;
  allCategories: string[];
  defaults: readonly string[];
  onAdd: (name: string) => void;
  onDelete: (name: string) => void;
  /** Custom entries only — returns false if oldName isn't custom or newName collides. */
  onRename: (oldName: string, newName: string) => boolean;
}) {
  const [input, setInput] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const handleAdd = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    if (allCategories.map((c) => c.toLowerCase()).includes(trimmed.toLowerCase())) {
      return toast.error("Category already exists");
    }
    onAdd(trimmed);
    setInput("");
    toast.success(`"${trimmed}" added`);
  };

  const startEdit = (cat: string) => {
    setEditing(cat);
    setEditValue(cat);
  };

  const saveEdit = () => {
    if (!editing) return;
    const trimmed = editValue.trim();
    if (!trimmed) return;
    if (trimmed === editing) {
      setEditing(null);
      return;
    }
    if (onRename(editing, trimmed)) {
      toast.success(`Renamed to "${trimmed}"`);
      setEditing(null);
    } else {
      toast.error("That name is already taken, or this isn't a custom category");
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">{title}</p>
      <ul className="space-y-1.5">
        {allCategories.map((cat) => {
          const isCustom = !defaults.includes(cat);
          const isEditing = editing === cat;
          return (
            <li
              key={cat}
              className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border border-glass-border bg-white/3 text-sm"
            >
              {isEditing ? (
                <>
                  <Input
                    autoFocus
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); saveEdit(); }
                      if (e.key === "Escape") setEditing(null);
                    }}
                    className="bg-input/40 border-glass-border h-8 text-sm"
                  />
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={saveEdit} className="text-muted-foreground hover:text-foreground p-1">
                      <Save className="size-3.5" />
                    </button>
                    <button onClick={() => setEditing(null)} className="text-muted-foreground hover:text-destructive p-1">
                      <X className="size-3.5" />
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <span>{cat}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    {isCustom && (
                      <button onClick={() => startEdit(cat)} className="text-muted-foreground hover:text-foreground">
                        <Pencil className="size-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() => {
                        onDelete(cat);
                        toast.success(`"${cat}" removed`);
                      }}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleAdd())}
          placeholder="New category…"
          className="bg-input/40 border-glass-border text-sm h-9"
        />
        <Button
          type="button"
          onClick={handleAdd}
          size="sm"
          className="gradient-primary text-primary-foreground border-0 h-9 px-3 shrink-0"
        >
          <Plus className="size-4" />
        </Button>
      </div>
    </div>
  );
}

// ─── Account mode column ────────────────────────────────────────────────────
// Grouped by type, banks first: a card/UPI handle is only half a story without
// the bank funding it, so the accounts it can point at are listed above it.
const CHANNEL_SUGGESTIONS_ID = "finstride-channel-suggestions";

function AccountModeColumn({
  accountModes,
  bankAccounts,
  defaultIds,
  onAdd,
  onDelete,
  onUpdate,
}: {
  accountModes: AccountMode[];
  /** Linkable targets — bank-type accounts only (see AccountMode.linkedBankId). */
  bankAccounts: AccountMode[];
  defaultIds: readonly string[];
  onAdd: (
    name: string,
    type: AccountType,
    opts?: { linkedBankId?: string; channelLabel?: string },
  ) => void;
  onDelete: (id: string) => boolean;
  onUpdate: (id: string, patch: Partial<Omit<AccountMode, "id">>) => boolean;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<AccountType>("bank");
  const [linkedBankId, setLinkedBankId] = useState("none");
  const [channel, setChannel] = useState("");
  const [editing, setEditing] = useState<AccountMode | null>(null);

  // Resolved against the live list, so a link left dangling by a deleted bank
  // renders as "unlinked" rather than a stale name.
  const linkedBankName = (id?: string) =>
    id ? accountModes.find((a) => a.id === id)?.name : undefined;

  const handleAdd = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    // Check BOTH id and name: a renamed custom account keeps its original id,
    // so an id-only check would let a second account be created with a display
    // name identical to an existing one — two indistinguishable rows.
    if (
      accountModes.some(
        (a) =>
          a.id.toLowerCase() === trimmed.toLowerCase() ||
          a.name.toLowerCase() === trimmed.toLowerCase(),
      )
    ) {
      return toast.error("An account with that name already exists");
    }
    onAdd(trimmed, type, {
      linkedBankId: isLinkable(type) && linkedBankId !== "none" ? linkedBankId : undefined,
      channelLabel: channel.trim() || undefined,
    });
    setName("");
    setChannel("");
    setLinkedBankId("none");
    toast.success(`"${trimmed}" added`);
  };

  const saveEdit = () => {
    if (!editing) return;
    const trimmed = editing.name.trim();
    if (!trimmed) return;
    if (accountModes.some((a) => a.id !== editing.id && a.name.toLowerCase() === trimmed.toLowerCase())) {
      return toast.error("Another account already has that name");
    }
    if (
      onUpdate(editing.id, {
        name: trimmed,
        type: editing.type,
        // Retyping a card as a bank drops the link rather than leaving a field
        // nothing reads — banks are the funding source, not the funded thing.
        linkedBankId: isLinkable(editing.type) ? editing.linkedBankId : undefined,
        channelLabel: editing.channelLabel?.trim() || undefined,
      })
    ) {
      toast.success(`"${trimmed}" updated`);
      setEditing(null);
    } else {
      toast.error("This account can't be edited in place");
    }
  };

  const renderRow = (a: AccountMode) => {
    const isCustom = !defaultIds.includes(a.id);
    const isEditing = editing?.id === a.id;
    const bankName = linkedBankName(a.linkedBankId);
    return (
      <li key={a.id} className="px-3 py-2.5 rounded-xl border border-glass-border bg-white/3 text-sm">
        {isEditing && editing ? (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              autoFocus
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              className="bg-input/40 border-glass-border h-8 text-sm flex-1 min-w-[8rem]"
            />
            <Select value={editing.type} onValueChange={(v: AccountType) => setEditing({ ...editing, type: v })}>
              <SelectTrigger className="bg-input/40 border-glass-border h-8 text-xs w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACCOUNT_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>{ACCOUNT_TYPE_LABELS[t]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isLinkable(editing.type) && (
              <Select
                value={editing.linkedBankId ?? "none"}
                onValueChange={(v) =>
                  setEditing({ ...editing, linkedBankId: v === "none" ? undefined : v })
                }
              >
                <SelectTrigger className="bg-input/40 border-glass-border h-8 text-xs w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No linked bank</SelectItem>
                  {/* An account can never fund itself, so it's never its own link option. */}
                  {bankAccounts
                    .filter((b) => b.id !== editing.id)
                    .map((b) => (
                      <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            )}
            <Input
              value={editing.channelLabel ?? ""}
              onChange={(e) => setEditing({ ...editing, channelLabel: e.target.value || undefined })}
              list={CHANNEL_SUGGESTIONS_ID}
              placeholder="Channel (optional)"
              className="bg-input/40 border-glass-border h-8 text-sm w-32"
            />
            <div className="flex items-center gap-1 shrink-0">
              <button onClick={saveEdit} className="text-muted-foreground hover:text-foreground p-1">
                <Save className="size-3.5" />
              </button>
              <button onClick={() => setEditing(null)} className="text-muted-foreground hover:text-destructive p-1">
                <X className="size-3.5" />
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <span>{a.name}</span>
              <span className="ml-2 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/8 text-muted-foreground">
                {ACCOUNT_TYPE_LABELS[a.type]}
              </span>
              {isLinkable(a.type) &&
                (bankName ? (
                  <span className="ml-1.5 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/8 text-muted-foreground">
                    via {bankName}
                  </span>
                ) : (
                  // Only worth flagging on rows the user can actually fix. The
                  // built-in "Credit Card"/"UPI" accounts have no editor (the
                  // pencil is gated on is-custom), so an "unlinked" nag there
                  // is a permanent complaint about something unactionable.
                  !defaultIds.includes(a.id) && (
                    <span className="ml-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/60">
                      unlinked
                    </span>
                  )
                ))}
              {a.channelLabel && (
                <span className="ml-1.5 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/8 text-muted-foreground">
                  {a.channelLabel}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {isCustom && (
                <button onClick={() => setEditing(a)} className="text-muted-foreground hover:text-foreground">
                  <Pencil className="size-3.5" />
                </button>
              )}
              <button
                onClick={() => {
                  if (onDelete(a.id)) toast.success(`"${a.name}" removed`);
                  else toast.error(`"${a.name}" is still in use — remove its transactions first`);
                }}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="space-y-4">
      <datalist id={CHANNEL_SUGGESTIONS_ID}>
        {PAYMENT_CHANNEL_SUGGESTIONS.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      {ACCOUNT_TYPES.map((groupType) => {
        const rows = accountModes.filter((a) => a.type === groupType);
        if (rows.length === 0) return null;
        return (
          <div key={groupType} className="space-y-1.5">
            <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              {ACCOUNT_GROUP_LABELS[groupType]}
            </p>
            <ul className="space-y-1.5">{rows.map(renderRow)}</ul>
          </div>
        );
      })}

      <div className="space-y-1.5">
        <div className="flex flex-wrap gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleAdd())}
            placeholder="e.g. HDFC Bank, Amazon Pay ICICI…"
            className="bg-input/40 border-glass-border text-sm h-9 flex-1 min-w-[10rem]"
          />
          <Select value={type} onValueChange={(v: AccountType) => setType(v)}>
            <SelectTrigger className="bg-input/40 border-glass-border h-9 text-xs w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ACCOUNT_TYPES.map((t) => (
                <SelectItem key={t} value={t}>{ACCOUNT_TYPE_LABELS[t]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isLinkable(type) && (
            <Select value={linkedBankId} onValueChange={setLinkedBankId}>
              <SelectTrigger className="bg-input/40 border-glass-border h-9 text-xs w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No linked bank</SelectItem>
                {bankAccounts.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Input
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleAdd())}
            list={CHANNEL_SUGGESTIONS_ID}
            placeholder="Channel (optional)"
            className="bg-input/40 border-glass-border text-sm h-9 w-32"
          />
          <Button
            type="button"
            onClick={handleAdd}
            size="sm"
            className="gradient-primary text-primary-foreground border-0 h-9 px-3 shrink-0"
          >
            <Plus className="size-4" />
          </Button>
        </div>
        {isLinkable(type) && bankAccounts.length === 0 && (
          <p className="text-[11px] text-muted-foreground">
            No bank accounts yet — add one first to link this to it. You can still add it unlinked
            and connect it later.
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Broker partition column ────────────────────────────────────────────────
function BrokerPartitionColumn({
  brokerPartitions,
  defaultIds,
  onAdd,
  onDelete,
  onUpdate,
}: {
  brokerPartitions: BrokerPartition[];
  defaultIds: readonly string[];
  onAdd: (
    name: string,
    purpose: PartitionPurpose,
    opts?: { category?: PartitionCategory; brokerApp?: string; description?: string },
  ) => void;
  onDelete: (id: string) => boolean;
  onUpdate: (id: string, patch: Partial<Omit<BrokerPartition, "id">>) => boolean;
}) {
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState<PartitionPurpose>("long_term");
  // "auto" = let the store derive the instrument category from the purpose;
  // an explicit pick is an override, which is why purpose is the primary control.
  const [category, setCategory] = useState<PartitionCategory | "auto">("auto");
  const [brokerApp, setBrokerApp] = useState("");
  const [editing, setEditing] = useState<BrokerPartition | null>(null);

  const handleAdd = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    // id OR name — same reasoning as the account add guard above.
    if (
      brokerPartitions.some(
        (p) =>
          p.id.toLowerCase() === trimmed.toLowerCase() ||
          p.name.toLowerCase() === trimmed.toLowerCase(),
      )
    ) {
      return toast.error("A partition with that name already exists");
    }
    onAdd(trimmed, purpose, {
      category: category === "auto" ? undefined : category,
      brokerApp: brokerApp.trim() || undefined,
    });
    setName("");
    setBrokerApp("");
    setCategory("auto");
    toast.success(`"${trimmed}" added`);
  };

  const saveEdit = () => {
    if (!editing) return;
    const trimmed = editing.name.trim();
    if (!trimmed) return;
    if (brokerPartitions.some((p) => p.id !== editing.id && p.name.toLowerCase() === trimmed.toLowerCase())) {
      return toast.error("Another partition already has that name");
    }
    if (
      onUpdate(editing.id, {
        name: trimmed,
        purpose: editing.purpose,
        category: editing.category,
        brokerApp: editing.brokerApp,
        description: editing.description,
      })
    ) {
      toast.success(`"${trimmed}" updated`);
      setEditing(null);
    } else {
      toast.error("This partition can't be edited in place");
    }
  };

  const renderRow = (p: BrokerPartition) => {
    const isCustom = !defaultIds.includes(p.id);
    const isEditing = editing?.id === p.id;
    return (
      <li key={p.id} className="px-3 py-2.5 rounded-xl border border-glass-border bg-white/3 text-sm">
        {isEditing && editing ? (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              autoFocus
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              className="bg-input/40 border-glass-border h-8 text-sm flex-1 min-w-[8rem]"
            />
            <Select
              value={editing.purpose}
              onValueChange={(v: PartitionPurpose) => setEditing({ ...editing, purpose: v })}
            >
              <SelectTrigger className="bg-input/40 border-glass-border h-8 text-xs w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PARTITION_PURPOSES.map((pp) => (
                  <SelectItem key={pp} value={pp}>{PARTITION_PURPOSE_LABELS[pp]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={editing.category} onValueChange={(v: PartitionCategory) => setEditing({ ...editing, category: v })}>
              <SelectTrigger className="bg-input/40 border-glass-border h-8 text-xs w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PARTITION_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>{PARTITION_CATEGORY_LABELS[c]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={editing.brokerApp ?? ""}
              onChange={(e) => setEditing({ ...editing, brokerApp: e.target.value || undefined })}
              placeholder="Broker app (optional)"
              className="bg-input/40 border-glass-border h-8 text-sm w-40"
            />
            <div className="flex items-center gap-1 shrink-0">
              <button onClick={saveEdit} className="text-muted-foreground hover:text-foreground p-1">
                <Save className="size-3.5" />
              </button>
              <button onClick={() => setEditing(null)} className="text-muted-foreground hover:text-destructive p-1">
                <X className="size-3.5" />
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <span>{p.name}</span>
              {/* Onboarding composes names like "Long-Term (Zerodha)" AND sets
                  brokerApp to "Zerodha", so appending it unconditionally would
                  read "Long-Term (Zerodha) · Zerodha". Only show the broker
                  when the name doesn't already carry it. */}
              {p.brokerApp && !p.name.toLowerCase().includes(p.brokerApp.toLowerCase()) && (
                <span className="text-muted-foreground"> · {p.brokerApp}</span>
              )}
              <span className="ml-2 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/8 text-muted-foreground">
                {PARTITION_CATEGORY_LABELS[p.category]}
              </span>
              {p.description && (
                <p className="text-[11px] text-muted-foreground/70 mt-0.5">{p.description}</p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {isCustom && (
                <button onClick={() => setEditing(p)} className="text-muted-foreground hover:text-foreground">
                  <Pencil className="size-3.5" />
                </button>
              )}
              <button
                onClick={() => {
                  if (onDelete(p.id)) toast.success(`"${p.name}" removed`);
                  else toast.error(`"${p.name}" is still in use — remove its trades/snapshots first`);
                }}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="space-y-4">
      {PARTITION_PURPOSES.map((groupPurpose) => {
        const rows = brokerPartitions.filter((p) => p.purpose === groupPurpose);
        if (rows.length === 0) return null;
        return (
          <div key={groupPurpose} className="space-y-1.5">
            <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              {PARTITION_PURPOSE_LABELS[groupPurpose]}
            </p>
            <ul className="space-y-1.5">{rows.map(renderRow)}</ul>
          </div>
        );
      })}

      <div className="flex flex-wrap gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleAdd())}
          placeholder="e.g. Swing Desk, MF Core…"
          className="bg-input/40 border-glass-border text-sm h-9 flex-1 min-w-[10rem]"
        />
        <Select value={purpose} onValueChange={(v: PartitionPurpose) => setPurpose(v)}>
          <SelectTrigger className="bg-input/40 border-glass-border h-9 text-xs w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PARTITION_PURPOSES.map((pp) => (
              <SelectItem key={pp} value={pp}>{PARTITION_PURPOSE_LABELS[pp]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={category} onValueChange={(v: PartitionCategory | "auto") => setCategory(v)}>
          <SelectTrigger className="bg-input/40 border-glass-border h-9 text-xs w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">
              Auto · {PARTITION_CATEGORY_LABELS[CATEGORY_BY_PURPOSE[purpose]]}
            </SelectItem>
            {PARTITION_CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>{PARTITION_CATEGORY_LABELS[c]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={brokerApp}
          onChange={(e) => setBrokerApp(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleAdd())}
          placeholder="Broker app (optional)"
          className="bg-input/40 border-glass-border text-sm h-9 w-40"
        />
        <Button
          type="button"
          onClick={handleAdd}
          size="sm"
          className="gradient-primary text-primary-foreground border-0 h-9 px-3 shrink-0"
        >
          <Plus className="size-4" />
        </Button>
      </div>
    </div>
  );
}

// ─── Obligation column (label + amount, unlike the string-only CategoryColumn) ─
function ObligationColumn({
  obligations,
  onAdd,
  onDelete,
}: {
  obligations: CustomObligation[];
  onAdd: (label: string, amount: number) => void;
  onDelete: (id: string) => void;
}) {
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");

  const handleAdd = () => {
    const trimmed = label.trim();
    if (!trimmed) return;
    if (obligations.some((o) => o.label.toLowerCase() === trimmed.toLowerCase())) {
      return toast.error(`"${trimmed}" is already on the list`);
    }
    const n = Number(amount);
    if (amount.trim() !== "" && (isNaN(n) || n < 0)) {
      return toast.error("Amount must be a positive number");
    }
    onAdd(trimmed, amount.trim() === "" ? 0 : n);
    setLabel("");
    setAmount("");
    toast.success(`"${trimmed}" added`);
  };

  return (
    <div className="space-y-3">
      {obligations.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">
          No custom obligations yet — the 3 blueprint obligations above always apply.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {obligations.map((o) => (
            <li
              key={o.id}
              className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border border-glass-border bg-white/3 text-sm"
            >
              <span className="min-w-0 truncate">{o.label}</span>
              <div className="flex items-center gap-3 shrink-0">
                <Sensitive>
                  <span className="tnum text-muted-foreground">{inr(o.amount)}</span>
                </Sensitive>
                <button
                  onClick={() => {
                    onDelete(o.id);
                    toast.success(`"${o.label}" removed`);
                  }}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleAdd())}
          placeholder="e.g. Netflix, Car Loan EMI…"
          className="bg-input/40 border-glass-border text-sm h-9"
        />
        <Input
          type="number"
          min="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleAdd())}
          placeholder="₹ / month"
          className="bg-input/40 border-glass-border text-sm h-9 tnum w-28 shrink-0"
        />
        <Button
          type="button"
          onClick={handleAdd}
          size="sm"
          className="gradient-primary text-primary-foreground border-0 h-9 px-3 shrink-0"
        >
          <Plus className="size-4" />
        </Button>
      </div>
    </div>
  );
}
