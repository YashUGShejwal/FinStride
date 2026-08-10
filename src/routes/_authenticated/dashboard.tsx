import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { ArrowDownRight, ArrowUpRight, Wallet, TrendingUp, Shield, Activity } from "lucide-react";
import { useStore } from "@/lib/store";
import { inr, fmtDate } from "@/lib/format";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { Sensitive } from "@/components/Sensitive";
import { DailyQuoteFooter } from "@/components/DailyQuoteFooter";

export const Route = createFileRoute("/_authenticated/dashboard")({ component: Dashboard });

const TRANSFER_CATS = new Set(["Capital Transfer (In)", "Capital Transfer (Out)"]);

function Dashboard() {
  const { transactions, trades, blueprintSettings } = useStore();

  const stats = useMemo(() => {
    // Capital transfers are excluded from operational income/expense — they only move money
    const operational = transactions.filter((t) => !TRANSFER_CATS.has(t.category));
    const income  = operational.filter((t) => t.type === "income" ).reduce((a, b) => a + b.amount, 0);
    const expense = operational.filter((t) => t.type === "expense").reduce((a, b) => a + b.amount, 0);
    const commitments = blueprintSettings.fixedRunrate + blueprintSettings.scooterEmi;
    const runway = blueprintSettings.defaultSalary - commitments;
    return { income, expense, commitments, runway, net: income - expense };
  }, [transactions, blueprintSettings]);

  const recent = transactions.slice(0, 5);

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Glance Hub</p>
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
          value={blueprintSettings.defaultSalary}
          hint="Fixed monthly income"
        />
        <KpiCard
          tone="success"
          icon={<Shield className="size-5" />}
          label="Fixed Operational Runway"
          value={stats.runway}
          hint={
            <>
              After <Sensitive><span className="tnum">{inr(stats.commitments)}</span></Sensitive>{" "}
              commitments
            </>
          }
        />
        <KpiCard
          tone="danger"
          icon={<Activity className="size-5" />}
          label="Active Commitments"
          value={stats.commitments}
          hint={
            <>
              <Sensitive><span className="tnum">{inr(blueprintSettings.fixedRunrate)}</span></Sensitive>{" "}
              runrate +{" "}
              <Sensitive><span className="tnum">{inr(blueprintSettings.scooterEmi)}</span></Sensitive>{" "}
              EMI
            </>
          }
        />
      </section>

      {/* Secondary stats */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MiniStat
          label="Income (logged)"
          icon={<ArrowUpRight className="size-4 text-[oklch(0.72_0.18_155)]" />}
        >
          <Sensitive><AnimatedNumber value={stats.income} format={inr} /></Sensitive>
        </MiniStat>
        <MiniStat
          label="Expenses (logged)"
          icon={<ArrowDownRight className="size-4 text-[oklch(0.7_0.22_20)]" />}
        >
          <Sensitive><AnimatedNumber value={stats.expense} format={inr} /></Sensitive>
        </MiniStat>
        <MiniStat label="Net flow" icon={<Wallet className="size-4 text-primary" />}>
          <Sensitive><AnimatedNumber value={stats.net} format={inr} /></Sensitive>
        </MiniStat>
        <MiniStat label="Active trades" icon={<TrendingUp className="size-4 text-accent" />}>
          {String(trades.length)}
        </MiniStat>
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
                    <p className="text-xs text-muted-foreground">{fmtDate(t.date)} • {t.account}</p>
                  </div>
                </div>
                <p className={`font-semibold tnum ${t.type === "income" ? "text-[oklch(0.78_0.16_155)]" : "text-[oklch(0.75_0.18_25)]"}`}>
                  <Sensitive>
                    {t.type === "income" ? "+" : "−"}{inr(t.amount)}
                  </Sensitive>
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

      <DailyQuoteFooter />
    </div>
  );
}

function KpiCard({ tone, icon, label, value, hint }: { tone: "primary" | "success" | "danger"; icon: React.ReactNode; label: string; value: number; hint: React.ReactNode }) {
  const grad = tone === "primary" ? "gradient-primary" : tone === "success" ? "gradient-success" : "gradient-danger";
  return (
    <div className="glass kpi-card rounded-2xl p-5 relative overflow-hidden">
      <div className={`absolute -right-10 -top-10 size-32 ${grad} opacity-20 blur-2xl rounded-full`} />
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
        <div className={`size-9 rounded-xl ${grad} grid place-items-center text-background`}>{icon}</div>
      </div>
      <p className="text-3xl font-semibold mt-3 tnum">
        <Sensitive><AnimatedNumber value={value} format={inr} /></Sensitive>
      </p>
      <p className="text-xs text-muted-foreground mt-1">{hint}</p>
    </div>
  );
}

function MiniStat({ label, children, icon }: { label: string; children: React.ReactNode; icon: React.ReactNode }) {
  return (
    <div className="glass kpi-card rounded-xl p-4">
      <div className="flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
        {icon}
      </div>
      <p className="text-lg font-semibold mt-2 tnum">{children}</p>
    </div>
  );
}
