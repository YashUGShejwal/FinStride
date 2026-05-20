import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import {
  Plus, Trash2, Target, Cpu, Code2, Users, Briefcase, TrendingUp,
} from "lucide-react";
import {
  useStore,
  GRIND_METRIC_META,
  HUSTLE_CATEGORIES,
  type GrindMetricKey,
  type HustleCategory,
} from "@/lib/store";
import { inr, inrCompact, fmtDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/grind")({ component: GrindPage });

// ─── icons per metric ─────────────────────────────────────────────────────
const METRIC_ICONS: Record<GrindMetricKey, React.ReactNode> = {
  systemDesign:     <Cpu      className="size-4" />,
  leetcode:         <Code2    className="size-4" />,
  linkedinOutreach: <Users    className="size-4" />,
};

const DIFFICULTY_COLORS: Record<string, string> = {
  Easy:   "text-[oklch(0.78_0.16_155)] bg-[oklch(0.72_0.18_155/0.15)]",
  Medium: "text-[oklch(0.82_0.18_80)]  bg-[oklch(0.78_0.18_80/0.15)]",
  Hard:   "text-[oklch(0.78_0.18_25)]  bg-[oklch(0.7_0.22_20/0.15)]",
};

const HUSTLE_COLORS: Record<HustleCategory, string> = {
  "Freelance":        "bg-[oklch(0.72_0.18_155/0.18)] text-[oklch(0.82_0.16_155)]",
  "Consulting":       "bg-[oklch(0.78_0.18_80/0.18)]  text-[oklch(0.82_0.18_80)]",
  "Media Production": "bg-[oklch(0.7_0.18_300/0.18)]  text-[oklch(0.78_0.18_300)]",
};

// ─── 30 LPA Prep: single metric section ───────────────────────────────────
function MetricSection({ metricKey }: { metricKey: GrindMetricKey }) {
  const { grind, addGrindLog, deleteGrindLog } = useStore();
  const meta = GRIND_METRIC_META[metricKey];
  const entries = grind.metrics[metricKey];

  const [label, setLabel] = useState("");
  const [metaVal, setMetaVal] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!label.trim()) return toast.error(`Enter a ${meta.inputLabel.toLowerCase()}`);
    addGrindLog(metricKey, label.trim(), metaVal.trim() || undefined);
    toast.success("Logged");
    setLabel("");
    setMetaVal("");
  };

  return (
    <section className="glass rounded-2xl p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-xl gradient-primary grid place-items-center text-primary-foreground">
            {METRIC_ICONS[metricKey]}
          </div>
          <div>
            <h2 className="font-semibold">{meta.label}</h2>
            <p className="text-xs text-muted-foreground">{entries.length} logged</p>
          </div>
        </div>
        <span className="text-3xl font-bold tabular-nums text-gradient">
          {entries.length}
        </span>
      </div>

      {/* Entry form */}
      <form onSubmit={submit} className="flex flex-col md:flex-row gap-2 mb-4">
        <div className="flex-1">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="bg-input/40 border-glass-border"
            placeholder={meta.placeholder}
          />
        </div>
        {meta.metaLabel && (
          <div className="md:w-44">
            <Input
              value={metaVal}
              onChange={(e) => setMetaVal(e.target.value)}
              className="bg-input/40 border-glass-border"
              placeholder={meta.metaPlaceholder}
            />
          </div>
        )}
        <Button
          type="submit"
          className="gradient-primary text-primary-foreground border-0 gap-1.5 h-9 text-sm shrink-0"
        >
          <Plus className="size-3.5" /> Log
        </Button>
      </form>

      {/* Log list */}
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">Nothing logged yet.</p>
      ) : (
        <ul className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
          {entries.map((e) => (
            <li
              key={e.id}
              className="flex items-center justify-between gap-3 py-2 border-b border-glass-border/40 last:border-0"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm truncate">{e.label}</p>
                {e.meta && (
                  <span
                    className={`inline-block text-[10px] px-1.5 py-0.5 rounded mt-0.5 font-medium ${
                      DIFFICULTY_COLORS[e.meta] ??
                      "bg-white/8 text-muted-foreground"
                    }`}
                  >
                    {e.meta}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[11px] text-muted-foreground">{fmtDate(e.loggedAt)}</span>
                <button
                  onClick={() => { deleteGrindLog(metricKey, e.id); toast.success("Removed"); }}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ─── Side Hustle Engine ────────────────────────────────────────────────────
function SideHustleEngine() {
  const { grind, addHustleEntry, deleteHustleEntry } = useStore();
  const entries = grind.hustle;

  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [category, setCategory] = useState<HustleCategory>("Freelance");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");

  const total = entries.reduce((s, e) => s + e.amount, 0);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const amt = Number(amount);
    if (!description.trim()) return toast.error("Enter a description");
    if (!amt || amt <= 0) return toast.error("Enter a valid amount");
    addHustleEntry({
      date: new Date(date).toISOString(),
      category,
      description: description.trim(),
      amount: amt,
    });
    toast.success("Income entry added");
    setDescription("");
    setAmount("");
  };

  // Group totals per category
  const byCategory = HUSTLE_CATEGORIES.map((cat) => ({
    cat,
    total: entries.filter((e) => e.category === cat).reduce((s, e) => s + e.amount, 0),
    count: entries.filter((e) => e.category === cat).length,
  }));

  return (
    <div className="space-y-5">
      {/* Summary bar */}
      <section className="glass-strong rounded-2xl p-5">
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground mb-1">
          Total side income
        </p>
        <p className="text-4xl font-bold tabular-nums text-gradient">{inr(total)}</p>
        <div className="mt-4 grid grid-cols-3 gap-3">
          {byCategory.map(({ cat, total: catTotal, count }) => (
            <div key={cat} className="glass rounded-xl p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{cat}</p>
              <p className="text-base font-semibold tabular-nums mt-1">{inrCompact(catTotal)}</p>
              <p className="text-[11px] text-muted-foreground">{count} entries</p>
            </div>
          ))}
        </div>
      </section>

      {/* Entry form */}
      <section className="glass-strong rounded-2xl p-5">
        <h2 className="font-semibold mb-4 flex items-center gap-2">
          <Briefcase className="size-4 text-primary" /> Log income
        </h2>
        <form onSubmit={submit} className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <Field className="col-span-1 md:col-span-1" label="Date">
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="bg-input/40 border-glass-border"
            />
          </Field>
          <Field className="col-span-1 md:col-span-1" label="Category">
            <Select value={category} onValueChange={(v: HustleCategory) => setCategory(v)}>
              <SelectTrigger className="bg-input/40 border-glass-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HUSTLE_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field className="col-span-2 md:col-span-3" label="Description">
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="bg-input/40 border-glass-border"
              placeholder="Project name, client, milestone…"
              required
            />
          </Field>
          <Field className="col-span-2 md:col-span-1" label="Amount (₹)">
            <Input
              type="number"
              step="1"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="bg-input/40 border-glass-border tabular-nums"
              placeholder="0"
              required
            />
          </Field>
          <div className="col-span-2 md:col-span-6 flex justify-end">
            <Button
              type="submit"
              className="gradient-primary text-primary-foreground border-0 gap-2 h-10"
            >
              <Plus className="size-4" /> Add entry
            </Button>
          </div>
        </form>
      </section>

      {/* Ledger */}
      <section className="glass rounded-2xl p-5">
        <h2 className="font-semibold mb-4">
          Income log
          {entries.length > 0 && (
            <span className="ml-2 text-xs text-muted-foreground font-normal">
              ({entries.length} entries)
            </span>
          )}
        </h2>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            No income logged yet. Add your first milestone above.
          </p>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wider text-muted-foreground border-b border-glass-border">
                    <th className="text-left py-2 font-medium">Date</th>
                    <th className="text-left py-2 font-medium">Category</th>
                    <th className="text-left py-2 font-medium">Description</th>
                    <th className="text-right py-2 font-medium">Amount</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr
                      key={e.id}
                      className="border-b border-glass-border/50 hover:bg-white/5 transition-colors"
                    >
                      <td className="py-3 text-muted-foreground">{fmtDate(e.date)}</td>
                      <td>
                        <span
                          className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-medium ${HUSTLE_COLORS[e.category]}`}
                        >
                          {e.category}
                        </span>
                      </td>
                      <td className="py-3">{e.description}</td>
                      <td className="py-3 text-right font-semibold tabular-nums text-[oklch(0.78_0.16_155)]">
                        +{inr(e.amount)}
                      </td>
                      <td className="text-right">
                        <button
                          onClick={() => { deleteHustleEntry(e.id); toast.success("Entry removed"); }}
                          className="text-muted-foreground hover:text-destructive p-2"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3} className="py-3 text-xs text-muted-foreground uppercase tracking-wider">
                      Total
                    </td>
                    <td className="py-3 text-right font-bold tabular-nums text-[oklch(0.78_0.16_155)]">
                      {inr(total)}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Mobile cards */}
            <ul className="md:hidden space-y-2">
              {entries.map((e) => (
                <li
                  key={e.id}
                  className="glass rounded-xl p-3 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{e.description}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span
                        className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-medium ${HUSTLE_COLORS[e.category]}`}
                      >
                        {e.category}
                      </span>
                      <span className="text-[11px] text-muted-foreground">{fmtDate(e.date)}</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-semibold tabular-nums text-sm text-[oklch(0.78_0.16_155)]">
                      +{inr(e.amount)}
                    </p>
                    <button
                      onClick={() => { deleteHustleEntry(e.id); toast.success("Entry removed"); }}
                      className="text-[11px] text-muted-foreground mt-1"
                    >
                      delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────
function GrindPage() {
  const { grind } = useStore();
  const totalLogs =
    grind.metrics.systemDesign.length +
    grind.metrics.leetcode.length +
    grind.metrics.linkedinOutreach.length;
  const totalHustle = grind.hustle.reduce((s, e) => s + e.amount, 0);

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Module</p>
        <h1 className="text-3xl md:text-4xl font-semibold mt-1">
          <span className="text-gradient">Grind</span> Deck
        </h1>
        <p className="text-sm text-muted-foreground mt-2">
          10 LPA → 25–30 LPA transition pipeline + alternative income engine.
        </p>
      </header>

      {/* Progress summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard
          icon={<Cpu className="size-4 text-primary" />}
          label="System Design"
          value={grind.metrics.systemDesign.length}
        />
        <SummaryCard
          icon={<Code2 className="size-4 text-accent" />}
          label="LeetCode"
          value={grind.metrics.leetcode.length}
        />
        <SummaryCard
          icon={<Users className="size-4 text-[oklch(0.78_0.18_80)]" />}
          label="Outreaches"
          value={grind.metrics.linkedinOutreach.length}
        />
        <SummaryCard
          icon={<TrendingUp className="size-4 text-[oklch(0.78_0.16_155)]" />}
          label="Side Income"
          value={inrCompact(totalHustle)}
          numeric={false}
        />
      </div>

      {/* Sub-tabs */}
      <Tabs defaultValue="prep" className="space-y-5">
        <TabsList className="glass border border-glass-border bg-transparent h-10 p-1 w-full md:w-auto">
          <TabsTrigger value="prep" className="flex items-center gap-2 flex-1 md:flex-none">
            <Target className="size-3.5" />
            30 LPA Interview Prep
          </TabsTrigger>
          <TabsTrigger value="hustle" className="flex items-center gap-2 flex-1 md:flex-none">
            <Briefcase className="size-3.5" />
            Side Hustle Engine
          </TabsTrigger>
        </TabsList>

        {/* ── 30 LPA Prep tab ─────────────────────────────────────────── */}
        <TabsContent value="prep" className="space-y-4 mt-0">
          <div className="glass rounded-2xl p-4 flex items-center gap-3">
            <Target className="size-5 text-accent shrink-0" />
            <p className="text-sm text-muted-foreground">
              Track your interview preparation across system design, competitive coding, and
              direct outreach. Every entry logged is a rep toward the offer.
              <span className="ml-1 text-foreground font-medium">{totalLogs} total reps logged.</span>
            </p>
          </div>
          {(["systemDesign", "leetcode", "linkedinOutreach"] as GrindMetricKey[]).map((k) => (
            <MetricSection key={k} metricKey={k} />
          ))}
        </TabsContent>

        {/* ── Side Hustle tab ──────────────────────────────────────────── */}
        <TabsContent value="hustle" className="mt-0">
          <SideHustleEngine />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Shared sub-components ─────────────────────────────────────────────────
function SummaryCard({
  icon,
  label,
  value,
  numeric = true,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  numeric?: boolean;
}) {
  return (
    <div className="glass rounded-xl p-4">
      <div className="flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
        {icon}
      </div>
      <p className={`mt-2 font-semibold ${numeric ? "text-2xl tabular-nums" : "text-lg tabular-nums"}`}>
        {value}
      </p>
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
