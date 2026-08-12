import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { LogOut, Mail, Shield, Wallet, TrendingUp } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useStore } from "@/lib/store";
import { Sensitive } from "@/components/Sensitive";
import { Button } from "@/components/ui/button";
import { inr } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/profile")({ component: ProfilePage });

function ProfilePage() {
  const { user, signOut } = useAuth();
  const { transactions, trades, blueprintSettings, riskCapCapital, investmentApps, partitionLabel } = useStore();
  const nav = useNavigate();

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Account</p>
        <h1 className="text-3xl md:text-4xl font-display font-semibold tracking-tight mt-1">Your <span className="text-gradient">profile</span></h1>
      </header>

      <section className="glass-strong rounded-2xl p-6 flex items-center gap-4">
        <div className="size-16 rounded-2xl gradient-primary grid place-items-center text-2xl font-bold text-primary-foreground glow">
          {(user?.name ?? "U")[0].toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="text-lg font-semibold truncate">{user?.name}</p>
          <p className="text-sm text-muted-foreground flex items-center gap-1.5 truncate"><Mail className="size-3.5" /> {user?.email}</p>
        </div>
      </section>

      <section className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Stat icon={<Wallet className="size-4 text-primary" />} label="Transactions" value={String(transactions.length)} />
        <Stat icon={<TrendingUp className="size-4 text-accent" />} label="Swing trades" value={String(trades.length)} />
        <Stat
          icon={<Shield className="size-4 text-[oklch(0.78_0.16_155)]" />}
          label="Risk cap"
          value={
            <Sensitive>
              {riskCapCapital > 0
                ? inr(riskCapCapital * blueprintSettings.defaultRiskCapPct)
                : `${(blueprintSettings.defaultRiskCapPct * 100).toFixed(1)}%`}
            </Sensitive>
          }
        />
      </section>

      <section className="glass rounded-2xl p-5">
        <h2 className="font-display font-semibold tracking-tight">Investment partitions</h2>
        <p className="text-xs text-muted-foreground mt-0.5 mb-4">Active broker accounts tracked in FinStride</p>
        <ul className="space-y-2">
          {investmentApps.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 py-2 border-b border-glass-border/50 last:border-0">
              <div>
                <p className="text-sm font-medium">{a.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{a.description}</p>
              </div>
              <div className="flex gap-1 flex-wrap justify-end">
                {a.scopes.map((s) => (
                  <span key={s} className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/8 text-muted-foreground">
                    {s}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="glass rounded-2xl p-5">
        <h2 className="font-display font-semibold tracking-tight">Blueprint</h2>
        <ul className="mt-3 text-sm space-y-2 text-muted-foreground">
          <li>• Salary baseline <Sensitive><span className="text-foreground font-medium tnum">{inr(blueprintSettings.defaultSalary)}</span></Sensitive></li>
          <li>• Fixed runrate <Sensitive><span className="text-foreground font-medium tnum">{inr(blueprintSettings.fixedRunrate)}</span></Sensitive> + loan EMI <Sensitive><span className="text-foreground font-medium tnum">{inr(blueprintSettings.scooterEmi)}</span></Sensitive></li>
          <li>• <span className="text-foreground font-medium tnum">{(blueprintSettings.defaultRiskCapPct * 100).toFixed(1)}%</span> per-trade risk cap on latest {partitionLabel(blueprintSettings.riskCapPartition)} snapshot</li>
          <li>• F&O instruments blocked at the input layer</li>
        </ul>
      </section>

      <Button onClick={async () => { await signOut(); nav({ to: "/login" }); }}
        variant="secondary" className="w-full gap-2 h-11 glass-strong border-glass-border">
        <LogOut className="size-4" /> Sign out
      </Button>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="glass kpi-card rounded-xl p-4">
      <div className="flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
        {icon}
      </div>
      <p className="text-lg font-semibold mt-2 tnum">{value}</p>
    </div>
  );
}
