import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Settings, Lock, Trash2, Plus, RotateCcw, Save } from "lucide-react";
import {
  useStore,
  DEFAULT_BLUEPRINT,
  DEFAULT_INCOME_CATEGORIES,
  DEFAULT_EXPENSE_CATEGORIES,
} from "@/lib/store";
import { inr } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/settings")({ component: SettingsPage });

function SettingsPage() {
  const { blueprintSettings, updateBlueprintSettings, incomeCategories, expenseCategories, addCategory, deleteCustomCategory } = useStore();

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
        <h1 className="text-3xl md:text-4xl font-semibold mt-1">
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
            <h2 className="font-semibold">Blueprint Configuration</h2>
            <p className="text-xs text-muted-foreground">
              Changes reflect immediately in Dashboard KPIs, Pending, and Swing risk cap.
            </p>
          </div>
        </div>

        <form onSubmit={handleBlueprintSave} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <BpField
              label="Monthly Salary Baseline (₹)"
              hint={`Currently: ${inr(blueprintSettings.defaultSalary)}`}
              value={bp.defaultSalary}
              onChange={(v) => setBp((s) => ({ ...s, defaultSalary: v }))}
            />
            <BpField
              label="Fixed Runrate / Rent (₹)"
              hint={`Currently: ${inr(blueprintSettings.fixedRunrate)}`}
              value={bp.fixedRunrate}
              onChange={(v) => setBp((s) => ({ ...s, fixedRunrate: v }))}
            />
            <BpField
              label="Scooter EMI (₹)"
              hint={`Currently: ${inr(blueprintSettings.scooterEmi)}`}
              value={bp.scooterEmi}
              onChange={(v) => setBp((s) => ({ ...s, scooterEmi: v }))}
            />
            <BpField
              label="Groww MF SIP (₹)"
              hint={`Currently: ${inr(blueprintSettings.growwMfSip)}`}
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
            <h2 className="font-semibold">Category Manager</h2>
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
            onDelete={(name) => deleteCustomCategory("income", name)}
          />
          <CategoryColumn
            title="Expense Categories"
            allCategories={expenseCategories}
            defaults={DEFAULT_EXPENSE_CATEGORIES}
            onAdd={(name) => addCategory("expense", name)}
            onDelete={(name) => deleteCustomCategory("expense", name)}
          />
        </div>
      </section>
    </div>
  );
}

// ─── Blueprint field ────────────────────────────────────────────────────────
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
  hint: string;
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
          className={`bg-input/40 border-glass-border tabular-nums ${suffix ? "pr-8" : ""}`}
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
  onDelete: (name: string) => void;
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
                    onDelete(cat);
                    toast.success(`"${cat}" removed`);
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
