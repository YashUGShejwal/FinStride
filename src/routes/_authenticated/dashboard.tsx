import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { ArrowDownRight, ArrowUpRight, Wallet, TrendingUp, Shield, Activity } from "lucide-react";
import { useStore, BLUEPRINT } from "@/lib/store";
import { inr, fmtDate } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/dashboard")({ component: Dashboard });

function Dashboard() {
  const { transactions, trades } = useStore();

  const stats = useMemo(() => {
    const income = transactions.filter((t) => t.type === "income").reduce((a, b) => a + b.amount, 0);
    const expense = transactions.filter((t) => t.type === "expense").reduce((a, b) => a + b.amount, 0);
    const commitments = BLUEPRINT.fixedRunrate + BLUEPRINT.scooterEmi;
    const runway = (BLUEPRINT.salaryBaseline - commitments);
    return { income, expense, commitments, runway, net: income - expense };
  }, [transactions]);

  const recent = transactions.slice(0, 5);

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Command Deck</p>
        <h1 className="text-3xl md:text-4xl font-semibold mt-1">
          Your <span className="text-gradient">runway</span> at a glance
        </h1>
        <p className="text-sm text-muted-foreground mt-2">Blueprint-enforced cashflow + disciplined swing trading.</p>
      </header>

      {/* KPI Cards */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KpiCard
          tone="primary"
          icon={<Wallet className="size-5" />}
          label="Monthly Salary Baseline"
          value={inr(BLUEPRINT.salaryBaseline)}
          hint="Fixed monthly income"
        />
        <KpiCard
          tone="success"
          icon={<Shield className="size-5" />}
          label="Fixed Operational Runway"
          value={inr(stats.runway)}
          hint={`After ${inr(stats.commitments)} commitments`}
        />
        <KpiCard
          tone="danger"
          icon={<Activity className="size-5" />}
          label="Active Commitments"
          value={inr(stats.commitments)}
          hint={`${inr(BLUEPRINT.fixedRunrate)} runrate + ${inr(BLUEPRINT.scooterEmi)} EMI`}
        />
      </section>

      {/* Secondary stats */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MiniStat label="Income (logged)" value={inr(stats.income)} icon={<ArrowUpRight className="size-4 text-[oklch(0.72_0.18_155)]" />} />
        <MiniStat label="Expenses (logged)" value={inr(stats.expense)} icon={<ArrowDownRight className="size-4 text-[oklch(0.7_0.22_20)]" />} />
        <MiniStat label="Net flow" value={inr(stats.net)} icon={<Wallet className="size-4 text-primary" />} />
        <MiniStat label="Active trades" value={String(trades.length)} icon={<TrendingUp className="size-4 text-accent" />} />
      </section>

      {/* Recent ledger */}
      <section className="glass rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-semibold">Recent Transactions</h2>
            <p className="text-xs text-muted-foreground">Latest 5 movements</p>
          </div>
          <Link to="/cashflow" className="text-xs text-primary hover:underline">Open ledger →</Link>
        </div>
        {recent.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">No transactions yet.</p>
        ) : (
          <ul className="divide-y divide-glass-border">
            {recent.map((t) => (
              <li key={t.id} className="py-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`size-9 rounded-xl grid place-items-center ${t.type === "income" ? "gradient-success" : "gradient-danger"}`}>
                    {t.type === "income" ? <ArrowUpRight className="size-4 text-background" /> : <ArrowDownRight className="size-4 text-background" />}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{t.category}</p>
                    <p className="text-xs text-muted-foreground">{fmtDate(t.date)} • {t.paymentMode}</p>
                  </div>
                </div>
                <p className={`font-semibold tabular-nums ${t.type === "income" ? "text-[oklch(0.78_0.16_155)]" : "text-[oklch(0.75_0.18_25)]"}`}>
                  {t.type === "income" ? "+" : "−"}{inr(t.amount)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid md:grid-cols-2 gap-4">
        <Link to="/cashflow" className="glass rounded-2xl p-5 hover:glow transition-all group">
          <Wallet className="size-6 text-primary mb-3" />
          <p className="font-semibold">Log a transaction</p>
          <p className="text-sm text-muted-foreground mt-1">Add income or expense to the ledger.</p>
        </Link>
        <Link to="/swing" className="glass rounded-2xl p-5 hover:glow transition-all group">
          <TrendingUp className="size-6 text-accent mb-3" />
          <p className="font-semibold">Log a swing trade</p>
          <p className="text-sm text-muted-foreground mt-1">Equity only. 3% risk cap. F&O blocked.</p>
        </Link>
      </section>
    </div>
  );
}

function KpiCard({ tone, icon, label, value, hint }: { tone: "primary" | "success" | "danger"; icon: React.ReactNode; label: string; value: string; hint: string }) {
  const grad = tone === "primary" ? "gradient-primary" : tone === "success" ? "gradient-success" : "gradient-danger";
  return (
    <div className="glass rounded-2xl p-5 relative overflow-hidden">
      <div className={`absolute -right-10 -top-10 size-32 ${grad} opacity-20 blur-2xl rounded-full`} />
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
        <div className={`size-9 rounded-xl ${grad} grid place-items-center text-background`}>{icon}</div>
      </div>
      <p className="text-3xl font-semibold mt-3 tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{hint}</p>
    </div>
  );
}

function MiniStat({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="glass rounded-xl p-4">
      <div className="flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
        {icon}
      </div>
      <p className="text-lg font-semibold mt-2 tabular-nums">{value}</p>
    </div>
  );
}
