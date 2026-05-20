import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type FormEvent } from "react";
import { Search, Plus, Trash2, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { useStore, PAYMENT_MODES, type PaymentMode, type TxCategory, type TxType } from "@/lib/store";
import { inr, fmtDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/cashflow")({ component: CashflowPage });

const CATEGORIES: TxCategory[] = ["Salary", "Fixed Runrate", "Scooter EMI", "Freelance", "Other"];

function CashflowPage() {
  const { transactions, addTransaction, deleteTransaction } = useStore();
  const [q, setQ] = useState("");

  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    type: "expense" as TxType,
    category: "Other" as TxCategory,
    paymentMode: "Bank Account" as PaymentMode,
    amount: "",
    tags: "",
    notes: "",
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const amt = Number(form.amount);
    if (!amt || amt <= 0) return toast.error("Enter a valid amount");
    addTransaction({
      date: new Date(form.date).toISOString(),
      type: form.type,
      category: form.category,
      paymentMode: form.paymentMode,
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
        t.paymentMode.toLowerCase().includes(s) ||
        t.tags.some((x) => x.toLowerCase().includes(s)) ||
        (t.notes?.toLowerCase().includes(s) ?? false),
    );
  }, [transactions, q]);

  const handleDelete = (id: string) => {
    deleteTransaction(id);
    toast.success("Transaction removed");
  };

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Module</p>
        <h1 className="text-3xl md:text-4xl font-semibold mt-1">
          <span className="text-gradient">Cashflow</span> ledger
        </h1>
        <p className="text-sm text-muted-foreground mt-2">Every rupee accounted for. INR formatted en-IN.</p>
      </header>

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
            <Select value={form.type} onValueChange={(v: TxType) => setForm({ ...form, type: v })}>
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
              onValueChange={(v: TxCategory) => setForm({ ...form, category: v })}
            >
              <SelectTrigger className="bg-input/40 border-glass-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field className="col-span-1 md:col-span-1" label="Account / Mode">
            <Select
              value={form.paymentMode}
              onValueChange={(v: PaymentMode) => setForm({ ...form, paymentMode: v })}
            >
              <SelectTrigger className="bg-input/40 border-glass-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_MODES.map((m) => (
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
              className="bg-input/40 border-glass-border tabular-nums"
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
                  <td className="text-muted-foreground">{t.paymentMode}</td>
                  <td className="text-xs text-muted-foreground">{t.tags.join(", ") || "—"}</td>
                  <td
                    className={`text-right font-semibold tabular-nums ${
                      t.type === "income"
                        ? "text-[oklch(0.78_0.16_155)]"
                        : "text-[oklch(0.78_0.18_25)]"
                    }`}
                  >
                    {t.type === "income" ? "+" : "−"}
                    {inr(t.amount)}
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
                    {fmtDate(t.date)} • {t.paymentMode}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p
                  className={`font-semibold tabular-nums text-sm ${
                    t.type === "income"
                      ? "text-[oklch(0.78_0.16_155)]"
                      : "text-[oklch(0.78_0.18_25)]"
                  }`}
                >
                  {t.type === "income" ? "+" : "−"}
                  {inr(t.amount)}
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
    </div>
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
