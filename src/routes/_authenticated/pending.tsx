import { createFileRoute } from "@tanstack/react-router";
import { CheckSquare, Square, CreditCard, CalendarCheck } from "lucide-react";
import { useStore, type ObligationKey } from "@/lib/store";
import { inr } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/pending")({ component: PendingPage });

type Obligation = {
  key: ObligationKey;
  label: string;
  amount: number;
  description: string;
};

function PendingPage() {
  const { creditCardDues, pendingChecklist, toggleObligation, blueprintSettings } = useStore();

  const OBLIGATIONS: Obligation[] = [
    {
      key: "fixedRunrate",
      label: "Rent / Fixed Runrate",
      amount: blueprintSettings.fixedRunrate,
      description: `Monthly operational expenses — blueprint threshold ${inr(blueprintSettings.fixedRunrate)}`,
    },
    {
      key: "scooterEmi",
      label: "Scooter EMI",
      amount: blueprintSettings.scooterEmi,
      description: `Fixed at ${inr(blueprintSettings.scooterEmi)} / month`,
    },
    {
      key: "growwMfSip",
      label: "Groww MF SIP",
      amount: blueprintSettings.growwMfSip,
      description: `Monthly mutual fund SIP commitment — ${inr(blueprintSettings.growwMfSip)}`,
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
    <div className="space-y-6">
      <header>
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Module</p>
        <h1 className="text-3xl md:text-4xl font-semibold mt-1">
          <span className="text-gradient">Pending</span> payments
        </h1>
        <p className="text-sm text-muted-foreground mt-2">
          {month} — clear dues before deploying your runway.
        </p>
      </header>

      {/* Credit Card Outstanding */}
      <section className="glass-strong rounded-2xl p-5 md:p-6">
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
            className={`text-4xl font-semibold tabular-nums ${
              creditCardDues > 0 ? "text-[oklch(0.78_0.18_25)]" : "text-[oklch(0.78_0.16_155)]"
            }`}
          >
            {inr(creditCardDues)}
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
            No credit card expenses logged yet. Add entries in the Cashflow ledger with mode "Credit
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
              {settledPct > 0
                ? `${inr(settledAmount)} cleared of ${inr(totalObligation)} total`
                : `${inr(totalObligation)} in commitments this month`}
            </p>
          </div>
          <span className="text-sm font-semibold tabular-nums text-muted-foreground shrink-0">
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
                    className={`tabular-nums font-semibold text-sm shrink-0 transition-colors ${
                      paid ? "text-[oklch(0.78_0.16_155)]" : ""
                    }`}
                  >
                    {inr(ob.amount)}
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
            <span>{settledPct}% of fixed obligations marked paid</span>
            <span>
              {inr(totalObligation - settledAmount)} remaining
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
