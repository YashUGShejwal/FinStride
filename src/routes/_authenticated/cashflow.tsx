import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState, type FormEvent } from "react";
import { motion } from "framer-motion";
import {
  Search, Plus, Trash2, ArrowUpRight, ArrowDownRight,
  CheckSquare, Square, CreditCard, CalendarCheck, ListChecks, BookOpenText,
} from "lucide-react";
import { useStore, type ObligationKey, type PaymentMode, type TxType } from "@/lib/store";
import { inr, fmtDate, todayLocalISO } from "@/lib/format";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { Sensitive } from "@/components/Sensitive";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

type CashflowTab = "ledger" | "obligations";
type CashflowSearch = { tab?: CashflowTab };

export const Route = createFileRoute("/_authenticated/cashflow")({
  validateSearch: (search: Record<string, unknown>): CashflowSearch => ({
    tab:
      search.tab === "obligations" ? "obligations" : search.tab === "ledger" ? "ledger" : undefined,
  }),
  component: CashflowPage,
});

const TABS: { key: CashflowTab; label: string; icon: typeof ListChecks }[] = [
  { key: "ledger", label: "Ledger", icon: BookOpenText },
  { key: "obligations", label: "Obligations & Dues", icon: ListChecks },
];

function CashflowPage() {
  const { tab } = Route.useSearch();
  const nav = useNavigate({ from: Route.fullPath });
  const activeTab: CashflowTab = tab ?? "ledger";

  // The URL is the tab state: the command palette and the notifications bell
  // both deep-link straight into a specific segment.
  const setTab = (next: CashflowTab) =>
    nav({ search: { tab: next }, replace: true });

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Cash Flow Hub</p>
        <h1 className="text-3xl md:text-4xl font-semibold mt-1">
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

      {activeTab === "ledger" ? <LedgerSection /> : <ObligationsSection />}
    </div>
  );
}

function cnSegment(active: boolean) {
  return [
    "relative flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors",
    active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
  ].join(" ");
}

// ─── Ledger segment ─────────────────────────────────────────────────────────
function LedgerSection() {
  const { transactions, addTransaction, deleteTransaction, incomeCategories, expenseCategories, paymentModes } = useStore();
  const [q, setQ] = useState("");

  const [form, setForm] = useState({
    date: todayLocalISO(),
    type: "expense" as TxType,
    category: expenseCategories[0] ?? "Other",
    account: "Bank Account" as PaymentMode,
    amount: "",
    tags: "",
    notes: "",
  });

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
  };

  const filtered = useMemo(() => {
    const s = q.toLowerCase();
    return transactions.filter(
      (t) =>
        !s ||
        t.category.toLowerCase().includes(s) ||
        t.account.toLowerCase().includes(s) ||
        t.tags.some((x) => x.toLowerCase().includes(s)) ||
        (t.notes?.toLowerCase().includes(s) ?? false),
    );
  }, [transactions, q]);

  const handleDelete = (id: string) => {
    deleteTransaction(id);
    toast.success("Transaction removed");
  };

  return (
    <>
      {/* Entry form */}
      <section className="glass-strong rounded-2xl p-5 md:p-6">
        <h2 className="font-semibold mb-4 flex items-center gap-2">
          <Plus className="size-4 text-primary" /> New entry
        </h2>
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
                {paymentModes.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field className="col-span-1 md:col-span-1" label="Amount (₹)">
            <Input
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
              type="submit"
              className="gradient-primary text-primary-foreground border-0 gap-2 glow h-10"
            >
              <Plus className="size-4" /> Add transaction
            </Button>
          </div>
        </form>
      </section>

      {/* Ledger */}
      <section className="glass rounded-2xl p-5">
        <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between mb-4">
          <div>
            <h2 className="font-semibold">Ledger</h2>
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
                  <td className="text-muted-foreground">{t.account}</td>
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
                    {fmtDate(t.date)} • {t.account}
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
type Obligation = {
  key: ObligationKey;
  label: string;
  amount: number;
  description: React.ReactNode;
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
  const { creditCardDues, pendingChecklist, toggleObligation, blueprintSettings } = useStore();

  const OBLIGATIONS: Obligation[] = [
    {
      key: "fixedRunrate",
      label: "Rent / Fixed Runrate",
      amount: blueprintSettings.fixedRunrate,
      description: (
        <>Monthly operational expenses — blueprint threshold <Amt value={blueprintSettings.fixedRunrate} /></>
      ),
    },
    {
      key: "scooterEmi",
      label: "Loan/EMI",
      amount: blueprintSettings.scooterEmi,
      description: <>Fixed at <Amt value={blueprintSettings.scooterEmi} /> / month</>,
    },
    {
      key: "growwMfSip",
      label: "Investment SIP",
      amount: blueprintSettings.growwMfSip,
      description: (
        <>Monthly mutual fund SIP commitment — <Amt value={blueprintSettings.growwMfSip} /></>
      ),
    },
  ];

  const month = new Date().toLocaleString("en-IN", { month: "long", year: "numeric" });

  const totalObligation = OBLIGATIONS.reduce((s, o) => s + o.amount, 0);
  const settledAmount = OBLIGATIONS.filter((o) => pendingChecklist[o.key]).reduce(
    (s, o) => s + o.amount,
    0,
  );
  const settledPct = totalObligation > 0 ? Math.round((settledAmount / totalObligation) * 100) : 0;

  return (
    <>
      <p className="text-sm text-muted-foreground -mt-2">
        {month} — clear dues before deploying your runway.
      </p>

      {/* Credit Card Outstanding */}
      <section className="glass-strong rounded-2xl p-5 md:p-6 kpi-card">
        <div className="flex items-center gap-3 mb-5">
          <div className="size-9 rounded-xl gradient-danger grid place-items-center shrink-0">
            <CreditCard className="size-4 text-background" />
          </div>
          <div>
            <h2 className="font-semibold">Credit Card Outstanding</h2>
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
            onClick={() => toggleObligation("ccSettled")}
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
      </section>

      {/* Monthly Obligations Checklist */}
      <section className="glass rounded-2xl p-5">
        <div className="flex items-center gap-3 mb-5">
          <div className="size-9 rounded-xl gradient-primary grid place-items-center shrink-0">
            <CalendarCheck className="size-4 text-primary-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold">Fixed Monthly Obligations</h2>
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
          {OBLIGATIONS.map((ob) => {
            const paid = !!pendingChecklist[ob.key];
            return (
              <li key={ob.key}>
                <button
                  onClick={() => toggleObligation(ob.key)}
                  className={`w-full flex items-center gap-3 p-4 rounded-xl border text-left transition-all ${
                    paid
                      ? "border-[oklch(0.72_0.18_155/0.3)] bg-[oklch(0.72_0.18_155/0.07)]"
                      : "border-glass-border hover:bg-white/5"
                  }`}
                >
                  <span
                    className={`shrink-0 transition-colors ${
                      paid ? "text-[oklch(0.78_0.16_155)]" : "text-muted-foreground"
                    }`}
                  >
                    {paid ? (
                      <CheckSquare className="size-5" />
                    ) : (
                      <Square className="size-5" />
                    )}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p
                      className={`text-sm font-medium transition-colors ${
                        paid ? "line-through text-muted-foreground" : ""
                      }`}
                    >
                      {ob.label}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">{ob.description}</p>
                  </div>
                  <p
                    className={`tnum font-semibold text-sm shrink-0 transition-colors ${
                      paid ? "text-[oklch(0.78_0.16_155)]" : ""
                    }`}
                  >
                    <Sensitive>{inr(ob.amount)}</Sensitive>
                  </p>
                </button>
              </li>
            );
          })}
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
