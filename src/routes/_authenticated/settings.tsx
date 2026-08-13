import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef, useState, type FormEvent } from "react";
import {
  Settings, Lock, Trash2, Plus, RotateCcw, Save, Wallet, Sparkles,
  Download, Upload, TriangleAlert, DatabaseZap, Monitor, CheckCircle2, CalendarClock,
} from "lucide-react";
import {
  useStore,
  DEFAULT_BLUEPRINT,
  DEFAULT_INCOME_CATEGORIES,
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_PAYMENT_MODES,
  DEFAULT_INVESTMENT_APPS,
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
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/settings")({ component: SettingsPage });

function SettingsPage() {
  const {
    blueprintSettings,
    updateBlueprintSettings,
    incomeCategories,
    expenseCategories,
    addCategory,
    deleteCategory,
    paymentModes,
    addAccountMode,
    deleteAccountMode,
    investmentApps,
    addPartition,
    deletePartition,
    portfolioPartitions,
    showPersonalQuotes,
    setShowPersonalQuotes,
    exportData,
    importData,
    resetAllData,
    canInstallApp,
    isAppInstalled,
    installApp,
    customObligations,
    addObligation,
    deleteObligation,
  } = useStore();
  const nav = useNavigate();
  const importInputRef = useRef<HTMLInputElement>(null);

  const riskCapPartitionLabel =
    portfolioPartitions.find((p) => p.key === blueprintSettings.riskCapPartition)?.label ??
    blueprintSettings.riskCapPartition;

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

  // ── Blueprint form local state (controlled, saved on submit) ──────────────
  const [bp, setBp] = useState({
    defaultSalary:    String(blueprintSettings.defaultSalary),
    fixedRunrate:     String(blueprintSettings.fixedRunrate),
    scooterEmi:       String(blueprintSettings.scooterEmi),
    growwMfSip:       String(blueprintSettings.growwMfSip),
    riskCapPct:       String(Math.round(blueprintSettings.defaultRiskCapPct * 100)),
  });

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
                    toast.success(`Risk cap partition set to "${v}"`);
                  }}
                >
                  <SelectTrigger className="bg-input/40 border-glass-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {portfolioPartitions.map((p) => (
                      <SelectItem key={p.key} value={p.key}>
                        {p.label}
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
              Add custom income / expense categories. Default categories cannot be removed.
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
          />
          <CategoryColumn
            title="Expense Categories"
            allCategories={expenseCategories}
            defaults={DEFAULT_EXPENSE_CATEGORIES}
            onAdd={(name) => addCategory("expense", name)}
            onDelete={(name) => deleteCategory("expense", name)}
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

      {/* Payment Modes & Broker Partitions */}
      <section className="glass rounded-2xl p-5 md:p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="size-9 rounded-xl gradient-success grid place-items-center shrink-0">
            <Wallet className="size-4 text-background" />
          </div>
          <div>
            <h2 className="font-display font-semibold tracking-tight">Payment Modes & Broker Partitions</h2>
            <p className="text-xs text-muted-foreground">
              Add custom payment modes or broker/investment partitions. Default entries cannot be removed.
            </p>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <CategoryColumn
            title="Payment Modes"
            allCategories={paymentModes}
            defaults={DEFAULT_PAYMENT_MODES}
            onAdd={(name) => addAccountMode(name)}
            onDelete={(name) => deleteAccountMode(name)}
          />
          <CategoryColumn
            title="Broker Partitions"
            allCategories={investmentApps.map((a) => a.id)}
            defaults={DEFAULT_INVESTMENT_APPS.map((a) => a.id)}
            onAdd={(name) => addPartition(name)}
            onDelete={(name) => deletePartition(name)}
          />
        </div>
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
              When off (default), only general motivational quotes are shown on the dashboard. Turn on to also see the app owner's personal reflections.
            </p>
          </div>
          <Switch
            checked={showPersonalQuotes}
            onCheckedChange={(checked) => setShowPersonalQuotes(checked)}
          />
        </div>
      </section>

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

// ─── Category column ────────────────────────────────────────────────────────
function CategoryColumn({
  title,
  allCategories,
  defaults,
  onAdd,
  onDelete,
}: {
  title: string;
  allCategories: string[];
  defaults: readonly string[];
  onAdd: (name: string) => void;
  // Returning false signals the deletion was blocked (e.g. still referenced by
  // existing records) — anything else (including void) is treated as success.
  onDelete: (name: string) => void | boolean;
}) {
  const [input, setInput] = useState("");

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

  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">{title}</p>
      <ul className="space-y-1.5">
        {allCategories.map((cat) => {
          const isDefault = defaults.includes(cat);
          return (
            <li
              key={cat}
              className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border border-glass-border bg-white/3 text-sm"
            >
              <span className={isDefault ? "text-muted-foreground" : ""}>{cat}</span>
              {isDefault ? (
                <Lock className="size-3.5 text-muted-foreground/50 shrink-0" />
              ) : (
                <button
                  onClick={() => {
                    const result = onDelete(cat);
                    if (result === false) {
                      toast.error(`"${cat}" is still in use — remove its records first`);
                    } else {
                      toast.success(`"${cat}" removed`);
                    }
                  }}
                  className="text-muted-foreground hover:text-destructive shrink-0"
                >
                  <Trash2 className="size-3.5" />
                </button>
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
