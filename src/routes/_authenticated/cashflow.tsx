import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { motion } from "framer-motion";
import {
  Search, Plus, Trash2, ArrowUpRight, ArrowDownRight,
  CheckSquare, Square, CreditCard, CalendarCheck, ListChecks, BookOpenText,
} from "lucide-react";
import { useStore, type PaymentMode, type TxType } from "@/lib/store";
import { inr, fmtDate, todayLocalISO } from "@/lib/format";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { Sensitive } from "@/components/Sensitive";
import { useGlowRipple } from "@/hooks/useGlowRipple";
import { QuickLogDrawer } from "@/components/ui/QuickLogDrawer";
import { SpotlightCard } from "@/components/ui/SpotlightCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

type CashflowTab = "ledger" | "obligations";
type CashflowSearch = { tab?: CashflowTab; action?: "add" };

export const Route = createFileRoute("/_authenticated/cashflow")({
  validateSearch: (search: Record<string, unknown>): CashflowSearch => ({
    tab:
      search.tab === "obligations" ? "obligations" : search.tab === "ledger" ? "ledger" : undefined,
    action: search.action === "add" ? "add" : undefined,
  }),
  component: CashflowPage,
});

const TABS: { key: CashflowTab; label: string; icon: typeof ListChecks }[] = [
  { key: "ledger", label: "Ledger", icon: BookOpenText },
  { key: "obligations", label: "Obligations & Dues", icon: ListChecks },
];

function CashflowPage() {
  const { tab, action } = Route.useSearch();
  const nav = useNavigate({ from: Route.fullPath });
  const activeTab: CashflowTab = tab ?? "ledger";

  // The URL is the tab state: the command palette and the notifications bell
  // both deep-link straight into a specific segment.
  const setTab = (next: CashflowTab) =>
    nav({ search: { tab: next }, replace: true });

  // ?action=add (palette "Add Transaction", dashboard quick card) expands the
  // entry drawer; the param self-clears so refresh/back won't re-trigger it.
  const openFormSignal = action === "add";
  useEffect(() => {
    if (action) void nav({ search: { tab }, replace: true });
  }, [action, tab, nav]);

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Cash Flow Hub</p>
        <h1 className="text-3xl md:text-4xl font-display font-semibold tracking-tight mt-1">
          <span className="text-gradient">Cash flow</span> command
        </h1>
        <p className="text-sm text-muted-foreground mt-2">
          Ledger and monthly obligations in one place. Every rupee accounted for.
        </p>
      </header>

      {/* Segmented control */}
      <div className="inline-flex items-center gap-1 p-1 rounded-xl glass">
        {TABS.map((t) => {
          const active = activeTab === t.key;
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cnSegment(active)}
            >
              {active && (
                <motion.span
                  layoutId="cashflow-segment"
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                  className="absolute inset-0 rounded-lg bg-white/[0.08] border border-white/[0.08]"
                />
              )}
              <Icon className="size-4 relative z-10" />
              <span className="relative z-10">{t.label}</span>
            </button>
          );
        })}
      </div>

      {activeTab === "ledger" ? (
        <LedgerSection openFormSignal={openFormSignal} />
      ) : (
        <ObligationsSection />
      )}
    </div>
  );
}

function cnSegment(active: boolean) {
  return [
    "relative flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors",
    active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
  ].join(" ");
}

// ─── Quick-log presets ───────────────────────────────────────────────────────
type QuickPreset = {
  emoji: string;
  label: string;
  type: TxType;
  category: string;
  amount: number;
  note?: string;
};

// Capital transfers only move money between the user's own accounts — the
// running totals exclude them, matching the dashboard's operational stats.
const TRANSFER_CATS = new Set(["Capital Transfer (In)", "Capital Transfer (Out)"]);

// ─── Ledger segment ─────────────────────────────────────────────────────────
function LedgerSection({ openFormSignal }: { openFormSignal: boolean }) {
  const { transactions, addTransaction, deleteTransaction, incomeCategories, expenseCategories, accountModes, accountLabel, blueprintSettings } = useStore();
  const [q, setQ] = useState("");
  const [formOpen, setFormOpen] = useState(openFormSignal);
  const submitRef = useRef<HTMLButtonElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const focusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ledgerRipple = useGlowRipple();

  // Latch, don't mirror: the deep-link signal opens the drawer, but the param
  // self-clears right after, and manual toggling must keep working.
  useEffect(() => {
    if (openFormSignal) setFormOpen(true);
  }, [openFormSignal]);

  useEffect(
    () => () => {
      if (focusTimer.current) clearTimeout(focusTimer.current);
    },
    [],
  );

  const [form, setForm] = useState({
    date: todayLocalISO(),
    type: "expense" as TxType,
    category: expenseCategories[0] ?? "Other",
    account: "Bank Account" as PaymentMode,
    amount: "",
    tags: "",
    notes: "",
  });

  // 1-click quick-log chips. All categories referenced here are built-in
  // defaults, so they always exist in the type-matched category list.
  const QUICK_PRESETS: QuickPreset[] = [
    { emoji: "☕", label: "Chai/Coffee", type: "expense", category: "Other", amount: 200, note: "Chai/Coffee" },
    { emoji: "⛽", label: "Fuel", type: "expense", category: "Other", amount: 1500, note: "Fuel" },
    { emoji: "🛒", label: "Groceries", type: "expense", category: "Other", amount: 3000, note: "Groceries" },
    { emoji: "💼", label: "Salary Baseline", type: "income", category: "Salary", amount: blueprintSettings.defaultSalary },
  ];

  const applyPreset = (p: QuickPreset) => {
    setForm((s) => ({
      ...s,
      // Quick log means "now" — a stale backdate or leftover tags from an
      // earlier abandoned entry must not silently ride along.
      date: todayLocalISO(),
      tags: "",
      type: p.type,
      category: p.category,
      // A 0 salary baseline (fresh install) leaves the field empty for the
      // user to complete instead of pre-filling an invalid ₹0.
      amount: p.amount > 0 ? String(p.amount) : "",
      notes: p.note ?? "",
    }));
    setFormOpen(true);
    // Focus lands once the drawer's expand animation has mounted the target.
    if (focusTimer.current) clearTimeout(focusTimer.current);
    focusTimer.current = setTimeout(() => {
      // If the user has meanwhile clicked into a field, don't steal focus.
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName)
      ) {
        return;
      }
      // Complete preset → confirm on submit; amount left blank → fill it in.
      (p.amount > 0 ? submitRef.current : amountRef.current)?.focus();
    }, 320);
  };

  // Switch the active category list and reset category when type changes
  const activeCategories = form.type === "income" ? incomeCategories : expenseCategories;

  const handleTypeChange = (v: TxType) => {
    const newCategories = v === "income" ? incomeCategories : expenseCategories;
    setForm((s) => ({ ...s, type: v, category: newCategories[0] ?? "Other" }));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const amt = Number(form.amount);
    if (!amt || amt <= 0) return toast.error("Enter a valid amount");
    addTransaction({
      date: new Date(form.date).toISOString(),
      type: form.type,
      category: form.category,
      account: form.account,
      amount: amt,
      tags: form.tags.split(",").map((s) => s.trim()).filter(Boolean),
      notes: form.notes || undefined,
    });
    toast.success("Transaction added");
    setForm({ ...form, amount: "", tags: "", notes: "" });
    ledgerRipple.trigger();
  };

  const totals = useMemo(() => {
    // Same operational scope as the dashboard's Income/Expenses/Net flow —
    // two identically-named figures must never disagree.
    const operational = transactions.filter((t) => !TRANSFER_CATS.has(t.category));
    const income = operational.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
    const expense = operational.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
    return { income, expense, net: income - expense };
  }, [transactions]);

  const filtered = useMemo(() => {
    const s = q.toLowerCase();
    return transactions.filter(
      (t) =>
        !s ||
        t.category.toLowerCase().includes(s) ||
        t.account.toLowerCase().includes(s) ||
        accountLabel(t.account).toLowerCase().includes(s) ||
        t.tags.some((x) => x.toLowerCase().includes(s)) ||
        (t.notes?.toLowerCase().includes(s) ?? false),
    );
  }, [transactions, q, accountLabel]);

  const handleDelete = (id: string) => {
    deleteTransaction(id);
    toast.success("Transaction removed");
  };

  return (
    <>
      {/* 1-click quick-log preset chips */}
      <div className="flex flex-wrap gap-2">
        {QUICK_PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => applyPreset(p)}
            className="flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-full border border-glass-border glass hover:border-primary/30 hover:bg-white/5 transition-all active:scale-95"
          >
            <span aria-hidden>{p.emoji}</span>
            <span>{p.label}</span>
            {p.amount > 0 && p.type === "expense" && (
              <span className="tnum text-muted-foreground">({inr(p.amount)})</span>
            )}
          </button>
        ))}
      </div>

      {/* Entry form — collapsed by default so the live ledger stays in focus */}
      <QuickLogDrawer
        label="Quick Log Entry"
        open={formOpen}
        onToggle={() => setFormOpen((v) => !v)}
      >
        <form onSubmit={submit} className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <Field className="col-span-2 md:col-span-2" label="Date">
            <Input
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              className="bg-input/40 border-glass-border"
              required
            />
          </Field>
          <Field className="col-span-1 md:col-span-1" label="Type">
            <Select value={form.type} onValueChange={(v: TxType) => handleTypeChange(v)}>
              <SelectTrigger className="bg-input/40 border-glass-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="income">Income</SelectItem>
                <SelectItem value="expense">Expense</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field className="col-span-1 md:col-span-1" label="Category">
            <Select
              value={form.category}
              onValueChange={(v) => setForm({ ...form, category: v })}
            >
              <SelectTrigger className="bg-input/40 border-glass-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {activeCategories.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field className="col-span-1 md:col-span-1" label="Account / Mode">
            <Select
              value={form.account}
              onValueChange={(v: PaymentMode) => setForm({ ...form, account: v })}
            >
              <SelectTrigger className="bg-input/40 border-glass-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {accountModes.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {accountLabel(m.id)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field className="col-span-1 md:col-span-1" label="Amount (₹)">
            <Input
              ref={amountRef}
              type="number"
              step="1"
              min="0"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              className="bg-input/40 border-glass-border tnum"
              placeholder="0"
              required
            />
          </Field>
          <Field className="col-span-2 md:col-span-3" label="Tags (comma-sep)">
            <Input
              value={form.tags}
              onChange={(e) => setForm({ ...form, tags: e.target.value })}
              className="bg-input/40 border-glass-border"
              placeholder="essentials, may"
            />
          </Field>
          <Field className="col-span-2 md:col-span-3" label="Notes">
            <Textarea
              rows={1}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="bg-input/40 border-glass-border min-h-[40px]"
              placeholder="Optional"
            />
          </Field>
          <div className="col-span-2 md:col-span-6 flex justify-end">
            <Button
              ref={submitRef}
              type="submit"
              className="gradient-primary text-primary-foreground border-0 gap-2 glow h-10"
            >
              <Plus className="size-4" /> Add transaction
            </Button>
          </div>
        </form>
      </QuickLogDrawer>

      {/* Running totals — spring counters roll up as entries land. Labeled
          "all time" because the search box below only filters the table.
          Single column on phones: mono lakh-scale amounts don't fit thirds. */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <SpotlightCard className="rounded-xl p-4">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Income · all time</p>
          <p className="text-lg font-semibold mt-1 tnum text-[oklch(0.78_0.16_155)]">
            <Sensitive><AnimatedNumber value={totals.income} format={inr} /></Sensitive>
          </p>
        </SpotlightCard>
        <SpotlightCard className="rounded-xl p-4">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Expenses · all time</p>
          <p className="text-lg font-semibold mt-1 tnum text-[oklch(0.78_0.18_25)]">
            <Sensitive><AnimatedNumber value={totals.expense} format={inr} /></Sensitive>
          </p>
        </SpotlightCard>
        <SpotlightCard className="rounded-xl p-4">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Net flow · all time</p>
          <p className="text-lg font-semibold mt-1 tnum">
            <Sensitive><AnimatedNumber value={totals.net} format={inr} /></Sensitive>
          </p>
        </SpotlightCard>
      </section>

      {/* Ledger */}
      <section className={`glass rounded-2xl p-5 ${ledgerRipple.className}`}>
        <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between mb-4">
          <div>
            <h2 className="font-display font-semibold tracking-tight">Ledger</h2>
            <p className="text-xs text-muted-foreground">
              {filtered.length} of {transactions.length} entries
            </p>
          </div>
          <div className="relative md:w-72">
            <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search category, mode, tag…"
              className="pl-9 bg-input/40 border-glass-border"
            />
          </div>
        </div>

        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wider text-muted-foreground border-b border-glass-border">
                <th className="text-left py-2 font-medium">Date</th>
                <th className="text-left py-2 font-medium">Type</th>
                <th className="text-left py-2 font-medium">Category</th>
                <th className="text-left py-2 font-medium">Account / Mode</th>
                <th className="text-left py-2 font-medium">Tags</th>
                <th className="text-right py-2 font-medium">Amount</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr
                  key={t.id}
                  className="border-b border-glass-border/50 hover:bg-white/5 transition-colors"
                >
                  <td className="py-3">{fmtDate(t.date)}</td>
                  <td>
                    <span
                      className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md ${
                        t.type === "income"
                          ? "bg-[oklch(0.72_0.18_155/0.15)] text-[oklch(0.82_0.16_155)]"
                          : "bg-[oklch(0.7_0.22_20/0.15)] text-[oklch(0.82_0.18_25)]"
                      }`}
                    >
                      {t.type === "income" ? (
                        <ArrowUpRight className="size-3" />
                      ) : (
                        <ArrowDownRight className="size-3" />
                      )}
                      {t.type}
                    </span>
                  </td>
                  <td>{t.category}</td>
                  <td className="text-muted-foreground">{accountLabel(t.account)}</td>
                  <td className="text-xs text-muted-foreground">{t.tags.join(", ") || "—"}</td>
                  <td
                    className={`text-right font-semibold tnum ${
                      t.type === "income"
                        ? "text-[oklch(0.78_0.16_155)]"
                        : "text-[oklch(0.78_0.18_25)]"
                    }`}
                  >
                    <Sensitive>
                      {t.type === "income" ? "+" : "−"}
                      {inr(t.amount)}
                    </Sensitive>
                  </td>
                  <td className="text-right">
                    <button
                      onClick={() => handleDelete(t.id)}
                      className="text-muted-foreground hover:text-destructive p-2"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-muted-foreground">
                    No entries match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <ul className="md:hidden space-y-2">
          {filtered.map((t) => (
            <li
              key={t.id}
              className="glass rounded-xl p-3 flex items-center justify-between gap-3"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={`size-9 rounded-xl grid place-items-center shrink-0 ${
                    t.type === "income" ? "gradient-success" : "gradient-danger"
                  }`}
                >
                  {t.type === "income" ? (
                    <ArrowUpRight className="size-4 text-background" />
                  ) : (
                    <ArrowDownRight className="size-4 text-background" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{t.category}</p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {fmtDate(t.date)} • {accountLabel(t.account)}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p
                  className={`font-semibold tnum text-sm ${
                    t.type === "income"
                      ? "text-[oklch(0.78_0.16_155)]"
                      : "text-[oklch(0.78_0.18_25)]"
                  }`}
                >
                  <Sensitive>
                    {t.type === "income" ? "+" : "−"}
                    {inr(t.amount)}
                  </Sensitive>
                </p>
                <button
                  onClick={() => handleDelete(t.id)}
                  className="text-[11px] text-muted-foreground mt-1"
                >
                  delete
                </button>
              </div>
            </li>
          ))}
          {filtered.length === 0 && (
            <p className="text-center py-8 text-muted-foreground text-sm">No entries match.</p>
          )}
        </ul>
      </section>
    </>
  );
}

// ─── Obligations & Dues segment (formerly the /pending route) ───────────────
// Unifies the 3 blueprint-driven obligations (toggled via the ObligationKey
// checklist, cloud-synced) with user-added custom obligations from Settings
// (toggled via customObligationsPending, local-only — see the CustomObligation
// comment in store.tsx) into one displayable, one totals-math list.
type DisplayObligation = {
  id: string;
  label: string;
  amount: number;
  description: React.ReactNode;
  paid: boolean;
  onToggle: () => void;
  isCustom: boolean;
};

/** Currency inside helper copy — blurred in stealth mode like the headline amounts. */
function Amt({ value }: { value: number }) {
  return (
    <Sensitive>
      <span className="tnum">{inr(value)}</span>
    </Sensitive>
  );
}

function ObligationsSection() {
  const {
    creditCardDues, pendingChecklist, toggleObligation, blueprintSettings,
    customObligations, customObligationsPending, toggleCustomObligation, deleteObligation,
  } = useStore();
  const ccRipple = useGlowRipple();
  const listRipple = useGlowRipple();

  const builtIn: DisplayObligation[] = [
    {
      id: "fixedRunrate",
      label: "Rent / Fixed Runrate",
      amount: blueprintSettings.fixedRunrate,
      description: (
        <>Monthly operational expenses — blueprint threshold <Amt value={blueprintSettings.fixedRunrate} /></>
      ),
      paid: !!pendingChecklist.fixedRunrate,
      onToggle: () => {
        if (!pendingChecklist.fixedRunrate) listRipple.trigger();
        toggleObligation("fixedRunrate");
      },
      isCustom: false,
    },
    {
      id: "scooterEmi",
      label: "Loan/EMI",
      amount: blueprintSettings.scooterEmi,
      description: <>Fixed at <Amt value={blueprintSettings.scooterEmi} /> / month</>,
      paid: !!pendingChecklist.scooterEmi,
      onToggle: () => {
        if (!pendingChecklist.scooterEmi) listRipple.trigger();
        toggleObligation("scooterEmi");
      },
      isCustom: false,
    },
    {
      id: "growwMfSip",
      label: "Investment SIP",
      amount: blueprintSettings.growwMfSip,
      description: (
        <>Monthly mutual fund SIP commitment — <Amt value={blueprintSettings.growwMfSip} /></>
      ),
      paid: !!pendingChecklist.growwMfSip,
      onToggle: () => {
        if (!pendingChecklist.growwMfSip) listRipple.trigger();
        toggleObligation("growwMfSip");
      },
      isCustom: false,
    },
  ];

  const custom: DisplayObligation[] = customObligations.map((o) => ({
    id: o.id,
    label: o.label,
    amount: o.amount,
    description: <>Custom monthly obligation — <Amt value={o.amount} /></>,
    paid: !!customObligationsPending[o.id],
    onToggle: () => {
      if (!customObligationsPending[o.id]) listRipple.trigger();
      toggleCustomObligation(o.id);
    },
    isCustom: true,
  }));

  const OBLIGATIONS = [...builtIn, ...custom];

  const month = new Date().toLocaleString("en-IN", { month: "long", year: "numeric" });

  const totalObligation = OBLIGATIONS.reduce((s, o) => s + o.amount, 0);
  const settledAmount = OBLIGATIONS.filter((o) => o.paid).reduce((s, o) => s + o.amount, 0);
  const settledPct = totalObligation > 0 ? Math.round((settledAmount / totalObligation) * 100) : 0;

  return (
    <>
      <p className="text-sm text-muted-foreground -mt-2">
        {month} — clear dues before deploying your runway.
      </p>

      {/* Credit Card Outstanding */}
      <SpotlightCard className={`rounded-2xl p-5 md:p-6 ${ccRipple.className}`}>
        <div className="flex items-center gap-3 mb-5">
          <div className="size-9 rounded-xl gradient-danger grid place-items-center shrink-0">
            <CreditCard className="size-4 text-background" />
          </div>
          <div>
            <h2 className="font-display font-semibold tracking-tight">Credit Card Outstanding</h2>
            <p className="text-xs text-muted-foreground">Cumulative card expenses from your ledger</p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 flex-wrap">
          <p
            className={`text-4xl font-semibold tnum ${
              creditCardDues > 0 ? "text-[oklch(0.78_0.18_25)]" : "text-[oklch(0.78_0.16_155)]"
            }`}
          >
            <Sensitive>
              <AnimatedNumber value={creditCardDues} format={inr} />
            </Sensitive>
          </p>
          <button
            onClick={() => {
              if (!pendingChecklist.ccSettled) ccRipple.trigger();
              toggleObligation("ccSettled");
            }}
            className={`flex items-center gap-2 text-sm px-4 py-2.5 rounded-xl border transition-all ${
              pendingChecklist.ccSettled
                ? "gradient-success border-transparent text-background font-medium"
                : "border-glass-border text-muted-foreground hover:text-foreground hover:bg-white/5"
            }`}
          >
            {pendingChecklist.ccSettled ? (
              <>
                <CheckSquare className="size-4" /> Bill settled
              </>
            ) : (
              <>
                <Square className="size-4" /> Mark as settled
              </>
            )}
          </button>
        </div>

        {pendingChecklist.ccSettled && creditCardDues > 0 && (
          <p className="mt-4 text-xs text-[oklch(0.78_0.16_155)]">
            Marked as settled for {month}. The amount above reflects all logged card spends — delete
            individual ledger rows to zero it out.
          </p>
        )}
        {creditCardDues === 0 && (
          <p className="mt-4 text-xs text-muted-foreground">
            No credit card expenses logged yet. Add entries in the Ledger tab with mode "Credit
            Card" to track them here.
          </p>
        )}
      </SpotlightCard>

      {/* Monthly Obligations Checklist */}
      <section className={`glass rounded-2xl p-5 ${listRipple.className}`}>
        <div className="flex items-center gap-3 mb-5">
          <div className="size-9 rounded-xl gradient-primary grid place-items-center shrink-0">
            <CalendarCheck className="size-4 text-primary-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-display font-semibold tracking-tight">Fixed Monthly Obligations</h2>
            <p className="text-xs text-muted-foreground">
              {settledPct > 0 ? (
                <>
                  <Amt value={settledAmount} /> cleared of <Amt value={totalObligation} /> total
                </>
              ) : (
                <>
                  <Amt value={totalObligation} /> in commitments this month
                </>
              )}
            </p>
          </div>
          <span className="text-sm font-semibold tnum text-muted-foreground shrink-0">
            {settledPct}%
          </span>
        </div>

        <ul className="space-y-2">
          {OBLIGATIONS.map((ob) => (
            <li key={ob.id} className="flex items-center gap-2">
              <button
                onClick={ob.onToggle}
                className={`flex-1 flex items-center gap-3 p-4 rounded-xl border text-left transition-all ${
                  ob.paid
                    ? "border-[oklch(0.72_0.18_155/0.3)] bg-[oklch(0.72_0.18_155/0.07)]"
                    : "border-glass-border hover:bg-white/5"
                }`}
              >
                <span
                  className={`shrink-0 transition-colors ${
                    ob.paid ? "text-[oklch(0.78_0.16_155)]" : "text-muted-foreground"
                  }`}
                >
                  {ob.paid ? (
                    <CheckSquare className="size-5" />
                  ) : (
                    <Square className="size-5" />
                  )}
                </span>
                <div className="flex-1 min-w-0">
                  <p
                    className={`text-sm font-medium transition-colors ${
                      ob.paid ? "line-through text-muted-foreground" : ""
                    }`}
                  >
                    {ob.label}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">{ob.description}</p>
                </div>
                <p
                  className={`tnum font-semibold text-sm shrink-0 transition-colors ${
                    ob.paid ? "text-[oklch(0.78_0.16_155)]" : ""
                  }`}
                >
                  <Sensitive>{inr(ob.amount)}</Sensitive>
                </p>
              </button>
              {ob.isCustom && (
                <button
                  onClick={() => deleteObligation(ob.id)}
                  aria-label={`Remove ${ob.label}`}
                  className="shrink-0 text-muted-foreground hover:text-destructive p-2"
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </li>
          ))}
        </ul>

        {/* Progress bar */}
        <div className="mt-5">
          <div className="h-2 rounded-full bg-white/5 overflow-hidden">
            <div
              className="h-full gradient-success transition-all duration-500"
              style={{ width: `${settledPct}%` }}
            />
          </div>
          <div className="flex justify-between text-[11px] text-muted-foreground mt-1.5">
            <span>
              <span className="tnum">{settledPct}%</span> of fixed obligations marked paid
            </span>
            <span>
              <Amt value={totalObligation - settledAmount} /> remaining
            </span>
          </div>
        </div>
      </section>
    </>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</Label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
